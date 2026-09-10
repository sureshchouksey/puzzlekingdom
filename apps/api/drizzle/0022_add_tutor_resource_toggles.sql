-- Track 2 ("Port Custom Gemini's toggle feature into the real Study Buddy
-- admin tab", plan/Puzzle-Kingdom-Master-Roadmap.md / Tech-Stack-
-- Consolidation-Plan.md) - the three-way "Resource Access" toggle from
-- the Custom Gemini reference prototype (~/Work/AI-ML/Custom Gemini,
-- app.py's use_concept_guides/use_cache/use_gemini session toggles),
-- ported onto the real app_settings singleton row migration 0008
-- created. All three default true so existing behaviour is completely
-- unchanged until an admin actually flips one off in the dashboard:
--   tutor_use_concept_guides - when false, retrieval skips concept_guides
--     entirely (tutorRetrieval.ts), answering only from real questions.
--   tutor_use_cache          - when false, skip reusing a previous real
--     Gemini answer to the same scoped question (tutorBudget.ts's new
--     getCachedReply) and always retrieve+generate fresh.
--   tutor_use_gemini         - when false, never call Gemini at all
--     (tutorGeneration.ts) - a match is served straight from the
--     database (mode "grounded"), same as a real Gemini failure today.
alter table app_settings add column if not exists tutor_use_concept_guides boolean not null default true;
alter table app_settings add column if not exists tutor_use_cache boolean not null default true;
alter table app_settings add column if not exists tutor_use_gemini boolean not null default true;

-- 'cached' is a new matched_source_type for a reply served by the new
-- cache toggle above: a real previous Gemini answer reused verbatim, not
-- a new Gemini call. Deliberately left OUT of checkDailyCap's
-- 'question'/'concept_guide' count (tutorBudget.ts) - reusing an old
-- answer costs nothing, so it shouldn't count against the daily cap
-- either, same reasoning as 'none'/'grounded' replies today. Postgres
-- has no "alter check constraint" - drop and recreate under the same
-- name, same pattern as 0013/0014/0016.
alter table tutor_messages drop constraint if exists tutor_messages_matched_source_type_check;
alter table tutor_messages add constraint tutor_messages_matched_source_type_check
  check (matched_source_type in ('question', 'concept_guide', 'none', 'fun_content', 'social', 'reveal_offer', 'quiz_question', 'quiz_reveal_offer', 'cached'));
