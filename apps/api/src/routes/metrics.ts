import type { FastifyInstance } from "fastify";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { activityHeartbeats, classes, profiles, subjects } from "../db/schema.js";
import { requireAdmin, requireFamilyOwner, requireIdentity } from "../auth.js";

// Activity time tracking (11 September 2026) - see migration 0026's own
// header comment for the full rationale. One raw ping row every ~30s
// while a screen is open and foregrounded (Page Visibility API);
// aggregated live via SQL at read time here, same "no job queue for a
// small-scale app" approach leaderboard.ts/admin.ts's GET /admin/users
// already use. Additive to, not a replacement for, the existing
// accuracy-based Reports/leaderboard - those are untouched.
//
// Period semantics, decided plainly: all three periods are rolling
// windows (day = trailing 24h, week = trailing 7 days, month = trailing
// 30 days), not calendar-aligned - simpler, and still answers "today/
// this week/this month" close enough for this dashboard.
const PERIODS = ["day", "week", "month"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };

function parsePeriod(raw: unknown): Period | null {
  if (raw === undefined) return "week";
  if (raw === "day" || raw === "week" || raw === "month") return raw;
  return null;
}

function windowStart(period: Period): Date {
  return new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000);
}

// Fixed server-side, never trusted from the client - see POST
// /metrics/heartbeat below and migration 0026's header comment for why.
// Matches the ~30s interval useActivityHeartbeat.ts pings on.
const HEARTBEAT_SECONDS = 30;

const activityTypeSchema = z.enum(["quiz", "game", "study_buddy", "browsing"]);

const heartbeatSchema = z.object({
  activityType: activityTypeSchema,
  subjectId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  // Only meaningful for 'quiz' (and optionally 'study_buddy').
  topic: z.string().min(1).optional(),
  // Only meaningful for 'game' - one of GAME_DEFINITIONS' keys (games.ts).
  gameKey: z.string().min(1).optional(),
  quizAttemptId: z.string().uuid().optional(),
  tutorConversationId: z.string().uuid().optional(),
});

// Picks, per profileId, whichever (key, seconds) pair had the most
// seconds - used for both "top topic" and "top game" below. Rows with a
// null key (no topic/game tagged) are skipped rather than counted as a
// candidate.
function pickTop(rows: { profileId: string; key: string | null; seconds: number }[]): Map<string, string> {
  const best = new Map<string, { key: string; seconds: number }>();
  for (const r of rows) {
    if (!r.key) continue;
    const current = best.get(r.profileId);
    if (!current || r.seconds > current.seconds) {
      best.set(r.profileId, { key: r.key, seconds: r.seconds });
    }
  }
  return new Map([...best.entries()].map(([profileId, v]) => [profileId, v.key]));
}

