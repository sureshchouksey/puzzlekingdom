# MVP 1 — Content-to-Quiz Pipeline

Prepared for Suresh Chouksey — 2 September 2026

This resets planning to one concrete, buildable first step, deliberately smaller than the full Puzzle Kingdom vision in the earlier plan: no accounts, no gamification, no curriculum roadmap yet — just the core loop working end to end. Upload course content, AI turns it into a multiple-choice quiz, someone takes it, they see how they did. Everything else (child profiles, games, progress tracking, public sign-up) builds on top of this once it works.

## The loop, concretely

1. Upload a PDF or image (or several) and tag it with a subject.
2. The app stores the file and sends it to Claude, which reads it directly and generates a set of multiple-choice questions from its actual content — no separate OCR step needed, since Claude reads PDFs and images natively.
3. Those questions are validated against a strict schema and saved to the database against that subject.
4. Someone opens the app, picks a subject, and gets a quiz assembled from whatever questions exist for it.
5. They answer each question, submit, and land on a results page: score, and every question with their answer, the correct answer, and a short explanation.

## One architecture decision to confirm: Node.js or Python for the backend

My recommendation is **Node.js with TypeScript**, for one main reason: the AI does the hard part. Because Claude reads PDFs and images directly, the backend doesn't need Python's OCR/PDF-parsing libraries doing any real work — it's mostly "receive a file, call Claude, validate and store the result," which Node handles just as well. Given that, using TypeScript on both the React frontend and the Node backend means one language for the whole project, shared validation schemas between the two, and it's the stack Claude Code has the most reliable experience building in — which matters since I'll be doing most of the actual coding.

Python (FastAPI) remains a completely reasonable alternative if you'd rather work in it yourself, or expect to add real machine-learning work later that isn't just "call the Claude API." Tell me if you'd rather go that way — otherwise I'll proceed with Node.js/TypeScript.

## Stack for this step specifically

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript (Vite), a small SPA — four screens: Upload, Subject picker, Quiz, Results. Plain, functional styling for now; the Puzzle Kingdom visual design already published can be layered on once the core loop works. |
| Backend | Node.js + TypeScript, Fastify (a lean, well-typed API framework), Zod for validating both incoming requests and the AI's generated output. |
| AI | Anthropic API (Claude), called server-side with the uploaded PDF/image as a document/image content block and a tool-use call that forces the response into a strict question schema — never free text parsed after the fact. |
| Database | PostgreSQL, via Supabase (Postgres + file storage together, generous free tier) — Prisma as the ORM. |
| File storage | Supabase Storage, for the uploaded source PDFs/images. |
| Deployment | React app on Vercel or Netlify (static hosting); Fastify API on Railway or Render (a small always-on Node service — simpler to reason about than serverless for this MVP's synchronous upload→AI→save flow); database on Supabase. |

Processing happens synchronously for now — upload, wait a few seconds while Claude generates questions, then see a "ready" state — rather than a background job queue. That's the right amount of complexity for step one; a queue is worth adding once uploads are large or frequent enough that users shouldn't have to wait on the request.

## Database schema (first cut)

**subjects** — id, name. Seeded with the subjects already established (English, Maths, Science, Verbal/Non-Verbal Reasoning, Broad Knowledge), editable later.

**documents** — id, subject_id, original_filename, storage_path, mime_type, status (`uploaded` → `processing` → `ready` → `failed`), uploaded_at.

**questions** — id, document_id, subject_id, question_text, options (JSON array of `{id, text}`), correct_option_id, explanation, created_at.

**quiz_attempts** — id, subject_id, started_at, completed_at, score, total_questions.

**quiz_attempt_answers** — id, attempt_id, question_id, selected_option_id, is_correct.

This is deliberately close to what the tech-stack document already sketched for the full platform — this MVP is that document's Section 4 build sequence, made concrete, not a different design.

## What's explicitly out of scope for this step

No parent/child accounts or login — this is a single shared space for now. No gamification (XP, streaks, quest maps) — that's the visual/motivational layer from the design pass, added once there's real content to play with. No mixing games with quizzes yet — just the MCQ quiz format you asked for here. No CSSE/CCHS-specific content weighting — whatever's uploaded gets turned into questions for its tagged subject, regardless of which school track it's aimed at. All of this is still on the roadmap; it's just sequenced after the core loop is proven.

## Suggested build order

1. Database schema + Supabase project set up.
2. Upload endpoint: file in, stored, `documents` row created.
3. Generation endpoint: reads a stored document, calls Claude with the schema-constrained prompt, validates and saves `questions`, flips status to `ready`.
4. Subject picker + quiz-assembly endpoint (pick N questions for a subject).
5. Quiz-taking UI + submit-and-score endpoint.
6. Results screen, reading back the stored attempt and answers.

Each step is independently testable before the next one starts, which matters more than usual here since step 3 — the AI generation — is the one genuinely new, unproven part of the whole system.
