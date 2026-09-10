import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { documents, subjects } from "../db/schema.js";
import { uploadDocument, downloadDocument } from "../lib/storage.js";
import { ensureSubject, saveGeneratedQuestions, saveTypedQuestions, createSeedDocument } from "../lib/save-questions.js";
import { QUESTION_TYPES, questionOptionSchema, validateQuestionShape } from "../lib/question-shape.js";
import { z } from "zod";
import { generateQuestionsFromDocument } from "../services/generate-questions.js";
import { estimateGenerationCosts } from "../lib/ai-pricing.js";
import type { AiProvider } from "../services/providers/types.js";
import { requireAdmin } from "../auth.js";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

// Wire shape for one question in POST /documents/manual's bulk "I already
// have questions" body - any of the 8 question types, mirroring admin.ts's
// questionWriteSchema (minus documentId, which this route sets once for
// the whole batch via createSeedDocument) but with questionText/
// explanation required rather than optional, since this route only ever
// creates new questions, never patches existing ones. Per-type shape
// rules (accepted answers, match-column pairs, etc.) are checked
// afterward by validateQuestionShape, not here.
const manualQuestionSchema = z.object({
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
const manualQuestionSetSchema = z.array(manualQuestionSchema).min(1);

export async function documentRoutes(app: FastifyInstance) {
  // Content management is admin-only - every route in this file changes
  // what questions exist, so all of them require an admin session.
  app.addHook("preHandler", requireAdmin);

  // Upload a PDF/image, tagged with a subject. Stores the file in Supabase
  // Storage and creates a `documents` row with status "uploaded".
  app.post("/documents", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "No file uploaded" });

    const subjectField = file.fields.subject;
    const subjectName =
      subjectField && "value" in subjectField ? String(subjectField.value) : undefined;
    if (!subjectName) return reply.status(400).send({ error: "subject is required" });

    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.status(400).send({ error: `Unsupported file type: ${file.mimetype}` });
    }

    const buffer = await file.toBuffer();
    const subject = await ensureSubject(subjectName);
    const storagePath = `${subject.id}/${randomUUID()}-${file.filename}`;

    await uploadDocument({ buffer, path: storagePath, mimeType: file.mimetype });

    const [doc] = await db
      .insert(documents)
      .values({
        subjectId: subject.id,
        originalFilename: file.filename,
        storagePath,
        mimeType: file.mimetype,
        status: "uploaded",
      })
      .returning();

    return reply.status(201).send({ id: doc.id, status: doc.status });
  });

  // "I already have questions" path: save a hand-entered (or otherwise
  // already-known) set of questions straight to the database, with no AI
  // call at all - the other option alongside AI generation, for content
  // like the CSSE past papers where the real correct answers are already
  // known and don't need to be (re)derived by a model.
  app.post<{ Body: { subjectName?: string; filename?: string; questions?: unknown; passage?: string } }>(
    "/documents/manual",
    async (request, reply) => {
      const subjectName = request.body?.subjectName;
      const filename = request.body?.filename?.trim() || "Manually entered content";
      const rawQuestions = request.body?.questions;
      const passage = request.body?.passage?.trim() || undefined;

      if (!subjectName) return reply.status(400).send({ error: "subjectName is required" });
      if (!rawQuestions) return reply.status(400).send({ error: "questions is required" });

      const parsed = manualQuestionSetSchema.safeParse(rawQuestions);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid questions - check each one's fields for its question type.",
          details: parsed.error.issues,
        });
      }

      // Same per-type validation admin.ts's POST /admin/questions uses for
      // a single question, run here across the whole batch - any of the 8
      // types can appear, each mixed freely with the others in one upload
      // (e.g. a CSSE paper with MCQ, fill-in-blank, and a match-the-column
      // question together).
      const shapedRows: Parameters<typeof saveTypedQuestions>[0]["rows"] = [];
      for (const [i, q] of parsed.data.entries()) {
        const questionType = q.questionType ?? "mcq";
        const shape = validateQuestionShape(questionType, q.options ?? [], q.correctOptionId ?? "", q.answerPayload ?? null);
        if (!shape.ok) {
          return reply.status(400).send({ error: `Question ${i + 1} ("${q.questionText.slice(0, 40)}"): ${shape.error}` });
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

      const doc = await createSeedDocument({ subjectName, filename, mimeType: "text/plain", passage });
      const result = await saveTypedQuestions({ subjectName, documentId: doc.id, rows: shapedRows });

      return reply.status(201).send({ status: "ready", questionCount: result.count, documentId: doc.id });
    }
  );

  // Before generating, show the user what each provider would cost for the
  // requested number of questions, so they can choose - never picked for
  // them. Free to call (both providers' token-counting endpoints are free);
  // doesn't touch document status or spend any generation budget.
  app.post<{ Params: { id: string }; Body: { count?: number } }>(
    "/documents/:id/estimate",
    async (request, reply) => {
      const { id } = request.params;
      const count = request.body?.count ?? 8;

      const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
      if (!doc) return reply.status(404).send({ error: "Document not found" });

      const [subject] = await db.select().from(subjects).where(eq(subjects.id, doc.subjectId)).limit(1);
      if (!subject) return reply.status(404).send({ error: "Subject not found" });

      const buffer = await downloadDocument(doc.storagePath);
      const estimates = await estimateGenerationCosts({
        fileBase64: buffer.toString("base64"),
        mimeType: doc.mimeType,
        subjectName: subject.name,
        count,
      });

      return reply.send({ documentId: doc.id, requestedQuestionCount: count, estimates });
    }
  );

  // Reads a stored document, calls the chosen AI provider with the
  // schema-constrained prompt, validates and saves `questions`, flips
  // status to "ready". The caller picks `provider` and `count` - normally
  // after looking at /estimate first - rather than the server deciding
  // silently; both are optional and fall back to the server's AI_PROVIDER
  // default and 8 questions if omitted (e.g. for scripts/tests).
  app.post<{ Params: { id: string }; Querystring: { force?: string }; Body?: { provider?: AiProvider; count?: number } }>(
    "/documents/:id/generate",
    async (request, reply) => {
      const { id } = request.params;
      const force = request.query.force === "true";
      const provider = request.body?.provider;
      const count = request.body?.count;

      const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
      if (!doc) return reply.status(404).send({ error: "Document not found" });

      // Generation is a one-time activity per document, not something that
      // happens every time someone takes a quiz - quiz-taking only ever
      // reads questions already saved here. Refuse to call the AI (and
      // spend money) again for a document that's already been processed,
      // unless the caller explicitly asks to regenerate with ?force=true.
      if (doc.status === "processing") {
        return reply.status(409).send({ error: "Generation already in progress for this document." });
      }
      if (doc.status === "ready" && !force) {
        return reply.status(409).send({
          error: "Questions were already generated for this document. Pass ?force=true to regenerate.",
        });
      }

      const [subject] = await db.select().from(subjects).where(eq(subjects.id, doc.subjectId)).limit(1);
      if (!subject) return reply.status(404).send({ error: "Subject not found" });

      await db.update(documents).set({ status: "processing" }).where(eq(documents.id, id));

      try {
        const buffer = await downloadDocument(doc.storagePath);
        const generated = await generateQuestionsFromDocument({
          fileBase64: buffer.toString("base64"),
          mimeType: doc.mimeType,
          subjectName: subject.name,
          provider,
          count,
        });

        const result = await saveGeneratedQuestions({
          subjectName: subject.name,
          documentId: doc.id,
          rawQuestions: generated,
        });

        await db.update(documents).set({ status: "ready" }).where(eq(documents.id, id));

        return reply.send({ status: "ready", questionCount: result.count, provider: provider ?? "default" });
      } catch (err) {
        app.log.error(err);
        await db
          .update(documents)
          .set({ status: "failed", failureReason: err instanceof Error ? err.message : "Unknown error" })
          .where(eq(documents.id, id));
        return reply.status(500).send({ error: "Generation failed" });
      }
    }
  );
}
