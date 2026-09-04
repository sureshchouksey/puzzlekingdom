// Structural sanity check for the *-questions.json content files against
// generatedQuestionSetSchema, run standalone (no DB connection needed).
// Usage: npm run validate:tips -w apps/api

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { generatedQuestionSetSchema } from "../src/lib/question-schema.js";

const INIT_CWD = process.env.INIT_CWD ?? process.cwd();

const dirs = [
  resolve(INIT_CWD, "docs/official-papers/generated"),
  resolve(INIT_CWD, "docs/Year3 content/generated"),
];

let totalFiles = 0;
let totalQuestions = 0;
let totalWithTip = 0;
let failed = 0;

for (const dir of dirs) {
  const files = readdirSync(dir).filter((f) => f.endsWith("-questions.json"));
  for (const file of files) {
    const path = resolve(dir, file);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const result = generatedQuestionSetSchema.safeParse(raw);
    totalFiles += 1;
    if (!result.success) {
      failed += 1;
      console.log(`FAIL ${file}:`, result.error.issues.slice(0, 5));
      continue;
    }
    const withTip = result.data.filter((q) => !!q.tip).length;
    totalQuestions += result.data.length;
    totalWithTip += withTip;
    console.log(`OK ${file}: ${result.data.length} questions, ${withTip} with tip`);
  }
}

console.log("---");
console.log(`Files: ${totalFiles}, Failed: ${failed}, Questions: ${totalQuestions}, WithTip: ${totalWithTip}`);
