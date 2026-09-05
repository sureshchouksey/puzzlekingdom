-- Section 10 step 8, plan/AI-Study-Mentor-Agent-Plan.md: distilled,
-- parent-facing summaries of what a profile's been asking their Study
-- Buddy about, one row per (profile, topic) - see tutorInsights.ts for
-- how these actually get generated (admin-triggered, not on a schedule).
-- Cascades on profile deletion, same convention as tutor_conversations.
create table if not exists tutor_growth_insights (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  topic text not null,
  insight_text text not null,
  generated_at timestamptz not null default now()
);

-- Regenerating overwrites the same topic's insight rather than piling up
-- duplicates over time - same "unique index makes upsert the natural
-- shape" pattern as concept_guides' (class_id, subject_id, topic) index.
create unique index if not exists tutor_growth_insights_profile_topic_idx
  on tutor_growth_insights (profile_id, topic);
