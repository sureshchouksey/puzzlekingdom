-- Distinguishes a family owner's own study profile (used for the
-- Certification Prep feature - reuses the exact same profile/quiz engine
-- children use, per plan/Puzzle-Kingdom-Master-Roadmap.md's 18 September
-- update) from a real child profile. Never surfaced in
-- GET /families/me/profiles (the children grid on FamilyDashboard.tsx) -
-- see families.ts's updated query.
alter table profiles add column if not exists is_owner_profile boolean not null default false;

-- Simple front/back study cards, subject-scoped (and optionally
-- topic-tagged) - deliberately separate from `questions` rather than
-- forcing a flip-card interaction into the MCQ-shaped scoring engine.
-- Seeded via apps/api/scripts/seed-flashcards.ts, same CLI convention as
-- seed-questions.ts.
create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id),
  topic text,
  front text not null,
  back text not null,
  created_at timestamptz not null default now()
);

create index if not exists flashcards_subject_id_idx on flashcards (subject_id);
