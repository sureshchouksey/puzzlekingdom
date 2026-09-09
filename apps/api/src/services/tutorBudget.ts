import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { RetrievalResult } from "./tutorRetrieval.js";
import type { TutorReply } from "./tutorGeneration.js";

// The tutor's usage guardrails - see plan/AI-Study-Mentor-Agent-Plan.md,
// Section 10 step 5. Two things live here: reading the admin on/off
// toggle and per-profile daily cap (app_settings, migration 0008), and
// writing the real transcript (tutor_conversations/tutor_messages) that
// cap actually counts against. Like tutorRetrieval.ts and
// tutorGeneration.ts, this is a data/logic module with no route yet - the
// not-yet-built POST /tutor/conversations/:id/messages route (Section 9)
// is the intended caller: check the budget BEFORE calling
// generateTutorReply, then record the exchange AFTER.
//
// Scope note, confirmed 5 September 2026: only the per-profile daily cap
// (30/day) is enforced here. Section 6/9's system-wide shared daily
// budget - meant to bound total cost regardless of how many profiles are
// active - is deliberately NOT built yet. This is a single-family
// instance with a small, fixed number of profiles, so even every profile
// hitting 30/day stays well inside gemini-3.1-flash-lite's free-tier
// daily quota (~1,000 requests/day, Section 6) without a second cap on
// top. `tutorSharedDailyBudget` already exists as a nullable column on
// app_settings specifically so this can be turned on later (a data
// change, once it's actually needed) without another migration - if that
// day comes, the natural place for the check is right here, alongside
// checkTutorBudget below.

export interface AppSettings {
  tutorEnabled: boolean;
  tutorDailyCapPerProfile: number;
  tutorSharedDailyBudget: number | null;
}

// Matches the migration's own defaults - used only if app_settings'
// singleton row is somehow missing (it shouldn't be: migration 0008
// inserts it, and the `id boolean` + check constraint makes a second row
// impossible). Failing open with a sane default rather than throwing
// keeps this consistent with tutorGeneration.ts's "never break the child-
// facing route" philosophy.
const DEFAULT_SETTINGS: AppSettings = {
  tutorEnabled: true,
  tutorDailyCapPerProfile: 30,
  tutorSharedDailyBudget: null,
};

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db.execute(sql`
    select
      tutor_enabled as "tutorEnabled",
      tutor_daily_cap_per_profile as "tutorDailyCapPerProfile",
      tutor_shared_daily_budget as "tutorSharedDailyBudget"
    from app_settings
    where id = true
    limit 1
  `);
  const row = rows[0] as unknown as AppSettings | undefined;
  return row ?? DEFAULT_SETTINGS;
}

/**
 * The admin's full kill-switch for Study Buddy (app_settings.tutor_enabled).
 * Deliberately separate from checkDailyCap below, and checked up front for
 * EVERY message (tutor.ts) regardless of what it turns out to be - unlike
 * the daily cap, which is purely a cost control on real Gemini calls, this
 * is a genuine "the whole feature is off" switch, so it has to block
 * everything: fun content, arithmetic, hints, all of it, not just academic
 * questions.
 */
export async function isTutorEnabled(): Promise<boolean> {
  const settings = await getAppSettings();
  return settings.tutorEnabled;
}

export type DailyCapCheck = { allowed: true } | { allowed: false; cap: number; usedToday: number };

/**
 * Call this right before generateTutorReply specifically - NOT up front
 * for the whole route (see tutor.ts, where this moved 9 September 2026).
 * Counts today's genuinely Gemini-answered academic exchanges for this
 * profile (UTC calendar day - a real per-timezone "today" isn't worth the
 * complexity for a 30/day cap) against the admin-configured cap.
 *
 * Revisited 9 September 2026, from the original "count every student
 * message, checked before anything else runs" behaviour: with fun content
 * (riddles/jokes/tongue twisters/puzzles/trivia, hints included) served
 * entirely from Postgres, arithmetic computed locally (tutorArithmetic.ts),
 * and intent classification degrading to a free keyword heuristic whenever
 * Gemini is unreachable (tutorIntent.ts), both counting every message AND
 * checking the cap before even knowing what kind of message this was meant
 * a child could hit "you've used up your chats for today" from riddles,
 * sums, and greetings alone - blocking features that never cost anything
 * once a real Gemini quota happened to run out. The cap is now a pure cost
 * control matching Section 6/9's framing (the same "cost-focused"
 * reasoning the shared daily budget already uses): it only counts an
 * 'agent' message whose matched_source_type is 'question' or
 * 'concept_guide' - recordTutorExchange below only ever sets one of those
 * two when generateTutorReply's reply.mode was actually "ai" (a real,
 * successful Gemini call), logging 'none' otherwise (no retrieval match,
 * or Gemini itself failed and it fell back to TEMPLATE_FALLBACK_REPLY). A
 * greeting/thanks/fun_request/reveal_answer/hint_request/answer_attempt
 * turn (recordSimpleTutorExchange) never sets either of those two values,
 * so none of those count here either, regardless of whether Gemini's key
 * happens to be working - and tutor.ts now only calls this function at
 * all once a message has actually been classified as academic, so it can
 * never block a message before knowing whether it would even need Gemini.
 */
