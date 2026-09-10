# Changelog

All notable Puzzle Kingdom releases are recorded here. From v1.0.0 onward,
`main` reflects only tagged releases - ongoing work happens on `dev`/feature
branches and lands on `main` at the next tagged release, not commit by
commit.

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
