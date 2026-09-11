# Changelog

All notable Puzzle Kingdom releases are recorded here. From v1.0.0 onward,
`main` reflects only tagged releases - ongoing work happens on `dev`/feature
branches and lands on `main` at the next tagged release, not commit by
commit.

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
