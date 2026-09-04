-- Adds a class/year-group layer above subject, and per-question topic tags,
-- so content can be browsed as Class -> Subject -> Topic instead of just by
-- subject. Run this once in the Supabase SQL Editor, same as 0000_init.sql
-- and 0001_add_document_passage.sql.
--
-- "class" here means the audience the content targets (e.g. "11+ Grammar
-- Prep" for CSSE/CCHS exam content, or "Year 3" for National Curriculum
-- course content) - nested above subject, since the same subject (Maths,
-- English) exists across multiple classes.
--
-- "topics" is a free-text tag array per question (e.g. {"Fractions,
-- Decimals & Percentages","Word Problems"}) assigned at seed/generation
-- time, not a fixed enum - a question can carry more than one topic tag,
-- and the app derives its topic filter list from whatever values actually
-- exist for a given class+subject (see GET /topics).

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

alter table documents add column if not exists class_id uuid references classes(id);
alter table questions add column if not exists topics text[];

create index if not exists documents_class_id_idx on documents(class_id);
create index if not exists questions_topics_idx on questions using gin(topics);
