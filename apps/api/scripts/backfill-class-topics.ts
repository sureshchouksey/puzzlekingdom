#!/usr/bin/env tsx
// One-off backfill for the class/topics columns added in
// drizzle/0002_add_class_and_topic.sql. Run this once, after that
// migration, against content seeded before the Class -> Subject -> Topic
// structure existed (the CSSE Maths/English batches).
//
// What it does:
//   1. Ensures a "11+ Grammar Prep" class exists, and sets class_id on
//      every `documents` row that doesn't have one yet - safe because
//      everything seeded so far is CSSE 11+ exam content.
//   2. Loads every docs/official-papers/generated/*-questions.json file
//      (the same source-of-truth files seed:questions reads from, now
//      tagged with a "topics" array per question) and builds a map from
//      exact question_text -> topics. For every `questions` row with no
//      topics yet, looks up its text in that map and updates it.
//
// Matches by question_text rather than by document, since it's simpler
// and more robust than reconstructing which --source filename was used
// for each of the 2021-2023 batches seeded in an earlier session.
//
// Usage: npm run backfill:class-topics -w apps/api

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { documents, questions } from "../src/db/schema.js";
import { ensureClass } from "../src/lib/save-questions.js";

const GENERATED_DIR = resolve(process.env.INIT_CWD ?? process.cwd(), "docs/official-papers/generated");
const CLASS_LABEL = "11+ Grammar Prep";

async function backfillClass() {
  const classRow = await ensureClass(CLASS_LABEL);
  const result = await db
    .update(documents)
    .set({ classId: classRow.id })
    .where(isNull(documents.classId))
    .returning({ id: documents.id, filename: documents.originalFilename });

  console.log(`Class: assigned "${CLASS_LABEL}" to ${result.length} document(s) with no class set.`);
  return classRow;
}

function loadTopicsByQuestionText(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const files = readdirSync(GENERATED_DIR).filter((f) => f.endsWith("-questions.json"));
  for (const file of files) {
    const raw = JSON.parse(readFileSync(resolve(GENERATED_DIR, file), "utf-8")) as {
      questionText: string;
      topics?: string[];
    }[];
    for (const q of raw) {
      if (q.topics && q.topics.length > 0) {
        map.set(q.questionText, q.topics);
      }
    }
  }
  console.log(`Loaded topic tags for ${map.size} distinct question(s) across ${files.length} file(s).`);
  return map;
}

async function backfillTopics() {
  const topicsByText = loadTopicsByQuestionText();

  const untagged = await db
    .select({ id: questions.id, questionText: questions.questionText })
    .from(questions)
    .where(isNull(questions.topics));

  let updated = 0;
  let unmatched = 0;
  for (const q of untagged) {
    const topics = topicsByText.get(q.questionText);
    if (!topics) {
      unmatched++;
      continue;
    }
    await db.update(questions).set({ topics }).where(eq(questions.id, q.id));
    updated++;
  }

  console.log(`Topics: updated ${updated} question(s); ${unmatched} had no matching entry in the generated JSON files (left untouched).`);
}

async function main() {
  await backfillClass();
  await backfillTopics();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
