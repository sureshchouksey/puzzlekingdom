-- Adds support for question types beyond MCQ, per
-- plan/Question-Types-and-Content-Authoring-Plan.md ("Data model
-- recommendation"). One additive migration: a new enum, plus two new
-- nullable columns on `questions` - no existing column is touched.
--
-- Existing MCQ rows: `question_type` backfills to 'mcq' via the column
-- default (applied to every existing row in the same ALTER TABLE, so no
-- separate UPDATE is needed), and their answer data keeps living in the
-- existing `options`/`correct_option_id` columns exactly as before -
-- `answer_payload` is left null for them. True/False also reuses
-- `options`/`correct_option_id` (same shape as MCQ, just rendered as a
-- toggle in the UI) rather than answer_payload, to avoid a second place
-- an MCQ-shaped answer could live. `answer_payload` is only populated for
-- the genuinely new shapes: fill_blank/missing_number/missing_spelling
-- ({acceptedAnswers}), match_column ({left, right, correctPairs}), and
-- short_answer/long_answer ({rubricKeyPoints}).
--
-- `image_url` is added now even though its first real use is Phase 2's
-- Non-Verbal Reasoning content (shape sequences, rotations) - cheaper to
-- add alongside this migration than open a third one later just for it.
--
-- Run this once in the Supabase SQL Editor, same as 0000-0010.

create type question_type as enum (
  'mcq',
  'true_false',
  'fill_blank',
  'missing_number',
  'missing_spelling',
  'match_column',
  'short_answer',
  'long_answer'
);

alter table questions
  add column question_type question_type not null default 'mcq',
  add column answer_payload jsonb,
  add column image_url text;
