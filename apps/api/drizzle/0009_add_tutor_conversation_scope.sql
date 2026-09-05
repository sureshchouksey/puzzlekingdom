-- Adds class_id/subject_id to tutor_conversations - a gap found while
-- actually building the route that uses this table (Section 10 step 6,
-- plan/AI-Study-Mentor-Agent-Plan.md). tutorRetrieval.ts's two entry
-- points both require a classId/subjectId to scope search against (the
-- class-scoping design documented in that file's own header comment,
-- there specifically to stop a Year 3 child ever being handed 11+-level
-- material or vice versa) - migration 0008 recorded profile_id and
-- context_type but never gave a conversation a fixed class/subject to
-- retrieve against, which only became visible once the actual route
-- needed to call retrieveForQuery/retrieveForQuestion with real values on
-- every message, not just the first one. A conversation's class/subject is
-- fixed for its whole lifetime (set once at POST /tutor/conversations,
-- read on every subsequent message) rather than re-sent by the client on
-- every message, the same way quiz_attempts fixes its own class_id/
-- subject_id once at assembly time. Table is empty (no route has ever
-- written to it), so this is a plain not-null add, no backfill needed.
-- Run this once in the Supabase SQL Editor, after 0008.

alter table tutor_conversations
  add column subject_id uuid not null references subjects(id),
  add column class_id uuid not null references classes(id);