export async function checkDailyCap(profileId: string): Promise<DailyCapCheck> {
  const settings = await getAppSettings();

  const rows = await db.execute(sql`
    select count(*)::int as count
    from tutor_messages tm
    join tutor_conversations tc on tc.id = tm.conversation_id
    where tc.profile_id = ${profileId}
      and tm.role = 'agent'
      and tm.matched_source_type in ('question', 'concept_guide')
      and tm.created_at >= date_trunc('day', now())
  `);
  const usedToday = Number((rows[0] as unknown as { count: number } | undefined)?.count ?? 0);

  if (usedToday >= settings.tutorDailyCapPerProfile) {
    return { allowed: false, cap: settings.tutorDailyCapPerProfile, usedToday };
  }
  return { allowed: true };
}

/**
 * Call this AFTER generateTutorReply, once both the student's message and
 * the reply actually sent are known. Records both turns and bumps the
 * conversation's lastMessageAt. The "top" retrieved source (RetrievalResult
 * .sources[0] - already rank-ordered by both retrieveForQuery's
 * rankSources() and retrieveForQuestion's own priority ordering) is what
 * gets logged as matchedSourceType/matchedSourceId/matchScore: the schema
 * (migration 0008) has room for one matched source per message, not the
 * full list generateTutorReply actually grounded on
 * (TutorReply.groundedSourceIds can have up to MAX_RESULTS) - logging the
 * top one is enough to audit "did this reply have real grounding, and
 * how strong was it", which is what match_score is for (Section 8); a
 * full per-source join table is a reasonable future addition if a finer
 * audit trail turns out to be needed, not something to build speculatively
 * now.
 */
/**
 * The lighter counterpart to recordTutorExchange, for the two chat paths
 * that never touch retrieval/generation at all: a social reply (greeting/
 * thanks - tutorIntent.ts) or a served fun_content item (funContent.ts).
 * `studentMessage` is omitted for the one proactive case with no real
 * student turn to log - the greeting shown when a brand new conversation
 * starts (tutor.ts's POST /tutor/conversations).
 */
export async function recordSimpleTutorExchange(params: {
  conversationId: string;
  studentMessage?: string;
  replyText: string;
  sourceType: "social" | "fun_content" | "reveal_offer";
  sourceId?: string;
}): Promise<void> {
  const { conversationId, studentMessage, replyText, sourceType, sourceId } = params;

  if (studentMessage) {
    await db.execute(sql`
      insert into tutor_messages (conversation_id, role, content)
      values (${conversationId}, 'student', ${studentMessage})
    `);
  }

  await db.execute(sql`
    insert into tutor_messages (conversation_id, role, content, matched_source_type, matched_source_id)
    values (${conversationId}, 'agent', ${replyText}, ${sourceType}, ${sourceId ?? null})
  `);

  await db.execute(sql`
    update tutor_conversations set last_message_at = now() where id = ${conversationId}
  `);
}

export async function recordTutorExchange(params: {
  conversationId: string;
  studentMessage: string;
  retrieval: RetrievalResult;
  reply: TutorReply;
}): Promise<void> {
  const { conversationId, studentMessage, retrieval, reply } = params;

  await db.execute(sql`
    insert into tutor_messages (conversation_id, role, content)
    values (${conversationId}, 'student', ${studentMessage})
  `);

  const topSource = reply.mode === "ai" ? retrieval.sources[0] : undefined;

  await db.execute(sql`
    insert into tutor_messages (conversation_id, role, content, matched_source_type, matched_source_id, match_score)
    values (
      ${conversationId},
      'agent',
      ${reply.reply},
      ${topSource ? topSource.type : "none"},
      ${topSource ? topSource.id : null},
      ${topSource ? topSource.rank : null}
    )
  `);

  await db.execute(sql`
    update tutor_conversations set last_message_at = now() where id = ${conversationId}
  `);
}
