-- Adds a per-question "tip" (a memorable trick/strategy, distinct from the
-- factual `explanation`, surfaced especially when a student gets a question
-- wrong) and a per-attempt topic-progress report, so completed quizzes can
-- be reviewed by topic over time, not just by overall score. Run this once
-- in the Supabase SQL Editor, same as the previous migrations.

alter table questions add column if not exists tip text;

-- Which class a quiz attempt was assembled from (nullable - older attempts
-- and any quiz not filtered by class leave this null). Lets reports be
-- grouped by class the same way content already is.
alter table quiz_attempts add column if not exists class_id uuid references classes(id);

-- A snapshot, computed once at submit time, of accuracy per topic for this
-- one attempt: {"Fractions, Decimals & Percentages": {"correct": 3, "total": 5}, ...}.
-- A question with more than one topic tag contributes to every tag it
-- carries. Stored (not recomputed live) so a report stays accurate to what
-- was actually asked even if a question's topics are edited later, and so
-- the /reports endpoints can aggregate across many attempts cheaply.
alter table quiz_attempts add column if not exists topic_breakdown jsonb;

create index if not exists quiz_attempts_class_id_idx on quiz_attempts(class_id);
