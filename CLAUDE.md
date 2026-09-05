# Puzzle Kingdom

Upload course content, get an AI-generated multiple-choice quiz, see your results.
Full plan: docs/PLAN.md. Stack rationale: docs/TECH-STACK.md.

## Commands

Run from repo root unless noted:
- `npm run dev:web` — start the web app (Vite dev server)
- `npm run dev:api` — start the API (Fastify, via tsx watch)
- `npm run build` — build all workspaces

From `apps/api`:
- `npm run db:generate` — generate a Drizzle migration from schema changes
- `npm run db:push` — push schema to the database
- `npm run seed:questions` — seed sample questions
- `npm run create-admin` — create an admin user
- `npm run test:e2e` / `test:quiz` / `test:privacy` / `test:estimate` / `test:manual` — ad-hoc manual test scripts (not a test runner — there's no `npm test`)
- `npm run backfill:class-topics` / `backfill:tips` — one-off data backfills
- `npm run validate:tips` — validation script

## Architecture

- npm workspaces monorepo: `apps/web` (React + Vite) and `apps/api` (Fastify).
- **Database is Drizzle ORM, not Prisma** — Prisma was tried first but its native query-engine binary download is blocked on this network (see docs/PLAN.md). Schema: `apps/api/src/db/schema.ts`. Migrations: `apps/api/drizzle/`.
- API routes live one-file-per-resource in `apps/api/src/routes/`: subjects, classes, documents, quizzes, reports, profiles, leaderboard, admin. All registered in `apps/api/src/index.ts`.
- AI provider is pluggable (`AI_PROVIDER` env var, `claude` default or `gemini`) — only the matching provider's API key is required (`ANTHROPIC_API_KEY` or `GEMINI_API_KEY` + `GEMINI_MODEL`), enforced in `apps/api/src/env.ts`. `JWT_SECRET` is always required (signs profile/admin session tokens), unlike the optional `APP_PASSCODE`.
- Two layers of access control on the API (see `index.ts` comments): a shared `x-app-passcode` header gate (`APP_PASSCODE` env var, no-op if unset locally, but set in the Render production deployment — see `render.yaml`) in front of everything except `/health`, and real per-user sessions (profile or admin) layered on top via `auth.ts` — most routes don't require a logged-in caller.
- **Fastify hook scoping**: an `addHook("preHandler", requireAdmin)` applies to every route in its *encapsulation context*, regardless of source order — not just routes declared after it. Admin routes wrap the protected ones in a nested `app.register(async (protectedApp) => { ... })` specifically so `/admin/login` (declared in the outer, unprotected context) doesn't get caught by the same hook it needs to bypass to issue a token in the first place. Follow this pattern for any new route group that needs a hook to exempt its own entry point.
- `profiles` are lightweight named players (no password, optional 4-digit PIN) — not real accounts. `admins` are real username/password accounts, the only ones that can create/edit/delete questions and see all users' data.
- Web screens live in `apps/web/src/screens/` (Welcome, Home, ClassPicker, SubjectPicker, Quiz, Results, Reports, Leaderboard, AdminLogin, AdminDashboard, Upload, Gate, Layout). `App.tsx` switches between them via a `Screen` union type — no router library.
- Content model: classes → subjects → documents → questions; quiz_attempts → quiz_attempt_answers.
- `docs/Year3 content/`, `docs/Year 4 Content/`, and `docs/official-papers/` hold real sample curriculum/past-paper files (PDF/DOCX) used as test input for the upload → AI-generate-questions pipeline, plus their `generated/` subfolders with the actual AI output for reference.

## Conventions

- Web: plain inline styles, no CSS framework.
- New screens: add to the `Screen` union type and the switch in `App.tsx`.
- AI generation output is always validated against a strict schema before being saved (Zod) — never free text parsed after the fact.

## Gotchas

- A known npm/rollup optional-dependency bug can break `apps/web`'s dev server (`Cannot find module @rollup/rollup-darwin-arm64`). Fix: `rm -rf node_modules package-lock.json && npm install` (from repo root).
- `apps/web/vite.config.ts` binds to `host: true` (all network interfaces) so other devices on the same Wi-Fi (phone, iPad) can hit the dev server — not just localhost.
- `render.yaml` is the **active** Render.com Blueprint for deploying `apps/api` (`npm install && npm run build -w apps/api`, then `npm run start:prod -w apps/api`) — secrets (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `SUPABASE_*`, `APP_PASSCODE`) are `sync: false` and must be pasted into the Render dashboard by hand; Render won't read them from the repo.
- **Script working directory**: scripts under `apps/api/scripts/` that resolve project paths (e.g. `docs/official-papers/generated`) use `process.env.INIT_CWD ?? process.cwd()`, not a path relative to the script's own folder — `INIT_CWD` is what npm sets to the directory `npm run` was actually invoked from, which may differ from the script's location. Any new script that resolves repo-relative paths should follow the same pattern.
- **Supabase SQL Editor**: paste and run one SQL statement at a time — a migration file with multiple statements pasted and run together doesn't reliably execute as expected there.

## Legal / data handling

- `docs/official-papers/` holds copyrighted CSSE past papers (gitignored, never committed, never served raw to anyone — including any future tutor-facing feature). Only content already *derived* from them (generated questions/explanations, already stored in the database) is fair game to use or serve.
- `docs/Year3 content/` and `docs/Year 4 Content/` are the user's own original material (not copyrighted like CSSE's) but also stay gitignored/local-only by choice — the questions generated from them are already seeded into the live Supabase database, so the deployed app doesn't need these files present.

## Hard rules

Can't be done from this sandbox — hand these back to the user's own real terminal:
- Any command touching Supabase directly (it can't authenticate here).
- `git push` / `git fetch` to GitHub (same reason).

Ask before doing, even though technically possible:
- Editing files under `apps/api/drizzle/` (generated migrations) directly.
- Committing `.env` or anything under it.
- Pushing to `main` or force-pushing (when run from the user's terminal on their behalf).