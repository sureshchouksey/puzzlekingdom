# Puzzle Kingdom — Technology Stack & Architecture

Prepared for Suresh Chouksey — 2 September 2026

This picks a concrete stack for building Puzzle Kingdom as a real, standalone application (not a Claude Artifact), sized for one person building it — largely with Claude's help — into a genuinely public product, with a content pipeline that turns uploaded or researched course material into games and MCQ mock quizzes.

---

## 1. The two content-generation asks, made concrete

Before the stack, it's worth pinning down exactly what "build games and quizzes from course content" means technically, since it drives several of the choices below.

**Parent/admin-uploaded content.** Someone uploads a source file (a worksheet, a curriculum PDF, a topic guide) tagged to a subject, year group, and topic. The system extracts its text, and an AI generation step turns it into structured content — MCQ questions, vocabulary sets, comprehension passages with questions — which lands in a review queue before it ever reaches a child. Nothing generated goes live unpublished.

**Claude-researched content.** Separately, I can research and draft baseline curriculum content myself — pulling from the UK National Curriculum (gov.uk), and the CSSE/CCHS specifics already gathered for the plan — to seed each subject and year group with real content before any parent has uploaded a single file. This runs through the exact same generate-then-review pipeline, just sourced from research instead of an upload.

**Mock quizzes are multiple-choice.** Worth flagging one nuance: the real CSSE and CCHS exams aren't multiple-choice — they involve extended writing and "show your working" maths, which the plan's Year 5–6 timed mock *papers* already account for as open-response. What you're asking for here is a different, complementary format — quick, frequent, auto-markable MCQ quizzes for everyday practice and instant feedback — which is exactly the right format for that use case; the full-length exam-realistic mock papers stay open-response later on. Both formats live in the same content pipeline, just as different question types.

That gives one shared content pipeline: **source → AI-drafted content → human review → published content bank → rendered as a game or a quiz.**

---

## 2. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | Next.js 15 (React, TypeScript, App Router) + Tailwind CSS + shadcn/ui | One framework handles the public marketing pages, the parent dashboard, and the game screens; server-side rendering helps the public pages get found and load fast on a child's phone; TypeScript end-to-end removes an entire class of bugs at the data boundary between game content and game code. |
| **Game/animation layer** | React + CSS/Framer Motion for most games; drop to a canvas library (PixiJS) only for a specific game that genuinely needs sprite-level performance | Most of the games described in the plan (matching, quest maps, word builders) are DOM-shaped, not physics-shaped — reaching for a full game engine everywhere would be over-engineering. |
| **Backend** | Next.js Route Handlers for regular app logic; Inngest for the durable background jobs (file parsing, AI content generation, review-queue processing) | Keeps everything in one deployable TypeScript codebase for the bulk of the app, while giving the content pipeline — which involves slow, retryable, multi-step AI calls — a proper durable-job system instead of fragile serverless functions timing out mid-generation. |
| **AI content generation** | Anthropic API (Claude), called server-side with structured/tool-based output validated against a schema (Zod) before anything is stored as a draft | This is the actual engine behind both content-generation asks in Section 1 — reading uploaded source material and turning National Curriculum topics into properly-typed question and game records, not free text. |
| **Database** | PostgreSQL, via Supabase | Relational fit is natural here — families → children → subjects → topics → content items → attempts — and Supabase's Row Level Security lets the database itself enforce "a family only ever sees its own children's data," which matters a lot given this holds children's personal data under the ICO's Children's Code. Supabase also bundles auth, file storage, and generous free tiers, which keeps the number of separate services you're running low. |
| **File storage** | Supabase Storage (or Cloudflare R2 if you outgrow it) | Holds uploaded source documents and any generated game media, served through a CDN. |
| **Auth** | Supabase Auth (email/password + magic link) for the parent account only; child profiles are plain database rows under the family, never separate logins | Matches the account model already decided in the plan — children never hold their own credentials. |
| **Deployment** | Vercel (frontend + backend), Supabase (database/storage/auth), Cloudflare in front for DNS and basic bot/rate-limit protection | Minimal ops for a project mostly built and maintained by one person with AI assistance; scales automatically; every pull request gets its own preview URL, which is genuinely useful for reviewing a new game or quiz type before it ships. |
| **CI/CD** | GitHub + GitHub Actions (lint, type-check, test) on every PR; Vercel's Git integration deploys previews and production automatically | Standard, low-maintenance pipeline; nothing bespoke to operate. |
| **Monitoring** | Sentry for errors; PostHog (EU-hosted) for product analytics, configured with no behavioural profiling of child users | The "no profiling children" constraint from the plan's privacy section needs to be a deliberate analytics configuration choice, not an afterthought. |
| **Email** | Resend | Parent sign-up confirmation, weekly progress digest — pairs cleanly with the rest of the stack. |

---

## 3. Why this combination specifically

**Everything is TypeScript, end to end.** One language across the game engine, the content pipeline, and the database access layer means the same types describe a question all the way from "Claude generated this" to "this child answered it," which cuts down on an entire category of content-shape bugs. It's also the stack Claude Code itself has the deepest, most reliable experience with — genuinely relevant, since most of this will be built through exactly that kind of AI-assisted development.

**Managed services over self-hosted infrastructure.** Vercel and Supabase between them cover hosting, database, auth, file storage, and backups — there's no server to patch, no Postgres instance to babysit, and both have real free tiers, so the cost stays near zero until the platform has genuine public traffic. The trade-off is less low-level control than a hand-rolled server would give you; for a project built and run by one person, that trade is worth it.

**Row Level Security earns its place here specifically.** Most projects this size wouldn't need to reach for RLS, but a public platform holding other families' children's data should enforce data isolation at the database layer, not only in application code — one missed `WHERE family_id = ...` clause in a hand-written query shouldn't be able to leak another family's child's data. Postgres/Supabase makes that a database-level guarantee.

**Durable background jobs, not fire-and-forget serverless calls.** The content pipeline genuinely needs retries and multi-step state (parse → generate → validate → await human review) — the kind of workflow that silently breaks on a plain serverless function with a timeout. Inngest (or Trigger.dev as an equally solid alternative) is built for exactly this and integrates natively with Vercel.

---

## 4. What this looks like as a build sequence

1. **Scaffold**: Next.js + TypeScript + Tailwind repo, Supabase project (Postgres + Auth + Storage), core schema (families, children, subjects, topics, content_items, attempts).
2. **Content pipeline v1**: file upload → text extraction → Claude-generated draft MCQ content → a simple internal review screen → publish. Prove this end to end with one real subject/topic before generalising it.
3. **Vertical slice** (as already planned): one working Y3 English game and one Y3 Maths game, reading from real published content rather than hardcoded questions, with scoring and progress saved to the database.
4. **Parent dashboard**, reading real progress data.
5. **Everything after** follows the phased roadmap already in the project plan — depth, then the multi-family public platform, then launch.

---

## 5. Alternatives considered, briefly

A single Python/FastAPI backend was considered given how AI-content-pipeline-heavy this project is, but was set aside in favour of TypeScript throughout — the content generation calls are just API calls either way, and splitting the stack across two languages adds real coordination cost for a solo-built project without a clear matching benefit here.

A fully custom Node/Express backend on Railway or Fly.io (instead of Supabase) was considered for more infrastructure control, and remains a reasonable fallback if you outgrow Supabase's limits later — but it means running and securing your own auth and file storage, which isn't worth taking on until there's a concrete reason to.
