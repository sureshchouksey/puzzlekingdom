import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { profiles } from "../db/schema.js";

// Lightweight named player profiles - "who's playing", like a game
// console's profile picker. No passwords, no login: a profile is just a
// name (plus an optional cosmetic title) that quiz attempts and the
// leaderboard can be attributed to.
export async function profileRoutes(app: FastifyInstance) {
  app.get("/profiles", async () => {
    return db.select().from(profiles).orderBy(profiles.name);
  });

  // Find-or-create by a case-insensitive, trimmed name match, so re-typing
  // your own name at the Welcome screen reuses your existing profile
  // instead of spawning a duplicate player every time.
  app.post<{ Body: { name?: string; title?: string } }>("/profiles", async (request, reply) => {
    const name = request.body?.name?.trim();
    const title = request.body?.title?.trim() || undefined;
    if (!name) return reply.status(400).send({ error: "name is required" });

    const [existing] = await db
      .select()
      .from(profiles)
      .where(sql`lower(${profiles.name}) = lower(${name})`)
      .limit(1);
    if (existing) return reply.send(existing);

    const [created] = await db.insert(profiles).values({ name, title }).returning();
    return reply.status(201).send(created);
  });
}
