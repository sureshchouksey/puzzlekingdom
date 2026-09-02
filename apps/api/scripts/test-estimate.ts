// Prints a real, live cost comparison between Claude and Gemini for
// generating questions from the sample PDF - the same estimate the
// /documents/:id/estimate route returns, run standalone for a quick check.
// Needs real internet access (run from your own Terminal): npm run test:estimate -w apps/api

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateGenerationCosts } from "../src/lib/ai-pricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH = path.join(__dirname, "..", "..", "..", "docs", "sample-content", "Year3_Maths_Sample_Course_Content.pdf");
const QUESTION_COUNT = 6;

async function main() {
  const buffer = await readFile(PDF_PATH);
  const estimates = await estimateGenerationCosts({
    fileBase64: buffer.toString("base64"),
    mimeType: "application/pdf",
    subjectName: "Maths",
    count: QUESTION_COUNT,
  });

  console.log(`\nCost to generate ${QUESTION_COUNT} questions from the sample Year 3 Maths PDF:\n`);
  for (const est of estimates) {
    if (!est.available) {
      console.log(`  ${est.provider.padEnd(8)} unavailable - ${est.reason}`);
      continue;
    }
    console.log(
      `  ${est.provider.padEnd(8)} ${est.model.padEnd(20)} ~${est.estimatedInputTokens} input + ~${est.estimatedOutputTokens} output tokens  =>  $${est.estimatedCostUsd!.toFixed(5)}`
    );
  }
  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
