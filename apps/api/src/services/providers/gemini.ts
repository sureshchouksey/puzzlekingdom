import { GoogleGenAI } from "@google/genai";
import { env } from "../../env.js";
import { generatedQuestionSetSchema } from "../../lib/question-schema.js";
import { QUESTIONS_JSON_SCHEMA, buildGenerationPrompt } from "../../lib/question-json-schema.js";
import type { GenerateQuestionsParams } from "./types.js";

let ai: GoogleGenAI | undefined;
function getClient() {
  if (!ai) ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return ai;
}

function isRetryableStatus(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  // 503 = model temporarily overloaded ("high demand"), 429 = rate limited.
  // Google's own docs say both are transient - safe to retry with backoff.
  return status === 503 || status === 429;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 5000];

export async function generateQuestionsWithGemini(params: GenerateQuestionsParams) {
  const count = params.count ?? 8;

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await getClient().models.generateContent({
        model: env.GEMINI_MODEL,
        contents: [
          { inlineData: { data: params.fileBase64, mimeType: params.mimeType } },
          { text: buildGenerationPrompt({ subjectName: params.subjectName, count }) },
        ],
        config: {
          responseMimeType: "application/json",
          // Gemini's responseSchema is a restricted OpenAPI-style subset; the plain
          // JSON-Schema fallback (responseJsonSchema) accepts the same schema object
          // used for Claude's tool input, so both providers share one schema source.
          responseJsonSchema: QUESTIONS_JSON_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Gemini did not return any text content with generated questions.");
      }

      const parsed = JSON.parse(text) as { questions: unknown };
      return generatedQuestionSetSchema.parse(parsed.questions);
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!isRetryableStatus(err) || isLastAttempt) {
        throw err;
      }
      const waitMs = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.warn(
        `Gemini request failed (attempt ${attempt + 1}/${MAX_ATTEMPTS}, likely temporary overload) - retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }

  throw lastErr;
}

// Real input-token count via Gemini's free token-counting endpoint, using
// the exact same content the real generation call would send.
export async function countGeminiInputTokens(params: GenerateQuestionsParams): Promise<number> {
  const result = await getClient().models.countTokens({
    model: env.GEMINI_MODEL,
    contents: [
      { inlineData: { data: params.fileBase64, mimeType: params.mimeType } },
      { text: buildGenerationPrompt({ subjectName: params.subjectName, count: params.count ?? 8 }) },
    ],
  });
  return result.totalTokens ?? 0;
}
