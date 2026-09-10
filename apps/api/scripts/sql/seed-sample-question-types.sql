-- Sample content covering all 8 question types, for manually testing the
-- new admin authoring UI + quiz-play UI end to end. Run this once in the
-- Supabase SQL Editor (device_bash has no network path to the Supabase
-- pooler from this environment, so this is pasted/run by hand - same
-- pattern used for migrations 0017-0020 earlier this project).
--
-- Attaches to the existing "Year 3" class and the existing "Maths"/
-- "English" subjects (created here only if somehow missing), via two new
-- `documents` rows (mirrors what createSeedDocument() in
-- src/lib/save-questions.ts does for every other seeded document).
--
-- 4 Maths questions (mcq, fill_blank, missing_number, match_column) +
-- 4 English questions (true_false, missing_spelling, short_answer,
-- long_answer) = all 8 questionType values, one each.

-- 1) Make sure the subjects/class exist (no-ops if they already do).
insert into subjects (name) values ('Maths') on conflict (name) do nothing;
insert into subjects (name) values ('English') on conflict (name) do nothing;
insert into classes (name) values ('Year 3') on conflict (name) do nothing;

-- 2) One document per subject to hold these sample questions.
insert into documents (subject_id, class_id, original_filename, storage_path, mime_type, status)
values (
  (select id from subjects where name = 'Maths'),
  (select id from classes where name = 'Year 3'),
  'Claude sample questions - Maths (all question types demo)',
  'seed:claude-sample-maths-all-types',
  'text/plain',
  'ready'
);

insert into documents (subject_id, class_id, original_filename, storage_path, mime_type, status)
values (
  (select id from subjects where name = 'English'),
  (select id from classes where name = 'Year 3'),
  'Claude sample questions - English (all question types demo)',
  'seed:claude-sample-english-all-types',
  'text/plain',
  'ready'
);

-- 3) Maths questions.

-- mcq
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-maths-all-types'),
  (select id from subjects where name = 'Maths'),
  'What is 30 x 4?',
  '[{"id":"a","text":"120"},{"id":"b","text":"90"},{"id":"c","text":"34"},{"id":"d","text":"70"}]'::jsonb,
  'a',
  '30 x 4 = 120. You can also think of it as 3 x 4 = 12, then scale by 10 to get 120.',
  array['Multiplication & Division'],
  'When multiplying by a multiple of 10, multiply the other two digits first, then add the zero back on.',
  'mcq',
  null
);

-- fill_blank
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-maths-all-types'),
  (select id from subjects where name = 'Maths'),
  'A rectangle has a length of 8 cm and a width of 3 cm. Its perimeter is ___ cm.',
  '[]'::jsonb,
  '',
  'Perimeter = 2 x (length + width) = 2 x (8 + 3) = 2 x 11 = 22 cm.',
  array['Word Problems'],
  'Add the length and width first, then double the answer - that''s quicker than adding all four sides one by one.',
  'fill_blank',
  '{"acceptedAnswers": ["22", "22cm", "22 cm"]}'::jsonb
);

-- missing_number
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-maths-all-types'),
  (select id from subjects where name = 'Maths'),
  'Find the missing number in the sequence: 5, 10, 15, ___, 25, 30',
  '[]'::jsonb,
  '',
  'This sequence counts up in 5s, so the missing number between 15 and 25 is 20.',
  array['Number Sequences'],
  'Work out the gap between two known numbers next to each other first (10 to 15 is +5), then apply that same gap to find the missing one.',
  'missing_number',
  '{"acceptedAnswers": ["20"]}'::jsonb
);

-- match_column
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-maths-all-types'),
  (select id from subjects where name = 'Maths'),
  'Match each multiplication fact to its answer.',
  '[]'::jsonb,
  '',
  '4 x 5 = 20, 3 x 6 = 18, 8 x 2 = 16, 5 x 5 = 25.',
  array['Times Tables'],
  'Work out each fact one at a time rather than trying to match them all at once - it''s easier to avoid mixing them up.',
  'match_column',
  '{"left": ["4 x 5", "3 x 6", "8 x 2", "5 x 5"], "right": ["16", "25", "18", "20"], "correctPairs": [[0,3],[1,2],[2,0],[3,1]]}'::jsonb
);

-- 4) English questions.

-- true_false
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-english-all-types'),
  (select id from subjects where name = 'English'),
  'A noun is a naming word - for a person, place, or thing. True or False?',
  '[{"id":"true","text":"True"},{"id":"false","text":"False"}]'::jsonb,
  'true',
  'That''s correct - nouns name people (Sarah), places (London), or things (table).',
  array['Grammar & Punctuation'],
  'If you can put "a" or "the" in front of a word and it still makes sense (e.g. "the table"), it''s probably a noun.',
  'true_false',
  null
);

-- missing_spelling
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-english-all-types'),
  (select id from subjects where name = 'English'),
  'Fill in the missing letters to complete the word: b_c_use',
  '[]'::jsonb,
  '',
  'The word is "because" - a common word in the Year 3 statutory spelling list.',
  array['Spelling Patterns'],
  'Say the word slowly out loud, sound by sound, to hear which letters are missing.',
  'missing_spelling',
  '{"acceptedAnswers": ["because"]}'::jsonb
);

-- short_answer
-- Dollar-quoted text ($q$...$q$) and jsonb_build_object instead of a raw
-- JSON string literal - this one hit a paste-truncation error in the
-- Supabase SQL Editor as a plain single-quoted statement, so it's
-- written defensively to avoid any single/double-quote nesting.
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-english-all-types'),
  (select id from subjects where name = 'English'),
  $q$In one sentence, explain why we use a capital letter at the start of a sentence.$q$,
  '[]'::jsonb,
  '',
  $e$A capital letter at the start of a sentence shows the reader exactly where a new sentence begins, which makes writing much easier to read.$e$,
  array['Writing'],
  $t$Think about how confusing a paragraph would be to read if every sentence just ran into the next with no clear starting point.$t$,
  'short_answer',
  jsonb_build_object(
    'rubricKeyPoints',
    array[
      'Shows where a new sentence begins',
      'Makes writing clearer to read',
      'Also used for proper nouns and the word I'
    ]
  )
);

-- long_answer
insert into questions (document_id, subject_id, question_text, options, correct_option_id, explanation, topics, tip, question_type, answer_payload)
values (
  (select id from documents where storage_path = 'seed:claude-sample-english-all-types'),
  (select id from subjects where name = 'English'),
  'Write two or three sentences describing your favourite animal and why you like it.',
  '[]'::jsonb,
  '',
  'A strong answer names the animal clearly, gives at least one real reason for liking it, and is written in complete sentences with capital letters and full stops.',
  array['Writing'],
  'Start with "My favourite animal is..." and then give one reason why, using a describing word (adjective) if you can.',
  'long_answer',
  '{"rubricKeyPoints": ["Names the animal clearly", "Gives at least one reason", "Written in complete sentences with correct punctuation"]}'::jsonb
);

-- 5) Quick check - should return 8 rows, one per question_type.
select question_type, question_text, subject_id
from questions
where document_id in (
  select id from documents
  where storage_path in ('seed:claude-sample-maths-all-types', 'seed:claude-sample-english-all-types')
)
order by question_type;
