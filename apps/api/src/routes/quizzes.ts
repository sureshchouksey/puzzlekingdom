import type { FastifyInstance } from "fastify";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { subjects, classes, profiles, questions, documents, quizAttempts, quizAttemptAnswers } from "../db/schema.js";
import { gradeAnswer, starsForPercent } from "../lib/scoring.js";
import { checkSpelling, type SpellingIssue } from "../lib/spellcheck.js";

const DEFAULT_STAGE_SIZE = 10;
// A stage must score at least this fraction correct to count as
// cleared - fall short and the player must retry the same stage (see
// /quizzes/:id/submit below).
const STAGE_PASS_THRESHOLD = 0.7;

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

// Strips a question's answerPayload down to only what's safe to show
// BEFORE it's answered - the same spoiler concern the comment on
// /quizzes above already applies to correctOptionId, just extended to
// the 6 newer question types. fill_blank/missing_number/missing_spelling
// store the correct answer itself in acceptedAnswers, and
// short_answer/long_answer's rubricKeyPoints is the model answer - both
// are withheld entirely pre-answer (there's nothing else in there the
// child needs to see; the blank/prompt is already part of questionText).
// match_column is the one type where the child needs SOME of the payload
// up front - the left/right lists to build pairs from - so only
// correctPairs (the answer key) is stripped, not the lists themselves.
function assemblyAnswerPayload(
  questionType: string,
  answerPayload: Record<string, unknown> | null
): { left: unknown; right: unknown } | null {
  if (questionType === "match_column" && answerPayload) {
    return { left: answerPayload.left, right: answerPayload.right };
  }
  return null;
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
        questionType: questions.questionType,
        answerPayload: questions.answerPayload,
        imageUrl: questions.imageUrl,
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
        topic: topic ?? null,
        questionIds: picked.map((q) => q.id),
      })
      .returning();

    // Correct answers and explanations are deliberately withheld here - a
    // quiz-taker shouldn't be able to read them out of the network
    // response before submitting. They come back from /results instead,
    // after the whole attempt is complete.
    return reply.status(201).send({
      attemptId: attempt.id,
      subjectName: subject.name,
      // Carried along so the frontend can start a question-scoped Study
      // Buddy conversation ("Explain this to me" - Section 10 step 7)
      // straight from a wrong answer, without a second round-trip just to
      // look up which subject/class this attempt belongs to.
      subjectId: subject.id,
      classId: classId ?? null,
      stageSize,
      totalStages,
      questions: picked.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        options: q.questionType === "mcq" || q.questionType === "true_false" ? shuffled(q.options) : [],
        answerPayload: assemblyAnswerPayload(q.questionType, q.answerPayload),
        imageUrl: q.imageUrl,
        documentId: q.documentId,
        passage: q.passage,
        topics: q.topics,
      })),
    });
  });

  // Every not-yet-completed attempt for one profile+subject(+class), most
  // recently started first - lets SubjectPicker's Topic Practice list show
  // "Continue" instead of "Start" on any topic (or the no-filter "mixed
  // practice" option, keyed by topic: null) the player left mid-quiz,
  // without a separate round-trip per topic.
  app.get<{ Querystring: { profileId?: string; subjectName?: string; classId?: string } }>(
    "/quizzes/in-progress",
    async (request, reply) => {
      const { profileId, subjectName, classId } = request.query;
      if (!profileId) return reply.status(400).send({ error: "profileId is required" });
      if (!subjectName) return reply.status(400).send({ error: "subjectName is required" });

      const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
      if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });

      const conditions = [
        eq(quizAttempts.profileId, profileId),
        eq(quizAttempts.subjectId, subject.id),
        sql`${quizAttempts.completedAt} is null`,
      ];
      if (classId) conditions.push(sql`${quizAttempts.classId} is not distinct from ${classId}`);

      const rows = await db
        .select({
          attemptId: quizAttempts.id,
          topic: quizAttempts.topic,
          stagesCleared: quizAttempts.stagesCleared,
          stageSize: quizAttempts.stageSize,
          totalQuestions: quizAttempts.totalQuestions,
        })
        .from(quizAttempts)
        .where(and(...conditions))
        .orderBy(desc(quizAttempts.startedAt));

      return rows.map((r) => ({
        attemptId: r.attemptId,
        topic: r.topic,
        stagesCleared: r.stagesCleared,
        totalStages: Math.ceil(r.totalQuestions / r.stageSize),
      }));
    }
  );

  // Find an in-progress (not yet completed) attempt for this
  // profile+subject(+class)(+topic) combination, so a player who
  // navigated away mid-quiz can pick up the exact same questions and
  // stage they left off at, instead of starting over. Matches on the
  // attempt's saved `topic` and `classId` with SQL's "is not distinct
  // from" so an unfiltered quiz (topic/classId both null) only resumes
  // another unfiltered quiz, never a topic- or class-filtered one (and
  // vice versa). Returns the most recently started match, if any.
  app.get<{ Querystring: { profileId?: string; subjectName?: string; classId?: string; topic?: string } }>(
    "/quizzes/resume",
    async (request, reply) => {
      const { profileId, subjectName, classId, topic } = request.query;
      if (!profileId) return reply.status(400).send({ error: "profileId is required" });
      if (!subjectName) return reply.status(400).send({ error: "subjectName is required" });

      const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
      if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });

      const [attempt] = await db
        .select()
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.profileId, profileId),
            eq(quizAttempts.subjectId, subject.id),
            sql`${quizAttempts.completedAt} is null`,
            sql`${quizAttempts.topic} is not distinct from ${topic ?? null}`,
            sql`${quizAttempts.classId} is not distinct from ${classId ?? null}`
          )
        )
        .orderBy(desc(quizAttempts.startedAt))
        .limit(1);

      if (!attempt || !attempt.questionIds || attempt.questionIds.length === 0) {
        return reply.status(404).send({ error: "No in-progress attempt to resume" });
      }

      // Re-fetch the exact same questions this attempt was assembled
      // with, then restore their original order - not whatever order the
      // IN (...) query happens to return - so stage grouping lines up
      // identically with the quiz_attempt_answers rows already recorded.
      const rows = await db
        .select({
          id: questions.id,
          questionText: questions.questionText,
          options: questions.options,
          questionType: questions.questionType,
          answerPayload: questions.answerPayload,
          imageUrl: questions.imageUrl,
          documentId: questions.documentId,
          passage: documents.passage,
          topics: questions.topics,
        })
        .from(questions)
        .innerJoin(documents, eq(questions.documentId, documents.id))
        .where(inArray(questions.id, attempt.questionIds));
      const byId = new Map(rows.map((q) => [q.id, q]));
      const orderedQuestions = attempt.questionIds.map((id) => byId.get(id)).filter((q): q is (typeof rows)[number] => !!q);

      return reply.send({
        attemptId: attempt.id,
        subjectName: subject.name,
        subjectId: subject.id,
        classId: attempt.classId ?? null,
        stageSize: attempt.stageSize,
        totalStages: Math.ceil(attempt.totalQuestions / attempt.stageSize),
        stagesCleared: attempt.stagesCleared,
        questions: orderedQuestions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.questionType === "mcq" || q.questionType === "true_false" ? shuffled(q.options) : [],
          answerPayload: assemblyAnswerPayload(q.questionType, q.answerPayload),
          imageUrl: q.imageUrl,
          documentId: q.documentId,
          passage: q.passage,
          topics: q.topics,
        })),
      });
    }
  );

  // Score one stage's worth of answers at a time - NOT necessarily the
  // whole quiz in one call. A quiz-taker finishes a stage (say, 5
  // questions), this is called with just those answers, and the response
  // says how many stages are now cleared and whether the whole attempt is
  // complete. Calling this again later with the next stage's answers picks
  // up where it left off. This is what lets stages_cleared - and so the
  // leaderboard - reflect real progress even if a quiz is never finished.
  //
  // A stage must score at least STAGE_PASS_THRESHOLD to count as cleared
  // (the daughter's "every stage should be cutoff 70%" request) - fall
  // short and the stage's answers are graded but never written to
  // quiz_attempt_answers, so none of its question ids become "already
  // answered". That's what lets a failed stage simply be resubmitted as a
  // retry with no separate retry/attempt-count state to track: from the
  // database's point of view a failed stage never happened.
  //
  // Idempotent on a PASSED stage: any questionId already recorded as
  // answered for this attempt is silently skipped rather than
  // double-counted, so a duplicate click (or a caller that resends every
  // answer in one call, as the old one-shot API did) can't inflate the
  // score or the stage count.
  app.post<{
    Params: { id: string };
    Body: { answers?: { questionId: string; selectedOptionId?: string; selectedPayload?: unknown }[] };
  }>(
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

      // Grade the newly-submitted answers in memory first - nothing is
      // written to the database yet, since whether they get persisted at
      // all depends on the pass/fail check below. Branches by
      // question_type (gradeAnswer, lib/scoring.ts) instead of assuming
      // every question is a binary MCQ right/wrong.
      const newGraded: {
        questionId: string;
        selectedOptionId: string | null;
        selectedPayload: unknown;
        isCorrect: boolean;
        score: number | null;
        spellingIssues: SpellingIssue[] | null;
        questionText: string;
        questionType: string;
        options: unknown;
        correctOptionId: string;
        answerPayload: Record<string, unknown> | null;
        explanation: string;
        tip: string | null;
      }[] = [];

      if (newAnswers.length > 0) {
        const questionIds = newAnswers.map((a) => a.questionId);
        const realQuestions = await db.select().from(questions).where(inArray(questions.id, questionIds));
        const byId = new Map(realQuestions.map((q) => [q.id, q]));

        for (const a of newAnswers) {
          const question = byId.get(a.questionId);
          if (!question) continue;
          const { isCorrect, score } = gradeAnswer(question, a);
          // Spelling feedback (lib/spellcheck.ts) runs for short/long
          // answer only, independent of scoring - score stays null for
          // these types either way (excluded from the stage total), but
          // the child still gets told what's misspelled. See the
          // grading-decision section of
          // Question-Types-and-Content-Authoring-Plan.md.
          let spellingIssues: SpellingIssue[] | null = null;
          if (question.questionType === "short_answer" || question.questionType === "long_answer") {
            const payload = a.selectedPayload;
            const text =
              payload && typeof payload === "object" && "text" in payload
                ? (payload as { text?: unknown }).text
                : undefined;
            spellingIssues = await checkSpelling(typeof text === "string" ? text : "");
          }
          newGraded.push({
            questionId: a.questionId,
            selectedOptionId: a.selectedOptionId ?? null,
            selectedPayload: a.selectedPayload ?? null,
            isCorrect,
            score,
            spellingIssues,
            questionText: question.questionText,
            questionType: question.questionType,
            options: question.options,
            correctOptionId: question.correctOptionId,
            answerPayload: question.answerPayload,
            explanation: question.explanation,
            tip: !isCorrect ? question.tip : null,
          });
        }
      }

      // Sum of `score`, not a count of `isCorrect` - identical to the old
      // boolean-count behavior for mcq/true_false (score is always
      // exactly 1 or 0 there), but now also carries match_column's
      // fractional partial credit. short_answer/long_answer questions
      // have score === null and are excluded from both the sum and the
      // count entirely, per "Scoring-engine impact" in
      // Question-Types-and-Content-Authoring-Plan.md - a stage made up
      // only of excluded questions has nothing to score and is treated
      // as passed.
      const scoredGraded = newGraded.filter((g) => g.score !== null);
      const newScoreSum = scoredGraded.reduce((sum, g) => sum + (g.score ?? 0), 0);
      const stagePercent = scoredGraded.length === 0 ? 1 : newScoreSum / scoredGraded.length;
      // A resubmission where every id was already recorded (nothing new to
      // grade) isn't a fresh attempt at the stage - treat it as passing so
      // it falls through to the normal "already cleared" response below,
      // same as before this cutoff existed.
      const stagePassed = newAnswers.length === 0 ? true : stagePercent >= STAGE_PASS_THRESHOLD;

      if (newGraded.length > 0 && stagePassed) {
        await db.insert(quizAttemptAnswers).values(
          newGraded.map((g) => ({
            attemptId: id,
            questionId: g.questionId,
            selectedOptionId: g.selectedOptionId,
            selectedPayload: g.selectedPayload,
            isCorrect: g.isCorrect,
            score: g.score,
            spellingIssues: g.spellingIssues,
          }))
        );
      }

      const totalStages = Math.ceil(attempt.totalQuestions / attempt.stageSize);

      if (!stagePassed) {
        // Below the cutoff - none of this stage's answers were persisted,
        // so stagesCleared/totalAnswered stay exactly where they were.
        // The review is built straight from the in-memory grading above,
        // in submission order, since there's nothing in the database yet
        // to read it back from.
        const gradedById = new Map(newGraded.map((g) => [g.questionId, g]));
        const stageAnswers = answers.flatMap((a) => {
          const g = gradedById.get(a.questionId);
          if (!g) return [];
          return [
            {
              questionId: g.questionId,
              questionText: g.questionText,
              questionType: g.questionType,
              options: g.options,
              selectedOptionId: g.selectedOptionId,
              selectedPayload: g.selectedPayload,
              correctOptionId: g.correctOptionId,
              answerPayload: g.answerPayload,
              explanation: g.explanation,
              tip: g.tip,
              isCorrect: g.isCorrect,
              score: g.score,
              spellingIssues: g.spellingIssues,
            },
          ];
        });

        return reply.send({
          attemptId: id,
          stagesCleared: attempt.stagesCleared,
          totalStages,
          stageScore: newScoreSum,
          stageTotal: newAnswers.length,
          scoredTotal: scoredGraded.length,
          stars: 0,
          isComplete: false,
          passed: false,
          passThreshold: STAGE_PASS_THRESHOLD,
          answers: stageAnswers,
        });
      }

      const totalAnswered = alreadyAnsweredIds.size + newAnswers.length;
      const stagesCleared = Math.min(Math.floor(totalAnswered / attempt.stageSize), totalStages);
      const isComplete = totalAnswered >= attempt.totalQuestions;

      // Full per-question review for just this stage's answers - what was
      // picked, what was actually correct, the explanation, and (for a
      // wrong answer) the memorable tip - so the stage-cleared screen can
      // show a real report instead of only a score, before the player
      // continues to the next stage.
      const stageAnswerRows = await db
        .select({
          questionId: quizAttemptAnswers.questionId,
          selectedOptionId: quizAttemptAnswers.selectedOptionId,
          selectedPayload: quizAttemptAnswers.selectedPayload,
          isCorrect: quizAttemptAnswers.isCorrect,
          score: quizAttemptAnswers.score,
          spellingIssues: quizAttemptAnswers.spellingIssues,
          questionText: questions.questionText,
          questionType: questions.questionType,
          options: questions.options,
          correctOptionId: questions.correctOptionId,
          answerPayload: questions.answerPayload,
          explanation: questions.explanation,
          tip: questions.tip,
        })
        .from(quizAttemptAnswers)
        .innerJoin(questions, eq(quizAttemptAnswers.questionId, questions.id))
        .where(and(eq(quizAttemptAnswers.attemptId, id), inArray(quizAttemptAnswers.questionId, answers.map((a) => a.questionId))));
      const stageAnswerById = new Map(stageAnswerRows.map((r) => [r.questionId, r]));
      // The authoritative percentage for THIS stage's star award - built
      // from every recorded row for this stage's question ids (not just
      // newGraded above), so a stage submitted across more than one call
      // still gets scored on its real, full percentage.
      const stageScoredRows = stageAnswerRows.filter((r) => r.score !== null);
      const stageScoreSum = stageScoredRows.reduce((sum, r) => sum + (r.score ?? 0), 0);
      const stagePercentForStars = stageScoredRows.length === 0 ? 1 : stageScoreSum / stageScoredRows.length;
      const stageStars = starsForPercent(stagePercentForStars);
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
            questionType: r.questionType,
            options: r.options,
            selectedOptionId: r.selectedOptionId,
            selectedPayload: r.selectedPayload,
            correctOptionId: r.correctOptionId,
            answerPayload: r.answerPayload,
            explanation: r.explanation,
            tip: !r.isCorrect ? r.tip : null,
            isCorrect: r.isCorrect,
            score: r.score,
            spellingIssues: r.spellingIssues,
          },
        ];
      });

      if (!isComplete) {
        await db
          .update(quizAttempts)
          .set({ stagesCleared, starsEarned: attempt.starsEarned + stageStars })
          .where(eq(quizAttempts.id, id));
        return reply.send({
          attemptId: id,
          stagesCleared,
          totalStages,
          stageScore: stageScoreSum,
          stageTotal: answers.length,
          scoredTotal: stageScoredRows.length,
          stars: stageStars,
          isComplete: false,
          passed: true,
          passThreshold: STAGE_PASS_THRESHOLD,
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
          score: quizAttemptAnswers.score,
          topics: questions.topics,
        })
        .from(quizAttemptAnswers)
        .innerJoin(questions, eq(quizAttemptAnswers.questionId, questions.id))
        .where(eq(quizAttemptAnswers.attemptId, id));

      // Rounded rather than fractional - quiz_attempts.score is an
      // integer column and, today, every recorded answer's score is
      // exactly 0 or 1 (no match_column content exists yet - see
      // Question-Types-and-Content-Authoring-Plan.md build order steps
      // 7-8), so this rounding is a no-op in practice. Worth revisiting
      // once match-column questions actually ship.
      const scoreSum = allAnswers.filter((a) => a.score !== null).reduce((sum, a) => sum + (a.score ?? 0), 0);
      const score = Math.round(scoreSum);
      const topicBreakdown = buildTopicBreakdown(allAnswers);

      await db
        .update(quizAttempts)
        .set({
          completedAt: new Date(),
          score,
          topicBreakdown,
          stagesCleared: totalStages,
          starsEarned: attempt.starsEarned + stageStars,
        })
        .where(eq(quizAttempts.id, id));

      return reply.send({
        attemptId: id,
        stagesCleared: totalStages,
        totalStages,
        stageScore: stageScoreSum,
        stageTotal: answers.length,
        scoredTotal: stageScoredRows.length,
        stars: stageStars,
        isComplete: true,
        passed: true,
        passThreshold: STAGE_PASS_THRESHOLD,
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
              questionType: questions.questionType,
              answerPayload: questions.answerPayload,
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
      // Same reason as the /quizzes response above - lets Results start a
      // question-scoped Study Buddy conversation directly from a past
      // attempt's wrong answers (Section 10 step 7).
      subjectId: attempt.subjectId,
      classId: attempt.classId ?? null,
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
          questionType: question?.questionType ?? "mcq",
          options: question?.options ?? [],
          selectedOptionId: a.selectedOptionId,
          selectedPayload: a.selectedPayload,
          correctOptionId: question?.correctOptionId ?? null,
          answerPayload: question?.answerPayload ?? null,
          explanation: question?.explanation ?? null,
          // Only worth showing the tip when it's actually needed - a
          // correct answer doesn't need a trick for next time.
          tip: !a.isCorrect ? question?.tip ?? null : null,
          isCorrect: a.isCorrect,
          score: a.score,
          spellingIssues: a.spellingIssues,
          documentId: question?.documentId ?? null,
          passage: question?.passage ?? null,
          topics: question?.topics ?? null,
        };
      }),
    });
  });
}
