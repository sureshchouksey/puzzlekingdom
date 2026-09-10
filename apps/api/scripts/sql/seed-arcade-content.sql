-- Sample content for the Arcade's 3 content-dependent games (Word
-- Meaning Match, Homophone Hunter, Prefix/Suffix Builder), plus a few
-- extra missing_spelling questions so Spelling Sprint/Missing Letters
-- have more than the single "because" question to draw a round from.
-- Run this once in the Supabase SQL Editor, same as
-- seed-sample-question-types.sql.
--
-- GET /games/round filters by (questionType, topic tag) per game - see
-- GAME_DEFINITIONS in src/routes/games.ts:
--   word_meaning_match  -> match_column, topic "Word Meanings"
--   homophone_hunter    -> mcq,          topic "Homophones"
--   prefix_suffix_builder -> fill_blank, topic "Prefixes & Suffixes"
--   spelling_sprint / missing_letters -> missing_spelling, no topic filter

insert into subjects (name) values ('English') on conflict (name) do nothing;
insert into classes (name) values ('Year 3') on conflict (name) do nothing;

insert into documents (subject_id, class_id, original_filename, storage_path, mime_type, status)
values (
  (select id from subjects where name = 'English'),
  (select id from classes where name = 'Year 3'),
  'Claude sample content - Arcade games (Word Meaning Match, Homophone Hunter, Prefix/Suffix Builder, extra Spelling)',
  'seed:claude-sample-arcade-english',
  'text/plain',
  'ready'
);

-- Word Meaning Match (match_column, topic "Word Meanings") - 2 rounds of
-- 4 pairs each.
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  'Match each word to its meaning.',
  '[]'::jsonb, '',
  'huge = large, tiny = small, begin = start, finish = end.',
  array['Word Meanings'],
  'Say the word in a sentence to yourself - it often makes the meaning obvious.',
  'match_column',
  jsonb_build_object('left', array['huge','tiny','begin','finish'], 'right', array['small','end','start','large'], 'correctPairs', jsonb_build_array(jsonb_build_array(0,3), jsonb_build_array(1,0), jsonb_build_array(2,2), jsonb_build_array(3,1)))
);

insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  'Match each word to its meaning.',
  '[]'::jsonb, '',
  'happy = joyful, sad = unhappy, fast = quick, slow = gradual.',
  array['Word Meanings'],
  'Think of a word that could swap places with it in a sentence without changing the meaning.',
  'match_column',
  jsonb_build_object('left', array['happy','sad','fast','slow'], 'right', array['unhappy','gradual','joyful','quick'], 'correctPairs', jsonb_build_array(jsonb_build_array(0,2), jsonb_build_array(1,0), jsonb_build_array(2,3), jsonb_build_array(3,1)))
);

-- Homophone Hunter (mcq, topic "Homophones").
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  $q$The children took ___ books home.$q$,
  '[{"id":"a","text":"there"},{"id":"b","text":"their"},{"id":"c","text":"they''re"}]'::jsonb,
  'b',
  $e$"Their" shows something belongs to them - the books belong to the children.$e$,
  array['Homophones'],
  $t$"There" points to a place, "their" shows ownership, "they''re" is short for "they are".$t$,
  'mcq',
  null
);

insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  $q$___ going to the park later.$q$,
  '[{"id":"a","text":"There"},{"id":"b","text":"Their"},{"id":"c","text":"They''re"}]'::jsonb,
  'c',
  $e$"They''re" is short for "they are" - "They''re going to the park" means "They are going to the park".$e$,
  array['Homophones'],
  $t$If you can replace the word with "they are" and it still makes sense, use "they're".$t$,
  'mcq',
  null
);

insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  'I would like to buy ___ apples from the shop.',
  '[{"id":"a","text":"to"},{"id":"b","text":"too"},{"id":"c","text":"two"}]'::jsonb,
  'c',
  '"Two" is the number 2 - two apples means a pair of apples.',
  array['Homophones'],
  '"Two" has a "w" like "twin" - both are about the number two.',
  'mcq',
  null
);

-- Prefix/Suffix Builder (fill_blank, topic "Prefixes & Suffixes").
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  $q$Add the prefix "un-" to the word "happy" to make a word meaning "not happy". Write the new word: ___$q$,
  '[]'::jsonb, '',
  $e$"Un-" flips a word to its opposite meaning: happy -> unhappy.$e$,
  array['Prefixes & Suffixes'],
  $t$"Un-" usually means "not" - unhappy, unsure, unfair.$t$,
  'fill_blank',
  jsonb_build_object('acceptedAnswers', array['unhappy'])
);

insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  $q$Add the suffix "-ful" to the word "care" to make a word meaning "full of care". Write the new word: ___$q$,
  '[]'::jsonb, '',
  $e$"-ful" means "full of": care -> careful.$e$,
  array['Prefixes & Suffixes'],
  $t$"-ful" adds "full of" to the end of a word - careful, joyful, helpful.$t$,
  'fill_blank',
  jsonb_build_object('acceptedAnswers', array['careful'])
);

insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  $q$Add the prefix "re-" to the word "do" to make a word meaning "do again". Write the new word: ___$q$,
  '[]'::jsonb, '',
  $e$"Re-" means "again": do -> redo.$e$,
  array['Prefixes & Suffixes'],
  $t$"Re-" at the start of a word usually means "again" - redo, replay, rewrite.$t$,
  'fill_blank',
  jsonb_build_object('acceptedAnswers', array['redo'])
);

-- A few extra missing_spelling questions, so Spelling Sprint/Missing
-- Letters have more than one question to draw a round from.
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  'Fill in the missing letters to complete the word: fr_end',
  '[]'::jsonb, '',
  'The word is "friend" - remember "i" before "e" here, which trips a lot of people up.',
  array['Spelling Patterns'],
  'Say the word slowly, sound by sound, to hear which letter is missing.',
  'missing_spelling',
  jsonb_build_object('acceptedAnswers', array['friend'])
);

insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  'Fill in the missing letters to complete the word: b_ut_ful',
  '[]'::jsonb, '',
  'The word is "beautiful" - a good one to learn by breaking it into "beauty" + "-ful".',
  array['Spelling Patterns'],
  'Break the word into smaller chunks you already know: "beauty" + "ful".',
  'missing_spelling',
  jsonb_build_object('acceptedAnswers', array['beautiful'])
);

insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-arcade-english'),
  (select id from subjects where name = 'English'),
  'Fill in the missing letters to complete the word: w_ich',
  '[]'::jsonb, '',
  'The word is "which" - not to be confused with the homophone "witch".',
  array['Spelling Patterns'],
  'Remember "wh" words are usually question words: which, when, where, why.',
  'missing_spelling',
  jsonb_build_object('acceptedAnswers', array['which'])
);

-- Quick check - should return 11 rows.
select question_type, question_text
from questions
where document_id = (select id from documents where storage_path = 'seed:claude-sample-arcade-english')
order by question_type;
