-- Automated spelling-check pass for short/long answers, per
-- Question-Types-and-Content-Authoring-Plan.md's grading-decision
-- section (build order step 5): a dictionary-based check runs regardless
-- of whether the answer counts toward the score (short/long answer is
-- excluded from scoring entirely - see migration 0019's score column),
-- so the feedback needs somewhere to live independent of score/isCorrect.
--
-- Nullable, additive - populated only for short_answer/long_answer
-- submissions (see lib/spellcheck.ts + routes/quizzes.ts); every other
-- question_type leaves this null.
--
-- Run this once in the Supabase SQL Editor, same as 0000-0019.

alter table quiz_attempt_answers
  add column spelling_issues jsonb;
