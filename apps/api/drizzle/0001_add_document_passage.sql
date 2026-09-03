-- Adds a nullable "passage" column to documents, for reading-comprehension
-- content (like the CSSE English papers) where a set of questions all refer
-- back to one shared story/passage that needs to be shown to the quiz-taker
-- before its questions, not just derived answers with no source text.
-- Run this once in the Supabase SQL Editor, same as 0000_init.sql.

alter table documents add column passage text;
