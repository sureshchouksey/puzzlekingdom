-- Adds a specific avatar choice on top of the existing cosmetic "title"
-- (Prince/Princess). Free text, same convention as `title` itself (no
-- enum) - the frontend owns the fixed list of valid ids (5 per title);
-- this column just stores whichever one the player picked, e.g.
-- "prince-3" or "princess-5". Null for older profiles created before
-- avatar choice existed, or one that hasn't finished onboarding yet -
-- Welcome.tsx/Leaderboard.tsx fall back to the old single generic image
-- per title when this is null. Run this once in the Supabase SQL Editor,
-- same as 0000-0011.

alter table profiles add column if not exists avatar_id text;
