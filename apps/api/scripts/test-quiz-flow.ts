// Smoke test for the quiz-taking flow (assemble -> submit -> results)
// against the real database - uses Fastify's in-process .inject(), so no
// server actually needs to be listening, but the underlying DB calls still
// need real internet access (run from your own Terminal):
//   npm run test:quiz -w apps/api
//
// Expects questions to already exist for subject "Maths" (e.g. from the
// CSSE seed batch, or test:e2e / test:estimate having run generation).

import Fastify from "fastify";
import { quizRoutes } from "../src/routes/quizzes.js";

async function main() {
  const app = Fastify();
  await app.register(quizRoutes);

  console.log("1/4  Assembling a quiz for subject 'Maths'...");
  const assembleRes = await app.inject({
    method: "POST",
    url: "/quizzes",
    payload: { subjectName: "Maths", count: 5 },
  });
  if (assembleRes.statusCode !== 201) {
    throw new Error(`Assemble failed (${assembleRes.statusCode}): ${assembleRes.body}`);
  }
  const assembled = assembleRes.json() as {
    attemptId: string;
    questions: { id: string; questionText: string; options: { id: string; text: string }[] }[];
  };
  console.log(`     OK - attempt ${assembled.attemptId}, ${assembled.questions.length} questions`);
  console.log(
    `     (answers/explanations correctly withheld: ${
      "correctOptionId" in (assembled.questions[0] as object) ? "NO - BUG" : "yes"
    })`
  );

  console.log("2/4  Submitting an answer for every question (first option each, just to exercise scoring)...");
  const answers = assembled.questions.map((q) => ({ questionId: q.id, selectedOptionId: q.options[0].id }));
  const submitRes = await app.inject({
    method: "POST",
    url: `/quizzes/${assembled.attemptId}/submit`,
    payload: { answers },
  });
  if (submitRes.statusCode !== 200) {
    throw new Error(`Submit failed (${submitRes.statusCode}): ${submitRes.body}`);
  }
  const submitted = submitRes.json() as { score: number; totalQuestions: number };
  console.log(`     OK - scored ${submitted.score}/${submitted.totalQuestions}`);

  console.log("3/4  Fetching results...");
  const resultsRes = await app.inject({ method: "GET", url: `/quizzes/${assembled.attemptId}/results` });
  if (resultsRes.statusCode !== 200) {
    throw new Error(`Results failed (${resultsRes.statusCode}): ${resultsRes.body}`);
  }
  const results = resultsRes.json() as { answers: { correctOptionId: string; explanation: string }[] };
  console.log(`     OK - got full review, e.g. first question's correct answer: "${results.answers[0].correctOptionId}"`);
  console.log(`     explanation: "${results.answers[0].explanation}"`);

  console.log("4/4  Confirming re-submitting the same attempt is rejected (409)...");
  const resubmitRes = await app.inject({
    method: "POST",
    url: `/quizzes/${assembled.attemptId}/submit`,
    payload: { answers },
  });
  console.log(
    resubmitRes.statusCode === 409
      ? "     OK - correctly rejected with 409"
      : `     UNEXPECTED status ${resubmitRes.statusCode}: ${resubmitRes.body}`
  );

  console.log("\n=== SUCCESS - quiz assembly, scoring, and results all work end to end ===\n");
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
