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
  | { kind: "academic" };

const FUN_CONTENT_TYPES = ["tongue_twister", "riddle", "joke", "puzzle", "trivia"] as const;
const TRIVIA_SUBJECTS = ["science", "english", "maths"] as const;

const intentResultSchema = z.object({
  intent: z.enum(["greeting", "thanks", "fun_request", "reveal_answer", "academic_or_other"]),
  funContentType: z.enum(FUN_CONTENT_TYPES).optional(),
  subject: z.enum(TRIVIA_SUBJECTS).optional(),
});

const INTENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["greeting", "thanks", "fun_request", "reveal_answer", "academic_or_other"],
      description:
        "greeting = hello/hi/hey and similar. thanks = thank you or appreciation. fun_request = the child " +
        "wants to play, or asked for a riddle, joke, tongue twister, puzzle/brain-teaser, or a trivia " +
        "question. reveal_answer = the child is responding to a riddle/joke/puzzle/trivia question they " +
        "were just asked - giving up, asking for the answer, saying they don't know, or similar (NOT a " +
        "guess at the answer itself, and not used unless a riddle/joke/puzzle/trivia question was just " +
        "asked). academic_or_other = an actual question about their schoolwork, or anything else.",
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
  },
  required: ["intent"],
} as const;

function buildPrompt(message: string): string {
  return [
    "You are a fast intent classifier for a children's educational chat app (Puzzle Kingdom). " +
      "A child (roughly age 7-11) in an ongoing chat with their AI Study Buddy just sent this message:",
    `"${message}"`,
    "",
    "Classify it using the JSON schema you've been given. A short, casual message like 'hi Sparky' " +
      "or 'can we do something fun' should NOT be treated as an academic question just because it's " +
      "short - use fun_request whenever the child seems to want to play, be entertained, or asked for " +
      "a riddle/joke/tongue twister/puzzle/trivia by name or description, even informally. Use " +
      "reveal_answer for a short give-up/'what's the answer'/'I don't know' reply that only makes sense " +
      "as a response to something just asked - not for a genuine new question.",
  ].join("\n");
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
const TRIVIA_PATTERN = /\btrivia\b|\bquiz me\b/i;
const PLAY_PATTERN = /\bplay\b|\bgame\b|\bsomething fun\b|\bbored\b|\bentertain me\b/i;
const REVEAL_PATTERN = /\bgive up\b|\bi give up\b|\bdon'?t know\b|\bdunno\b|\bno idea\b|\bwhat'?s the answer\b|\btell me the answer\b|\bwhat is it\b|\breveal\b|\bi can'?t guess\b|\bidk\b/i;

function heuristicClassifyTutorIntent(message: string): TutorIntent {
  const text = message.trim();
  if (GREETING_PATTERN.test(text)) return { kind: "greeting" };
  if (THANKS_PATTERN.test(text) && text.length < 60) return { kind: "thanks" };
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
export async function classifyTutorIntent(message: string): Promise<TutorIntent> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getGeminiClient().models.generateContent({
        model: env.GEMINI_TUTOR_MODEL,
        contents: [{ text: buildPrompt(message) }],
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
      return heuristicClassifyTutorIntent(message);
    }
  }
  return heuristicClassifyTutorIntent(message);
}
