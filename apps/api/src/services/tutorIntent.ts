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
// or Gemini itself being down all degrade to "academic" rather than
// throwing - academic is what routes into the existing retrieval ->
// generation -> honest-fallback pipeline, which was already built to
// never break the child-facing chat (tutorGeneration.ts's own doc
// comment). A classification failure should never be the reason a real
// question goes unanswered.

export type TutorIntent =
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "fun_request"; contentType: FunContentType; subject?: "science" | "english" | "maths" }
  | { kind: "academic" };

const FUN_CONTENT_TYPES = ["tongue_twister", "riddle", "joke", "puzzle", "trivia"] as const;
const TRIVIA_SUBJECTS = ["science", "english", "maths"] as const;

const intentResultSchema = z.object({
  intent: z.enum(["greeting", "thanks", "fun_request", "academic_or_other"]),
  funContentType: z.enum(FUN_CONTENT_TYPES).optional(),
  subject: z.enum(TRIVIA_SUBJECTS).optional(),
});

const INTENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["greeting", "thanks", "fun_request", "academic_or_other"],
      description:
        "greeting = hello/hi/hey and similar. thanks = thank you or appreciation. fun_request = the child " +
        "wants to play, or asked for a riddle, joke, tongue twister, puzzle/brain-teaser, or a trivia " +
        "question. academic_or_other = an actual question about their schoolwork, or anything else.",
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
      "a riddle/joke/tongue twister/puzzle/trivia by name or description, even informally.",
  ].join("\n");
}

/**
 * One classification call, no retry loop (unlike the other Gemini
 * callers in this project) - kept intentionally low-latency, since this
 * sits in front of every message and a slow/retried classification would
 * add straight to the child's wait time for ANY reply, not just fun
 * ones. A single retryable failure (429/503) gets exactly one immediate
 * retry; anything else, or a second failure, falls back to "academic"
 * rather than adding backoff delay here - see this module's own doc
 * comment on why that fallback is safe.
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
      console.warn("Tutor intent classification failed - defaulting to 'academic':", err);
      return { kind: "academic" };
    }
  }
  return { kind: "academic" };
}
