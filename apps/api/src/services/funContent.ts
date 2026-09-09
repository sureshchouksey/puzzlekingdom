import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { funContent } from "../db/schema.js";

// The playful counterpart to tutorRetrieval.ts's curriculum retrieval -
// see migration 0013 and plan/AI-Study-Mentor-Agent-Plan.md's "friendly
// chat / play a game" extension. Deliberately NOT retrieval-ranked like
// concept_guides/questions: fun_content is a small, hand-curated,
// already-reviewed bank (scripts/seed-fun-content.ts), so once
// tutorIntent.ts has decided the child wants a riddle/joke/twister/
// puzzle/trivia question, any row of that type is a valid answer - a
// genuinely random pick is what makes repeat requests feel fresh rather
// than deterministic.

export type FunContentType = "tongue_twister" | "riddle" | "joke" | "puzzle" | "trivia";

export interface FunContentItem {
  id: string;
  contentType: FunContentType;
  subject: string | null;
  promptText: string;
  answerText: string | null;
  // A gentle nudge toward the answer - see formatFunContentHint below.
  // Null for tongue twisters and for any answerable item that hasn't
  // been given one yet (migration 0015).
  hintText: string | null;
}

/**
 * Picks one random row of the given type (and, for 'trivia', the given
 * subject if provided). Returns null only if the table genuinely has no
 * matching row yet (e.g. seed-fun-content.ts hasn't been run) - the
 * caller (tutor.ts) is expected to degrade gracefully rather than treat
 * this as an error, the same "never break the child-facing chat"
 * philosophy tutorGeneration.ts already follows for a Gemini failure.
 *
 * Uses Postgres's own `order by random()` rather than fetching every
 * matching row into Node and picking client-side - fine at this table's
 * size (a few dozen rows), and keeps the random pick correct even if the
 * table grows, without needing to revisit this later the way
 * tutorRetrieval.ts's own module comment flags for to_tsvector().
 */
export async function getRandomFunContent(params: {
  contentType: FunContentType;
  subject?: string | null;
}): Promise<FunContentItem | null> {
  const { contentType, subject } = params;

  const conditions = [eq(funContent.contentType, contentType)];
  if (subject) conditions.push(eq(funContent.subject, subject));

  const [row] = await db
    .select()
    .from(funContent)
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    contentType: row.contentType as FunContentType,
    subject: row.subject,
    promptText: row.promptText,
    answerText: row.answerText,
    hintText: row.hintText,
  };
}

/** Looks up one fun_content row by id - used to reveal the answer to
 * whichever riddle/joke/puzzle/trivia question was most recently sent in
 * a conversation (see tutor.ts's "reveal_answer" handling), once the
 * child asks for it rather than having it shown right away. Returns null
 * if the id doesn't exist (should be rare - it only ever comes from a
 * matched_source_id this same module wrote), same graceful-degrade
 * contract as getRandomFunContent above. */
export async function getFunContentById(id: string): Promise<FunContentItem | null> {
  const [row] = await db.select().from(funContent).where(eq(funContent.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    contentType: row.contentType as FunContentType,
    subject: row.subject,
    promptText: row.promptText,
    answerText: row.answerText,
    hintText: row.hintText,
  };
}

const CONTENT_LABELS: Record<FunContentType, { emoji: string; label: string }> = {
  tongue_twister: { emoji: "👅", label: "Tongue twister" },
  riddle: { emoji: "🧠", label: "Riddle" },
  joke: { emoji: "😄", label: "Joke" },
  puzzle: { emoji: "🧩", label: "Puzzle" },
  trivia: { emoji: "🔎", label: "Quick question" },
};

/**
 * Formats one fun_content row as a chat-ready reply string - the
 * question/prompt only, deliberately WITHOUT the answer. Showing a
 * riddle/joke/puzzle/trivia question and its answer in the very same
 * message defeats the point of asking - a child should get a real chance
 * to guess first. The answer is only ever sent later, in response to a
 * "reveal_answer" intent (see tutorIntent.ts/formatFunContentAnswer
 * below), which looks up this same row by the matched_source_id this
 * reply gets recorded under.
 */
export function formatFunContentReply(item: FunContentItem): string {
  const { emoji, label } = CONTENT_LABELS[item.contentType];
  if (!item.answerText) {
    // Tongue twisters have no answer to guess - nothing to hold back.
    return `${emoji} ${label} time! ${item.promptText}`;
  }
  return `${emoji} ${label} time! ${item.promptText}\n\nTake a guess - or just ask me for the answer if you get stuck!`;
}

/** Formats the answer reveal for one fun_content row, once the child asks
 * for it - see formatFunContentReply's doc comment above for why the two
 * are kept separate. */
export function formatFunContentAnswer(item: FunContentItem): string {
  if (!item.answerText) {
    return "That one doesn't have an answer to reveal - it was just for fun! Want another?";
  }
  return `The answer is... ${item.answerText}`;
}

/** Formats a hint for one fun_content row, once the child asks for one
 * instead of the full answer (see tutorIntent.ts's hint_request intent
 * and tutor.ts's own doc comment on why this is kept distinct from
 * formatFunContentAnswer above - a hint should nudge, not give it away).
 * Two different "nothing to give" cases, same distinction
 * formatFunContentAnswer already draws: an item with no answerText at
 * all (e.g. a tongue twister) genuinely has nothing to hint OR reveal -
 * offering "tell you the answer instead" there would be a promise this
 * app can't keep. An item that DOES have an answer but just hasn't been
 * given a hintText yet (migration 0015 added the column to an existing
 * table, so older/not-yet-updated rows can still be null) is the one
 * case where falling back to offering the full answer makes sense. */
export function formatFunContentHint(item: FunContentItem): string {
  if (!item.answerText) {
    return "That one doesn't have a hint or an answer - it was just for fun! Want another?";
  }
  if (!item.hintText) {
    return "I don't have a hint saved for that one yet - want me to just tell you the answer instead?";
  }
  return `Here's a hint: ${item.hintText}`;
}
