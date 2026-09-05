-- Adds the data model the AI Study Mentor tutor needs to actually run:
-- see plan/AI-Study-Mentor-Agent-Plan.md, Section 8 and Section 10 step 5.
-- concept_guides (0007) and the retrieval/generation modules
-- (tutorRetrieval.ts, tutorGeneration.ts) already exist; this migration
-- adds the three pieces still missing - a real conversation/message log
-- (needed to count "how many messages has this child sent today", not
-- just for the eventual transcript view) and a settings row for the
-- admin on/off toggle and the per-profile daily cap. Run this once in the
-- Supabase SQL Editor, same as 0000-0007.

-- A singleton settings row - there is deliberately only ever one. The
-- `id boolean primary key default true` + check trick is what enforces
-- that: `id` can only ever be the literal value true, and a primary key
-- can't repeat, so a second insert is rejected outright rather than
-- relying on application code to remember not to create one.
create table if not exists app_settings (
  id boolean primary key default true,
  constraint app_settings_is_singleton check (id),
  tutor_enabled boolean not null default true,
  -- Confirmed 5 September 2026: 30 messages/day per profile. This is the
  -- only cap actually enforced right now - see tutorBudget.ts. The
  -- system-wide shared daily budget described in Section 6/Section 9 (to
  -- bound total cost regardless of how many profiles are active) is
  -- deliberately NOT built yet: this is a single-family instance with a
  -- small, fixed number of profiles, so even every profile hitting 30/day
  -- stays well inside gemini-3.1-flash-lite's free-tier daily quota
  -- (~1,000 requests/day per Section 6's research) without needing a
  -- second cap on top. tutor_shared_daily_budget exists as a column now,
  -- nullable/unused, specifically so enabling it later (if the family or
  -- the free-tier limit ever changes) is a data change, not a migration.
  tutor_daily_cap_per_profile integer not null default 30,
  tutor_shared_daily_budget integer,
  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

-- One row per tutor chat session, so a "general" Ask-your-Study-Buddy
-- chat and an "Explain this to me" chat both have somewhere to attach
-- their messages. related_question_id/related_attempt_id are set only for
-- the "explain this wrong answer" entry point (Section 2's two entry
-- points) - both nullable, and both left without an onDelete behaviour
-- for now (a deleted question or attempt should not silently delete the
-- conversation history that referenced it).
create table if not exists tutor_conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  context_type text not null default 'general' check (context_type in ('general', 'question')),
  related_question_id uuid references questions(id),
  related_attempt_id uuid references quiz_attempts(id)
);

create index if not exists tutor_conversations_profile_idx
  on tutor_conversations (profile_id);

-- The real transcript, one row per turn. matched_source_type/
-- matched_source_id/match_score are only ever set on 'agent' rows and map
-- directly onto tutorRetrieval.ts's RetrievedSource / tutorGeneration.ts's
-- TutorReply shapes (Section 8's own note on this correspondence).
-- on delete cascade: deleting a conversation should take its messages
-- with it, the same cascade choice already made for quiz_attempt_answers
-- in migration 0005.
create table if not exists tutor_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references tutor_conversations(id) on delete cascade,
  role text not null check (role in ('student', 'agent')),
  content text not null,
  matched_source_type text check (matched_source_type in ('question', 'concept_guide', 'none')),
  matched_source_id uuid,
  match_score real,
  created_at timestamptz not null default now()
);

create index if not exists tutor_messages_conversation_idx
  on tutor_messages (conversation_id);

-- Powers tutorBudget.ts's "how many messages has this profile sent today"
-- count directly, without a full table scan.
create index if not exists tutor_messages_created_at_idx
  on tutor_messages (created_at);
