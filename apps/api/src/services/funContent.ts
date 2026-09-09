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
  };
}

/** Formats one fun_content row as a chat-ready reply string. */
export function formatFunContentReply(item: FunContentItem): string {
  const labels: Record<FunContentType, { emoji: string; label: string }> = {
    tongue_twister: { emoji: "👅", label: "Tongue twister" },
    riddle: { emoji: "🧠", label: "Riddle" },
    joke: { emoji: "😄", label: "Joke" },
    puzzle: { emoji: "🧩", label: "Puzzle" },
    trivia: { emoji: "🔎", label: "Quick question" },
  };
  const { emoji, label } = labels[item.contentType];
  let reply = `${emoji} ${label} time! ${item.promptText}`;
  if (item.answerText) {
    reply += `\n\n(When you're ready... ${item.answerText})`;
  }
  return reply;
}
