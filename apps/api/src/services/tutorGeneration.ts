import { getGeminiClient, isRetryableStatus, sleep, MAX_ATTEMPTS, BACKOFF_MS } from "./providers/gemini.js";
import { env } from "../env.js";
import type { RetrievalResult, RetrievedSource } from "./tutorRetrieval.js";

// Turns a RetrievalResult (tutorRetrieval.ts, Section 10 step 3) into what
// the child actually sees - see plan/AI-Study-Mentor-Agent-Plan.md, Section
// 7 ("How a reply actually gets built", steps 3-4) and Section 10 step 4.
// This module owns exactly the generation half of that split: it never
// decides WHAT counts as a match (that's retrieval's job, already done by
// the time RetrievalResult reaches here) - it only decides HOW to turn
// already-matched content into a natural-sounding reply, or hands back an
// honest template when there's nothing to work with.
//
// The not-yet-built POST /tutor/conversations/:id/messages route (Section
// 9) is the only intended caller. It is responsible for the per-profile
// cap, the shared daily budget, and the on/off setting (Section 10 steps
// 4-5) - none of that lives here. This module assumes it's fine to make
// the call it's asked to make; the route is what decides whether to ask.
//
// Model choice: deliberately GEMINI_TUTOR_MODEL (see env.ts), NOT the
// GEMINI_MODEL used for quiz-question generation. The tutor's entire cost
// story (Section 6) depends on staying on a genuinely free tier no matter
// what model question-generation is configured to use.

export type TutorReplyMode = "ai" | "template" | "grounded";

export interface TutorReply {
  mode: TutorReplyMode;
  // Source ids actually handed to the model as grounding material for an
  // "ai" reply (every retrieved source), the single top source for a
  // "grounded" reply (see formatGroundedReply below), or empty for a
  // "template" reply. Shaped to drop straight into tutor_messages'
  // matched_source_type/matched_source_id columns once that table exists
  // (Section 8), the same way RetrievedSource already is.
  reply: string;
  groundedSourceIds: string[];
}

// The refuse-rather-than-guess fallback from Section 2, decision 1. Used
// only when retrieval found nothing relevant at all (RetrievalResult
// .matched === false) - deliberately WITHOUT calling Gemini, both because
// there's nothing real to ground a reply in, and because every skipped
// call is a call that doesn't count against the free tier's daily quota
// (Section 6). NOT used anymore when retrieval DID find something but
// Gemini itself failed - see formatGroundedReply/generateTutorReply below,
// updated 9 September 2026: a genuine match should never be thrown away
// just because there's no LLM available to rephrase it.
export const TEMPLATE_FALLBACK_REPLY =
  "I don't know about that yet! I'm still learning, and I can only really help with things " +
  "from your Puzzle Kingdom lessons and quizzes. Try asking me about something you've been " +
  "practising, or ask a grown-up if it's something else.";

// Kept deliberately short and free of persona details (Section 11's "Sage
// the Owl" name is still an open question, Section 12) - this prompt
// should keep working unchanged once a persona is chosen; the persona
// layer belongs on top of this, not inside it.
function buildSystemPrompt(): string {
  return [
    "You are Sage the Owl, the Study Buddy inside Puzzle Kingdom, an app that helps a Year 3 " +
      "child (age 7-8) revise Maths and English. You are an AI helper, not a person - but do " +
      "NOT say this unprompted, and never open a reply by introducing yourself or your name. " +
      "Only mention your name and/or that you're an AI if the child directly asks something " +
      "like 'who are you', 'what's your name', 'are you real', or 'are you a robot' - then " +
      "say so plainly and warmly, in one short sentence, before answering. Every other reply " +
      "should start straight in on the actual answer, the way a warm tutor mid-conversation " +
      "would, never with a greeting or self-introduction.",
    "",
    "You will be given REFERENCE MATERIAL taken from this child's own real lessons and " +
      "quizzes, plus the child's QUESTION. Your only job is to explain what's in the " +
      "reference material, in your own natural words, at a level a 7-8 year old can follow.",
    "",
    "Hard rules, more important than being helpful or complete:",
    "1. Only ever use facts, numbers, methods, and formulas that appear in the reference " +
      "material below. Never add a fact, example, or method from your own general knowledge, " +
      "even if you're confident it's correct.",
    "2. If the reference material only partly answers the question, explain the part it does " +
      "cover, then say plainly that you don't have more detail on the rest yet - never fill " +
      "the gap yourself.",
    "3. Never mention 'reference material', 'retrieval', a database, or that content was " +
      "'provided to you' - just answer naturally, the way a warm tutor would.",
    "",
    "Style: short sentences, one idea at a time, a concrete worked example where the " +
      "material gives you one, encouraging and never condescending. End with a small " +
      "check-in question when it fits naturally (e.g. 'Does that make sense?' or 'Want to " +
      "try one yourself?').",
    "",
    "Formatting: plain conversational sentences only, like you're talking, not writing a " +
      "worksheet. Never use markdown - no **bold**, no bullet points, no numbered lists, no " +
      "headings. If you have a few steps, say them as a short flowing sentence or two " +
      "('First add the top numbers, then keep the bottom number the same') rather than a " +
      "list.",
  ].join("\n");
}

