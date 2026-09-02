import type { FastifyInstance } from "fastify";
import { eq, sql, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { subjects, questions, quizAttempts, quizAttemptAnswers } from "../db/schema.js";

const DEFAULT_QUESTION_COUNT = 10;

export async function quizRoutes(app: FastifyInstance) {
  // Assemble a quiz: pick up to `count` questions at random from whatever's
  // already saved for this subject, and create a quiz_attempts row to track
  // it. Never calls an AI provider - this only ever reads questions that
  // were generated once, earlier, at upload time.
  app.post<{ Body: { subjectName?: string; count?: number } }>("/quizzes", async (request, reply) => {
    const subjectName = request.body?.subjectName;
    const count = request.body?.count ?? DEFAULT_QUESTION_COUNT;

    if (!subjectName) return reply.status(400).send({ error: "subjectName is required" });

    const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
    if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });

    const picked = await db
      .select()
      .from(questions)
      .where(eq(questions.subjectId, subject.id))
      .orderBy(sql`random()`)
      .limit(count);

    if (picked.length === 0) {
      return reply.status(404).send({ error: `No questions saved yet for subject "${subjectName}".` });
    }

    const [attempt] = await db
      .insert(quizAttempts)
      .values({ subjectId: subject.id, totalQuestions: picked.length })
      .returning();

    // Correct answers and explanations are deliberately withheld here - a
    // quiz-taker shouldn't be able to read them out of the network
    // response before submitting. They come back from /results instead,
    // after submission.
    return reply.status(201).send({
      attemptId: attempt.id,
      subjectName: subject.name,
      questions: picked.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: q.options,
      })),
    });
  });

  // Score a completed quiz. Trusts nothing from the client about
  // correctness - looks up each question's real correctOptionId from the
  // database and compares server-side.
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

      const questionIds = answers.map((a) => a.questionId);
      const realQuestions = await db.select().from(questions).where(inArray(questions.id, questionIds));
      const byId = new Map(realQuestions.map((q) => [q.id, q]));

      const answerRows = answers.map((a) => {
        const question = byId.get(a.questionId);
        const isCorrect = question ? question.correctOptionId === a.selectedOptionId : false;
        return {
          attemptId: id,
          questionId: a.questionId,
          selectedOptionId: a.selectedOptionId,
          isCorrect,
        };
      });

      await db.insert(quizAttemptAnswers).values(answerRows);

      const score = answerRows.filter((a) => a.isCorrect).length;

      await db
        .update(quizAttempts)
        .set({ completedAt: new Date(), score })
        .where(eq(quizAttempts.id, id));

      return reply.send({ attemptId: id, score, totalQuestions: attempt.totalQuestions });
    }
  );

  // Full results + answer review: every question, what was picked, what
  // was actually correct, and the explanation.
  app.get<{ Params: { id: string } }>("/quizzes/:id/results", async (request, reply) => {
    const { id } = request.params;

    const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id)).limit(1);
    if (!attempt) return reply.status(404).send({ error: "Quiz attempt not found" });
    if (!attempt.completedAt) {
      return reply.status(409).send({ error: "This quiz attempt has not been submitted yet." });
    }

    const [subject] = await db.select().from(subjects).where(eq(subjects.id, attempt.subjectId)).limit(1);

    const answerRows = await db
      .select()
      .from(quizAttemptAnswers)
      .where(eq(quizAttemptAnswers.attemptId, id));

    const questionIds = answerRows.map((a) => a.questionId);
    const realQuestions =
      questionIds.length > 0 ? await db.select().from(questions).where(inArray(questions.id, questionIds)) : [];
    const byId = new Map(realQuestions.map((q) => [q.id, q]));

    return reply.send({
      attemptId: attempt.id,
      subjectName: subject?.name ?? null,
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      completedAt: attempt.completedAt,
      answers: answerRows.map((a) => {
        const question = byId.get(a.questionId);
        return {
          questionId: a.questionId,
          questionText: question?.questionText ?? null,
          options: question?.options ?? [],
          selectedOptionId: a.selectedOptionId,
          correctOptionId: question?.correctOptionId ?? null,
          explanation: question?.explanation ?? null,
          isCorrect: a.isCorrect,
        };
      }),
    });
  });
}
