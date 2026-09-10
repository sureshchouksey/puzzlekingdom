import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { eq, and, desc, ilike, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { admins, questions, documents, subjects, classes, topics, profiles, quizAttempts, quizAttemptAnswers, tutorConversations, tutorGrowthInsights, gameAttempts } from "../db/schema.js";
import { generatedOptionSchema } from "../lib/question-schema.js";
import { QUESTION_TYPES, type QuestionType, type QuestionOption, validateQuestionShape } from "../lib/question-shape.js";
import { getAppSettings } from "../services/tutorBudget.js";
import { clearGrowthInsights, generateGrowthInsights, getDoubtBreakdown, getGrowthInsights } from "../services/tutorInsights.js";
import { requireAdmin } from "../auth.js";
import { z } from "zod";

const DEFAULT_PAGE_SIZE = 30;

// Body shape for PATCH /admin/settings - every field optional, same
// "only send what changed" convention as questionWriteSchema. tutorEnabled
// is the Study Buddy on/off switch from Section 10 step 5;
// tutorDailyCapPerProfile is the per-profile daily message cap (30 by
// default, see tutorBudget.ts); tutorSharedDailyBudget stays here even
// though tutorBudget.ts doesn't enforce it yet (deliberately deferred,
// see that file's header comment) - accepting and storing it now means
// enabling the shared cap later is a tutorBudget.ts change only, not
// another route/schema change.
const settingsWriteSchema = z.object({
  tutorEnabled: z.boolean().optional(),
  tutorDailyCapPerProfile: z.number().int().positive().optional(),
  tutorSharedDailyBudget: z.number().int().positive().nullable().optional(),
  // Track 2's three-way Resource Access toggle (migration 0022) - see
  // tutorBudget.ts's AppSettings for what each one gates.
  tutorUseConceptGuides: z.boolean().optional(),
  tutorUseCache: z.boolean().optional(),
  tutorUseGemini: z.boolean().optional(),
  // Flag-based feature management (migration 0023) - see
  // tutorBudget.ts's AppSettings for what each one gates.
  arcadeEnabled: z.boolean().optional(),
  gameSpellingSprintEnabled: z.boolean().optional(),
  gameMissingLettersEnabled: z.boolean().optional(),
  gameWordMeaningMatchEnabled: z.boolean().optional(),
  gameHomophoneHunterEnabled: z.boolean().optional(),
  gamePrefixSuffixBuilderEnabled: z.boolean().optional(),
  tutorFunContentEnabled: z.boolean().optional(),
});

// Body shape for creating/editing one question by hand from the admin
// dashboard - looser than generatedQuestionSchema (every field optional
// except documentId on create) since an edit only sends the fields that
// changed, not the whole question every time. options/correctOptionId
// are validated more strictly (per questionType) in
// validateQuestionShape below, not here - this schema just checks the
// wire shape, not the business rules for a given type.
const questionWriteSchema = z.object({
  documentId: z.string().uuid().optional(),
  questionType: z.enum(QUESTION_TYPES).optional(),
  questionText: z.string().min(1).optional(),
  options: z.array(generatedOptionSchema).max(6).optional(),
  correctOptionId: z.string().optional(),
  // Per-type shape (acceptedAnswers / left+right+correctPairs /
  // rubricKeyPoints) - validated in validateQuestionShape, not here,
  // since the required keys depend on questionType.
  answerPayload: z.record(z.unknown()).nullable().optional(),
  // Non-Verbal Reasoning (Phase 2) will be the first real user of this,
  // but it's accepted for any type now that the column exists (migration
  // 0017) - no reason to gate it to one question type.
  imageUrl: z.string().min(1).optional(),
  explanation: z.string().min(1).optional(),
  topics: z.array(z.string().min(1)).optional(),
  tip: z.string().min(1).optional(),
});

// Body shape for creating/editing a subject from the admin dashboard.
// Subjects are flat and reusable across classes (see subjects.ts) - just
// a name.
const subjectWriteSchema = z.object({
  name: z.string().min(1),
});

// Body shape for creating/editing a topic (schema.ts's topics table -
// class+subject scoped, ordered, with a difficulty). classId/subjectId/
// name are required on create but all-optional here so the same schema
// covers PATCH's "only send what changed" convention too.
const topicWriteSchema = z.object({
  classId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  name: z.string().min(1).optional(),
  displayOrder: z.number().int().optional(),
  difficulty: z.enum(["beginner", "medium", "hard"]).optional(),
});

// Admin-only routes: real login (username + bcrypt-hashed password, unlike
// the passwordless player profiles), full question CRUD, and a roster of
// every profile with their stats. This is the one place content gets
// managed - see documentRoutes, which is gated with the same requireAdmin.
export async function adminRoutes(app: FastifyInstance) {
  app.post<{ Body: { username?: string; password?: string } }>("/admin/login", async (request, reply) => {
    const username = request.body?.username?.trim();
    const password = request.body?.password;
    if (!username || !password) {
      return reply.status(400).send({ error: "username and password are required" });
    }

    const [admin] = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      return reply.status(401).send({ error: "Invalid username or password" });
    }

    const token = await app.jwt.sign(
      { kind: "admin", adminId: admin.id, username: admin.username },
      { expiresIn: "30d" }
    );
    return reply.send({ admin: { id: admin.id, username: admin.username }, token });
  });

  // Public summary of the flag-based feature toggles (migration 0023) -
  // deliberately NOT under requireAdmin, since this is exactly what the
  // kid-facing app (Home, SubjectPicker, StudyBuddy, Arcade) needs to
  // read on every screen to decide what to show. Only exposes the on/off
  // booleans a normal player screen cares about, not the admin-only caps
  // (tutorDailyCapPerProfile etc.) GET /admin/settings returns - those
  // stay behind requireAdmin below. Each game's flag is ANDed with the
  // arcade master switch here, so the frontend never has to know that
  // rule exists - "arcade off" and "this one game off" both just read as
  // `false` for that game.
  app.get("/features", async () => {
    const settings = await getAppSettings();
    return {
      studyBuddyEnabled: settings.tutorEnabled,
      funContentEnabled: settings.tutorFunContentEnabled,
      arcadeEnabled: settings.arcadeEnabled,
      games: {
        spelling_sprint: settings.arcadeEnabled && settings.gameSpellingSprintEnabled,
        missing_letters: settings.arcadeEnabled && settings.gameMissingLettersEnabled,
        word_meaning_match: settings.arcadeEnabled && settings.gameWordMeaningMatchEnabled,
        homophone_hunter: settings.arcadeEnabled && settings.gameHomophoneHunterEnabled,
        prefix_suffix_builder: settings.arcadeEnabled && settings.gamePrefixSuffixBuilderEnabled,
      },
    };
  });

  // Everything below this line requires a valid admin session. A nested
  // register() creates its own encapsulation context, which is required
  // here - addHook only exempts routes in a SEPARATE context, not routes
  // declared earlier in the SAME context (Fastify wires hooks to a
  // context's whole route set regardless of source-order), so without
  // this nesting the preHandler would also apply to /admin/login above
  // and nobody could ever log in.
  await app.register(async (protectedApp) => {
  protectedApp.addHook("preHandler", requireAdmin);

  protectedApp.get<{
    Querystring: { subjectName?: string; classId?: string; topic?: string; search?: string; limit?: string; cursor?: string };
  }>(
    "/admin/questions",
    async (request) => {
      const { subjectName, classId, topic, search } = request.query;
      const limit = Math.min(Number(request.query.limit) || DEFAULT_PAGE_SIZE, 100);
      const offset = Math.max(Number(request.query.cursor) || 0, 0);

      const conditions = [];
      if (subjectName) conditions.push(eq(subjects.name, subjectName));
      if (classId) conditions.push(eq(documents.classId, classId));
      // topics is a text[] tag array - a question matches if the requested
      // topic string is one of its tags, same convention as quizzes.ts's
      // assembleQuiz topic filter.
      if (topic) conditions.push(sql`${questions.topics} @> ARRAY[${topic}]::text[]`);
      if (search) conditions.push(ilike(questions.questionText, `%${search}%`));

      const rows = await db
        .select({
          id: questions.id,
          questionText: questions.questionText,
          options: questions.options,
          correctOptionId: questions.correctOptionId,
          questionType: questions.questionType,
          answerPayload: questions.answerPayload,
          imageUrl: questions.imageUrl,
          explanation: questions.explanation,
          topics: questions.topics,
          tip: questions.tip,
          documentId: questions.documentId,
          subjectName: subjects.name,
          className: classes.name,
          createdAt: questions.createdAt,
        })
        .from(questions)
        .innerJoin(subjects, eq(questions.subjectId, subjects.id))
        .innerJoin(documents, eq(questions.documentId, documents.id))
        .leftJoin(classes, eq(documents.classId, classes.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(questions.createdAt))
        .limit(limit + 1)
        .offset(offset);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return { questions: page, nextCursor: hasMore ? String(offset + limit) : null };
    }
  );

  protectedApp.post<{ Body: unknown }>("/admin/questions", async (request, reply) => {
    const parsed = questionWriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid question", details: parsed.error.issues });
    const body = parsed.data;

    if (!body.documentId) return reply.status(400).send({ error: "documentId is required" });
    if (!body.questionText || !body.explanation) {
      return reply.status(400).send({ error: "questionText and explanation are both required to create a question" });
    }

    const questionType = body.questionType ?? "mcq";
    const shape = validateQuestionShape(questionType, body.options ?? [], body.correctOptionId ?? "", body.answerPayload ?? null);
    if (!shape.ok) return reply.status(400).send({ error: shape.error });

    const [doc] = await db.select().from(documents).where(eq(documents.id, body.documentId)).limit(1);
    if (!doc) return reply.status(404).send({ error: "Document not found" });

    const [created] = await db
      .insert(questions)
      .values({
        documentId: doc.id,
        subjectId: doc.subjectId,
        questionText: body.questionText,
        questionType,
        options: shape.options,
        correctOptionId: shape.correctOptionId,
        answerPayload: shape.answerPayload,
        imageUrl: body.imageUrl,
        explanation: body.explanation,
        topics: body.topics,
        tip: body.tip,
      })
      .returning();

    return reply.status(201).send(created);
  });

  protectedApp.patch<{ Params: { id: string }; Body: unknown }>("/admin/questions/:id", async (request, reply) => {
    const parsed = questionWriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid question", details: parsed.error.issues });
    const body = parsed.data;

    const [existing] = await db.select().from(questions).where(eq(questions.id, request.params.id)).limit(1);
    if (!existing) return reply.status(404).send({ error: "Question not found" });

    const nextType = body.questionType ?? existing.questionType;
    // A type change means the old options/answerPayload belong to the old
    // shape and shouldn't be reused as a fallback - the caller must send
    // the new type's fields together (the admin form always does this,
    // since switching the type picker resets the type-specific fields).
    const typeChanged = body.questionType !== undefined && body.questionType !== existing.questionType;
    const nextOptions = body.options ?? (typeChanged ? [] : existing.options);
    const nextCorrectOptionId = body.correctOptionId ?? (typeChanged ? "" : existing.correctOptionId);
    const nextAnswerPayload = body.answerPayload !== undefined ? body.answerPayload : typeChanged ? null : existing.answerPayload;

    const shape = validateQuestionShape(nextType, nextOptions, nextCorrectOptionId, nextAnswerPayload);
    if (!shape.ok) return reply.status(400).send({ error: shape.error });

    const [updated] = await db
      .update(questions)
      .set({
        questionText: body.questionText ?? existing.questionText,
        questionType: nextType,
        options: shape.options,
        correctOptionId: shape.correctOptionId,
        answerPayload: shape.answerPayload,
        imageUrl: body.imageUrl ?? existing.imageUrl,
        explanation: body.explanation ?? existing.explanation,
        topics: body.topics ?? existing.topics,
        tip: body.tip ?? existing.tip,
      })
      .where(eq(questions.id, existing.id))
      .returning();

    return reply.send(updated);
  });

  protectedApp.delete<{ Params: { id: string } }>("/admin/questions/:id", async (request, reply) => {
    const [deleted] = await db.delete(questions).where(eq(questions.id, request.params.id)).returning();
    if (!deleted) return reply.status(404).send({ error: "Question not found" });
    return reply.status(204).send();
  });

  // Subjects are flat and shared across classes (subjects.ts's GET
  // /subjects lists them for anyone) - admin can add a new one here, e.g.
  // when a subject like Religion needs to exist before any documents or
  // topics can be created under it.
  protectedApp.get("/admin/subjects", async () => {
    return db.select().from(subjects).orderBy(subjects.name);
  });

  protectedApp.post<{ Body: unknown }>("/admin/subjects", async (request, reply) => {
    const parsed = subjectWriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid subject", details: parsed.error.issues });

    try {
      const [created] = await db.insert(subjects).values({ name: parsed.data.name }).returning();
      return reply.status(201).send(created);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "A subject with that name already exists" });
      }
      throw err;
    }
  });

  // Topics (plan/Question-Types-and-Content-Authoring-Plan.md's reward/
  // difficulty labels + the quest map's node sequence - see schema.ts's
  // comment on the topics table for the full rationale). Listed/managed
  // per class+subject since that's how the table is scoped.
  protectedApp.get<{ Querystring: { classId?: string; subjectId?: string } }>(
    "/admin/topics",
    async (request) => {
      const { classId, subjectId } = request.query;
      const conditions = [];
      if (classId) conditions.push(eq(topics.classId, classId));
      if (subjectId) conditions.push(eq(topics.subjectId, subjectId));

      return db
        .select({
          id: topics.id,
          classId: topics.classId,
          subjectId: topics.subjectId,
          name: topics.name,
          displayOrder: topics.displayOrder,
          difficulty: topics.difficulty,
          createdAt: topics.createdAt,
          className: classes.name,
          subjectName: subjects.name,
        })
        .from(topics)
        .innerJoin(classes, eq(topics.classId, classes.id))
        .innerJoin(subjects, eq(topics.subjectId, subjects.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(topics.displayOrder, topics.name);
    }
  );

  protectedApp.post<{ Body: unknown }>("/admin/topics", async (request, reply) => {
    const parsed = topicWriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid topic", details: parsed.error.issues });
    const body = parsed.data;

    if (!body.classId || !body.subjectId || !body.name) {
      return reply.status(400).send({ error: "classId, subjectId, and name are all required to create a topic" });
    }

    try {
      const [created] = await db
        .insert(topics)
        .values({
          classId: body.classId,
          subjectId: body.subjectId,
          name: body.name,
          displayOrder: body.displayOrder ?? 0,
          difficulty: body.difficulty ?? "beginner",
        })
        .returning();
      return reply.status(201).send(created);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "A topic with that name already exists for this class and subject" });
      }
      throw err;
    }
  });

  protectedApp.patch<{ Params: { id: string }; Body: unknown }>("/admin/topics/:id", async (request, reply) => {
    const parsed = topicWriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid topic", details: parsed.error.issues });
    const body = parsed.data;

    const [existing] = await db.select().from(topics).where(eq(topics.id, request.params.id)).limit(1);
    if (!existing) return reply.status(404).send({ error: "Topic not found" });

    try {
      const [updated] = await db
        .update(topics)
        .set({
          classId: body.classId ?? existing.classId,
          subjectId: body.subjectId ?? existing.subjectId,
          name: body.name ?? existing.name,
          displayOrder: body.displayOrder ?? existing.displayOrder,
          difficulty: body.difficulty ?? existing.difficulty,
        })
        .where(eq(topics.id, existing.id))
        .returning();
      return reply.send(updated);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "A topic with that name already exists for this class and subject" });
      }
      throw err;
    }
  });

  protectedApp.delete<{ Params: { id: string } }>("/admin/topics/:id", async (request, reply) => {
    const [deleted] = await db.delete(topics).where(eq(topics.id, request.params.id)).returning();
    if (!deleted) return reply.status(404).send({ error: "Topic not found" });
    return reply.status(204).send();
  });

  // Same two-CTE aggregation shape as GET /leaderboard (see that route for
  // why it's two separate aggregations, not one join), just without the
  // per-class split or the "played at least one quiz" filter - admin sees
  // every profile, including ones that haven't played yet.
  protectedApp.get("/admin/users", async () => {
    const rows = await db.execute<{
      profile_id: string;
      name: string;
      title: string | null;
      avatar_id: string | null;
      created_at: string;
      has_pin: boolean;
      quizzes_played: number;
      stages_cleared: number;
      questions_answered: number;
      questions_correct: number;
      last_active: string | null;
    }>(sql`
      with attempt_agg as (
        select
          profile_id,
          count(*) as quizzes_played,
          coalesce(sum(stages_cleared), 0) as stages_cleared,
          max(coalesce(completed_at, started_at)) as last_active
        from ${quizAttempts}
        where profile_id is not null
        group by profile_id
      ),
      answer_agg as (
        select
          qa.profile_id,
          count(qaa.id) as questions_answered,
          count(qaa.id) filter (where qaa.is_correct) as questions_correct
        from ${quizAttempts} qa
        inner join ${quizAttemptAnswers} qaa on qaa.attempt_id = qa.id
        where qa.profile_id is not null
        group by qa.profile_id
      )
      select
        p.id as profile_id,
        p.name,
        p.title,
        p.avatar_id,
        p.created_at,
        (p.pin_hash is not null) as has_pin,
        coalesce(attempt_agg.quizzes_played, 0) as quizzes_played,
        coalesce(attempt_agg.stages_cleared, 0) as stages_cleared,
        coalesce(answer_agg.questions_answered, 0) as questions_answered,
        coalesce(answer_agg.questions_correct, 0) as questions_correct,
        attempt_agg.last_active
      from ${profiles} p
      left join attempt_agg on attempt_agg.profile_id = p.id
      left join answer_agg on answer_agg.profile_id = p.id
      order by p.name asc
    `);

    return rows.map((r) => ({
      profileId: r.profile_id,
      name: r.name,
      title: r.title,
      avatarId: r.avatar_id,
      createdAt: r.created_at,
      hasPin: r.has_pin,
      quizzesPlayed: Number(r.quizzes_played),
      stagesCleared: Number(r.stages_cleared),
      questionsAnswered: Number(r.questions_answered),
      questionsCorrect: Number(r.questions_correct),
      accuracy: Number(r.questions_answered) > 0 ? Number(r.questions_correct) / Number(r.questions_answered) : null,
      lastActive: r.last_active,
    }));
  });

  // Full, irreversible hard delete of a profile and every row that
  // depends on it - the cleanup-activities delete the user asked for.
  // Most FKs to profiles.id do NOT cascade at the DB level (only
  // tutorGrowthInsights does, and only tutorMessages cascades from
  // tutorConversations - see migration 0008's comment), so this deletes
  // explicitly, in dependency order, inside one transaction: any failure
  // rolls the whole thing back rather than leaving orphaned rows.
  protectedApp.delete<{ Params: { profileId: string } }>("/admin/users/:profileId", async (request, reply) => {
    const { profileId } = request.params;
    const [existing] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId));
    if (!existing) return reply.status(404).send({ error: "Profile not found" });

    await db.transaction(async (tx) => {
      // quiz_attempt_answers has no direct profile_id column - it hangs
      // off quiz_attempts, so delete via a subquery before the attempts
      // themselves.
      await tx.execute(sql`
        delete from ${quizAttemptAnswers}
        where ${quizAttemptAnswers.attemptId} in (
          select id from ${quizAttempts} where ${quizAttempts.profileId} = ${profileId}
        )
      `);
      // tutor_conversations must go before quizAttempts below -
      // related_attempt_id references quiz_attempts.id with no cascade,
      // so deleting the attempts first 500s if any conversation (this
      // profile's own, e.g. from "Explain this to me") still points at
      // one. Deleting tutor_conversations cascades tutor_messages
      // automatically (onDelete: "cascade", verified against migration
      // 0008's actual SQL).
      await tx.delete(tutorConversations).where(eq(tutorConversations.profileId, profileId));
      // Defensive: null out any other conversation's related_attempt_id
      // that still points at one of this profile's attempts (shouldn't
      // happen today - conversations are per-profile - but the FK has no
      // ON DELETE behavior at all, so this keeps a future edge case from
      // reintroducing the same 500 instead of silently corrupting data).
      await tx.execute(sql`
        update ${tutorConversations}
        set related_attempt_id = null
        where related_attempt_id in (
          select id from ${quizAttempts} where ${quizAttempts.profileId} = ${profileId}
        )
      `);
      await tx.delete(quizAttempts).where(eq(quizAttempts.profileId, profileId));
      // Redundant safety net - tutorGrowthInsights already cascades on
      // profile delete, but profiles isn't deleted until the next line.
      await tx.delete(tutorGrowthInsights).where(eq(tutorGrowthInsights.profileId, profileId));
      await tx.delete(gameAttempts).where(eq(gameAttempts.profileId, profileId));
      await tx.delete(profiles).where(eq(profiles.id, profileId));
    });

    return reply.status(204).send();
  });

  // Forgot-PIN recovery: clears a profile's PIN so it goes back to the
  // "set a PIN on next login" state (POST /profiles/:id/set-pin) instead
  // of needing the old one. Only an admin can do this - a profile can't
  // reset its own PIN.
  protectedApp.post<{ Params: { profileId: string } }>("/admin/users/:profileId/reset-pin", async (request, reply) => {
    const [updated] = await db
      .update(profiles)
      .set({ pinHash: null })
      .where(eq(profiles.id, request.params.profileId))
      .returning({ id: profiles.id });
    if (!updated) return reply.status(404).send({ error: "Profile not found" });
    return reply.send({ ok: true });
  });

  // Doubt tracking + growth insights (Section 10 step 8). GET is cheap
  // and safe to call anytime - it's a live aggregation over
  // tutor_messages that already exists (Section 8), plus whatever
  // insights have already been generated, so the admin dashboard can
  // show the real breakdown even before anyone's pressed "generate".
  // POST is the only thing that actually calls Gemini and writes to
  // tutor_growth_insights - not run on any schedule, see
  // tutorInsights.ts's own header comment for why that's the right
  // amount of complexity for a first version here.
  protectedApp.get<{ Params: { profileId: string } }>("/admin/users/:profileId/tutor-insights", async (request, reply) => {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, request.params.profileId)).limit(1);
    if (!profile) return reply.status(404).send({ error: "Profile not found" });
    const [breakdown, insights] = await Promise.all([
      getDoubtBreakdown(request.params.profileId),
      getGrowthInsights(request.params.profileId),
    ]);
    return { breakdown, insights };
  });

  protectedApp.post<{ Params: { profileId: string } }>(
    "/admin/users/:profileId/tutor-insights/generate",
    async (request, reply) => {
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, request.params.profileId)).limit(1);
      if (!profile) return reply.status(404).send({ error: "Profile not found" });
      const result = await generateGrowthInsights(profile.id, profile.name);
      return reply.send(result);
    }
  );

  // Lets an admin wipe a profile's stored insights outright - see
  // clearGrowthInsights's own comment for why this exists (stale rows
  // from an early version of this feature, found via a real click-
  // through, that "Generate insights" alone can't clean up while
  // GEMINI_API_KEY stays invalid).
  protectedApp.delete<{ Params: { profileId: string } }>(
    "/admin/users/:profileId/tutor-insights",
    async (request, reply) => {
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, request.params.profileId)).limit(1);
      if (!profile) return reply.status(404).send({ error: "Profile not found" });
      await clearGrowthInsights(profile.id);
      return reply.status(204).send();
    }
  );

  // The Study Buddy on/off switch and its caps (Section 10 step 5/6) -
  // reads/writes the same app_settings singleton row tutorBudget.ts's
  // getAppSettings() reads on every chat turn. GET exists so the admin
  // dashboard's settings tab has something to load on open; PATCH is the
  // only writer of this table anywhere in the app (migration 0008 seeds
  // the one row, nothing else touches it).
  protectedApp.get("/admin/settings", async () => {
    return getAppSettings();
  });

  protectedApp.patch<{ Body: unknown }>("/admin/settings", async (request, reply) => {
    const parsed = settingsWriteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid settings", details: parsed.error.issues });
    const body = parsed.data;

    if (Object.keys(body).length === 0) {
      return reply.status(400).send({ error: "At least one setting must be provided" });
    }

    // app_settings has exactly one row (the "id boolean primary key
    // default true" + check constraint from migration 0008 makes a
    // second one impossible), so this is always an update against
    // id = true, never an insert - the row is guaranteed to already
    // exist by the time any admin session can reach this route.
    const current = await getAppSettings();
    const next = {
      tutorEnabled: body.tutorEnabled ?? current.tutorEnabled,
      tutorDailyCapPerProfile: body.tutorDailyCapPerProfile ?? current.tutorDailyCapPerProfile,
      tutorSharedDailyBudget:
        body.tutorSharedDailyBudget !== undefined ? body.tutorSharedDailyBudget : current.tutorSharedDailyBudget,
      tutorUseConceptGuides: body.tutorUseConceptGuides ?? current.tutorUseConceptGuides,
      tutorUseCache: body.tutorUseCache ?? current.tutorUseCache,
      tutorUseGemini: body.tutorUseGemini ?? current.tutorUseGemini,
      arcadeEnabled: body.arcadeEnabled ?? current.arcadeEnabled,
      gameSpellingSprintEnabled: body.gameSpellingSprintEnabled ?? current.gameSpellingSprintEnabled,
      gameMissingLettersEnabled: body.gameMissingLettersEnabled ?? current.gameMissingLettersEnabled,
      gameWordMeaningMatchEnabled: body.gameWordMeaningMatchEnabled ?? current.gameWordMeaningMatchEnabled,
      gameHomophoneHunterEnabled: body.gameHomophoneHunterEnabled ?? current.gameHomophoneHunterEnabled,
      gamePrefixSuffixBuilderEnabled: body.gamePrefixSuffixBuilderEnabled ?? current.gamePrefixSuffixBuilderEnabled,
      tutorFunContentEnabled: body.tutorFunContentEnabled ?? current.tutorFunContentEnabled,
    };

    await db.execute(sql`
      update app_settings
      set
        tutor_enabled = ${next.tutorEnabled},
        tutor_daily_cap_per_profile = ${next.tutorDailyCapPerProfile},
        tutor_shared_daily_budget = ${next.tutorSharedDailyBudget},
        tutor_use_concept_guides = ${next.tutorUseConceptGuides},
        tutor_use_cache = ${next.tutorUseCache},
        tutor_use_gemini = ${next.tutorUseGemini},
        arcade_enabled = ${next.arcadeEnabled},
        game_spelling_sprint_enabled = ${next.gameSpellingSprintEnabled},
        game_missing_letters_enabled = ${next.gameMissingLettersEnabled},
        game_word_meaning_match_enabled = ${next.gameWordMeaningMatchEnabled},
        game_homophone_hunter_enabled = ${next.gameHomophoneHunterEnabled},
        game_prefix_suffix_builder_enabled = ${next.gamePrefixSuffixBuilderEnabled},
        tutor_fun_content_enabled = ${next.tutorFunContentEnabled},
        updated_at = now()
      where id = true
    `);

    return reply.send(next);
  });
  });
}
