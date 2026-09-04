#!/usr/bin/env tsx
// Content-seeding CLI: takes a JSON file of already-generated questions
// (produced by the "convert course content to quiz" Claude Code skill, or
// by hand) and writes them into the database against a subject and class,
// creating a `documents` row to represent the source material.
//
// Usage:
//   npm run seed:questions -- --subject "Maths" --class "11+ Grammar Prep" --source path/to/content.pdf --questions path/to/generated-questions.json
//   npm run seed:questions -- --subject "English" --class "11+ Grammar Prep" --source path/to/paper.pdf --questions path/to/questions.json --passage path/to/passage.txt
//
// --class labels the audience this content targets (e.g. "11+ Grammar
// Prep" for CSSE/CCHS exam content, "Year 3" for National Curriculum
// course content) - it's the top level of the Class -> Subject -> Topic
// browsing structure. Optional for backward compatibility, but should
// always be set for new content.
//
// --passage is optional: a plain text file containing the shared reading
// passage/story that every question in --questions refers back to (e.g.
// a CSSE English comprehension paper). Omit it for content with no shared
// passage, like Maths. When present, the app shows this text to the
// quiz-taker once, before the questions drawn from this document.
//
// Per-question topic labels (e.g. "Fractions, Decimals & Percentages")
// are read straight from an optional "topic" field on each question
// object in --questions, not passed as a CLI flag.
//
// --source and --questions are resolved relative to the directory you ran
// the command FROM (via npm's INIT_CWD), not this script's own folder - so
// e.g. running from the project root with `npm run seed:questions -w
// apps/api -- ...` still resolves "docs/foo.json" against the project root,
// even though npm changes this script's actual working directory to
// apps/api/ when -w is used. Without this, plain relative paths silently
// fail to be found because they'd be looked up inside apps/api/ instead.

import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
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

// npm sets INIT_CWD to the directory the `npm run` command was actually
// typed from, even when -w switches this process's own cwd to a workspace
// subfolder. Falling back to process.cwd() keeps this working when the
// script is run directly with tsx (no npm, no workspace flag).
const baseDir = process.env.INIT_CWD ?? process.cwd();

function resolvePath(p: string): string {
  return resolve(baseDir, p);
}

async function main() {
  const subject = arg("subject");
  const classLabel = arg("class");
  const sourceFile = arg("source");
  const questionsFile = arg("questions");
  const passageFile = arg("passage");

  if (!subject || !sourceFile || !questionsFile) {
    console.error(
      'Usage: npm run seed:questions -- --subject "Maths" --class "11+ Grammar Prep" --source path/to/content.pdf --questions path/to/generated-questions.json'
    );
    process.exit(1);
  }

  const resolvedQuestionsPath = resolvePath(questionsFile);
  const raw = JSON.parse(readFileSync(resolvedQuestionsPath, "utf-8"));
  const passage = passageFile ? readFileSync(resolvePath(passageFile), "utf-8").trim() : undefined;
  const doc = await createSeedDocument({
    subjectName: subject,
    filename: basename(sourceFile),
    mimeType: mimeTypeFor(sourceFile),
    passage,
    classLabel,
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
