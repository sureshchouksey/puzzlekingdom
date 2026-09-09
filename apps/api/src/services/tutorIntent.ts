import { z } from "zod";
import { env } from "../env.js";
import { getGeminiClient, isRetryableStatus } from "./providers/gemini.js";
import type { FunContentType } from "./funContent.js";

// Real NLP intent classification for the Study Buddy chat, sitting in
// front of tutorRetrieval.ts/tutorGeneration.ts - see
// plan/AI-Study-Mentor-Agent-Plan.md's "friendly chat / play a game"
// extension. Deliberately a genuine model call, not keyword/regex
// matching: this app is multi-profile (many children can be chatting at
// once, each phrasing "can we play something fun?" or "give me a hard
// one" however they like), so a fixed word list would miss real
// requests and misfire on unrelated ones far more often than a small
// classification call would. Kept as its own step (rather than folded
// into tutorGeneration.ts's existing call) because a fun-content or
// social reply should NEVER reach Gemini's generation step at all - it's
// served straight from fun_content or a template, both free and instant,
// which matters at real usage scale (Section 6's free-tier ceiling).
//
// Deliberately conservative on failure: a malformed response, a timeout,
// or Gemini itself being down (bad/expired API key included) never
// throws. It first tries a small keyword heuristic (see
// heuristicClassifyTutorIntent below) so that "give me a riddle" and
// similar still work even with Gemini fully unreachable, since the
// fun-content bank they route to is plain Postgres data with no
// dependency on Gemini at all - only a genuine academic question
// actually needs the model to be up. Anything the heuristic doesn't
// recognize falls through to "academic", which routes into the existing
// retrieval -> generation -> honest-fallback pipeline, already built to
// never break the child-facing chat (tutorGeneration.ts's own doc
// comment). A classification failure should never be the reason a real
// question goes unanswered.

export type TutorIntent =
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "fun_request"; contentType: FunContentType; subject?: "science" | "english" | "maths" }
  // The child is asking to be told the answer to whatever riddle/joke/
  // puzzle/trivia question was most recently sent - see funContent.ts's
  // formatFunContentReply, which deliberately withholds the answer from
  // the initial reply so there's something to guess. tutor.ts looks up
  // the most recent fun_content message in this conversation to know
  // which one to reveal.
  | { kind: "reveal_answer" }
  // The child appears to be answering the riddle/joke/puzzle/trivia
  // question that's still outstanding (see tutor.ts's getPendingFunContent)
  // - `correct` says whether their guess matches the pending answer,
  // judged with some tolerance for rewording/spelling. Only ever
  // classified when a pending question was actually passed to
  // classifyTutorIntent below - never invented when nothing is pending.
  | { kind: "answer_attempt"; correct: boolean }
  | { kind: "academic" };

const FUN_CONTENT_TYPES = ["tongue_twister", "riddle", "joke", "puzzle", "trivia"] as const;
const TRIVIA_SUBJECTS = ["science", "english", "maths"] as const;

const intentResultSchema = z.object({
  intent: z.enum(["greeting", "thanks", "fun_request", "reveal_answer", "answer_attempt", "academic_or_other"]),
  funContentType: z.enum(FUN_CONTENT_TYPES).optional(),
  subject: z.enum(TRIVIA_SUBJECTS).optional(),
  correct: z.boolean().optional(),
});

const INTENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["greeting", "thanks", "fun_request", "reveal_answer", "answer_attempt", "academic_or_other"],
      description:
        "greeting = hello/hi/hey and similar. thanks = thank you or appreciation. fun_request = the child " +
        "wants to play, or asked for a riddle, joke, tongue twister, puzzle/brain-teaser, or a trivia " +
        "question. reveal_answer = the child is asking to be told the answer to a riddle/joke/puzzle/" +
        "trivia question they were just asked - giving up, asking outright for the answer, saying they " +
        "don't know (NOT a guess at the answer itself). answer_attempt = the child appears to be guessing " +
        "the answer to a riddle/joke/puzzle/trivia question they were just asked - use this ONLY when the " +
        "prompt below tells you a question is currently outstanding. academic_or_other = an actual " +
        "question about their schoolwork, or anything else.",
    },
    funContentType: {
      type: "string",
      enum: FUN_CONTENT_TYPES as unknown as string[],
      description: "Only set when intent is fun_request - which kind of fun content they want.",
    },
    subject: {
      type: "string",
      enum: TRIVIA_SUBJECTS as unknown as string[],
      description:
        "Only set when intent is fun_request and funContentType is trivia - which subject, guessing " +
        "'science' if genuinely unclear.",
    },
    correct: {
      type: "boolean",
      description:
        "Only set when intent is answer_attempt - true if their guess matches the pending answer (be " +
        "generous about close wording, spelling, or a partial match of the key idea), false otherwise.",
    },
  },
  required: ["intent"],
} as const;

export interface PendingFunContent {
  promptText: string;
  answerText: string;
  // True when the very last thing said wasn't the original fun_content
  // question, but this app's own follow-up offering a hint or the answer
  // after a wrong guess (see tutor.ts's INCORRECT_GUESS_REPLIES) - changes
  // how a short reply like "yes" should be read: it's accepting that
  // offer, not attempting a fresh guess or asking something new.
  offeredReveal?: boolean;
}

// Context matters here, not just the words in isolation - "a coin" means
// nothing on its own, but is obviously an answer attempt right after
// being asked "what has a head and a tail but no body?". This is exactly
// why intent classification is a real model call rather than keyword
// matching (per this module's own doc comment above): telling apart a
// guess from a new question needs the previous turn, not just this one.
function buildPrompt(message: string, pending?: PendingFunContent): string {
  const lines = [
    "You are a fast intent classifier for a children's educational chat app (Puzzle Kingdom). " +
      "A child (roughly age 7-11) in an ongoing chat with their AI Study Buddy just sent this message:",
    `"${message}"`,
    "",
  ];
  if (pending?.offeredReveal) {
    lines.push(
      `Context: they were just asked this riddle/joke/puzzle/trivia question: "${pending.promptText}" ` +
        `(the correct answer is: "${pending.answerText}"), guessed wrong, and were just asked "want a ` +
        `hint, or should I tell you the answer?". If their reply is a short affirmative (yes/sure/ok/` +
        "please/go ahead) or otherwise asks to be told, classify it as reveal_answer. If it instead reads " +
        "as another guess at the answer, classify it as answer_attempt and judge correctness generously.",
      ""
    );
  } else if (pending) {
    lines.push(
      `Context: they were just asked this riddle/joke/puzzle/trivia question: "${pending.promptText}" ` +
        `(the correct answer is: "${pending.answerText}"). If their message reads as an attempt to answer ` +
        "it - right or wrong, even informally worded, even just a single word or short phrase - classify " +
        "it as answer_attempt and judge correctness generously (close wording, spelling, or the key idea " +
        "is enough). Only use answer_attempt for an actual guess at THIS answer - not for a request to " +
        "reveal it, a request to play something else, or a genuine, unrelated question.",
      ""
    );
  }
  lines.push(
    "Classify it using the JSON schema you've been given. A short, casual message like 'hi Sparky' " +
      "or 'can we do something fun' should NOT be treated as an academic question just because it's " +
      "short - use fun_request whenever the child seems to want to play, be entertained, or asked for " +
      "a riddle/joke/tongue twister/puzzle/trivia by name or description, even informally. Use " +
      "reveal_answer for a short give-up/'what's the answer'/'I don't know' reply that only makes sense " +
      "as a response to something just asked - not for a genuine new question."
  );
  return lines.join("\n");
}

