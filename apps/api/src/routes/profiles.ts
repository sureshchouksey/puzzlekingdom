import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { profiles } from "../db/schema.js";

const PIN_PATTERN = /^\d{4}$/;

// Strips pin_hash (and anything else internal) before a profile ever goes
// back to a client - the hash should never leave the server.
function publicProfile(p: typeof profiles.$inferSelect) {
  return { id: p.id, name: p.name, title: p.title };
}

// Lightweight named player profiles, now with a real 4-digit PIN each -
// see schema.ts's pinHash comment. The flow from the Welcome screen is:
//   1. POST /profiles {name}            - find-or-create by name, no PIN check yet
//   2. if the response says hasPin=false - POST /profiles/:id/set-pin (bootstrap, one-time only)
//   3. if hasPin=true                    - POST /profiles/:id/verify-pin
// Both (2) and (3) are how a session token actually gets issued - there's
// still deliberately no "list every profile" route, so nothing here lets a
// client enumerate the other players' names.
export async function profileRoutes(app: FastifyInstance) {
  // Find-or-create by a case-insensitive, trimmed name match, so re-typing
  // your own name at the Welcome screen reuses your existing profile
  // instead of spawning a duplicate player every time. Never issues a
  // session by itself - that only happens after the PIN step below.
  app.post<{ Body: { name?: string } }>("/profiles", async (request, reply) => {
    const name = request.body?.name?.trim();
    if (!name) return reply.status(400).send({ error: "name is required" });

    const [existing] = await db
      .select()
      .from(profiles)
      .where(sql`lower(${profiles.name}) = lower(${name})`)
      .limit(1);
    if (existing) {
      return reply.send({ ...publicProfile(existing), created: false, hasPin: existing.pinHash !== null });
    }

    const [created] = await db.insert(profiles).values({ name }).returning();
    return reply.status(201).send({ ...publicProfile(created), created: true, hasPin: false });
  });

  // One-time PIN bootstrap: only succeeds while the profile has no PIN yet
  // (a brand-new profile, or an older one from before PINs existed) - once
  // set, this route 409s forever after, so it can never be used to
  // overwrite someone else's PIN just by knowing their profile id. `title`
  // is optional and only applied if the profile doesn't already have one
  // (the prince/princess pick, for a genuinely new profile).
  app.post<{ Params: { id: string }; Body: { pin?: string; title?: string } }>(
    "/profiles/:id/set-pin",
    async (request, reply) => {
      const pin = request.body?.pin;
      const title = request.body?.title?.trim() || undefined;
      if (!pin || !PIN_PATTERN.test(pin)) {
        return reply.status(400).send({ error: "pin must be exactly 4 digits" });
      }

      const [profile] = await db.select().from(profiles).where(eq(profiles.id, request.params.id)).limit(1);
      if (!profile) return reply.status(404).send({ error: "Profile not found" });
      if (profile.pinHash !== null) {
        return reply.status(409).send({ error: "A PIN is already set for this profile - use verify-pin, or an admin reset." });
      }

      const pinHash = await bcrypt.hash(pin, 10);
      const [updated] = await db
        .update(profiles)
        .set({ pinHash, title: profile.title ?? title })
        .where(eq(profiles.id, profile.id))
        .returning();

      const token = await app.jwt.sign(
        { kind: "profile", profileId: updated.id, name: updated.name },
        { expiresIn: "90d" }
      );
      return reply.send({ profile: publicProfile(updated), token });
    }
  );

  // Normal login for a profile that already has a PIN set.
  app.post<{ Params: { id: string }; Body: { pin?: string } }>("/profiles/:id/verify-pin", async (request, reply) => {
    const pin = request.body?.pin;
    if (!pin) return reply.status(400).send({ error: "pin is required" });

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, request.params.id)).limit(1);
    if (!profile) return reply.status(404).send({ error: "Profile not found" });
    if (profile.pinHash === null) {
      return reply.status(409).send({ error: "No PIN set for this profile yet - use set-pin first." });
    }

    const ok = await bcrypt.compare(pin, profile.pinHash);
    if (!ok) return reply.status(401).send({ error: "Incorrect PIN" });

    const token = await app.jwt.sign(
      { kind: "profile", profileId: profile.id, name: profile.name },
      { expiresIn: "90d" }
    );
    return reply.send({ profile: publicProfile(profile), token });
  });
}
