import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { families, familyOwners, profiles } from "../db/schema.js";
import { requireFamilyOwner } from "../auth.js";

const PIN_PATTERN = /^\d{4}$/;
const pinSchema = z.string().regex(PIN_PATTERN, "PIN must be exactly 4 digits");

// Strips pin_hash before a family owner ever goes back to a client - same
// convention as profiles.ts's publicProfile for its own pinHash.
function publicOwner(o: typeof familyOwners.$inferSelect) {
  return { id: o.id, familyId: o.familyId, email: o.email };
}

function publicProfile(p: typeof profiles.$inferSelect) {
  return { id: p.id, name: p.name, title: p.title, avatarId: p.avatarId, yearGroup: p.yearGroup };
}

const signupSchema = z.object({
  familyName: z.string().trim().min(1).optional(),
  email: z.string().trim().email(),
  // A 4-digit PIN, same as a child profile's own login (migration 0025) -
  // not a full password. See that migration's own comment for why.
  pin: pinSchema,
  // The first child profile is optional at signup time - a family can be
  // created with no kids yet and add one afterwards via
  // POST /families/me/profiles.
  childNickname: z.string().trim().min(1).optional(),
  childYearGroup: z.string().trim().min(1).optional(),
  childTitle: z.string().trim().min(1).optional(),
  childAvatarId: z.string().trim().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  pin: pinSchema,
});

const addOwnerSchema = z.object({
  email: z.string().trim().email(),
  pin: pinSchema,
});

const addProfileSchema = z.object({
  // Nickname + year group per the Children's Code data-minimization
  // decision (migration 0024) - NOT a real first name, unlike the 13
  // profiles that predate the family flow.
  nickname: z.string().trim().min(1),
  yearGroup: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  avatarId: z.string().trim().min(1).optional(),
});

// The Track 7 multi-family platform: any family can sign up, log in as one
// or more parent/guardian owners (by email + a 4-digit PIN, same keypad
// UI and credential weight as a child's own login - migration 0025), and
// manage their own kids' profiles - separate from both the passwordless
// player profiles (profiles.ts) and the platform-wide admins table
// (admin.ts), which keeps its full cross-family visibility unchanged and
// still authenticates with a real username+password (see routes/admin.ts).
// Family scoping here is enforced at the application layer (every
// /families/me/* route filters by the caller's own familyId from their
// JWT) rather than Postgres RLS - see migration 0024's header comment for
// why RLS isn't in this pass.
export async function familyRoutes(app: FastifyInstance) {
  // Creates a new family + its first owner (and optionally its first
  // child profile) in one transaction, and immediately logs the owner in.
  app.post<{ Body: z.infer<typeof signupSchema> }>("/families/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    }
    const body = parsed.data;

    const [existingOwner] = await db.select().from(familyOwners).where(eq(familyOwners.email, body.email)).limit(1);
    if (existingOwner) {
      return reply.status(409).send({ error: "An account with this email already exists - log in instead." });
    }

    const pinHash = await bcrypt.hash(body.pin, 10);

    const result = await db.transaction(async (tx) => {
      const [family] = await tx
        .insert(families)
        .values({ name: body.familyName ?? `${body.email.split("@")[0]}'s Family` })
        .returning();

      const [owner] = await tx
        .insert(familyOwners)
        .values({ familyId: family.id, email: body.email, pinHash })
        .returning();

      let profile: typeof profiles.$inferSelect | undefined;
      if (body.childNickname) {
        [profile] = await tx
          .insert(profiles)
          .values({
            name: body.childNickname,
            title: body.childTitle,
            avatarId: body.childAvatarId,
            yearGroup: body.childYearGroup,
            familyId: family.id,
          })
          .returning();
      }

      return { family, owner, profile };
    });

    const token = await app.jwt.sign(
      { kind: "family_owner", familyId: result.family.id, ownerId: result.owner.id, email: result.owner.email },
      { expiresIn: "90d" }
    );

    return reply.status(201).send({
      family: { id: result.family.id, name: result.family.name },
      owner: publicOwner(result.owner),
      profile: result.profile ? publicProfile(result.profile) : undefined,
      token,
    });
  });

  app.post<{ Body: z.infer<typeof loginSchema> }>("/families/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    }
    const { email, pin } = parsed.data;

    const [owner] = await db.select().from(familyOwners).where(eq(familyOwners.email, email)).limit(1);
    if (!owner || !(await bcrypt.compare(pin, owner.pinHash))) {
      return reply.status(401).send({ error: "Invalid email or PIN" });
    }

    const token = await app.jwt.sign(
      { kind: "family_owner", familyId: owner.familyId, ownerId: owner.id, email: owner.email },
      { expiresIn: "90d" }
    );
    return reply.send({ owner: publicOwner(owner), token });
  });

  // Adds a second (or third, ...) owner to the caller's own family -
  // "multiple owners per family from day one" per the confirmed decision,
  // e.g. both parents logging in independently to the same family, each
  // with their own email + PIN.
  app.post<{ Body: z.infer<typeof addOwnerSchema> }>(
    "/families/me/owners",
    { preHandler: requireFamilyOwner },
    async (request, reply) => {
      const parsed = addOwnerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
      }
      const { email, pin } = parsed.data;
      const identity = request.identity as { kind: "family_owner"; familyId: string };

      const [existing] = await db.select().from(familyOwners).where(eq(familyOwners.email, email)).limit(1);
      if (existing) {
        return reply.status(409).send({ error: "An account with this email already exists." });
      }

      const pinHash = await bcrypt.hash(pin, 10);
      const [owner] = await db
        .insert(familyOwners)
        .values({ familyId: identity.familyId, email, pinHash })
        .returning();

      return reply.status(201).send({ owner: publicOwner(owner) });
    }
  );

  // Every child profile belonging to the caller's own family - the
  // family-scoped equivalent of admin.ts's GET /admin/users, but never
  // returns another family's profiles no matter what's requested, since
  // the filter comes from the caller's own JWT, not a query param.
  app.get("/families/me/profiles", { preHandler: requireFamilyOwner }, async (request, reply) => {
    const identity = request.identity as { kind: "family_owner"; familyId: string };
    const rows = await db.select().from(profiles).where(eq(profiles.familyId, identity.familyId));
    return reply.send({ profiles: rows.map(publicProfile) });
  });

  // Adds a new child profile to the caller's own family. Returns the
  // created profile with no PIN set yet - the existing
  // POST /profiles/:id/set-pin route (profiles.ts) is reused for the
  // one-time PIN bootstrap step, exactly as it already works for any
  // profile by id.
  app.post<{ Body: z.infer<typeof addProfileSchema> }>(
    "/families/me/profiles",
    { preHandler: requireFamilyOwner },
    async (request, reply) => {
      const parsed = addProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
      }
      const body = parsed.data;
      const identity = request.identity as { kind: "family_owner"; familyId: string };

      const [profile] = await db
        .insert(profiles)
        .values({
          name: body.nickname,
          title: body.title,
          avatarId: body.avatarId,
          yearGroup: body.yearGroup,
          familyId: identity.familyId,
        })
        .returning();

      return reply.status(201).send({ ...publicProfile(profile), hasPin: false });
    }
  );
}
