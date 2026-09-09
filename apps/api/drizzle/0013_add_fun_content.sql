-- Adds fun_content: a small bank of tongue twisters, riddles, jokes,
-- multi-step brain-teaser puzzles, and subject trivia questions the
-- Study Buddy chat (apps/api/src/routes/tutor.ts) can pull from when a
-- child wants to play rather than ask a curriculum question - see
-- plan/AI-Study-Mentor-Agent-Plan.md's "friendly chat / play a game"
-- extension. Distinct from concept_guides (curriculum method/formula
-- content) - this is deliberately playful content, reviewed and curated
-- up front rather than generated fresh by Gemini each time, so a child
-- always gets something reliably kid-appropriate and so repeat requests
-- don't cost a Gemini call. Seeded separately by
-- apps/api/scripts/seed-fun-content.ts (same "migration creates the
-- empty table, content is authored/seeded separately" convention as
-- concept_guides - see 0007). Run this once in the Supabase SQL Editor,
-- same as 0000-0012.

create table if not exists fun_content (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('tongue_twister', 'riddle', 'joke', 'puzzle', 'trivia')),
  -- Only meaningful for content_type = 'trivia' (e.g. 'science',
  -- 'english') - null for the other types, which aren't subject-specific.
  subject text,
  prompt_text text not null,
  -- The riddle/puzzle/trivia answer, or a joke's punchline. Null for
  -- tongue twisters, which have no "answer".
  answer_text text,
  created_at timestamptz not null default now()
);

create index if not exists fun_content_type_idx on fun_content (content_type);

-- tutor_messages.matched_source_type (migration 0008) only allowed
-- 'question' | 'concept_guide' | 'none' - widened here to add
-- 'fun_content' (a served riddle/joke/twister/puzzle/trivia row) and
-- 'social' (a greeting or an acknowledged thanks/appreciation - see
-- tutorIntent.ts), neither of which is grounded in the curriculum
-- content bank the original three values were about. Postgres has no
-- "alter check constraint" - drop and recreate under the same name.
alter table tutor_messages drop constraint if exists tutor_messages_matched_source_type_check;
alter table tutor_messages add constraint tutor_messages_matched_source_type_check
  check (matched_source_type in ('question', 'concept_guide', 'none', 'fun_content', 'social'));
