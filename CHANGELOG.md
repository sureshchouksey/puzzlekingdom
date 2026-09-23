# Changelog

All notable Puzzle Kingdom releases are recorded here. From v1.0.0 onward,
`main` reflects only tagged releases - ongoing work happens on `dev`/feature
branches and lands on `main` at the next tagged release, not commit by
commit.

## v1.0.12 - 23 September 2026

Everything built on `dev` since v1.0.11, commit `95f9fce`.

### Certification Prep: Module 2 Arcade games

- Enterprise Integration & Production (Module 2) previously had no
  Arcade games at all - only Module 1 (Claude Platform & Solution
  Design) did. Added one game per real section (Evals, POC to Prod,
  Sizing, Integration, A/B & Obs) plus a Module 2 Mix, 6 games total,
  same shape as Module 1's 10.
- `certCourseInfo.ts` now lists Module 2's 5 real sub-topics (it
  previously held only the module's own flat topic), so the Quest map
  and Topic Practice group Module 2 into one node the same way Module 1
  already does, instead of leaving it as a single undifferentiated
  topic.
- Content: 24 new original questions (mcq, true/false, match_column,
  categorize), grounded in Anthropic's public documentation, not the
  paid certification course - same provenance discipline the
  20 September copyright audit established for this feature. See
  `claude-certified-architect-professional-module2-sections-source-note.txt`.

## v1.0.11 - 21 September 2026

Everything built on `dev` since v1.0.10, commit `341b970`.

### Topic Practice redesign

- Topic Practice's card list was a plain icon-and-button row with no
  mastery signal at all - every card looked the same whether a topic
  had never been opened or was already aced, unlike Quest's much
  richer path of glowing badges, stars and progress fills right next
  to it.
- Topic Practice now fetches the same `topicReports` data Quest and
  Reports already chart (previously Quest-only) and shows real
  accuracy on every card: a jewel-filled, glowing badge with a
  checkmark once a topic clears the same 70% mastery bar Quest uses, a
  star row + live percentage, and a fill bar underneath.
- Added a "topics mastered" summary progress bar above the grid,
  matching Quest's own header pattern.
- Mixed practice keeps a permanently floating, glowing gold badge - the
  same treatment Quest gives its always-unlocked "current" node - so it
  still reads as the one stand-out action among the topic cards.
- Cards stagger in with the same per-index animation delay Quest's path
  nodes use, with a subtle lift on hover.

## v1.0.10 - 20 September 2026

Everything built on `dev` since v1.0.9, commits `f2edca0`..`032fea5`.

### Certification Prep content fixes

- Fixed a missing-space rendering bug in `CertPrepHub.tsx`'s content
  summary ("...to coverClaude Certified...") caused by a JSX line break
  swallowing the space between a text node and the next expression.
- Removed the "Topics you can practice here" pills section from
  `CertPrepHub.tsx`, which was listing the 10 granular DB sub-topics
  that make up course module 1 as if they were standalone topics,
  alongside the 5 real course modules already shown above it.

### Quest map & Topic Practice grouped by course module

- Certification Prep's Quest map and Topic Practice were both building
  one node/card per raw database topic tag (15, for "Claude Certified
  Architect - Professional") instead of the 5 real course modules shown
  in the Content section - module 1's 10 granular sub-topics (Platform
  Map & Primitives, Pattern Selection, RAG Pipeline Design, and so on)
  were each showing up as their own quest node and practice card.
- `certCourseInfo.ts`'s `CourseModule` now lists every real DB topic tag
  that belongs to each module; module 1 folds in its 10 sub-topics plus
  2 ambiguous ones confirmed with the user, modules 2-5 stay
  single-topic.
- `POST /quizzes` gains an optional `topics` array filter
  (array-overlap match) alongside the existing single `topic`, which
  keeps being the value stored on `quizAttempts.topic` - so
  resume/in-progress/reporting needed zero changes.
- Both `SubjectPicker.tsx`'s Quest map and its Topic Practice card list
  now build from the same module-grouped list; a grouped node/card
  starts one combined quiz across all of that module's underlying
  topics, with accuracy shown as a weighted average across them.
  `Results.tsx`'s "next quest" carries the same grouping through.
- Topic Practice, Arcade, and every non-Certification-Prep subject are
  unaffected - this only changes how Quest and Topic Practice group
  nodes/cards for subjects that have course module info.

## v1.0.9 - 20 September 2026

Everything built on `dev` since v1.0.8, commit `051183b`.

### Legal & copyright production audit

- Added a root `LICENSE` (proprietary/all-rights-reserved) and marked
  every workspace `package.json` as `"license": "UNLICENSED"`.
