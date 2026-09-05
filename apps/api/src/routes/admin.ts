import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { eq, and, desc, ilike, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { admins, questions, documents, subjects, classes, profiles, quizAttempts, quizAttemptAnswers } from "../db/schema.js";
import { generatedOptionSchema } from "../lib/question-schema.js";
import { getAppSettings } from "../services/tutorBudget.js";
import { generateGrowthInsights, getDoubtBreakdown, getGrowthInsights } from "../services/tutorInsights.js";
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
});

// Body shape for creating/editing one question by hand from the admin
// dashboard - looser than generatedQuestionSchema (every field optional
// except documentId on create) since an edit only sends the fields that
// changed, not the whole question every time.
const questionWriteSchema = z.object({
  documentId: z.string().uuid().optional(),
  questionText: z.string().min(1).optional(),
  options: z.array(generatedOptionSchema).min(3).max(6).optional(),
  correctOptionId: z.string().min(1).optional(),
  explanation: z.string().min(1).optional(),
  topics: z.array(z.string().min(1)).optional(),
  tip: z.string().min(1).optional(),
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

  // Everything below this line requires a valid admin session. A nested
  // register() creates its own encapsulation context, which is required
  // here - addHook only exempts routes in a SEPARATE context, not routes
  // declared earlier in the SAME context (Fastify wires hooks to a
  // context's whole route set regardless of source-order), so without
  // this nesting the preHandler would also apply to /admin/login above
  // and nobody could ever log in.
  await app.register(async (protectedApp) => {
  protectedApp.addHook("preHandler", requireAdmin);

  protectedApp.get<{ Querystring: { subjectName?: string; classId?: string; search?: string; limit?: string; cursor?: string } }>(
    "/admin/questions",
    async (request) => {
      const { subjectName, classId, search } = request.query;
      const limit = Math.min(Number(request.query.limit) || DEFAULT_PAGE_SIZE, 100);
      const offset = Math.max(Number(request.query.cursor) || 0, 0);

      const conditions = [];
      if (subjectName) conditions.push(eq(subjects.name, subjectName));
      if (classId) conditions.push(eq(documents.classId, classId));
      if (search) conditions.push(ilike(questions.questionText, `%${search}%`));

      const rows = await db
        .select({
          id: questions.id,
          questionText: questions.questionText,
          options: questions.options,
          correctOptionId: questions.correctOptionId,
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
    if (!body.questionText || !body.options || !body.correctOptionId || !body.explanation) {
      return reply.status(400).send({
        error: "questionText, options, correctOptionId, and explanation are all required to create a question",
      });
    }
    if (!body.options.some((o) => o.id === body.correctOptionId)) {
      return reply.status(400).send({ error: "correctOptionId must match the id of one of the options" });
    }

    const [doc] = await db.select().from(documents).where(eq(documents.id, body.documentId)).limit(1);
    if (!doc) return reply.status(404).send({ error: "Document not found" });

    const [created] = await db
      .insert(questions)
      .values({
        documentId: doc.id,
        subjectId: doc.subjectId,
        questionText: body.questionText,
        options: body.options,
        correctOptionId: body.correctOptionId,
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

    const nextOptions = body.options ?? existing.options;
    const nextCorrectOptionId = body.correctOptionId ?? existing.correctOptionId;
    if (!nextOptions.some((o) => o.id === nextCorrectOptionId)) {
      return reply.status(400).send({ error: "correctOptionId must match the id of one of the options" });
    }

    const [updated] = await db
      .update(questions)
      .set({
        questionText: body.questionText ?? existing.questionText,
        options: nextOptions,
        correctOptionId: nextCorrectOptionId,
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

  // Same two-CTE aggregation shape as GET /leaderboard (see that route for
  // why it's two separate aggregations, not one join), just without the
  // per-class split or the "played at least one quiz" filter - admin sees
  // every profile, including ones that haven't played yet.
  protectedApp.get("/admin/users", async () => {
    const rows = await db.execute<{
      profile_id: string;
      name: string;
      title: string | null;
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
    };

    await db.execute(sql`
      update app_settings
      set
        tutor_enabled = ${next.tutorEnabled},
        tutor_daily_cap_per_profile = ${next.tutorDailyCapPerProfile},
        tutor_shared_daily_budget = ${next.tutorSharedDailyBudget},
        updated_at = now()
      where id = true
    `);

    return reply.send(next);
  });
  });
}
