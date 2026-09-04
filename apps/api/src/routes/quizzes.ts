import type { FastifyInstance } from "fastify";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { subjects, classes, profiles, questions, documents, quizAttempts, quizAttemptAnswers } from "../db/schema.js";

const DEFAULT_STAGE_SIZE = 10;

// Tally correct/total per topic tag across a set of answered questions. A
// question with more than one topic tag (questions.topics is a tag array)
// contributes to every tag it carries - e.g. a question tagged both
// "Fractions, Decimals & Percentages" and "Word Problems" counts toward
// both topics' totals. Questions with no topics tagged are simply skipped
// (they don't contribute to any topic's report).
function buildTopicBreakdown(
  graded: { topics: string[] | null; isCorrect: boolean }[]
): Record<string, { correct: number; total: number }> {
  const breakdown: Record<string, { correct: number; total: number }> = {};
  for (const g of graded) {
    for (const topic of g.topics ?? []) {
      const entry = (breakdown[topic] ??= { correct: 0, total: 0 });
      entry.total += 1;
      if (g.isCorrect) entry.correct += 1;
    }
  }
  return breakdown;
}

// Fisher-Yates - a fresh random order every call. Used to shuffle each
// question's options at serve time (below): the correct answer's POSITION
// in the array is never touched at rest in the database, only how it's
// laid out for this one quiz. Matching an answer's correctness is always
// by option `id`, never by array position, so this is purely cosmetic and
// can't affect scoring - it just stops "the answer is always the 2nd
// option" from being something a quiz-taker can memorize across retakes.
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function quizRoutes(app: FastifyInstance) {
  // Assemble a quiz: by default, pull in EVERY question already saved for
  // this subject (optionally narrowed to one class and/or one topic) - not
  // just a small sample - and create a quiz_attempts row to track it. An
  // explicit `count` still limits how many are picked (used by the
  // smoke-test script), but the app's own UI no longer sends one. Never
  // calls an AI provider - this only ever reads questions that were
  // generated once, earlier, at upload time.
  //
  // The attempt is also broken into "stages" of `stageSize` questions each
  // (clamped to the actual question count picked) - purely a positional
  // grouping of the array returned here, not a separate per-question tag,
  // so /quizzes/:id/submit and the frontend both chunk the same list the
  // same way. With the whole question bank pulled in and a small stage
  // size, this naturally produces many stages (e.g. 200 questions at 10
  // per stage = 20 stages) rather than just one or two.
  app.post<{
    Body: { subjectName?: string; classId?: string; topic?: string; count?: number; profileId?: string; stageSize?: number };
  }>("/quizzes", async (request, reply) => {
    const subjectName = request.body?.subjectName;
    const classId = request.body?.classId;
    const topic = request.body?.topic;
    const profileId = request.body?.profileId;
    // No default cap - omitting `count` pulls in every matching question.
    const count = request.body?.count;

    if (!subjectName) return reply.status(400).send({ error: "subjectName is required" });

    const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
    if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });

    const conditions = [eq(questions.subjectId, subject.id)];
    if (classId) conditions.push(eq(documents.classId, classId));
    // topics is a text[] tag array - a question matches if the requested
    // topic is one of (possibly several) tags on it.
    if (topic) conditions.push(sql`${questions.topics} @> ARRAY[${topic}]::text[]`);

    // Joined with documents so each question can carry its source
    // document's id, class, and (if any) shared reading passage -
    // questions from a comprehension paper all point back to the same
    // passage, which the quiz-taker needs to read before answering, not
    // just derived answers with no source text shown.
    const baseQuery = db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        options: questions.options,
        documentId: questions.documentId,
        passage: documents.passage,
        topics: questions.topics,
      })
      .from(questions)
      .innerJoin(documents, eq(questions.documentId, documents.id))
      .where(and(...conditions))
      .orderBy(sql`random()`);

    const picked = typeof count === "number" ? await baseQuery.limit(count) : await baseQuery;

    if (picked.length === 0) {
      return reply.status(404).send({ error: `No questions saved yet for subject "${subjectName}" matching those filters.` });
    }

    const requestedStageSize = request.body?.stageSize ?? DEFAULT_STAGE_SIZE;
    const stageSize = Math.min(Math.max(1, Math.trunc(requestedStageSize) || DEFAULT_STAGE_SIZE), picked.length);
    const totalStages = Math.ceil(picked.length / stageSize);

    const [attempt] = await db
      .insert(quizAttempts)
      .values({
        subjectId: subject.id,
        classId: classId ?? undefined,
        profileId: profileId ?? undefined,
        totalQuestions: picked.length,
        stageSize,
      })
      .returning();

    // Correct answers and explanations are deliberately withheld here - a
    // quiz-taker shouldn't be able to read them out of the network
    // response before submitting. They come back from /results instead,
    // after the whole attempt is complete.
    return reply.status(201).send({
      attemptId: attempt.id,
      subjectName: subject.name,
      stageSize,
      totalStages,
      questions: picked.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: shuffled(q.options),
        documentId: q.documentId,
        passage: q.passage,
        topics: q.topics,
      })),
    });
  });

  // Score one stage's worth of answers at a time - NOT necessarily the
  // whole quiz in one call. A quiz-taker finishes a stage (say, 5
  // questions), this is called with just those answers, and the response
  // says how many stages are now cleared and whether the whole attempt is
  // complete. Calling this again later with the next stage's answers picks
  // up where it left off. This is what lets stages_cleared - and so the
  // leaderboard - reflect real progress even if a quiz is never finished.
  //
  // Idempotent: any questionId already answered for this attempt is
  // silently skipped rather than double-counted, so a duplicate click (or
  // a caller that resends every answer in one call, as the old one-shot
  // API did) can't inflate the score or the stage count.
  app.post<{ Params: { id: string }; Body: { answers?: { questionId: string; selectedOptionId: string }[] } }>(
    "/quizzes/:id/submit",
    async (request, reply) => {
      const { id } = request.params;
      const answers = request.body?.answers;

      if (!answers || answers.length === 0) {
        return reply.status(400).send({ error: "answers is required and must be non-empty" });
      }

      const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id)).limit(1);
      if (!attempt) return reply.status(404).send({ error: "Quiz attempt not found" });
      if (attempt.completedAt) {
        return reply.status(409).send({ error: "This quiz attempt was already submitted." });
      }

      const alreadyAnswered = await db
        .select({ questionId: quizAttemptAnswers.questionId })
        .from(quizAttemptAnswers)
        .where(eq(quizAttemptAnswers.attemptId, id));
      const alreadyAnsweredIds = new Set(alreadyAnswered.map((a) => a.questionId));

      const newAnswers = answers.filter((a) => !alreadyAnsweredIds.has(a.questionId));

      if (newAnswers.length > 0) {
        const questionIds = newAnswers.map((a) => a.questionId);
        const realQuestions = await db.select().from(questions).where(inArray(questions.id, questionIds));
        const byId = new Map(realQuestions.map((q) => [q.id, q]));

        const rows = newAnswers.map((a) => {
          const question = byId.get(a.questionId);
          return {
            attemptId: id,
            questionId: a.questionId,
            selectedOptionId: a.selectedOptionId,
            isCorrect: question ? question.correctOptionId === a.selectedOptionId : false,
          };
        });

        await db.insert(quizAttemptAnswers).values(rows);
      }

      const totalAnswered = alreadyAnsweredIds.size + newAnswers.length;
      const totalStages = Math.ceil(attempt.totalQuestions / attempt.stageSize);
      const stagesCleared = Math.min(Math.floor(totalAnswered / attempt.stageSize), totalStages);
      const isComplete = totalAnswered >= attempt.totalQuestions;

      // How many of the just-submitted answers were correct, for the
      // stage-cleared interstitial - purely informational about this call,
      // not the overall score.
      const stageScore = await db
        .select({ isCorrect: quizAttemptAnswers.isCorrect })
        .from(quizAttemptAnswers)
        .where(and(eq(quizAttemptAnswers.attemptId, id), inArray(quizAttemptAnswers.questionId, answers.map((a) => a.questionId))));
      const stageCorrect = stageScore.filter((s) => s.isCorrect).length;

      // Full per-question review for just this stage's answers - what was
      // picked, what was actually correct, the explanation, and (for a
      // wrong answer) the memorable tip - so the stage-cleared screen can
      // show a real report instead of only a score, before the player
      // continues to the next stage.
      const stageAnswerRows = await db
        .select({
          questionId: quizAttemptAnswers.questionId,
          selectedOptionId: quizAttemptAnswers.selectedOptionId,
          isCorrect: quizAttemptAnswers.isCorrect,
          questionText: questions.questionText,
          options: questions.options,
          correctOptionId: questions.correctOptionId,
          explanation: questions.explanation,
          tip: questions.tip,
        })
        .from(quizAttemptAnswers)
        .innerJoin(questions, eq(quizAttemptAnswers.questionId, questions.id))
        .where(and(eq(quizAttemptAnswers.attemptId, id), inArray(quizAttemptAnswers.questionId, answers.map((a) => a.questionId))));
      const stageAnswerById = new Map(stageAnswerRows.map((r) => [r.questionId, r]));
      // Reordered to match the order this stage's answers were submitted
      // in (the same order the player saw them), not whatever order the
      // DB happened to return.
      const stageAnswers = answers.flatMap((a) => {
        const r = stageAnswerById.get(a.questionId);
        if (!r) return [];
        return [
          {
            questionId: r.questionId,
            questionText: r.questionText,
            options: r.options,
            selectedOptionId: r.selectedOptionId,
            correctOptionId: r.correctOptionId,
            explanation: r.explanation,
            tip: !r.isCorrect ? r.tip : null,
            isCorrect: r.isCorrect,
          },
        ];
      });

      if (!isComplete) {
        await db.update(quizAttempts).set({ stagesCleared }).where(eq(quizAttempts.id, id));
        return reply.send({
          attemptId: id,
          stagesCleared,
          totalStages,
          stageScore: stageCorrect,
          stageTotal: answers.length,
          isComplete: false,
          answers: stageAnswers,
        });
      }

      // Final stage just submitted - finalize the whole attempt: compute
      // the overall score and topic breakdown from every recorded answer
      // (across every stage, not just this call's), same as the old
      // single-shot submit did.
      const allAnswers = await db
        .select({
          isCorrect: quizAttemptAnswers.isCorrect,
          topics: questions.topics,
        })
        .from(quizAttemptAnswers)
        .innerJoin(questions, eq(quizAttemptAnswers.questionId, questions.id))
        .where(eq(quizAttemptAnswers.attemptId, id));

      const score = allAnswers.filter((a) => a.isCorrect).length;
      const topicBreakdown = buildTopicBreakdown(allAnswers);

      await db
        .update(quizAttempts)
        .set({ completedAt: new Date(), score, topicBreakdown, stagesCleared: totalStages })
        .where(eq(quizAttempts.id, id));

      return reply.send({
        attemptId: id,
        stagesCleared: totalStages,
        totalStages,
        stageScore: stageCorrect,
        stageTotal: answers.length,
        isComplete: true,
        answers: stageAnswers,
        score,
        totalQuestions: attempt.totalQuestions,
        topicBreakdown,
      });
    }
  );

  // Full results + answer review: every question, what was picked, what
  // was actually correct, the explanation, and - especially for a wrong
  // answer - the memorable trick/tip for that question, plus this
  // attempt's saved topic-progress breakdown and stage progress.
  app.get<{ Params: { id: string } }>("/quizzes/:id/results", async (request, reply) => {
    const { id } = request.params;

    const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id)).limit(1);
    if (!attempt) return reply.status(404).send({ error: "Quiz attempt not found" });
    if (!attempt.completedAt) {
      return reply.status(409).send({ error: "This quiz attempt has not been submitted yet." });
    }

    const [subject] = await db.select().from(subjects).where(eq(subjects.id, attempt.subjectId)).limit(1);
    const [classRow] = attempt.classId
      ? await db.select().from(classes).where(eq(classes.id, attempt.classId)).limit(1)
      : [undefined];
    const [profileRow] = attempt.profileId
      ? await db.select().from(profiles).where(eq(profiles.id, attempt.profileId)).limit(1)
      : [undefined];

    const answerRows = await db
      .select()
      .from(quizAttemptAnswers)
      .where(eq(quizAttemptAnswers.attemptId, id));

    const questionIds = answerRows.map((a) => a.questionId);
    const realQuestions =
      questionIds.length > 0
        ? await db
            .select({
              id: questions.id,
              questionText: questions.questionText,
              options: questions.options,
              correctOptionId: questions.correctOptionId,
              explanation: questions.explanation,
              tip: questions.tip,
              documentId: questions.documentId,
              passage: documents.passage,
              topics: questions.topics,
            })
            .from(questions)
            .innerJoin(documents, eq(questions.documentId, documents.id))
            .where(inArray(questions.id, questionIds))
        : [];
    const byId = new Map(realQuestions.map((q) => [q.id, q]));

    return reply.send({
      attemptId: attempt.id,
      subjectName: subject?.name ?? null,
      className: classRow?.name ?? null,
      profileName: profileRow?.name ?? null,
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      stageSize: attempt.stageSize,
      totalStages: Math.ceil(attempt.totalQuestions / attempt.stageSize),
      stagesCleared: attempt.stagesCleared,
      completedAt: attempt.completedAt,
      topicBreakdown: attempt.topicBreakdown ?? {},
      answers: answerRows.map((a) => {
        const question = byId.get(a.questionId);
        return {
          questionId: a.questionId,
          questionText: question?.questionText ?? null,
          options: question?.options ?? [],
          selectedOptionId: a.selectedOptionId,
          correctOptionId: question?.correctOptionId ?? null,
          explanation: question?.explanation ?? null,
          // Only worth showing the tip when it's actually needed - a
          // correct answer doesn't need a trick for next time.
          tip: !a.isCorrect ? question?.tip ?? null : null,
          isCorrect: a.isCorrect,
          documentId: question?.documentId ?? null,
          passage: question?.passage ?? null,
          topics: question?.topics ?? null,
        };
      }),
    });
  });
}
