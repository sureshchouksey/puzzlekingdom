// One-off end-to-end smoke test for the content-to-quiz pipeline.
// Run with real internet access (your own Terminal, not a sandboxed shell):
//   npm run test:e2e -w apps/api
//
// Exercises all three Supabase pieces (Storage bucket, Postgres tables) plus
// a real Claude API call, using the sample Year 3 Maths PDF already in the repo.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadDocument } from "../src/lib/storage.js";
import { generateQuestionsFromDocument } from "../src/services/generate-questions.js";
import { createSeedDocument, saveGeneratedQuestions } from "../src/lib/save-questions.js";
import { env } from "../src/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, "..", "..", "..", "docs", "sample-content", "Year3_Maths_Sample_Course_Content.pdf");

async function main() {
  console.log(`Using AI_PROVIDER=${env.AI_PROVIDER}`);
  console.log("1/4  Reading sample PDF from", PDF_PATH);
  const buffer = await readFile(PDF_PATH);
  const base64 = buffer.toString("base64");

  console.log("2/4  Uploading to Supabase Storage bucket 'course-content'...");
  const storagePath = `test/${Date.now()}-year3-maths-sample.pdf`;
  await uploadDocument({ buffer, path: storagePath, mimeType: "application/pdf" });
  console.log("     OK - stored at", storagePath);

  console.log(`3/4  Calling ${env.AI_PROVIDER} to generate questions from the PDF content (this takes ~10-20s)...`);
  const generated = await generateQuestionsFromDocument({
    fileBase64: base64,
    mimeType: "application/pdf",
    subjectName: "Maths",
    count: 5,
  });
  console.log(`     OK - ${env.AI_PROVIDER} returned ${generated.length} questions`);

  console.log("4/4  Saving questions to the database...");
  const doc = await createSeedDocument({
    subjectName: "Maths",
    filename: "Year3_Maths_Sample_Course_Content.pdf",
    mimeType: "application/pdf",
  });
  const result = await saveGeneratedQuestions({
    subjectName: "Maths",
    documentId: doc.id,
    rawQuestions: generated,
  });
  console.log(`     OK - saved ${result.count} questions under subject "${result.subject.name}" (document ${doc.id})`);

  console.log("\n=== SUCCESS - full pipeline works end to end ===\n");
  console.log("Sample question:");
  console.log(JSON.stringify(generated[0], null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
