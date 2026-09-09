import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Reuses a prior Gemini-generated reply for the exact same question
// instead of spending another API call - gated by app_settings'
// tutor_use_cache (migration 0015). Ported from Custom Gemini's
// db_client.py get_cached_gemini_answer: no separate cache table, just a
// scoped re-query of the existing tutor_conversations/tutor_messages
// transcript for a prior exchange that matches exactly. See
// Puzzle-Kingdom-Master-Roadmap.md's Track 2 and
// Tech-Stack-Consolidation-Plan.md.
//
// "Matches exactly" means the same profile, same class+subject, and an
// exact (already-trimmed) string match on the student's message text -
// no fuzzy matching, same as the source this was ported from. A
// rephrased question is a cache miss, which is the safe direction to be
// wrong in: a fresh, correctly-grounded Gemini call, never a mismatched
// reused answer.
//
// "A prior Gemini-generated reply" is identified by matched_source_type
// != 'none' on the agent's reply, rather than a dedicated mode column -
// recordTutorExchange (tutorBudget.ts) only ever logs a real source type
// (concept_guide/question) when tutorGeneration.ts actually returned
// mode: "ai"; a template reply (no match, or Gemini itself failed after
// retries) always logs "none". See recordTutorExchange's own comment for
// why that invariant holds - this function relies on it instead of
// adding a new column.
export async function getCachedTutorReply(params: {
  profileId: string;
  classId: string;
  subjectId: string;
  message: string;
}): Promise<string | null> {
  const { profileId, classId, subjectId, message } = params;

  const rows = await db.execute<{ reply: string }>(sql`
    select agent_reply.content as reply
    from tutor_conversations tc
    join tutor_messages student_msg
      on student_msg.conversation_id = tc.id
      and student_msg.role = 'student'
      and student_msg.content = ${message}
    join lateral (
      select content
      from tutor_messages tm
      where tm.conversation_id = tc.id
        and tm.role = 'agent'
        and tm.matched_source_type != 'none'
        and tm.created_at >= student_msg.created_at
      order by tm.created_at asc
      limit 1
    ) agent_reply on true
    where tc.profile_id = ${profileId}
      and tc.class_id = ${classId}
      and tc.subject_id = ${subjectId}
    order by student_msg.created_at desc
    limit 1
  `);

  return rows[0]?.reply ?? null;
}
