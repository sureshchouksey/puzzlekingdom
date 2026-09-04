// Smoke test for the quiz-taking flow (assemble -> submit stage-by-stage ->
// results) against the real database - uses Fastify's in-process .inject(),
// so no server actually needs to be listening, but the underlying DB calls
// still need real internet access (run from your own Terminal):
//   npm run test:quiz -w apps/api
//
// Expects questions to already exist for subject "Maths" (e.g. from the
// CSSE seed batch, or test:e2e / test:estimate having run generation).
//
// Also exercises the 70% stage-pass cutoff added later: a stage answered
// entirely wrong must come back not-passed and not advance anything, and
// the exact same stage must then be resubmittable (a retry) with correct
// answers and succeed - this is what makes "resubmit the same stage" work
// as a retry with no separate retry-tracking state on either side.

import { inArray } from "drizzle-orm";
import Fastify from "fastify";
import { db } from "../src/db/client.js";
import { questions } from "../src/db/schema.js";
import { quizRoutes } from "../src/routes/quizzes.js";

async function main() {
  const app = Fastify();
  await app.register(quizRoutes);

  console.log("1/5  Assembling a 5-question quiz for subject 'Maths' with a stage size of 2 (so 3 stages: 2+2+1)...");
  const assembleRes = await app.inject({
    method: "POST",
    url: "/quizzes",
    payload: { subjectName: "Maths", count: 5, stageSize: 2 },
  });
  if (assembleRes.statusCode !== 201) {
    throw new Error(`Assemble failed (${assembleRes.statusCode}): ${assembleRes.body}`);
  }
  const assembled = assembleRes.json() as {
    attemptId: string;
    stageSize: number;
    totalStages: number;
    questions: { id: string; questionText: string; options: { id: string; text: string }[] }[];
  };
  console.log(`     OK - attempt ${assembled.attemptId}, ${assembled.questions.length} questions, ${assembled.totalStages} stages`);
  console.log(
    `     (answers/explanations correctly withheld: ${
      "correctOptionId" in (assembled.questions[0] as object) ? "NO - BUG" : "yes"
    })`
  );

  // The assemble response deliberately withholds correctOptionId (a
  // quiz-taker shouldn't be able to read it out of the network response),
  // so this test - unlike a real player - looks it up directly to know
  // which option is actually right for each question, rather than
  // guessing "first option" as it used to before the pass cutoff existed.
  const questionIds = assembled.questions.map((q) => q.id);
  const correctRows = await db
    .select({ id: questions.id, correctOptionId: questions.correctOptionId })
    .from(questions)
    .where(inArray(questions.id, questionIds));
  const correctOptionById = new Map(correctRows.map((r) => [r.id, r.correctOptionId]));

  console.log("2/5  Submitting stage 1 entirely wrong, confirming the 70% cutoff rejects it and nothing advances...");
  const stage1Questions = assembled.questions.slice(0, assembled.stageSize);
  const stage1Wrong = stage1Questions.map((q) => {
    const correctId = correctOptionById.get(q.id);
    const wrongOption = q.options.find((o) => o.id !== correctId) ?? q.options[0];
    return { questionId: q.id, selectedOptionId: wrongOption.id };
  });
  const wrongSubmitRes = await app.inject({
    method: "POST",
    url: `/quizzes/${assembled.attemptId}/submit`,
    payload: { answers: stage1Wrong },
  });
  if (wrongSubmitRes.statusCode !== 200) {
    throw new Error(`Wrong-answer stage submit failed (${wrongSubmitRes.statusCode}): ${wrongSubmitRes.body}`);
  }
  const wrongResult = wrongSubmitRes.json() as { passed: boolean; isComplete: boolean; stagesCleared: number; stageScore: number };
  if (wrongResult.passed !== false || wrongResult.isComplete !== false || wrongResult.stagesCleared !== 0) {
    throw new Error(`Expected an all-wrong stage to fail the cutoff (passed:false, stagesCleared:0), got ${JSON.stringify(wrongResult)}`);
  }
  console.log(`     OK - correctly rejected (stageScore=${wrongResult.stageScore}, stagesCleared still ${wrongResult.stagesCleared})`);

  console.log("3/5  Retrying that same stage with correct answers - the ids weren't recorded, so this must be accepted as new...");
  const allAnswers = assembled.questions.map((q) => ({ questionId: q.id, selectedOptionId: correctOptionById.get(q.id)! }));
  let lastSubmitted:
    | { stagesCleared: number; totalStages: number; isComplete: boolean; passed: boolean; score?: number; totalQuestions?: number }
    | null = null;
  for (let stage = 0; stage < assembled.totalStages; stage++) {
    const stageAnswers = allAnswers.slice(stage * assembled.stageSize, (stage + 1) * assembled.stageSize);
    const submitRes = await app.inject({
      method: "POST",
      url: `/quizzes/${assembled.attemptId}/submit`,
      payload: { answers: stageAnswers },
    });
    if (submitRes.statusCode !== 200) {
      throw new Error(`Submit (stage ${stage + 1}) failed (${submitRes.statusCode}): ${submitRes.body}`);
    }
    lastSubmitted = submitRes.json();
    if (!lastSubmitted!.passed) {
      throw new Error(`Expected an all-correct stage to pass the 70% cutoff, got ${JSON.stringify(lastSubmitted)}`);
    }
    console.log(
      `     stage ${stage + 1}/${assembled.totalStages} submitted - stagesCleared=${lastSubmitted!.stagesCleared}, isComplete=${lastSubmitted!.isComplete}`
    );
  }
  if (!lastSubmitted?.isComplete) {
    throw new Error("Expected the final stage submission to complete the attempt, but isComplete was false");
  }
  console.log(`     OK - final score ${lastSubmitted.score}/${lastSubmitted.totalQuestions}, all ${lastSubmitted.totalStages} stages cleared`);

  console.log("4/5  Fetching results...");
  const resultsRes = await app.inject({ method: "GET", url: `/quizzes/${assembled.attemptId}/results` });
  if (resultsRes.statusCode !== 200) {
    throw new Error(`Results failed (${resultsRes.statusCode}): ${resultsRes.body}`);
  }
  const results = resultsRes.json() as {
    answers: { correctOptionId: string; explanation: string }[];
    stagesCleared: number;
    totalStages: number;
  };
  console.log(`     OK - got full review, e.g. first question's correct answer: "${results.answers[0].correctOptionId}"`);
  console.log(`     explanation: "${results.answers[0].explanation}"`);
  console.log(`     stagesCleared=${results.stagesCleared}/${results.totalStages}`);

  console.log("5/5  Confirming re-submitting after completion is rejected (409)...");
  const resubmitRes = await app.inject({
    method: "POST",
    url: `/quizzes/${assembled.attemptId}/submit`,
    payload: { answers: allAnswers.slice(0, assembled.stageSize) },
  });
  console.log(
    resubmitRes.statusCode === 409
      ? "     OK - correctly rejected with 409"
      : `     UNEXPECTED status ${resubmitRes.statusCode}: ${resubmitRes.body}`
  );

  console.log("\n=== SUCCESS - quiz assembly, the 70% stage-pass cutoff (fail + retry), stage-by-stage scoring, and results all work end to end ===\n");
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
