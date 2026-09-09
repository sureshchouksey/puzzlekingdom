-- Lets an in-progress quiz attempt be resumed instead of losing all
-- progress when a player navigates away mid-quiz. `topic` records which
-- topic filter (if any - null means "all topics mixed") this attempt was
-- assembled with, and `question_ids` is the exact ordered set of question
-- ids picked at assembly time. Both are needed so GET /quizzes/resume can
-- rebuild the identical stage grouping a player left off partway through,
-- rather than handing back a fresh random set that no longer lines up
-- with quiz_attempt_answers already recorded for this attempt. Run this
-- once in the Supabase SQL Editor, same as 0000-0010.

alter table quiz_attempts add column if not exists topic text;
alter table quiz_attempts add column if not exists question_ids jsonb;
