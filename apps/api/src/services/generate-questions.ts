import { env } from "../env.js";
import { generateQuestionsWithClaude } from "./providers/claude.js";
import { generateQuestionsWithGemini } from "./providers/gemini.js";
import type { AiProvider, GenerateQuestionsParams } from "./providers/types.js";

// Production generation path: a real end user uploaded this file through the
// web app, so the backend itself must call an AI provider - there's no
// developer sitting in a Claude Code session to do the reading. See the
// content-to-quiz skill for the development/seeding equivalent of this idea,
// which reads content directly in-session instead of calling either API.
//
// The caller (the upload/generate route, ultimately the user via the UI)
// can pick a provider explicitly - see estimateGenerationCosts() in
// lib/ai-pricing.ts for the cost comparison that choice is meant to be
// based on. Falls back to AI_PROVIDER from env if the caller doesn't specify
// one, so existing callers (scripts, tests) keep working unchanged.
export async function generateQuestionsFromDocument(
  params: GenerateQuestionsParams & { provider?: AiProvider }
) {
  const provider = params.provider ?? env.AI_PROVIDER;
  if (provider === "gemini") {
    return generateQuestionsWithGemini(params);
  }
  return generateQuestionsWithClaude(params);
}
