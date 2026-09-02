import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { documents, subjects } from "../db/schema.js";
import { uploadDocument, downloadDocument } from "../lib/storage.js";
import { ensureSubject, saveGeneratedQuestions } from "../lib/save-questions.js";
import { generateQuestionsFromDocument } from "../services/generate-questions.js";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export async function documentRoutes(app: FastifyInstance) {
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

  // Reads a stored document, calls Claude with the schema-constrained
  // prompt, validates and saves `questions`, flips status to "ready".
  app.post<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/documents/:id/generate",
    async (request, reply) => {
      const { id } = request.params;
      const force = request.query.force === "true";

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
        });

        const result = await saveGeneratedQuestions({
          subjectName: subject.name,
          documentId: doc.id,
          rawQuestions: generated,
        });

        await db.update(documents).set({ status: "ready" }).where(eq(documents.id, id));

        return reply.send({ status: "ready", questionCount: result.count });
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
