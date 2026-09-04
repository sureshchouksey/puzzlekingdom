import type { FastifyInstance } from "fastify";
import { eq, and, desc, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { subjects, classes, quizAttempts } from "../db/schema.js";

const DEFAULT_HISTORY_LIMIT = 20;

// Progress reports, built on top of the topic-progress snapshot each quiz
// attempt saves at submit time (see buildTopicBreakdown in routes/quizzes.ts).
// There are no parent/child accounts yet (MVP1 is a single shared space),
// so "reports" here means the shared history of every quiz anyone's taken,
// filterable by class/subject - not a per-child view. That's the natural
// next step once accounts exist, not a redesign of this data.
export async function reportRoutes(app: FastifyInstance) {
  // History: every completed quiz attempt (most recent first), each with
  // its own saved topic breakdown - a "report" per quiz taken.
  app.get<{ Querystring: { subjectName?: string; classId?: string; limit?: string } }>(
    "/reports",
    async (request, reply) => {
      const { subjectName, classId } = request.query;
      const limit = Math.min(Number(request.query.limit) || DEFAULT_HISTORY_LIMIT, 100);

      let subjectId: string | undefined;
      if (subjectName) {
        const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
        if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });
        subjectId = subject.id;
      }

      const conditions = [isNotNull(quizAttempts.completedAt)];
      if (subjectId) conditions.push(eq(quizAttempts.subjectId, subjectId));
      if (classId) conditions.push(eq(quizAttempts.classId, classId));

      const rows = await db
        .select({
          id: quizAttempts.id,
          subjectName: subjects.name,
          className: classes.name,
          score: quizAttempts.score,
          totalQuestions: quizAttempts.totalQuestions,
          completedAt: quizAttempts.completedAt,
          topicBreakdown: quizAttempts.topicBreakdown,
        })
        .from(quizAttempts)
        .innerJoin(subjects, eq(quizAttempts.subjectId, subjects.id))
        .leftJoin(classes, eq(quizAttempts.classId, classes.id))
        .where(and(...conditions))
        .orderBy(desc(quizAttempts.completedAt))
        .limit(limit);

      return rows;
    }
  );

  // Aggregated accuracy per topic across every matching completed attempt -
  // not just the last quiz. Sums each attempt's saved per-topic
  // correct/total, so a question tagged with more than one topic counts
  // toward each of its tags, same as within a single attempt. Sorted
  // weakest-first (lowest accuracy), since the point is showing a student
  // where to focus, not just listing topics alphabetically.
  app.get<{ Querystring: { subjectName?: string; classId?: string } }>(
    "/reports/topics",
    async (request, reply) => {
      const { subjectName, classId } = request.query;

      let subjectId: string | undefined;
      if (subjectName) {
        const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
        if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });
        subjectId = subject.id;
      }

      const conditions = [sql`${quizAttempts.topicBreakdown} is not null`];
      if (subjectId) conditions.push(sql`${quizAttempts.subjectId} = ${subjectId}`);
      if (classId) conditions.push(sql`${quizAttempts.classId} = ${classId}`);

      const whereClause = sql.join(conditions, sql` and `);

      const rows = await db.execute<{ topic: string; correct: number; total: number; attempts: number }>(sql`
        select
          t.key as topic,
          sum((t.value->>'correct')::int) as correct,
          sum((t.value->>'total')::int) as total,
          count(distinct ${quizAttempts.id}) as attempts
        from ${quizAttempts}
        cross join lateral jsonb_each(${quizAttempts.topicBreakdown}) as t(key, value)
        where ${whereClause}
        group by t.key
        order by (sum((t.value->>'correct')::int)::float / nullif(sum((t.value->>'total')::int), 0)) asc nulls last
      `);

      return rows.map((r) => ({
        topic: r.topic,
        correct: Number(r.correct),
        total: Number(r.total),
        accuracy: Number(r.total) > 0 ? Number(r.correct) / Number(r.total) : null,
        attempts: Number(r.attempts),
      }));
    }
  );
}
