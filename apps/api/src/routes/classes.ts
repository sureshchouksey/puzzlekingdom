import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { classes, subjects, documents, questions } from "../db/schema.js";

// Class -> Subject -> Topic browsing structure. A "class" is the audience
// content targets (e.g. "11+ Grammar Prep", "Year 3"); subjects (Maths,
// English, ...) exist within a class via the documents seeded/generated
// under it; topics are free-text tags on individual questions (a question
// can carry more than one), derived from whatever values actually exist
// rather than a fixed list.
export async function classRoutes(app: FastifyInstance) {
  app.get("/classes", async () => {
    return db.select().from(classes).orderBy(classes.name);
  });

  // Distinct subjects that have at least one document under this class.
  app.get<{ Params: { id: string } }>("/classes/:id/subjects", async (request, reply) => {
    const { id } = request.params;

    const [classRow] = await db.select().from(classes).where(eq(classes.id, id)).limit(1);
    if (!classRow) return reply.status(404).send({ error: "Class not found" });

    const rows = await db
      .selectDistinct({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .innerJoin(documents, eq(documents.subjectId, subjects.id))
      .where(eq(documents.classId, id))
      .orderBy(subjects.name);

    return rows;
  });

  // Distinct topic tags for a class + subject combination - what the app
  // offers as topic filter options for a quiz. Both query params are
  // optional: omit classId to search across all classes for that subject,
  // omit subjectName to search across all subjects for that class. Unnests
  // each question's tag array so a question tagged with two topics shows
  // up under both.
  app.get<{ Querystring: { classId?: string; subjectName?: string } }>("/topics", async (request, reply) => {
    const { classId, subjectName } = request.query;

    let subjectId: string | undefined;
    if (subjectName) {
      const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
      if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });
      subjectId = subject.id;
    }

    const conditions = [sql`${questions.topics} is not null`];
    if (subjectId) conditions.push(sql`${questions.subjectId} = ${subjectId}`);
    if (classId) conditions.push(sql`${documents.classId} = ${classId}`);

    const whereClause = sql.join(conditions, sql` and `);

    const rows = await db.execute<{ topic: string }>(sql`
      select distinct unnest(${questions.topics}) as topic
      from ${questions}
      inner join ${documents} on ${questions.documentId} = ${documents.id}
      where ${whereClause}
      order by topic
    `);

    return rows.map((r) => r.topic);
  });
}
