-- Ports Custom Gemini's "Resource Access" toggles (app.py's
-- use_concept_guides / use_cache / use_gemini) into the real Study
-- Buddy's app_settings, per Tech-Stack-Consolidation-Plan.md steps 1-3
-- and Puzzle-Kingdom-Master-Roadmap.md's Track 2. Only two new columns,
-- not three: the existing tutor_enabled already serves as the "Gemini"
-- master switch (checkTutorBudget already refuses the whole tutor when
-- it's off), so there's nothing left for a separate Gemini toggle to do.
--
-- tutor_use_concept_guides - gates DB retrieval (tutorRetrieval.ts). When
-- off, the tutor never even looks for grounding content, which - per the
-- existing "refuse rather than guess" design (see tutorGeneration.ts's
-- header comment) - means it always shows the honest "I don't know that
-- yet" template rather than letting Gemini answer freely. This is a
-- deliberate departure from Custom Gemini's own behavior (which lets
-- Gemini answer ungrounded when this toggle is off) - the real app never
-- has an ungrounded-Gemini code path, and this migration doesn't add one.
--
-- tutor_use_cache - gates a real port of Custom Gemini's
-- get_cached_gemini_answer (db_client.py): reuse a prior AI-generated
-- reply for the exact same question (same profile+class+subject, exact
-- text match) instead of spending another Gemini call. See
-- services/tutorCache.ts.
--
-- Both default true, matching Custom Gemini's own session-state defaults
-- (app.py: `st.session_state.use_concept_guides = True`, `use_cache =
-- True`).
--
-- Run this once in the Supabase SQL Editor, same as 0000-0014.

alter table app_settings
  add column tutor_use_concept_guides boolean not null default true,
  add column tutor_use_cache boolean not null default true;