- Added a real Privacy Policy and Terms of Service, reachable both
  pre-passcode (from the Gate screen) and post-login (from Welcome's new
  footer) - see `plan/Legal-and-Copyright-Production-Audit.md` for the
  full audit trail.
- Added a persistent "not affiliated with, endorsed by, or sponsored by
  Anthropic" disclaimer wherever Certification Prep content appears.
- Replaced 8 unlicensed/unknown-provenance stock avatar images with
  original hand-authored SVG portraits; the originals are archived
  locally (gitignored), not deleted.
- Rewrote every place Certification Prep content described itself as
  "drawn from" or "authored from" Anthropic's own official course
  material - it's independently written to cover the same public
  topics, and now says so accurately everywhere, including in
  `CertPrepHub.tsx`'s content summary.
- Removed two categories of copyrighted/paywalled content from the live
  database (not just this repo): the CSSE-derived "11+ Grammar Prep"
  class, and 14 questions + 24 flashcards that had been built around
  gated Anthropic Skilljar course detail rather than public
  documentation.

### Certification Prep: flashcards & mock test

- A new `flashcards` table (migration 0028) and `GET /flashcards`
  route; front/back study cards, subject-scoped and optionally
  topic-tagged, seeded via a new `seed-flashcards` CLI.
- A new `is_owner_profile` flag (migration 0028) lets a family owner
  study through the same profile/quiz engine their kids use, without
  showing up as a child on the family dashboard.
- A new `categorize` question type (migration 0029): sort several items
  into a small set of shared named buckets - genuinely different from
  `match_column`'s strict 1:1 pairing.
- `CertPrepHub.tsx` reworked into a two-step flow (choose a
  certification once, then a hub with Content/Exam details and all four
  actions already scoped to it) instead of re-asking on every
  downstream screen.
- A new timed Mock Test flow (`MockTest.tsx` / `MockExamResults.tsx`):
  assembles every seeded question for a certification into one
  full-length, real-exam-paced run, graded once at the end rather than
  staged like a normal quiz.
- New `apps/web/src/data/certExamInfo.ts` and `certCourseInfo.ts`:
  reference exam logistics (from an independent third-party study
  guide, clearly disclaimed as non-official) and the real Anthropic
  course's own public module breakdown, both keyed by certification.

## v1.0.8 - 11 September 2026

Everything built on `dev` since v1.0.7, commit `739f084`.

### Activity time tracking (family & admin metrics dashboards)

- New `activity_heartbeats` table (migration 0026) recording a ~30s
  server-side ping while a child has Quiz, Arcade, Study Buddy, or the
  subject picker open and foregrounded - the Page Visibility API pauses
  pings when the tab is backgrounded, so idle time isn't counted.
- New `GET /metrics/family/summary` (family-owner scoped) and
  `GET /metrics/admin/overview` (platform-wide) routes, both with
  day/week/month rolling-window views.
- A new "Time in the Kingdom" section on the family dashboard, and a new
  Metrics tab on the admin dashboard.
- Also includes migration 0027 (per-family feature toggles).

### Admin Questions tab

- A live total-question-count for whatever class/subject/topic/search
  filter is currently selected, so newly seeded content can be validated
  right in the admin console instead of via SQL. `GET /admin/questions`
  now returns `totalCount` alongside its page of results.

### Welcome screen

- Fixed a real production complaint: the name/PIN submit button used to
  just show "..." for up to a minute during a Render free-tier cold
  start, reading as frozen. A new "Waking up the kingdom..." message now
  appears if the request is still pending after 3.5s.

### Content

- Year 3 Verbal Reasoning, Non-Verbal Reasoning, and Religion (300
  questions), the last two Year 4 subjects (Science, English), and Year
  5 Maths and English were validated, converted to seed JSON, and
  seeded to the live database (data only - not part of this repo).

## v1.0.7 - 11 September 2026

Everything built on `dev` since v1.0.6, up to and including commit
`f082153` (the Vercel rewrite config).

### Track 7: family accounts

- Any family can now sign up and log in independently of the single
  shared platform-admin account: `families`/`family_owners` tables, one
  or more parent/guardian owners per family from day one, and every
  `/families/me/*` route scoped to the caller's own family only
  (application-layer isolation for now, not Postgres RLS - a documented,
  deliberate deferral, not an oversight).
- A family owner logs in or signs up with a 4-digit PIN - the same
  keypad weight as a child profile's own login, not a password - from a
  single "Parent dashboard" entry point on Welcome. That one screen
  decides client-side whether a typed identifier is a family owner's
  email (PIN login/signup) or the platform admin's username (unchanged
  password login), so there's no separate "Family login" link anymore
  and no new lookup endpoint.