export async function metricsRoutes(app: FastifyInstance) {
  // profileId is ALWAYS request.identity.profileId - never accepted from
  // the client, matching tutor.ts's POST /tutor/conversations pattern
  // (deliberately not games.ts's POST /games/attempts, which trusts a
  // client-supplied profileId - not followed here since these numbers
  // feed a dashboard a parent/admin will actually read). Silently no-ops
  // on the frontend if this ever fails (see useActivityHeartbeat.ts) -
  // this only powers a dashboard, never gameplay.
  app.post<{ Body: unknown }>("/metrics/heartbeat", { preHandler: requireIdentity }, async (request, reply) => {
    const identity = request.identity!;
    if (identity.kind !== "profile") {
      return reply.status(403).send({ error: "Only a profile session can send an activity heartbeat." });
    }

    const parsed = heartbeatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    }
    const body = parsed.data;

    await db.insert(activityHeartbeats).values({
      profileId: identity.profileId,
      activityType: body.activityType,
      subjectId: body.subjectId,
      classId: body.classId,
      topic: body.topic,
      gameKey: body.gameKey,
      quizAttemptId: body.quizAttemptId,
      tutorConversationId: body.tutorConversationId,
      durationSeconds: HEARTBEAT_SECONDS,
    });

    return reply.status(201).send({ ok: true });
  });

  // A family owner's own dashboard - every child in the caller's own
  // family (even ones with zero activity, so they still show 0 - same
  // left-joined-for-everyone convention as GET /admin/users), scoped to
  // identity.familyId from the JWT, never from a query param (same rule
  // families.ts already follows for GET /families/me/profiles).
  //
  // BONUS FINDING, not fixed here (flagged, out of scope for this
  // change): reports.ts's own ?profileId= override currently treats a
  // family_owner identity the same as admin, so a family owner could in
  // principle pass another family's profileId there and see that child's
  // reports. This route doesn't have that problem (no profileId
  // override exists here at all), but it's worth a follow-up in
  // reports.ts.
  app.get<{ Querystring: { period?: string } }>(
    "/metrics/family/summary",
    { preHandler: requireFamilyOwner },
    async (request, reply) => {
      const period = parsePeriod(request.query.period);
      if (!period) return reply.status(400).send({ error: "period must be day, week, or month" });

      const identity = request.identity as { kind: "family_owner"; familyId: string };
      const familyProfiles = await db.select().from(profiles).where(eq(profiles.familyId, identity.familyId));

      if (familyProfiles.length === 0) {
        return reply.send({ period, children: [] });
      }

      const profileIds = familyProfiles.map((p) => p.id);
      const since = windowStart(period);
      const inFamily = inArray(activityHeartbeats.profileId, profileIds);
      const inWindow = gte(activityHeartbeats.createdAt, since);

      const [totalsRows, byTypeRows, topicRows, gameRows, trendRows] = await Promise.all([
        db
          .select({
            profileId: activityHeartbeats.profileId,
            totalSeconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
            activeDays: sql<number>`count(distinct date_trunc('day', ${activityHeartbeats.createdAt}))`,
          })
          .from(activityHeartbeats)
          .where(and(inFamily, inWindow))
          .groupBy(activityHeartbeats.profileId),
        db
          .select({
            profileId: activityHeartbeats.profileId,
            activityType: activityHeartbeats.activityType,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .where(and(inFamily, inWindow))
          .groupBy(activityHeartbeats.profileId, activityHeartbeats.activityType),
        db
          .select({
            profileId: activityHeartbeats.profileId,
            topic: activityHeartbeats.topic,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .where(and(inFamily, inWindow, isNotNull(activityHeartbeats.topic)))
          .groupBy(activityHeartbeats.profileId, activityHeartbeats.topic),
        db
          .select({
            profileId: activityHeartbeats.profileId,
            gameKey: activityHeartbeats.gameKey,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .where(and(inFamily, inWindow, isNotNull(activityHeartbeats.gameKey)))
          .groupBy(activityHeartbeats.profileId, activityHeartbeats.gameKey),
        db
          .select({
            profileId: activityHeartbeats.profileId,
            day: sql<string>`to_char(date_trunc('day', ${activityHeartbeats.createdAt}), 'YYYY-MM-DD')`,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .where(and(inFamily, inWindow))
          .groupBy(activityHeartbeats.profileId, sql`date_trunc('day', ${activityHeartbeats.createdAt})`),
      ]);

      const totalsMap = new Map(totalsRows.map((r) => [r.profileId, r]));
      const byTypeMap = new Map<string, Record<string, number>>();
      for (const r of byTypeRows) {
        const m = byTypeMap.get(r.profileId) ?? {};
        m[r.activityType] = Number(r.seconds);
        byTypeMap.set(r.profileId, m);
      }
      const topTopicMap = pickTop(topicRows.map((r) => ({ profileId: r.profileId, key: r.topic, seconds: Number(r.seconds) })));
      const topGameMap = pickTop(gameRows.map((r) => ({ profileId: r.profileId, key: r.gameKey, seconds: Number(r.seconds) })));
      const trendMap = new Map<string, { date: string; seconds: number }[]>();
      for (const r of trendRows) {
        const arr = trendMap.get(r.profileId) ?? [];
        arr.push({ date: r.day, seconds: Number(r.seconds) });
        trendMap.set(r.profileId, arr);
      }

      const children = familyProfiles.map((p) => {
        const totals = totalsMap.get(p.id);
        return {
          profileId: p.id,
          name: p.name,
          title: p.title,
          avatarId: p.avatarId,
          totalSeconds: totals ? Number(totals.totalSeconds) : 0,
          activeDays: totals ? Number(totals.activeDays) : 0,
          byActivityType: byTypeMap.get(p.id) ?? {},
          topTopic: topTopicMap.get(p.id) ?? null,
          topGame: topGameMap.get(p.id) ?? null,
          dailyTrend: (trendMap.get(p.id) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
        };
      });

      return reply.send({ period, children });
    }
  );

  // The platform-admin view - every family, no scoping. Same rolling-
  // window semantics as the family route above.
  app.get<{ Querystring: { period?: string } }>(
    "/metrics/admin/overview",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const period = parsePeriod(request.query.period);
      if (!period) return reply.status(400).send({ error: "period must be day, week, or month" });

      const since = windowStart(period);
      const inWindow = gte(activityHeartbeats.createdAt, since);

      const [totalsRows, byTypeRows, trendRows, breakdownRows, gameRows] = await Promise.all([
        db
          .select({
            totalSeconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
            activeProfiles: sql<number>`count(distinct ${activityHeartbeats.profileId})`,
          })
          .from(activityHeartbeats)
          .where(inWindow),
        db
          .select({
            activityType: activityHeartbeats.activityType,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .where(inWindow)
          .groupBy(activityHeartbeats.activityType),
        db
          .select({
            day: sql<string>`to_char(date_trunc('day', ${activityHeartbeats.createdAt}), 'YYYY-MM-DD')`,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .where(inWindow)
          .groupBy(sql`date_trunc('day', ${activityHeartbeats.createdAt})`)
          .orderBy(sql`date_trunc('day', ${activityHeartbeats.createdAt})`),
        // Left-joined so activity with no class/subject still appears
        // (same convention as GET /admin/users' zero-activity profiles) -
        // no fan-out risk since activity_heartbeats is the base table and
        // classId/subjectId each reference at most one row.
        db
          .select({
            classId: activityHeartbeats.classId,
            className: classes.name,
            subjectId: activityHeartbeats.subjectId,
            subjectName: subjects.name,
            topic: activityHeartbeats.topic,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .leftJoin(classes, eq(activityHeartbeats.classId, classes.id))
          .leftJoin(subjects, eq(activityHeartbeats.subjectId, subjects.id))
          .where(inWindow)
          .groupBy(activityHeartbeats.classId, classes.name, activityHeartbeats.subjectId, subjects.name, activityHeartbeats.topic)
          .orderBy(sql`sum(${activityHeartbeats.durationSeconds}) desc`),
        db
          .select({
            gameKey: activityHeartbeats.gameKey,
            seconds: sql<number>`coalesce(sum(${activityHeartbeats.durationSeconds}), 0)`,
          })
          .from(activityHeartbeats)
          .where(and(inWindow, isNotNull(activityHeartbeats.gameKey)))
          .groupBy(activityHeartbeats.gameKey)
          .orderBy(sql`sum(${activityHeartbeats.durationSeconds}) desc`),
      ]);

      const totals = totalsRows[0] ?? { totalSeconds: 0, activeProfiles: 0 };

      return reply.send({
        period,
        totalSeconds: Number(totals.totalSeconds),
        activeProfiles: Number(totals.activeProfiles),
        byActivityType: Object.fromEntries(byTypeRows.map((r) => [r.activityType, Number(r.seconds)])),
        dailyTrend: trendRows.map((r) => ({ date: r.day, seconds: Number(r.seconds) })),
        byClassSubjectTopic: breakdownRows.map((r) => ({
          classId: r.classId,
          className: r.className,
          subjectId: r.subjectId,
          subjectName: r.subjectName,
          topic: r.topic,
          seconds: Number(r.seconds),
        })),
        byGame: gameRows.map((r) => ({ gameKey: r.gameKey as string, seconds: Number(r.seconds) })),
      });
    }
  );
}
