# Puzzle Kingdom

Upload course content (a PDF or an image), Claude reads it directly and generates a multiple-choice quiz from it, pick a subject and take the quiz, then see your results with every answer alongside the correct one.

This is **MVP 1** of a larger plan — see `docs/PLAN.md` for exactly what's in and out of scope for this step, and `docs/TECH-STACK.md` for the full architecture reasoning.

## Monorepo layout

- `apps/web` - React + TypeScript frontend (Vite)
- `apps/api` - Node.js + TypeScript backend (Fastify)

## Stack

Frontend: React, TypeScript, Vite.
Backend: Node.js, TypeScript, Fastify, Zod.
AI: Anthropic API (Claude) - reads uploaded PDFs/images directly, generates schema-validated quiz questions.
Database: PostgreSQL via Supabase, accessed with Prisma.
File storage: Supabase Storage.

## Getting started

Requires Node.js 20+ and a Supabase project.

```bash
npm install

# copy and fill in each app's env file
cp apps/api/.env.example apps/api/.env

npm run dev:api   # starts the API on http://localhost:3001
npm run dev:web   # starts the web app on http://localhost:5173
```

## Status

Early scaffold - the upload -> AI-generate -> quiz -> results loop described in `docs/PLAN.md` is being built one step at a time; see that document's "Suggested build order" for what's next.