- A family dashboard lists just that family's own children, with an
  "add a child" flow and PIN entry to actually play as one. A
  family-created child can also log straight in from Welcome's own name
  flow afterward, same as any other profile.
- A one-time CLI (`create-family`) creates or resets a family owner's
  PIN and backfills any existing profile with no family into one - used
  to bring this app's original 13 profiles under a single family.

### Feature flags & admin dashboard

- A master Arcade on/off switch, one toggle per Arcade game, and a
  separate Study Buddy fun-content toggle, all managed from a new admin
  Features tab and enforced on both the backend (a disabled feature
  403s or declines, not just hides) and the frontend.
- Fixed: admin delete/reset confirmations that were silently doing
  nothing in some browser contexts, replaced with a real in-app confirm
  dialog; fixed a delete-ordering bug that 500'd when deleting a profile
  with a Study Buddy conversation linked to one of its own quiz
  attempts; added a "Clear" action for stale Study Buddy growth-insight
  rows.
- Manual question upload ("I already have questions") now supports all
  8 question types, not just multiple choice, sharing the same
  type-aware authoring UI and validation the admin Questions tab
  already used.

### Ops

- A Vercel rewrite config so a direct load or refresh on a client-side
  route (e.g. `/admin`) doesn't 404.

## v1.0.0 - 10 September 2026

The first tagged release. Everything built up to and including commit
`a24d7be` (Study Buddy's real-question chat quiz game).

### Core quiz experience

- Class -> Subject -> Quest Journey / Topic Practice quiz flow, with
  resumable attempts and multi-question "stages" (5 questions per stage by
  default, 70% pass cutoff per stage).
- AI-assisted and manual content authoring: upload a document, generate
  multiple-choice questions via Gemini or Claude with real cost estimates
  before generating, or enter questions by hand.
- Reading-passage support for comprehension-style content.
- Shuffled answer options per attempt, so the same question doesn't always
  show its options in the same order.
- Mid-quiz stage report and a Results screen with a topic-by-topic
  breakdown, plus a tip and explanation on every wrong answer.
- Quest map: a per-subject topic timeline with locked/current/completed
  nodes, world names, a 4-star band, total stars earned, a world switcher,
  and a castle-style final node.
- Multi-user named profiles with PIN-based private sessions.
- Private per-profile Reports/My Progress (scoped to your own profile
  only) alongside a fully public Leaderboard, ranked by total stars
  earned.
- A real admin role (username/password, stored in the database) for
  creating, editing, and deleting subjects/topics/questions and viewing
  every profile's stats; content upload/generation now lives behind
  admin login rather than being open on the Home screen.
- A Parent dashboard.
- A shared family passcode gate in front of the whole deployed app.

### AI Study Buddy (chat tutor)

- Curriculum-grounded Q&A chat, scoped to the child's own class and
  subject, retrieval-based (concept guides + real questions) before ever
  calling Gemini for a fresh answer.
- An "Explain this to me" entry point straight from a wrong quiz answer.
- Friendly, NLP-driven fun content in chat: riddles, jokes, tongue
  twisters, puzzles, and subject trivia, each with hints and a
  reveal-the-answer flow.
- **New in this release**: a real-question chat quiz game. Ask Study
  Buddy to quiz you (a "Quiz me!" chip, or just ask) and it serves a real
  question from the actual question bank, scoped to whichever class and
  subject the chat is already in. Answer by typing the letter or the
  answer itself - checked deterministically (no Gemini call needed),
  with hints and answer-reveal on request. Deliberately a separate
  practice mode: it never affects real stars, the quest map, or the
  leaderboard.
- Local, Gemini-free arithmetic evaluation for a bare sum typed straight
  into chat (e.g. "25 + 20").
- Graceful degradation whenever Gemini itself is unavailable: a matched
  concept guide or question is served directly instead of an unhelpful
  "I don't know," and intent classification falls back to keyword
  matching rather than breaking the chat.
- Progress-aware greetings and parent-facing growth insights.
- A daily per-profile message cap and an admin on/off toggle for the
  whole tutor - cost-focused, so only real Gemini-answered exchanges
  count against the cap.

### Design & UI

- A full visual redesign across every screen (Welcome, PIN entry, Home,
  Class/Subject pickers, Quiz, Results, Leaderboard, Study Buddy,
  Reports, Admin, Parent dashboard) to a consistent night-sky/gold
  identity, built on Tailwind v4 + shadcn/ui.
- Ten avatar choices (five Prince, five Princess) to play as.
- Mobile-first refinements, including a one-question-at-a-time quiz flow
  on small screens.
