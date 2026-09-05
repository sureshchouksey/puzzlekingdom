import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, pgEnum, real } from "drizzle-orm/pg-core";
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
  // A 4-digit PIN (bcrypt-hashed), set once by POST /profiles/:id/set-pin
  // and thereafter checked by POST /profiles/:id/verify-pin - this is what
  // makes a profile a real per-child login rather than just a name anyone
  // could type. Null until first set (older profiles, or a fresh one that
  // hasn't finished onboarding yet); an admin can null it out again via
  // the "reset PIN" action to recover a forgotten one.
  pinHash: text("pin_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A real administrator account (username + bcrypt password hash) - the
// one place that can create/edit/delete questions and see every user's
// data. Separate from `profiles`, which are just named players with no
// login at all.
export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
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
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  selectedOptionId: text("selected_option_id").notNull(),
  isCorrect: boolean("is_correct").notNull(),
});

// The "how do you actually solve this kind of problem" method/formula
// reference for a topic - distinct from any one question's explanation/
// tip (those answer one specific question; this is the general method).
// See plan/AI-Study-Mentor-Agent-Plan.md, Section 8. Content is authored
// via the content-author subagent (Section 10, step 2), not written here -
// this table starts empty. Backs the get_concept_guide MCP tool
// (mcp-server.ts), which returns "not found" honestly for any topic
// without a row yet rather than fabricating one.
export const conceptGuides = pgTable("concept_guides", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").notNull().references(() => classes.id),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  // Same free-text tag convention as questions.topics - not a foreign key,
  // since topics are tag strings, not a table of their own.
  topic: text("topic").notNull(),
  title: text("title").notNull(),
  methodText: text("method_text").notNull(),
  formula: text("formula"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const classesRelations = relations(classes, ({ many }) => ({
  documents: many(documents),
  conceptGuides: many(conceptGuides),
}));

export const subjectsRelations = relations(subjects, ({ many }) => ({
  documents: many(documents),
  questions: many(questions),
  attempts: many(quizAttempts),
  conceptGuides: many(conceptGuides),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  attempts: many(quizAttempts),
  tutorConversations: many(tutorConversations),
  tutorGrowthInsights: many(tutorGrowthInsights),
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

export const conceptGuidesRelations = relations(conceptGuides, ({ one }) => ({
  class: one(classes, { fields: [conceptGuides.classId], references: [classes.id] }),
  subject: one(subjects, { fields: [conceptGuides.subjectId], references: [subjects.id] }),
}));

// Section 10 step 5 (plan/AI-Study-Mentor-Agent-Plan.md) - the tutor's
// on/off toggle and per-profile daily message cap. A real singleton: the
// migration's `id boolean primary key default true` + check constraint
// makes a second row physically impossible, not just discouraged by
// convention, so callers can always read/write this one known row without
// a lookup. tutorSharedDailyBudget is intentionally unenforced right now -
// see the migration's own comment on why a single per-profile cap is
// enough at this app's current (single-family) scale.
export const appSettings = pgTable("app_settings", {
  id: boolean("id").primaryKey().default(true),
  tutorEnabled: boolean("tutor_enabled").notNull().default(true),
  tutorDailyCapPerProfile: integer("tutor_daily_cap_per_profile").notNull().default(30),
  tutorSharedDailyBudget: integer("tutor_shared_daily_budget"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per tutor chat session - see tutorBudget.ts and the
// not-yet-built POST /tutor/conversations route (Section 9). A "general"
// Ask-your-Study-Buddy chat and an "Explain this to me" chat are
// distinguished by contextType; the latter also carries which question/
// attempt it's about.
export const tutorConversations = pgTable("tutor_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profiles.id),
  // Fixed for the conversation's whole lifetime, set once at POST
  // /tutor/conversations and read on every message - see migration 0009's
  // own comment on why this couldn't just be re-sent per message.
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  classId: uuid("class_id").notNull().references(() => classes.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  contextType: text("context_type").notNull().default("general"),
  relatedQuestionId: uuid("related_question_id").references(() => questions.id),
  relatedAttemptId: uuid("related_attempt_id").references(() => quizAttempts.id),
});

// The real transcript. matchedSourceType/matchedSourceId/matchScore mirror
// tutorRetrieval.ts's RetrievedSource and tutorGeneration.ts's TutorReply
// (`type` -> matchedSourceType, a source's `id` -> matchedSourceId, `rank`
// -> matchScore) and are only ever set on 'agent' rows - see Section 8's
// note on keeping this correspondence when writing to this table.
export const tutorMessages = pgTable("tutor_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => tutorConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  matchedSourceType: text("matched_source_type"),
  matchedSourceId: uuid("matched_source_id"),
  matchScore: real("match_score"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tutorConversationsRelations = relations(tutorConversations, ({ one, many }) => ({
  profile: one(profiles, { fields: [tutorConversations.profileId], references: [profiles.id] }),
  subject: one(subjects, { fields: [tutorConversations.subjectId], references: [subjects.id] }),
  class: one(classes, { fields: [tutorConversations.classId], references: [classes.id] }),
  relatedQuestion: one(questions, { fields: [tutorConversations.relatedQuestionId], references: [questions.id] }),
  relatedAttempt: one(quizAttempts, { fields: [tutorConversations.relatedAttemptId], references: [quizAttempts.id] }),
  messages: many(tutorMessages),
}));

export const tutorMessagesRelations = relations(tutorMessages, ({ one }) => ({
  conversation: one(tutorConversations, { fields: [tutorMessages.conversationId], references: [tutorConversations.id] }),
}));

// Distilled, parent-facing summaries of what a profile's been asking
// about - see tutorInsights.ts (Section 10 step 8). One row per
// (profile, topic), enforced by a unique index (migration 0010) so
// regenerating overwrites rather than accumulating duplicates.
export const tutorGrowthInsights = pgTable("tutor_growth_insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  insightText: text("insight_text").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tutorGrowthInsightsRelations = relations(tutorGrowthInsights, ({ one }) => ({
  profile: one(profiles, { fields: [tutorGrowthInsights.profileId], references: [profiles.id] }),
}));