// Keyword fallback for when the Gemini call itself fails (bad/expired
// key, quota, network, Gemini down) - used ONLY in classifyTutorIntent's
// catch block below, never as the primary path. This matters because the
// fun-content bank (riddles/jokes/tongue twisters/puzzles/trivia) lives
// entirely in Postgres - it has nothing to do with Gemini being up - so a
// Gemini outage has no real reason to also break "give me a riddle".
// Deliberately narrow and conservative: it only recognizes clear, common
// phrasings (greetings, thanks, and explicit play/riddle/joke/twister/
// puzzle/trivia requests); anything it doesn't confidently recognize
// still falls through to "academic" exactly as before, which is the
// right call for a genuine lesson question - retrieval -> generation's
// own honest TEMPLATE_FALLBACK_REPLY is still correct there. This is a
// safety net, not a replacement for the real classifier above.
const GREETING_PATTERN = /^(hi+|hello+|hey+|hiya|yo|sup|good\s?(morning|afternoon|evening))[\s!.,]*$/i;
const THANKS_PATTERN = /\b(thanks?|thank you|thx|ty)\b/i;
const RIDDLE_PATTERN = /\briddles?\b/i;
const JOKE_PATTERN = /\bjokes?\b|\bfunny\b/i;
const TWISTER_PATTERN = /\btongue\s?twisters?\b|\btwisters?\b/i;
const PUZZLE_PATTERN = /\bpuzzles?\b|\bbrain\s?teasers?\b/i;
// "trivia"/"quiz me"/"test me" as bare triggers, or an explicit request
// verb ("ask me"/"give me") plus a subject - deliberately NOT a bare
// "<subject> question" match (e.g. just "science question" anywhere in
// the text), since that would also catch a real academic ask like "I
// have a science question, how does photosynthesis work" - requiring
// "ask me"/"give me" keeps this to messages that are clearly requesting
// content, not stating they already have a question.
const TRIVIA_PATTERN = /\btrivia\b|\bquiz me\b|\btest me\b|\b(ask|give)\s+me\s+(a|an)?\s*(science|english|maths?)\b/i;
const PLAY_PATTERN = /\bplay\b|\bgame\b|\bsomething fun\b|\bbored\b|\bentertain me\b/i;
const REVEAL_PATTERN =
  /\bgive up\b|\bi give up\b|\bdon'?t know\b|\bdunno\b|\bno idea\b|\bwhat'?s the answer\b|\btell me the answer\b|\bgive me (the\s+)?answer\b|\bwhat is it\b|\breveal\b|\bi can'?t guess\b|\bidk\b/i;

// A bare "yes"/"sure"/"ok" and similar short agreement - only meaningful
// as "yes, reveal it" when we just offered a hint or the answer (see
// heuristicClassifyTutorIntent's pending.offeredReveal check below).
// Anywhere else, a bare affirmative must NOT be read as a reveal request -
// it's often just agreement to something else entirely.
const AFFIRMATIVE_PATTERN = /^(yes+|yeah+|yep+|yup+|sure|ok(ay)?|please|go ahead|tell me)[\s!.,]*$/i;

// Strips filler words/punctuation so "It's a coin!" and "a coin" and
// "COIN." all reduce to the same core text for a loose match against the
// stored answer - used only by the heuristic fallback below (the real
// classifier does this kind of generous, meaning-aware comparison itself).
function normalizeForFuzzyMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(a|an|the|it'?s|it is|is it|maybe|i think( it'?s)?|my guess is)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCorrectGuess(guess: string, answer: string): boolean {
  const normGuess = normalizeForFuzzyMatch(guess);
  const normAnswer = normalizeForFuzzyMatch(answer);
  if (normGuess.length < 2 || normAnswer.length < 2) return false;
  return normGuess === normAnswer || normAnswer.includes(normGuess) || normGuess.includes(normAnswer);
}

