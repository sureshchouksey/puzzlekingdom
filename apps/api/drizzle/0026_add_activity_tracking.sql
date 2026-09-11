-- Activity time tracking (11 September 2026): nothing in Puzzle Kingdom
-- tracks *time* before this - every existing table only has point-in-time
-- timestamps (quiz_attempts.started_at/completed_at, game_attempts.
-- played_at, tutor_conversations.started_at/last_message_at), and every
-- existing report is built on accuracy/counts/stars, never duration. Per
-- direct user request: track how long each child spends in the app -
-- overall, by topic, by Arcade game, by activity type - for a family
-- owner's own dashboard and a platform-admin metrics view.
--
-- One raw ping row every ~30s while a screen is open and the tab is
-- foregrounded (Page Visibility API) - not an estimate derived from
-- existing start/submit timestamps. duration_seconds is fixed server-side
-- to the heartbeat interval, never trusted from the client, since a
-- tampered client could otherwise inflate a child's numbers on a
-- parent/admin-visible dashboard.
--
-- No rollup/summary table - aggregated live via SQL at read time, same
-- "no job queue for a small-scale app" approach the leaderboard and
-- admin Users tab already use. Even a child playing 2 hours/day is only
-- ~240 rows/day - trivial at this app's scale.
create table if not exists activity_heartbeats (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  -- 'quiz' | 'game' | 'study_buddy' | 'browsing' - free text + check
  -- constraint (not a pg enum), matching tutor_conversations.context_type's
  -- convention, since a hand-run migration can't ALTER TYPE ... ADD VALUE
  -- inside the same transaction as other DDL if a 5th type shows up later.
  activity_type text not null,
  subject_id uuid references subjects(id),
  class_id uuid references classes(id),
  topic text,        -- only meaningful for 'quiz' (and optionally 'study_buddy')
  game_key text,      -- only meaningful for 'game'
  quiz_attempt_id uuid references quiz_attempts(id),
  tutor_conversation_id uuid references tutor_conversations(id),
  duration_seconds integer not null default 30,
  created_at timestamptz not null default now(),
  constraint activity_heartbeats_activity_type_check
    check (activity_type in ('quiz', 'game', 'study_buddy', 'browsing'))
);

create index if not exists activity_heartbeats_profile_id_created_at_idx on activity_heartbeats (profile_id, created_at);
create index if not exists activity_heartbeats_created_at_idx on activity_heartbeats (created_at);
create index if not exists activity_heartbeats_class_id_idx on activity_heartbeats (class_id);
