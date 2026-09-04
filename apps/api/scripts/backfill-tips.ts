#!/usr/bin/env tsx
// One-off backfill for the `tip` column added in
// drizzle/0003_add_tips_and_reports.sql. Run this once, after that
// migration, against all 397 CSSE + Year 3 questions that were seeded
// before tips were authored.
//
// What it does:
//   Loads every *-questions.json file from both content source
//   directories (CSSE past papers and Year 3 mock tests), builds a map
//   from exact question_text -> tip, then updates every `questions` row
//   with no tip yet by looking up its text in that map.
//
// Matches by question_text (same pattern as backfill-class-topics.ts),
// since it's simpler and more robust than tracking which document each
// question came from.
//
// Usage: npm run backfill:tips -w apps/api

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, isNull } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { questions } from "../src/db/schema.js";

const INIT_CWD = process.env.INIT_CWD ?? process.cwd();
const SOURCE_DIRS = [
  resolve(INIT_CWD, "docs/official-papers/generated"),
  resolve(INIT_CWD, "docs/Year3 content/generated"),
];

function loadTipsByQuestionText(): Map<string, string> {
  const map = new Map<string, string>();
  let fileCount = 0;
  for (const dir of SOURCE_DIRS) {
    const files = readdirSync(dir).filter((f) => f.endsWith("-questions.json"));
    fileCount += files.length;
    for (const file of files) {
      const raw = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as {
        questionText: string;
        tip?: string;
      }[];
      for (const q of raw) {
        if (q.tip && q.tip.trim().length > 0) {
          map.set(q.questionText, q.tip);
        }
      }
    }
  }
  console.log(`Loaded tips for ${map.size} distinct question(s) across ${fileCount} file(s).`);
  return map;
}

async function backfillTips() {
  const tipsByText = loadTipsByQuestionText();

  const untipped = await db
    .select({ id: questions.id, questionText: questions.questionText })
    .from(questions)
    .where(isNull(questions.tip));

  let updated = 0;
  let unmatched = 0;
  for (const q of untipped) {
    const tip = tipsByText.get(q.questionText);
    if (!tip) {
      unmatched++;
      continue;
    }
    await db.update(questions).set({ tip }).where(eq(questions.id, q.id));
    updated++;
  }

  console.log(`Tips: updated ${updated} question(s); ${unmatched} had no matching entry in the generated JSON files (left untouched).`);
}

backfillTips()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
