-- Puzzle Kingdom — MVP1 initial schema
-- Matches apps/api/src/db/schema.ts exactly.
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).

create extension if not exists "pgcrypto";

create type document_status as enum ('uploaded', 'processing', 'ready', 'failed');

create table subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id),
  original_filename text not null,
  storage_path text not null,
  mime_type text not null,
  status document_status not null default 'uploaded',
  failure_reason text,
  uploaded_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  subject_id uuid not null references subjects(id),
  question_text text not null,
  options jsonb not null,
  correct_option_id text not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  score integer,
  total_questions integer not null
);

create table quiz_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references quiz_attempts(id),
  question_id uuid not null references questions(id),
  selected_option_id text not null,
  is_correct boolean not null
);

create index documents_subject_id_idx on documents(subject_id);
create index questions_document_id_idx on questions(document_id);
create index questions_subject_id_idx on questions(subject_id);
create index quiz_attempts_subject_id_idx on quiz_attempts(subject_id);
create index quiz_attempt_answers_attempt_id_idx on quiz_attempt_answers(attempt_id);
create index quiz_attempt_answers_question_id_idx on quiz_attempt_answers(question_id);

-- Seed the subjects already established in the project plan
insert into subjects (name) values
  ('English'),
  ('Maths'),
  ('Science'),
  ('Verbal Reasoning'),
  ('Non-Verbal Reasoning'),
  ('Broad Knowledge');
