-- Adds concept_guides: the "how do you actually solve this kind of
-- problem" method/formula reference for a topic, distinct from any one
-- specific question's explanation/tip. See
-- plan/AI-Study-Mentor-Agent-Plan.md, Section 8 - this is the first piece
-- of that plan's data model, added specifically to unblock the
-- get_concept_guide MCP tool (apps/api/src/mcp-server.ts), which until now
-- was a stub with no table to query. Content itself (topic/title/
-- method_text/formula rows) is authored separately, via the
-- content-author subagent, following Section 10 step 2 of the same plan -
-- this migration only creates the empty table. Run this once in the
-- Supabase SQL Editor, same as 0000-0006.

create table if not exists concept_guides (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id),
  subject_id uuid not null references subjects(id),
  -- Matches the same free-text topic tag convention as questions.topics
  -- (see schema.ts) - not a foreign key to a fixed topic list, since
  -- topics themselves are just tag strings, not a table.
  topic text not null,
  title text not null,
  method_text text not null,
  formula text,
  created_at timestamptz not null default now()
);

-- One guide per class+subject+topic combination - content-author should
-- update an existing row rather than create a duplicate for the same
-- (class, subject, topic).
create unique index if not exists concept_guides_class_subject_topic_idx
  on concept_guides (class_id, subject_id, topic);
