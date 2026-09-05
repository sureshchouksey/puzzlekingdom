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

export type BudgetCheck =
  | { allowed: true }
  | { allowed: false; reason: "tutor_disabled" }
  | { allowed: false; reason: "daily_cap_reached"; cap: number; usedToday: number };

/**
 * Call this BEFORE generateTutorReply. Counts today's student messages
 * for this profile (UTC calendar day - a real per-timezone "today" isn't
 * worth the complexity for a 30/day cap) against the admin-configured
 * cap, and separately checks the tutor's own on/off toggle. Deliberately
 * counts every student message, not just ones that triggered a real
 * Gemini call - the cap is a usage limit on the child's own chat, not
 * purely a cost control (Section 6 draws that same distinction between
 * the per-profile cap and the cost-focused shared budget).
 */
export async function checkTutorBudget(profileId: string): Promise<BudgetCheck> {
  const settings = await getAppSettings();
  if (!settings.tutorEnabled) {
    return { allowed: false, reason: "tutor_disabled" };
  }

  const rows = await db.execute(sql`
    select count(*)::int as count
    from tutor_messages tm
    join tutor_conversations tc on tc.id = tm.conversation_id
    where tc.profile_id = ${profileId}
      and tm.role = 'student'
      and tm.created_at >= date_trunc('day', now())
  `);
  const usedToday = Number((rows[0] as unknown as { count: number } | undefined)?.count ?? 0);

  if (usedToday >= settings.tutorDailyCapPerProfile) {
    return { allowed: false, reason: "daily_cap_reached", cap: settings.tutorDailyCapPerProfile, usedToday };
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