function describeSource(source: RetrievedSource): string {
  if (source.type === "concept_guide") {
    return [
      `[Concept guide: ${source.topic} - ${source.title}]`,
      source.methodText,
      source.formula ? `Formula: ${source.formula}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `[A question this child has seen: ${source.questionText}]`,
    `Explanation: ${source.explanation}`,
    source.tip ? `Tip: ${source.tip}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// The child-facing sibling of describeSource above: describeSource labels
// a source for Gemini's own context window ("[Concept guide: ...]"),
// this formats one plainly enough to show a child directly, for when
// there's no working Gemini call to rephrase it through (see
// generateTutorReply's catch block below). Only ever called with
// retrieval.sources[0] - the single best match - matching how
// recordTutorExchange (tutorBudget.ts) already only logs the top source,
// not the full list.
function formatGroundedReply(source: RetrievedSource): string {
  if (source.type === "concept_guide") {
    return [`Here's what I know about ${source.title}:`, source.methodText, source.formula]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
  }
  return ["Here's an explanation that might help:", source.explanation, source.tip ? `Tip: ${source.tip}` : null]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function buildUserContent(queryText: string, sources: RetrievedSource[]): string {
  const material = sources.map(describeSource).join("\n\n");
  return [
    "REFERENCE MATERIAL (the only source of facts you may use):",
    material,
    "",
    `CHILD'S QUESTION: ${queryText}`,
  ].join("\n");
}

// Same retry shape as generateQuestionsWithGemini (providers/gemini.ts) -
// transient 429/503 get a couple of backed-off retries, anything else (or
// exhausted retries) is treated as a real failure by the caller below.
async function callGemini(queryText: string, sources: RetrievedSource[]): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await getGeminiClient().models.generateContent({
        model: env.GEMINI_TUTOR_MODEL,
        contents: [{ text: buildUserContent(queryText, sources) }],
        config: {
          systemInstruction: buildSystemPrompt(),
        },
      });
      const text = response.text;
      if (!text) throw new Error("Gemini returned no text for a tutor reply.");
      return text.trim();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!isRetryableStatus(err) || isLastAttempt) throw err;
      const waitMs = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.warn(
        `Gemini tutor request failed (attempt ${attempt + 1}/${MAX_ATTEMPTS}, likely temporary overload) - retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

/**
 * The one entry point this module exposes. Never throws - a Gemini failure
 * (no working API key, exhausted retries, malformed response, anything)
 * never lets a child-facing chat request 500.
 *
 * Revisited 9 September 2026: a Gemini failure used to degrade all the way
 * to TEMPLATE_FALLBACK_REPLY - the same "I don't know about that yet" line
 * as a genuine "nothing matched" - even when retrieval HAD found real,
 * relevant content (e.g. "Additions of 3 digits?" correctly matching the
 * Year 3 "Addition & Subtraction" concept guide). That's misleading: the
 * app genuinely does know something here, it just couldn't get an LLM to
 * rephrase it. Now a matched-but-Gemini-failed reply serves that real
 * content directly instead (mode: "grounded", formatGroundedReply above) -
 * still without ever calling Gemini for a genuine non-match, and still
 * never counted toward the daily cap (tutorBudget.ts's recordTutorExchange
 * only logs a countable matched_source_type for mode "ai", by design - a
 * "grounded" reply cost nothing, so it shouldn't count either). The caller
 * route (Section 9) should still log which mode was actually served, since
 * an unusually high rate of "grounded" replies is worth knowing about even
 * though the user experience stays graceful either way.
 */
export async function generateTutorReply(params: {
  queryText: string;
  retrieval: RetrievalResult;
}): Promise<TutorReply> {
  const { queryText, retrieval } = params;

  if (!retrieval.matched) {
    return { mode: "template", reply: TEMPLATE_FALLBACK_REPLY, groundedSourceIds: [] };
  }

  try {
    const reply = await callGemini(queryText, retrieval.sources);
    return {
      mode: "ai",
      reply,
      groundedSourceIds: retrieval.sources.map((s) => s.id),
    };
  } catch (err) {
    console.error(
      "Gemini tutor generation failed after retries - falling back to the matched content directly (mode: grounded):",
      err
    );
    const topSource = retrieval.sources[0];
    return { mode: "grounded", reply: formatGroundedReply(topSource), groundedSourceIds: [topSource.id] };
  }
}
