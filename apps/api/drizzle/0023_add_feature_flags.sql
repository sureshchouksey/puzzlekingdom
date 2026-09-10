-- Flag-based feature management (admin request, 10 September 2026):
-- extends the same app_settings singleton (migration 0008, extended by
-- 0022's Resource Access toggle) with on/off switches for the rest of
-- the app's optional features, not just Study Buddy. All default true so
-- nothing changes behaviourally until an admin flips one off from the
-- new admin dashboard "Features" tab - same "default true, opt-out"
-- convention 0022 established.
--
-- arcade_enabled is the Arcade's master switch (routes/games.ts); the 5
-- per-game columns below let an admin turn off just one game (e.g.
-- Spelling Sprint) while leaving the other 4 on - both are checked
-- together (arcade_enabled AND the specific game's column) by
-- GET /games/round and GET /games/available, and by GET /features'
-- public summary the kid-facing app reads to decide what to show.
alter table app_settings add column if not exists arcade_enabled boolean not null default true;
alter table app_settings add column if not exists game_spelling_sprint_enabled boolean not null default true;
alter table app_settings add column if not exists game_missing_letters_enabled boolean not null default true;
alter table app_settings add column if not exists game_word_meaning_match_enabled boolean not null default true;
alter table app_settings add column if not exists game_homophone_hunter_enabled boolean not null default true;
alter table app_settings add column if not exists game_prefix_suffix_builder_enabled boolean not null default true;

-- Gates the riddle/joke/tongue-twister/trivia "fun content" bank inside
-- Study Buddy chat (services/funContent.ts) - deliberately separate from
-- tutor_enabled (Study Buddy's own all-or-nothing kill switch), so an
-- admin can keep real curriculum help on while turning off just the
-- playful side, or vice versa.
alter table app_settings add column if not exists tutor_fun_content_enabled boolean not null default true;
