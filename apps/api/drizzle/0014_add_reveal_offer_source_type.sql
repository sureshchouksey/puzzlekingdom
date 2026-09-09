-- tutor_messages.matched_source_type (migration 0008, widened by 0013 to
-- add 'fun_content'/'social') needs one more value: 'reveal_offer' - an
-- incorrect guess's own feedback message ("Not quite! Want a hint, or
-- should I tell you the answer?"), which tutor.ts now tags separately
-- from a plain 'social' reply so the NEXT message can tell "we just
-- offered to reveal the answer" apart from an ordinary social turn (see
-- tutorIntent.ts's PendingFunContent.offeredReveal and tutor.ts's
-- getPendingFunContent). Postgres has no "alter check constraint" - drop
-- and recreate under the same name, same pattern as 0013.
alter table tutor_messages drop constraint if exists tutor_messages_matched_source_type_check;
alter table tutor_messages add constraint tutor_messages_matched_source_type_check
  check (matched_source_type in ('question', 'concept_guide', 'none', 'fun_content', 'social', 'reveal_offer'));
