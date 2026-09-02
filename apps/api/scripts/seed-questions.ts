#!/usr/bin/env tsx
// Content-seeding CLI: takes a JSON file of already-generated questions
// (produced by the "convert course content to quiz" Claude Code skill, or
// by hand) and writes them into the database against a subject, creating a
// `documents` row to represent the source material.
//
// Usage:
//   npm run seed:questions -- --subject "Maths" --source path/to/content.pdf --questions path/to/generated-questions.json

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { createSeedDocument, saveGeneratedQuestions } from "../src/lib/save-questions.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function mimeTypeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function main() {
  const subject = arg("subject");
  const sourceFile = arg("source");
  const questionsFile = arg("questions");

  if (!subject || !sourceFile || !questionsFile) {
    console.error(
      'Usage: npm run seed:questions -- --subject "Maths" --source path/to/content.pdf --questions path/to/generated-questions.json'
    );
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(questionsFile, "utf-8"));
  const doc = await createSeedDocument({
    subjectName: subject,
    filename: basename(sourceFile),
    mimeType: mimeTypeFor(sourceFile),
  });

  const result = await saveGeneratedQuestions({
    subjectName: subject,
    documentId: doc.id,
    rawQuestions: raw,
  });

  console.log(`Saved ${result.count} question(s) to subject "${result.subject.name}" (document ${doc.id}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to seed questions:", err);
    process.exit(1);
  });
