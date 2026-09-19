import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { flashcards, subjects } from "../db/schema.js";
import { requireIdentity } from "../auth.js";

// Read-only for now - flashcards are seeded via
// apps/api/scripts/seed-flashcards.ts, same convention as questions via
// seed-questions.ts, rather than an admin authoring UI (which questions
// already have). Gated behind requireIdentity (any logged-in profile,
// family owner, or admin) rather than left open, since nothing else in
// this app serves content with no auth at all.
export async function flashcardRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { subjectName?: string; topic?: string } }>(
    "/flashcards",
    { preHandler: requireIdentity },
    async (request, reply) => {
      const { subjectName, topic } = request.query;
      if (!subjectName) {
        return reply.status(400).send({ error: "subjectName is required" });
      }

      const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
      if (!subject) {
        return reply.send({ cards: [] });
      }

      const conditions = [eq(flashcards.subjectId, subject.id)];
      if (topic) conditions.push(eq(flashcards.topic, topic));

      const rows = await db
        .select()
        .from(flashcards)
        .where(and(...conditions));

      return reply.send({
        cards: rows.map((c) => ({ id: c.id, topic: c.topic, front: c.front, back: c.back })),
      });
    }
  );
}
