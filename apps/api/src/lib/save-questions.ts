import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { subjects, classes, documents, questions } from "../db/schema.js";
import { generatedQuestionSetSchema, type GeneratedQuestion } from "./question-schema.js";
import type { QuestionType, QuestionOption } from "./question-shape.js";

export async function ensureSubject(name: string) {
  const existing = await db.select().from(subjects).where(eq(subjects.name, name)).limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db.insert(subjects).values({ name }).returning();
  return created;
}

// The audience a document targets - e.g. "11+ Grammar Prep", "Year 3".
// Same ensure-or-create pattern as ensureSubject.
export async function ensureClass(name: string) {
  const existing = await db.select().from(classes).where(eq(classes.name, name)).limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db.insert(classes).values({ name }).returning();
  return created;
}

// Used by the content-seeding CLI script / skill, where there's no real
// uploaded file going through Supabase Storage - it still creates a real
// `documents` row (status "ready") so seeded questions trace back to a source.
export async function createSeedDocument(params: {
  subjectName: string;
  filename: string;
  mimeType: string;
  // For reading-comprehension content where every question in this
  // document refers back to one shared story/passage that needs to be
  // shown to the quiz-taker before its questions (e.g. CSSE English
  // papers). Omit/undefined for content with no shared passage (e.g. Maths).
  passage?: string;
  // The audience this content targets (e.g. "11+ Grammar Prep", "Year 3").
  // Optional for backward compatibility with older callers, but new
  // seeding should always set this.
  classLabel?: string;
}) {
  const subject = await ensureSubject(params.subjectName);
  const classRow = params.classLabel ? await ensureClass(params.classLabel) : undefined;
  const [doc] = await db
    .insert(documents)
    .values({
      subjectId: subject.id,
      classId: classRow?.id,
      originalFilename: params.filename,
      storagePath: `seed:${params.filename}`,
      mimeType: params.mimeType,
      status: "ready",
      passage: params.passage,
    })
    .returning();
  return doc;
}

// Inserts a batch of already type-validated questions (the caller has
// already run each one through question-shape.ts's validateQuestionShape)
// against one document - used by POST /documents/manual's "I already
// have questions" path, which (unlike saveGeneratedQuestions above) isn't
// limited to MCQ: any of the 8 question types can appear in the same
// batch, each with whatever answerPayload its type needs. Deliberately a
// separate function from saveGeneratedQuestions rather than a shared one
// with a type switch - that function is also the AI-generation path's
// insert, which stays MCQ-only on purpose (see
// Question-Types-and-Content-Authoring-Plan.md's "deliberately skipped"
// note on extending AI generation to the new types), so keeping them
// separate means a future change to one can't accidentally affect the
// other.
export async function saveTypedQuestions(params: {
  subjectName: string;
  documentId: string;
  rows: Array<{
    questionType: QuestionType;
    questionText: string;
    options: QuestionOption[];
    correctOptionId: string;
    answerPayload: Record<string, unknown> | null;
    imageUrl?: string;
    explanation: string;
    topics?: string[];
    tip?: string;
  }>;
}) {
  const subject = await ensureSubject(params.subjectName);

  const rows = params.rows.map((q) => ({
    documentId: params.documentId,
    subjectId: subject.id,
    questionText: q.questionText,
    questionType: q.questionType,
    options: q.options,
    correctOptionId: q.correctOptionId,
    answerPayload: q.answerPayload,
    imageUrl: q.imageUrl,
    explanation: q.explanation,
    topics: q.topics,
    tip: q.tip,
  }));

  const inserted = await db.insert(questions).values(rows).returning({ id: questions.id });
  return { subject, count: inserted.length };
}

export async function saveGeneratedQuestions(params: {
  subjectName: string;
  documentId: string;
  rawQuestions: unknown;
}) {
  const parsed = generatedQuestionSetSchema.parse(params.rawQuestions);
  const subject = await ensureSubject(params.subjectName);

  const rows = parsed.map((q: GeneratedQuestion) => ({
    documentId: params.documentId,
    subjectId: subject.id,
    questionText: q.questionText,
    options: q.options,
    correctOptionId: q.correctOptionId,
    explanation: q.explanation,
    topics: q.topics,
    tip: q.tip,
  }));

  const inserted = await db.insert(questions).values(rows).returning({ id: questions.id });
  return { subject, count: inserted.length };
}
