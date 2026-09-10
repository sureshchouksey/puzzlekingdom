-- The Arcade: informal, repeatable practice games (Spelling Sprint, Word
-- Meaning Match, Homophone Hunter, Prefix/Suffix Builder, Missing
-- Letters), distinct from the graded stage-based quiz - per
-- "Practice games (the Arcade)" in
-- plan/Question-Types-and-Content-Authoring-Plan.md. Deliberately reuses
-- the exact same `questions`/`answerPayload` data model (no separate
-- content system) - this migration only adds a place to record a
-- completed round.
--
-- One row per completed round (not per question) - a round is a batch of
-- N quick-fire questions of one game's type, played in one sitting.
-- class_id/subject_id are nullable because a round can be "any class,
-- any subject" if the player didn't filter, matching how quiz_attempts.
-- topic works today. stars_earned reuses the exact same star-band
-- function (starsForPercent in lib/scoring.ts) as the graded quiz, so
-- "stars" means the same thing everywhere in the app.
--
-- Run this once in the Supabase SQL Editor, same as 0000-0020.

create table if not exists game_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id),
  class_id uuid references classes(id),
  subject_id uuid references subjects(id),
  game_key text not null,
  correct_count integer not null,
  total_count integer not null,
  stars_earned integer not null default 0,
  played_at timestamptz not null default now()
);

create index if not exists game_attempts_profile_id_idx on game_attempts (profile_id);
