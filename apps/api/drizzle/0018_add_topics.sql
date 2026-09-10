-- Adds a real `topics` table, replacing the plan to keep inventing topic
-- structure out of questions.topics' free-text tag array. Per
-- plan/Question-Types-and-Content-Authoring-Plan.md ("Phase 1 scope" +
-- build order step 2): class+subject scoped, ordered (drives the quest
-- map's node sequence in the Lovable visual migration), and carrying a
-- difficulty tag (drives the Beginner/Medium/Hard reward-system labels).
--
-- This migration only creates the table - it does not touch
-- questions.topics or backfill anything into this new table. Wiring
-- questions to real topic rows (and admin routes to manage them) is the
-- next step in the same plan.
--
-- Run this once in the Supabase SQL Editor, same as 0000-0017.

create type topic_difficulty as enum ('beginner', 'medium', 'hard');

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id),
  subject_id uuid not null references subjects(id),
  name text not null,
  -- Drives the quest map's node sequence (Lovable-Design-Migration-Plan.md
  -- Phase 2) and, indirectly, the difficulty label below (early topics in
  -- a subject's order = Beginner, middle = Medium, later = Hard).
  display_order integer not null default 0,
  difficulty topic_difficulty not null default 'beginner',
  created_at timestamptz not null default now()
);

-- One topic per (class, subject, name) - admin routes should update an
-- existing row rather than create a duplicate for the same combination,
-- same convention as concept_guides' unique index (migration 0007).
create unique index if not exists topics_class_subject_name_idx
  on topics (class_id, subject_id, name);