export function heuristicClassifyTutorIntent(message: string, pending?: PendingFunContent): TutorIntent {
  const text = message.trim();
  if (GREETING_PATTERN.test(text)) return { kind: "greeting" };
  if (THANKS_PATTERN.test(text) && text.length < 60) return { kind: "thanks" };

  // A short "yes"/"sure"/"ok" only means "reveal it" when we just asked
  // whether they want a hint or the answer - see PendingFunContent's
  // offeredReveal doc comment above for why this is gated so narrowly.
  if (pending?.offeredReveal && AFFIRMATIVE_PATTERN.test(text)) return { kind: "reveal_answer" };

  if (REVEAL_PATTERN.test(text)) return { kind: "reveal_answer" };

  if (RIDDLE_PATTERN.test(text)) return { kind: "fun_request", contentType: "riddle" };
  if (JOKE_PATTERN.test(text)) return { kind: "fun_request", contentType: "joke" };
  if (TWISTER_PATTERN.test(text)) return { kind: "fun_request", contentType: "tongue_twister" };
  if (PUZZLE_PATTERN.test(text)) return { kind: "fun_request", contentType: "puzzle" };
  if (TRIVIA_PATTERN.test(text)) {
    const subject = /science/i.test(text) ? "science" : /english/i.test(text) ? "english" : /maths?/i.test(text) ? "maths" : "science";
    return { kind: "fun_request", contentType: "trivia", subject };
  }
  // A bare "let's play"/"something fun" with no specific type named -
  // pick a random one, same spirit as fun_request without a Gemini-given
  // contentType would if it ever happened.
  if (PLAY_PATTERN.test(text)) {
    const types: FunContentType[] = ["riddle", "joke", "tongue_twister", "puzzle"];
    return { kind: "fun_request", contentType: types[Math.floor(Math.random() * types.length)] };
  }

  // Nothing else matched, but a riddle/joke/puzzle/trivia question is
  // still outstanding and this message is short enough to plausibly be a
  // one-line guess at it (rather than a real, longer lesson question) -
  // treat it as an answer attempt instead of falling through to academic.
  if (pending && text.length > 0 && text.length < 100) {
    return { kind: "answer_attempt", correct: looksLikeCorrectGuess(text, pending.answerText) };
  }

  return { kind: "academic" };
}

/**
 * One classification call, no retry loop (unlike the other Gemini
 * callers in this project) - kept intentionally low-latency, since this
 * sits in front of every message and a slow/retried classification would
 * add straight to the child's wait time for ANY reply, not just fun
 * ones. A single retryable failure (429/503) gets exactly one immediate
 * retry; anything else, or a second failure, falls back to the keyword
 * heuristic above rather than adding backoff delay here - that heuristic
 * in turn falls back to "academic" for anything it doesn't recognize,
 * which was already established as the safe default (see this module's
 * own doc comment above).
 */
export async function classifyTutorIntent(message: string, pending?: PendingFunContent): Promise<TutorIntent> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getGeminiClient().models.generateContent({
        model: env.GEMINI_TUTOR_MODEL,
        contents: [{ text: buildPrompt(message, pending) }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: INTENT_JSON_SCHEMA,
        },
      });
      const text = response.text;
      if (!text) throw new Error("Gemini returned no text for intent classification.");
      const parsed = intentResultSchema.parse(JSON.parse(text));

      if (parsed.intent === "greeting") return { kind: "greeting" };
      if (parsed.intent === "thanks") return { kind: "thanks" };
      if (parsed.intent === "reveal_answer") return { kind: "reveal_answer" };
      if (parsed.intent === "answer_attempt") return { kind: "answer_attempt", correct: parsed.correct ?? false };
      if (parsed.intent === "fun_request" && parsed.funContentType) {
        return {
          kind: "fun_request",
          contentType: parsed.funContentType,
          subject: parsed.funContentType === "trivia" ? (parsed.subject ?? "science") : undefined,
        };
      }
      return { kind: "academic" };
    } catch (err) {
      if (attempt === 0 && isRetryableStatus(err)) continue;
      console.warn("Tutor intent classification failed - falling back to keyword matching:", err);
      return heuristicClassifyTutorIntent(message, pending);
    }
  }
  return heuristicClassifyTutorIntent(message, pending);
}
