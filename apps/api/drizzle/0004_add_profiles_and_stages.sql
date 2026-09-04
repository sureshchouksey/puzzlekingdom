-- Adds lightweight named player profiles (no passwords - "who's playing",
-- like a game console), and breaks a quiz attempt into configurable-size
-- "stages" so progress is saved and can be shown on a leaderboard as you
-- go, not only once an entire quiz is finished. Run this once in the
-- Supabase SQL Editor, same as 0000-0003.

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  created_at timestamptz not null default now()
);

-- Who played this attempt (nullable - older attempts, and any quiz taken
-- before this feature existed, simply have no profile and won't show up
-- on the leaderboard).
alter table quiz_attempts add column if not exists profile_id uuid references profiles(id);

-- How many questions make up one stage for this attempt, chosen at
-- quiz-assembly time (clamped server-side to the actual question count).
alter table quiz_attempts add column if not exists stage_size integer not null default 5;

-- How many full stages have been scored so far - updated on every stage
-- submission, not only at final completion, so an attempt that's
-- abandoned partway still credits whatever stages were actually cleared.
alter table quiz_attempts add column if not exists stages_cleared integer not null default 0;

create index if not exists quiz_attempts_profile_id_idx on quiz_attempts(profile_id);
