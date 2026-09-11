-- Per-family feature toggles ("4 toggle based feature" request, 11
-- September 2026): Child Health, Child Education, IT Jobs, Council Jobs
-- in the family/parent dashboard. Unlike migration 0023's app_settings
-- flags (one global on/off switch for the whole platform), these are
-- per-family - each family owner enables/disables their own family's
-- access to each feature area from FamilyDashboard.tsx's new "Family
-- features" panel (routes/families.ts's GET/PATCH /families/me/features).
--
-- This migration adds ONLY the toggle columns. The features themselves
-- (SmartClassify-style IT/Council job matching, council/public-sector
-- activity feeds - NHS/schools/nursery/library/volunteer - and child
-- health tracking) are NOT built yet and are explicitly deferred to a
-- later phase per direct user instruction ("Just add toggle right now
-- we will implement in phase 3 and phase 4, just create a dashboard
-- only"). Right now enabling child_health/it_jobs/council_jobs just
-- reveals a "coming soon" placeholder in the dashboard; only
-- child_education_enabled gates something real today (the reports/
-- activity-time view already built in FamilyDashboard.tsx's
-- ChildDetailView + the "Time in the Kingdom" metrics section).
--
-- child_education_enabled defaults true so this migration doesn't hide
-- anything already live; the other three default false so nothing new
-- appears until a family owner opts in.
alter table families add column if not exists child_education_enabled boolean not null default true;
alter table families add column if not exists child_health_enabled boolean not null default false;
alter table families add column if not exists it_jobs_enabled boolean not null default false;
alter table families add column if not exists council_jobs_enabled boolean not null default false;
