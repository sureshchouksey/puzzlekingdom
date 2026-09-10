-- Family / multi-family platform foundation (Track 7, 10 September 2026):
-- introduces a tenant boundary above profiles so that in future any family
-- can sign up and manage their own kids' profiles, independent of the
-- platform admin account. Chosen shape per user decision: multiple owners
-- per family from day one (family_owners is one-to-many against families,
-- not a single email/password column on families itself), platform admins
-- (the existing `admins` table) keep full unscoped visibility unchanged,
-- and family_id on profiles is left nullable so existing profiles keep
-- working immediately after this migration - they get adopted into a
-- family afterwards by a one-time backfill script (apps/api/scripts/
-- create-family.ts), not by this migration.
--
-- Note on isolation: the API currently connects to Postgres with a single
-- service-role connection string (DATABASE_URL), not per-request Supabase
-- Auth roles, so Postgres RLS policies would not automatically be enforced
-- here - family scoping for this phase is done in the application layer
-- (WHERE family_id = ..., matching the existing reports.ts profile-scoping
-- pattern) via routes/families.ts. RLS is a real follow-up, not build here.
create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists family_owners (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists family_owners_family_id_idx on family_owners(family_id);

-- Nullable for now: existing 13 profiles keep working with no family until
-- the backfill script adopts them into one family owned by the user.
alter table profiles add column if not exists family_id uuid references families(id);

create index if not exists profiles_family_id_idx on profiles(family_id);

-- Children's Code / UK ICO data-minimization decision (10 September
-- 2026): new sign-ups create child profiles with a nickname (the existing
-- `name` column) plus a year group, rather than a real first name -
-- year_group is free text (e.g. "Year 3") for the same reason `title` is
-- free text: it's descriptive, not a fixed enum tied to one curriculum.
-- Nullable - the existing 13 profiles (real first names) are explicitly
-- NOT retrofitted with a year group by this migration.
alter table profiles add column if not exists year_group text;
