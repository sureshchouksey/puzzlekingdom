import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Puzzle Kingdom - MVP1 schema (see docs/PLAN.md "Database schema (first cut)")
// classes -> subjects -> documents -> questions, and quiz_attempts -> quiz_attempt_answers -> questions

export const documentStatus = pgEnum("document_status", ["uploaded", "processing", "ready", "failed"]);

// The audience a piece of content targets - e.g. "11+ Grammar Prep" for
// CSSE/CCHS exam content, or "Year 3" for National Curriculum course
// content. Nested above subject: the same subject (Maths, English) exists
// across multiple classes, so browsing goes Class -> Subject -> Topic.
export const classes = pgTable("classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const subjects = pgTable("subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

// A lightweight named player, not a real account - no password, no login.
// "Who's playing" is picked from a list (or created) at the Welcome
// screen, and threaded through to quiz_attempts so progress and the
// leaderboard can be attributed to a person.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Cosmetic only ("Prince" / "Princess", matching the Welcome screen) -
  // free text rather than an enum since it's purely decorative.
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  // Nullable: older seeded documents predate the class layer and are
  // backfilled separately; new documents should always set this.
  classId: uuid("class_id").references(() => classes.id),
  originalFilename: text("original_filename").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  status: documentStatus("status").notNull().default("uploaded"),
  failureReason: text("failure_reason"),
  // Shared reading passage/story for documents whose questions all refer
  // back to one piece of source text (e.g. English comprehension papers).
  // Null for documents like Maths papers, where each question is
  // self-contained and there's no passage to show first.
  passage: text("passage"),
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
  // Free-text tag array (e.g. ["Fractions, Decimals & Percentages",
  // "Word Problems"]) assigned at seed/generation time. Not a fixed enum,
  // and a question can carry more than one tag - the app derives its topic
  // filter list from whatever values actually exist for a given
  // class+subject (see GET /topics). Nullable/empty for older content not
  // yet backfilled.
  topics: text("topics").array(),
  // A memorable trick/strategy for getting this question right (e.g. "Add
  // the tens first, then the ones, to avoid mixing up place value" or "ROY
  // G BIV..."), distinct from `explanation` (which states the factual
  // answer). Surfaced especially on a wrong answer, in the results review.
  tip: text("tip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizAttempts = pgTable("quiz_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  // Which class this quiz was assembled from, if the request specified one
  // (nullable - an unfiltered quiz, or one predating the class layer,
  // leaves this null). Lets reports be grouped by class.
  classId: uuid("class_id").references(() => classes.id),
  // Who played this attempt (nullable - an attempt taken before profiles
  // existed, or with no profile selected, simply doesn't show up on the
  // leaderboard).
  profileId: uuid("profile_id").references(() => profiles.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  score: integer("score"),
  totalQuestions: integer("total_questions").notNull(),
  // How many questions make up one stage for this attempt, chosen at
  // assembly time and clamped server-side to totalQuestions.
  stageSize: integer("stage_size").notNull().default(5),
  // How many full stages have been scored so far. Updated on every stage
  // submission (not only at final completion) so an attempt abandoned
  // partway through still credits whatever stages were actually cleared -
  // this is what the leaderboard sums per profile.
  stagesCleared: integer("stages_cleared").notNull().default(0),
  // A snapshot, computed once at submit time, of accuracy per topic for
  // this one attempt: { "Fractions, Decimals & Percentages": { correct: 3,
  // total: 5 }, ... }. A question with more than one topic tag contributes
  // to every tag it carries. Stored rather than recomputed live so a
  // report stays accurate to what was actually asked even if a question's
  // topics are edited later, and so /reports can aggregate cheaply across
  // many attempts. Null until the attempt is submitted.
  topicBreakdown: jsonb("topic_breakdown").$type<Record<string, { correct: number; total: number }>>(),
});

export const quizAttemptAnswers = pgTable("quiz_attempt_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id").notNull().references(() => quizAttempts.id),
  questionId: uuid("question_id").notNull().references(() => questions.id),
  selectedOptionId: text("selected_option_id").notNull(),
  isCorrect: boolean("is_correct").notNull(),
});

export const classesRelations = relations(classes, ({ many }) => ({
  documents: many(documents),
}));

export const subjectsRelations = relations(subjects, ({ many }) => ({
  documents: many(documents),
  questions: many(questions),
  attempts: many(quizAttempts),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  attempts: many(quizAttempts),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  subject: one(subjects, { fields: [documents.subjectId], references: [subjects.id] }),
  class: one(classes, { fields: [documents.classId], references: [classes.id] }),
  questions: many(questions),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  document: one(documents, { fields: [questions.documentId], references: [documents.id] }),
  subject: one(subjects, { fields: [questions.subjectId], references: [subjects.id] }),
  answers: many(quizAttemptAnswers),
}));

export const quizAttemptsRelations = relations(quizAttempts, ({ one, many }) => ({
  subject: one(subjects, { fields: [quizAttempts.subjectId], references: [subjects.id] }),
  class: one(classes, { fields: [quizAttempts.classId], references: [classes.id] }),
  profile: one(profiles, { fields: [quizAttempts.profileId], references: [profiles.id] }),
  answers: many(quizAttemptAnswers),
}));

export const quizAttemptAnswersRelations = relations(quizAttemptAnswers, ({ one }) => ({
  attempt: one(quizAttempts, { fields: [quizAttemptAnswers.attemptId], references: [quizAttempts.id] }),
  question: one(questions, { fields: [quizAttemptAnswers.questionId], references: [questions.id] }),
}));
