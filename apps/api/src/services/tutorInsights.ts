import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { tutorGrowthInsights } from "../db/schema.js";
import { env } from "../env.js";
import { BACKOFF_MS, MAX_ATTEMPTS, getGeminiClient, isRetryableStatus, sleep } from "./providers/gemini.js";

// Doubt tracking + growth insights - see plan/AI-Study-Mentor-Agent-Plan.md,
// Section 8 (the tutor_growth_insights table) and Section 10 step 8. This
// module owns two separate things:
//
//   - getDoubtBreakdown: a real-time aggregation over tutor_messages
//     (already logged by every tutor turn since Section 10 step 5/6 -
//     see tutorBudget.ts's recordTutorExchange) - no new data collection
//     needed, just a query that turns matched_source_type/matched_source_id
//     back into topic tags. This alone is "doubt tracking": what a
//     profile's actually been asking about, and how often the tutor had
//     nothing to ground a reply in at all.
//
//   - generateGrowthInsights: the distilled, parent-facing summaries
//     Section 1 promises ("a distilled 'what your Study Buddy noticed'
//     summary"), written by Gemini from that same breakdown and stored
//     in tutor_growth_insights. Deliberately admin-triggered rather than
//     on any schedule or automatic per-message trigger - this is a
//     small, low-traffic single-family instance (the same reasoning
//     tutorBudget.ts and the upload pipeline already use for staying
//     synchronous rather than reaching for a job queue), so "an admin
//     presses a button when they want an update" is the right amount of
//     complexity for a first version.
//
// Whether either of these should ever surface directly to the child
// (rather than admin-only) is still an open question - Section 12.

// A topic needs at least this many doubt-worthy messages in the lookback
// window before it's worth spending a Gemini call writing a parent-facing
// line about it - a single off-hand question about a topic shouldn't
// produce a misleading "your child keeps asking about X" summary. A
// reasonable first number, not yet tuned against real usage - same
// starting-point reasoning as MATCH_THRESHOLD (Section 10 step 3) and the
// 30/day cap (step 5) before either was calibrated for real.
const INSIGHT_MIN_MESSAGE_COUNT = 3;
const LOOKBACK_DAYS = 30;

export interface DoubtBreakdown {
  // Every topic a profile's agent replies have actually been grounded
  // in, most-asked first - derived from tutor_messages.matched_source_type
  // /matched_source_id, joined back to the question's `topics` tags or
  // the concept guide's own single `topic`, not a separately-tracked
  // column. A question can carry more than one topic tag, so a single
  // message can (correctly) contribute to more than one topic's count.
  topicCounts: { topic: string; count: number }[];
  // Agent replies where nothing was matched at all (mode: "template" -
  // either a genuine "nothing in the curriculum covers this" or a
  // Gemini failure degrading to the same reply, see tutorGeneration.ts;
  // recordTutorExchange can't tell the two apart, and for this purpose
  // it doesn't need to - both mean "the tutor had nothing to ground a
  // reply in", which is itself a real signal worth surfacing).
  ungroundedCount: number;
  totalAgentReplies: number;
}

export async function getDoubtBreakdown(profileId: string): Promise<DoubtBreakdown> {
  // Interpolated into raw sql`` templates below as an ISO string, not a
  // bare JS Date - a real bug found by actually running this against the
  // live database: passed as a Date object, it got bound as
  // Date.prototype.toString() (e.g. "Thu Aug 06 2026 22:56:53 GMT+0100
  // (British Summer Time)"), which Postgres cannot parse as a timestamp -
  // every query below failed with a 500 the very first time this ran for
  // real. toISOString() is what Postgres actually accepts.
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const topicRows = await db.execute<{ topic: string; count: number }>(sql`
    with agent_msgs as (
      select tm.id, tm.matched_source_type, tm.matched_source_id
      from tutor_messages tm
      join tutor_conversations tc on tc.id = tm.conversation_id
      where tc.profile_id = ${profileId}
        and tm.role = 'agent'
        and tm.created_at >= ${cutoff}
    ),
    question_topics as (
      select am.id as message_id, unnest(q.topics) as topic
      from agent_msgs am
      join questions q on q.id = am.matched_source_id and am.matched_source_type = 'question'
      where q.topics is not null
    ),
    guide_topics as (
      select am.id as message_id, cg.topic
      from agent_msgs am
      join concept_guides cg on cg.id = am.matched_source_id and am.matched_source_type = 'concept_guide'
    ),
    all_topics as (
      select * from question_topics
      union all
      select * from guide_topics
    )
    select topic, count(*)::int as count
    from all_topics
    group by topic
    order by count desc
  `);

  const [ungroundedRow] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from tutor_messages tm
    join tutor_conversations tc on tc.id = tm.conversation_id
    where tc.profile_id = ${profileId}
      and tm.role = 'agent'
      and tm.created_at >= ${cutoff}
      and (tm.matched_source_type = 'none' or tm.matched_source_type is null)
  `);

  const [totalRow] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from tutor_messages tm
    join tutor_conversations tc on tc.id = tm.conversation_id
    where tc.profile_id = ${profileId}
      and tm.role = 'agent'
      and tm.created_at >= ${cutoff}
  `);

  return {
    topicCounts: topicRows.map((r) => ({ topic: r.topic, count: Number(r.count) })),
    ungroundedCount: Number(ungroundedRow?.count ?? 0),
    totalAgentReplies: Number(totalRow?.count ?? 0),
  };
}

