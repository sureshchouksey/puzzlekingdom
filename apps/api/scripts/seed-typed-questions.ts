#!/usr/bin/env tsx
// Content-seeding CLI for any of the 8 question types (mcq, true_false,
// fill_blank, missing_number, missing_spelling, match_column, short_answer,
// long_answer) - unlike seed-questions.ts (which only accepts the plain
// MCQ shape from generatedQuestionSchema), this script runs each row
// through validateQuestionShape first, exactly like POST /documents/manual
// does, so a JSON file mixing e.g. mcq and match_column questions in one
// batch seeds cleanly. questionType defaults to "mcq" per-row when omitted,
// matching documents.ts's manualQuestionSchema.
//
// Usage:
//   npm run seed:typed-questions -- --subject "Claude Certified Architect - Professional" --class "Professional Certifications" --source path/to/content.txt --questions path/to/generated-questions.json
//
// Same --class/--source/--questions/--passage conventions as
// seed-questions.ts - see that script's header comment for the full
// rationale (INIT_CWD path resolution, --class labeling, etc.), not
// repeated here.

import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { createSeedDocument, saveTypedQuestions } from "../src/lib/save-questions.js";
import { QUESTION_TYPES, questionOptionSchema, validateQuestionShape } from "../src/lib/question-shape.js";
import { z } from "zod";

const typedQuestionSchema = z.object({
  questionType: z.enum(QUESTION_TYPES).optional(),
  questionText: z.string().min(1),
  options: z.array(questionOptionSchema).max(6).optional(),
  correctOptionId: z.string().optional(),
  answerPayload: z.record(z.unknown()).nullable().optional(),
  imageUrl: z.string().min(1).optional(),
  explanation: z.string().min(1),
  topics: z.array(z.string().min(1)).optional(),
  tip: z.string().min(1).optional(),
});
const typedQuestionSetSchema = z.array(typedQuestionSchema).min(1);

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
  return "text/plain";
}

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
      'Usage: npm run seed:typed-questions -- --subject "..." --class "..." --source path/to/content.txt --questions path/to/generated-questions.json'
    );
    process.exit(1);
  }

  const resolvedQuestionsPath = resolvePath(questionsFile);
  const raw = JSON.parse(readFileSync(resolvedQuestionsPath, "utf-8"));
  const passage = passageFile ? readFileSync(resolvePath(passageFile), "utf-8").trim() : undefined;

  const parsed = typedQuestionSetSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Invalid questions file - check each question's fields for its question type.");
    console.error(JSON.stringify(parsed.error.issues, null, 2));
    process.exit(1);
  }

  const shapedRows: Parameters<typeof saveTypedQuestions>[0]["rows"] = [];
  for (const [i, q] of parsed.data.entries()) {
    const questionType = q.questionType ?? "mcq";
    const shape = validateQuestionShape(questionType, q.options ?? [], q.correctOptionId ?? "", q.answerPayload ?? null);
    if (!shape.ok) {
      console.error(`Question ${i + 1} ("${q.questionText.slice(0, 40)}"): ${shape.error}`);
      process.exit(1);
    }
    shapedRows.push({
      questionType,
      questionText: q.questionText,
      options: shape.options,
      correctOptionId: shape.correctOptionId,
      answerPayload: shape.answerPayload,
      imageUrl: q.imageUrl,
      explanation: q.explanation,
      topics: q.topics,
      tip: q.tip,
    });
  }

  const doc = await createSeedDocument({
    subjectName: subject,
    filename: basename(sourceFile),
    mimeType: mimeTypeFor(sourceFile),
    passage,
    classLabel,
  });

  const result = await saveTypedQuestions({ subjectName: subject, documentId: doc.id, rows: shapedRows });

  console.log(`Saved ${result.count} question(s) to subject "${result.subject.name}" (document ${doc.id}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to seed questions:", err);
    process.exit(1);
  });
