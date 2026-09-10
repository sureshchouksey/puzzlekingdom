import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Ranks every profile by total stars earned - summed across BOTH the
// graded quiz (quiz_attempts.stars_earned, see migration 0019) and the
// Arcade (game_attempts.stars_earned, see migration 0021) - per
// Question-Types-and-Content-Authoring-Plan.md's "Competitive framing"
// section: "the single number that lets her compare directly against
// friends." A round in the Arcade uses the exact same starsForPercent
// band as a quiz stage (lib/scoring.ts), so the two are directly
// comparable and just get added together here rather than tracked as two
// separate scores. Stages cleared stays as the tie-break (then accuracy,
// then name). Optionally scoped to one class, since comparing an 11+
// attempt to a Year 3 attempt doesn't mean much.
export async function leaderboardRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { classId?: string } }>("/leaderboard", async (request) => {
    const { classId } = request.query;

    const classFilter = classId ? sql`and qa.class_id = ${classId}` : sql``;
    const gameClassFilter = classId ? sql`and ga.class_id = ${classId}` : sql``;

    // Three separate aggregations (not one big join) deliberately: joining
    // quiz_attempts straight to quiz_attempt_answers and then summing
    // quiz_attempts.stages_cleared/stars_earned would double-count them
    // once per answer row on that attempt (a classic join fan-out bug) -
    // a 4-question attempt with stages_cleared=1 would sum to 4, not 1.
    // Aggregating attempts, answers, and Arcade rounds independently
    // first, then joining those pre-aggregated results to profiles,
    // avoids that entirely.
    const rows = await db.execute<{
      profile_id: string;
      name: string;
      title: string | null;
      avatar_id: string | null;
      quizzes_played: number;
      stages_cleared: number;
      quiz_stars_earned: number;
      questions_answered: number;
      questions_correct: number;
      games_played: number;
      game_stars_earned: number;
    }>(sql`
      with attempt_agg as (
        select
          qa.profile_id,
          count(*) as quizzes_played,
          coalesce(sum(qa.stages_cleared), 0) as stages_cleared,
          coalesce(sum(qa.stars_earned), 0) as stars_earned
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
      ),
      game_agg as (
        select
          ga.profile_id,
          count(*) as games_played,
          coalesce(sum(ga.stars_earned), 0) as stars_earned
        from game_attempts ga
        where ga.profile_id is not null ${gameClassFilter}
        group by ga.profile_id
      )
      select
        p.id as profile_id,
        p.name,
        p.title,
        p.avatar_id,
        coalesce(attempt_agg.quizzes_played, 0) as quizzes_played,
        coalesce(attempt_agg.stages_cleared, 0) as stages_cleared,
        coalesce(attempt_agg.stars_earned, 0) as quiz_stars_earned,
        coalesce(answer_agg.questions_answered, 0) as questions_answered,
        coalesce(answer_agg.questions_correct, 0) as questions_correct,
        coalesce(game_agg.games_played, 0) as games_played,
        coalesce(game_agg.stars_earned, 0) as game_stars_earned
      from profiles p
      left join attempt_agg on attempt_agg.profile_id = p.id
      left join answer_agg on answer_agg.profile_id = p.id
      left join game_agg on game_agg.profile_id = p.id
      order by
        (coalesce(attempt_agg.stars_earned, 0) + coalesce(game_agg.stars_earned, 0)) desc,
        coalesce(attempt_agg.stages_cleared, 0) desc,
        (coalesce(answer_agg.questions_correct, 0)::float / nullif(answer_agg.questions_answered, 0)) desc nulls last,
        p.name asc
    `);

    return rows.map((r) => {
      const quizStars = Number(r.quiz_stars_earned);
      const gameStars = Number(r.game_stars_earned);
      return {
        profileId: r.profile_id,
        name: r.name,
        title: r.title,
        avatarId: r.avatar_id,
        quizzesPlayed: Number(r.quizzes_played),
        stagesCleared: Number(r.stages_cleared),
        // Combined total - what the leaderboard actually ranks by.
        starsEarned: quizStars + gameStars,
        quizStarsEarned: quizStars,
        gamesPlayed: Number(r.games_played),
        gameStarsEarned: gameStars,
        questionsAnswered: Number(r.questions_answered),
        questionsCorrect: Number(r.questions_correct),
        accuracy: Number(r.questions_answered) > 0 ? Number(r.questions_correct) / Number(r.questions_answered) : null,
      };
    });
  });
}
