import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Ranks every profile by total stages cleared (summed across all their
// quiz attempts, completed or still in progress - stages_cleared is kept
// accurate on every stage submission, not just at final completion),
// with accuracy as the secondary sort. Optionally scoped to one class,
// since comparing an 11+ attempt to a Year 3 attempt doesn't mean much.
export async function leaderboardRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { classId?: string } }>("/leaderboard", async (request) => {
    const { classId } = request.query;

    const classFilter = classId ? sql`and qa.class_id = ${classId}` : sql``;

    // Two separate aggregations (not one join) deliberately: joining
    // quiz_attempts straight to quiz_attempt_answers and then summing
    // quiz_attempts.stages_cleared would double-count it once per answer
    // row on that attempt (a classic join fan-out bug) - a 4-question
    // attempt with stages_cleared=1 would sum to 4, not 1. Aggregating
    // attempts and answers independently first, then joining those two
    // pre-aggregated results to profiles, avoids that entirely.
    const rows = await db.execute<{
      profile_id: string;
      name: string;
      title: string | null;
      quizzes_played: number;
      stages_cleared: number;
      questions_answered: number;
      questions_correct: number;
    }>(sql`
      with attempt_agg as (
        select
          qa.profile_id,
          count(*) as quizzes_played,
          coalesce(sum(qa.stages_cleared), 0) as stages_cleared
        from quiz_attempts qa
        where qa.profile_id is not null ${classFilter}
        group by qa.profile_id
      ),
      answer_agg as (
        select
          qa.profile_id,
          count(qaa.id) as questions_answered,
          count(qaa.id) filter (where qaa.is_correct) as questions_correct
        from quiz_attempts qa
        inner join quiz_attempt_answers qaa on qaa.attempt_id = qa.id
        where qa.profile_id is not null ${classFilter}
        group by qa.profile_id
      )
      select
        p.id as profile_id,
        p.name,
        p.title,
        coalesce(attempt_agg.quizzes_played, 0) as quizzes_played,
        coalesce(attempt_agg.stages_cleared, 0) as stages_cleared,
        coalesce(answer_agg.questions_answered, 0) as questions_answered,
        coalesce(answer_agg.questions_correct, 0) as questions_correct
      from profiles p
      left join attempt_agg on attempt_agg.profile_id = p.id
      left join answer_agg on answer_agg.profile_id = p.id
      order by
        coalesce(attempt_agg.stages_cleared, 0) desc,
        (coalesce(answer_agg.questions_correct, 0)::float / nullif(answer_agg.questions_answered, 0)) desc nulls last,
        p.name asc
    `);

    return rows.map((r) => ({
      profileId: r.profile_id,
      name: r.name,
      title: r.title,
      quizzesPlayed: Number(r.quizzes_played),
      stagesCleared: Number(r.stages_cleared),
      questionsAnswered: Number(r.questions_answered),
      questionsCorrect: Number(r.questions_correct),
      accuracy: Number(r.questions_answered) > 0 ? Number(r.questions_correct) / Number(r.questions_answered) : null,
    }));
  });
}