const growthInsightSchema = z.object({
  topic: z.string().min(1),
  insightText: z.string().min(1),
});
const growthInsightSetSchema = z.array(growthInsightSchema).min(1);

// Same "one JSON-Schema shared across providers" convention as
// question-json-schema.ts, even though only Gemini calls this today -
// keeps the door open to a second provider later without a rewrite.
const GROWTH_INSIGHTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Must exactly match one of the topics listed in the prompt." },
          insightText: { type: "string" },
        },
        required: ["topic", "insightText"],
      },
    },
  },
  required: ["insights"],
} as const;

function buildInsightPrompt(params: {
  profileName: string;
  topicCounts: { topic: string; count: number }[];
  ungroundedCount: number;
}): string {
  const lines = params.topicCounts.map(
    (t) => `- ${t.topic}: asked about ${t.count} time${t.count === 1 ? "" : "s"} in the last ${LOOKBACK_DAYS} days`
  );
  return [
    `${params.profileName} is a Year 3 child (age 7-8) using an educational app's AI Study Buddy chat feature.`,
    "Here's what they've actually been asking about recently, by topic:",
    lines.join("\n"),
    params.ungroundedCount > 0
      ? `They also asked ${params.ungroundedCount} question(s) the Study Buddy had no matching lesson content for at all.`
      : "",
    "",
    "For EACH topic listed above, write exactly one short, warm, factual sentence a busy parent " +
      "could read at a glance - describing the pattern plainly (how often, roughly what kind of " +
      "questions this suggests) so they can decide whether it's worth a bit of extra practice " +
      "together. Base this only on the actual counts given - never invent grades, ability level, " +
      "emotions, or specific mistakes you don't actually have evidence for. Plain conversational " +
      "English, one sentence per topic, no markdown.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Same retry shape as generateQuestionsWithGemini/callGemini (this
// project's two other Gemini callers) - a couple of backed-off retries
// on a transient 429/503, anything else is a real failure.
async function callGeminiForInsights(prompt: string): Promise<{ topic: string; insightText: string }[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await getGeminiClient().models.generateContent({
        model: env.GEMINI_TUTOR_MODEL,
        contents: [{ text: prompt }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: GROWTH_INSIGHTS_JSON_SCHEMA,
        },
      });
      const text = response.text;
      if (!text) throw new Error("Gemini returned no text for growth insights.");
      const parsed = JSON.parse(text) as { insights: unknown };
      return growthInsightSetSchema.parse(parsed.insights);
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!isRetryableStatus(err) || isLastAttempt) throw err;
      const waitMs = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.warn(
        `Gemini growth-insight request failed (attempt ${attempt + 1}/${MAX_ATTEMPTS}, likely temporary overload) - retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

export interface GrowthInsight {
  id: string;
  profileId: string;
  topic: string;
  insightText: string;
  generatedAt: Date;
}

export type GenerateInsightsResult =
  | { generated: true; insights: GrowthInsight[] }
  | { generated: false; reason: "not_enough_activity" };

/**
 * Admin-triggered from the new /admin/users/:profileId/tutor-insights/
 * generate route. Only topics that clear INSIGHT_MIN_MESSAGE_COUNT get
 * sent to Gemini at all - unlike the child-facing tutor chat, there's no
 * "always answer something" requirement here, so a profile with too
 * little recent activity simply gets `generated: false` back rather than
 * a low-signal or invented-sounding insight. One Gemini call covers
 * every qualifying topic at once (not one call per topic) - cheaper, and
 * lets the model see the full picture rather than writing each topic's
 * line in isolation.
 */
export async function generateGrowthInsights(profileId: string, profileName: string): Promise<GenerateInsightsResult> {
  const breakdown = await getDoubtBreakdown(profileId);
  const qualifying = breakdown.topicCounts.filter((t) => t.count >= INSIGHT_MIN_MESSAGE_COUNT);

  if (qualifying.length === 0) {
    return { generated: false, reason: "not_enough_activity" };
  }

  const prompt = buildInsightPrompt({ profileName, topicCounts: qualifying, ungroundedCount: breakdown.ungroundedCount });
  const results = await callGeminiForInsights(prompt);

  // Upserts one row per (profileId, topic) - migration 0010's unique
  // index is what makes this an update-in-place on a regenerate rather
  // than an ever-growing history of stale insights for the same topic.
  const saved: GrowthInsight[] = [];
  for (const r of results) {
    const [row] = await db
      .insert(tutorGrowthInsights)
      .values({ profileId, topic: r.topic, insightText: r.insightText })
      .onConflictDoUpdate({
        target: [tutorGrowthInsights.profileId, tutorGrowthInsights.topic],
        set: { insightText: r.insightText, generatedAt: new Date() },
      })
      .returning();
    saved.push(row);
  }
  return { generated: true, insights: saved };
}

export async function getGrowthInsights(profileId: string): Promise<GrowthInsight[]> {
  return db
    .select()
    .from(tutorGrowthInsights)
    .where(eq(tutorGrowthInsights.profileId, profileId))
    .orderBy(desc(tutorGrowthInsights.generatedAt));
}
