import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { subjects, documents, questions } from "../db/schema.js";
import { generatedQuestionSetSchema, type GeneratedQuestion } from "./question-schema.js";

export async function ensureSubject(name: string) {
  const existing = await db.select().from(subjects).where(eq(subjects.name, name)).limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db.insert(subjects).values({ name }).returning();
  return created;
}

// Used by the content-seeding CLI script / skill, where there's no real
// uploaded file going through Supabase Storage - it still creates a real
// `documents` row (status "ready") so seeded questions trace back to a source.
export async function createSeedDocument(params: {
  subjectName: string;
  filename: string;
  mimeType: string;
}) {
  const subject = await ensureSubject(params.subjectName);
  const [doc] = await db
    .insert(documents)
    .values({
      subjectId: subject.id,
      originalFilename: params.filename,
      storagePath: `seed:${params.filename}`,
      mimeType: params.mimeType,
      status: "ready",
    })
    .returning();
  return doc;
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
  }));

  const inserted = await db.insert(questions).values(rows).returning({ id: questions.id });
  return { subject, count: inserted.length };
}
