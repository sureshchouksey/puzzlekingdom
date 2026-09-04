-- Adds a real admin account table (username + bcrypt password hash - see
-- scripts/create-admin.ts for how to create the first one) for the new
-- admin login, and makes deleting a question safe: today the
-- quiz_attempt_answers.question_id foreign key has no ON DELETE behavior,
-- so an admin trying to delete a question that's already been answered
-- would just get a foreign-key-violation error. Run this once in the
-- Supabase SQL Editor, same as 0000-0004.

create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- The original 0000_init.sql created quiz_attempt_answers.question_id with
-- an inline `references questions(id)` (no ON DELETE, no explicit
-- constraint name), so Postgres assigned its own default name rather than
-- Drizzle's naming convention. This block looks that name up instead of
-- guessing it, then replaces it with an equivalent constraint that adds
-- ON DELETE CASCADE - deleting a question now also removes any answer
-- rows that referenced it, rather than being blocked or left orphaned.
do $$
declare
  existing_constraint text;
begin
  select tc.constraint_name into existing_constraint
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_name = 'quiz_attempt_answers'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'question_id'
    and tc.table_schema = 'public';

  if existing_constraint is not null then
    execute format('alter table quiz_attempt_answers drop constraint %I', existing_constraint);
  end if;

  alter table quiz_attempt_answers
    add constraint quiz_attempt_answers_question_id_fkey
    foreign key (question_id) references questions(id) on delete cascade;
end $$;
