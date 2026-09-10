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
  // Track 2's three-way "Resource Access" toggle (migration 0022) - see
  // that migration's comment for what each one gates. All default true.
  tutorUseConceptGuides: boolean;
  tutorUseCache: boolean;
  tutorUseGemini: boolean;
  // Flag-based feature management (migration 0023) - see schema.ts's
  // appSettings table for what each one gates.
  arcadeEnabled: boolean;
  gameSpellingSprintEnabled: boolean;
  gameMissingLettersEnabled: boolean;
  gameWordMeaningMatchEnabled: boolean;
  gameHomophoneHunterEnabled: boolean;
  gamePrefixSuffixBuilderEnabled: boolean;
  tutorFunContentEnabled: boolean;
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
  tutorUseConceptGuides: true,
  tutorUseCache: true,
  tutorUseGemini: true,
  arcadeEnabled: true,
  gameSpellingSprintEnabled: true,
  gameMissingLettersEnabled: true,
  gameWordMeaningMatchEnabled: true,
  gameHomophoneHunterEnabled: true,
  gamePrefixSuffixBuilderEnabled: true,
  tutorFunContentEnabled: true,
};

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db.execute(sql`
    select
      tutor_enabled as "tutorEnabled",
      tutor_daily_cap_per_profile as "tutorDailyCapPerProfile",
      tutor_shared_daily_budget as "tutorSharedDailyBudget",
      tutor_use_concept_guides as "tutorUseConceptGuides",
      tutor_use_cache as "tutorUseCache",
      tutor_use_gemini as "tutorUseGemini",
      arcade_enabled as "arcadeEnabled",
      game_spelling_sprint_enabled as "gameSpellingSprintEnabled",
      game_missing_letters_enabled as "gameMissingLettersEnabled",
      game_word_meaning_match_enabled as "gameWordMeaningMatchEnabled",
      game_homophone_hunter_enabled as "gameHomophoneHunterEnabled",
      game_prefix_suffix_builder_enabled as "gamePrefixSuffixBuilderEnabled",
      tutor_fun_content_enabled as "tutorFunContentEnabled"
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
 * successful Gemini call), logging 'none' otherwise: whether that's a
 * genuine "nothing matched" (mode "template") or a real match served
 * straight from the database because Gemini itself failed (mode
 * "grounded", added 9 September 2026 - see tutorGeneration.ts's
 * formatGroundedReply), neither one made a real Gemini call, so neither
 * should count here either. A
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
 * Track 2's "Cache" toggle (tutor_use_cache), ported from Custom Gemini's
 * get_cached_gemini_answer (~/Work/AI-ML/Custom Gemini/db_client.py) -
 * reuse a previous REAL Gemini answer to the same scoped question instead
 * of spending another call. Call this before checkDailyCap specifically
 * (tutor.ts) - a cache hit should cost no quota at all, the same way the
 * reference prototype's cache check runs before its Gemini-call attempt.
 *
 * "Same scoped question" means an exact (trimmed, case-insensitive) text
 * match from this profile, in this class+subject, same as the reference -
 * fuzzy-matching a cache key felt like a good way to serve a stale answer
 * to a differently-intended question. Only ever returns an answer that
 * was itself a genuine Gemini reply (matched_source_type 'question' or
 * 'concept_guide', i.e. reply.mode "ai" when it was first recorded by
 * recordTutorExchange below) - never a 'grounded', 'template', or already-
 * 'cached' reply, so a cache hit always traces back to one real call.
 */
export async function getCachedReply(params: {
  profileId: string;
  classId: string;
  subjectId: string;
  queryText: string;
}): Promise<string | null> {
  const { profileId, classId, subjectId, queryText } = params;

  const rows = await db.execute(sql`
    select agent.content
    from tutor_messages student
    join tutor_conversations tc on tc.id = student.conversation_id
    join lateral (
      select content
      from tutor_messages a
      where a.conversation_id = student.conversation_id
        and a.role = 'agent'
        and a.matched_source_type in ('question', 'concept_guide')
        and a.created_at >= student.created_at
      order by a.created_at asc
      limit 1
    ) agent on true
    where tc.profile_id = ${profileId}
      and tc.class_id = ${classId}
      and tc.subject_id = ${subjectId}
      and student.role = 'student'
      and lower(trim(student.content)) = lower(trim(${queryText}))
    order by student.created_at desc
    limit 1
  `);

  const row = rows[0] as unknown as { content: string } | undefined;
  return row?.content ?? null;
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
  sourceType: "social" | "fun_content" | "reveal_offer" | "quiz_question" | "quiz_reveal_offer" | "cached";
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
