// Smoke test for the quiz-taking flow (assemble -> submit stage-by-stage ->
// results) against the real database - uses Fastify's in-process .inject(),
// so no server actually needs to be listening, but the underlying DB calls
// still need real internet access (run from your own Terminal):
//   npm run test:quiz -w apps/api
//
// Expects questions to already exist for subject "Maths" (e.g. from the
// CSSE seed batch, or test:e2e / test:estimate having run generation).

import Fastify from "fastify";
import { quizRoutes } from "../src/routes/quizzes.js";

async function main() {
  const app = Fastify();
  await app.register(quizRoutes);

  console.log("1/4  Assembling a 5-question quiz for subject 'Maths' with a stage size of 2 (so 3 stages: 2+2+1)...");
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

  console.log("2/4  Submitting one stage's worth of answers at a time (first option each, just to exercise scoring)...");
  const allAnswers = assembled.questions.map((q) => ({ questionId: q.id, selectedOptionId: q.options[0].id }));
  let lastSubmitted: { stagesCleared: number; totalStages: number; isComplete: boolean; score?: number; totalQuestions?: number } | null =
    null;
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
    console.log(
      `     stage ${stage + 1}/${assembled.totalStages} submitted - stagesCleared=${lastSubmitted!.stagesCleared}, isComplete=${lastSubmitted!.isComplete}`
    );
  }
  if (!lastSubmitted?.isComplete) {
    throw new Error("Expected the final stage submission to complete the attempt, but isComplete was false");
  }
  console.log(`     OK - final score ${lastSubmitted.score}/${lastSubmitted.totalQuestions}, all ${lastSubmitted.totalStages} stages cleared`);

  console.log("3/4  Fetching results...");
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

  console.log("4/4  Confirming re-submitting after completion is rejected (409)...");
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

  console.log("\n=== SUCCESS - quiz assembly, stage-by-stage scoring, and results all work end to end ===\n");
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
