-- Scoring-engine support for the new question types, per
-- plan/Question-Types-and-Content-Authoring-Plan.md ("Scoring-engine
-- impact") and build order step 4. quiz_attempt_answers was MCQ-only
-- (a single selected_option_id, boolean is_correct) - this makes it
-- type-general:
--
-- - selected_option_id becomes nullable: only mcq/true_false answers use
--   it; every other type submits selected_payload instead.
-- - selected_payload (jsonb, nullable) holds whatever the submitted
--   answer shape needs for non-mcq types - a typed-in string for
--   fill_blank/missing_number/missing_spelling/short_answer/long_answer,
--   or { pairs: [leftIdx, rightIdx][] } for match_column.
-- - score (real, nullable) replaces "is_correct implies 1 correct
--   question" as the thing that actually gets summed for a stage's
--   percentage: 1 or 0 for the binary types (matches is_correct exactly,
--   so today's all-MCQ data is unaffected), a fraction for match_column's
--   partial credit (e.g. 3 of 5 pairs = 0.6), and NULL for short/long
--   answer - which the scoring engine excludes from the stage total
--   entirely per the "excluded from auto-scoring, spelling feedback
--   shown regardless" decision, rather than counting as a 0.
--
-- Existing rows are all graded MCQ answers, so they backfill from
-- is_correct exactly (no behavior change for anything already recorded).
--
-- Also adds quiz_attempts.stars_earned: a running total, incremented as
-- each stage is scored (70-84% -> 1, 85-94% -> 2, 95-100% -> 3, layered
-- on top of the existing 70% pass gate - see "Star bands" in the same
-- plan doc), summed per profile once the leaderboard switches to a
-- stars-based ranking (build order step 6, not this migration).
--
-- Run this once in the Supabase SQL Editor, same as 0000-0012.

alter table quiz_attempt_answers
  alter column selected_option_id drop not null;

alter table quiz_attempt_answers
  add column selected_payload jsonb,
  add column score real;

update quiz_attempt_answers
  set score = case when is_correct then 1 else 0 end
  where score is null;

alter table quiz_attempts
  add column stars_earned integer not null default 0;
