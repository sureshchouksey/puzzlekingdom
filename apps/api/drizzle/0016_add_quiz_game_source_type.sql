-- tutor_messages.matched_source_type needs two more values for the new
-- real-question chat quiz game (plan/AI-Study-Mentor-Agent-Plan.md's
-- "friendly chat / play a game" extension, now widened to real curriculum
-- questions, not just fun_content - see tutorQuizGame.ts): 'quiz_question'
-- (a real question from the `questions` bank was just served in chat, and
-- a guess is pending - see tutor.ts's getPendingInteractive) and
-- 'quiz_reveal_offer' (the quiz-game's own "want a hint, or should I tell
-- you the answer?" follow-up after a wrong guess - the quiz-game
-- counterpart to 0014's 'reveal_offer', kept as its own distinct value
-- rather than reusing 'reveal_offer' so tutor.ts always knows which table
-- - fun_content vs questions - the pending sourceId actually points into).
-- Postgres has no "alter check constraint" - drop and recreate under the
-- same name, same pattern as 0013/0014. Run this once in the Supabase SQL
-- Editor, same as 0000-0015.
alter table tutor_messages drop constraint if exists tutor_messages_matched_source_type_check;
alter table tutor_messages add constraint tutor_messages_matched_source_type_check
  check (matched_source_type in ('question', 'concept_guide', 'none', 'fun_content', 'social', 'reveal_offer', 'quiz_question', 'quiz_reveal_offer'));
