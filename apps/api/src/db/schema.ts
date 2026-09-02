import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Puzzle Kingdom - MVP1 schema (see docs/PLAN.md "Database schema (first cut)")
// subjects -> documents -> questions, and quiz_attempts -> quiz_attempt_answers -> questions

export const documentStatus = pgEnum("document_status", ["uploaded", "processing", "ready", "failed"]);

export const subjects = pgTable("subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  originalFilename: text("original_filename").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  status: documentStatus("status").notNull().default("uploaded"),
  failureReason: text("failure_reason"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  questionText: text("question_text").notNull(),
  // [{ id: "a", text: "..." }, ...]
  options: jsonb("options").$type<{ id: string; text: string }[]>().notNull(),
  correctOptionId: text("correct_option_id").notNull(),
  explanation: text("explanation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizAttempts = pgTable("quiz_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  score: integer("score"),
  totalQuestions: integer("total_questions").notNull(),
});

export const quizAttemptAnswers = pgTable("quiz_attempt_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id").notNull().references(() => quizAttempts.id),
  questionId: uuid("question_id").notNull().references(() => questions.id),
  selectedOptionId: text("selected_option_id").notNull(),
  isCorrect: boolean("is_correct").notNull(),
});

export const subjectsRelations = relations(subjects, ({ many }) => ({
  documents: many(documents),
  questions: many(questions),
  attempts: many(quizAttempts),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  subject: one(subjects, { fields: [documents.subjectId], references: [subjects.id] }),
  questions: many(questions),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  document: one(documents, { fields: [questions.documentId], references: [documents.id] }),
  subject: one(subjects, { fields: [questions.subjectId], references: [subjects.id] }),
  answers: many(quizAttemptAnswers),
}));

export const quizAttemptsRelations = relations(quizAttempts, ({ one, many }) => ({
  subject: one(subjects, { fields: [quizAttempts.subjectId], references: [subjects.id] }),
  answers: many(quizAttemptAnswers),
}));

export const quizAttemptAnswersRelations = relations(quizAttemptAnswers, ({ one }) => ({
  attempt: one(quizAttempts, { fields: [quizAttemptAnswers.attemptId], references: [quizAttempts.id] }),
  question: one(questions, { fields: [quizAttemptAnswers.questionId], references: [questions.id] }),
}));
