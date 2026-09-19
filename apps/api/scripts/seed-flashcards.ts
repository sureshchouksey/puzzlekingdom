#!/usr/bin/env tsx
// Flashcard-seeding CLI, same convention as seed-questions.ts.
//
// Usage:
//   npm run seed:flashcards -w apps/api -- --subject "Claude Certified Architect - Professional" --flashcards path/to/flashcards.json
//
// --flashcards is a JSON array of {topic?, front, back} - resolved
// relative to the directory you ran the command FROM (INIT_CWD), same
// path-resolution rule as seed-questions.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../src/db/client.js";
import { flashcards, subjects } from "../src/db/schema.js";

const flashcardSchema = z.object({
  topic: z.string().min(1).optional(),
  front: z.string().min(1),
  back: z.string().min(1),
});
const flashcardSetSchema = z.array(flashcardSchema).min(1);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baseDir = process.env.INIT_CWD ?? process.cwd();
function resolvePath(p: string): string {
  return resolve(baseDir, p);
}

async function ensureSubject(name: string) {
  const [existing] = await db.select().from(subjects).where(eq(subjects.name, name)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(subjects).values({ name }).returning();
  return created;
}

async function main() {
  const subject = arg("subject");
  const flashcardsFile = arg("flashcards");

  if (!subject || !flashcardsFile) {
    console.error(
      'Usage: npm run seed:flashcards -- --subject "Claude Certified Architect - Professional" --flashcards path/to/flashcards.json'
    );
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(resolvePath(flashcardsFile), "utf-8"));
  const cards = flashcardSetSchema.parse(raw);

  const subjectRow = await ensureSubject(subject);

  const inserted = await db
    .insert(flashcards)
    .values(cards.map((c) => ({ subjectId: subjectRow.id, topic: c.topic, front: c.front, back: c.back })))
    .returning();

  console.log(`Saved ${inserted.length} flashcards for subject "${subject}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed flashcards:", err);
  process.exit(1);
});
