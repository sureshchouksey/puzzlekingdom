import { env } from "../env.js";
import { generateQuestionsWithClaude } from "./providers/claude.js";
import { generateQuestionsWithGemini } from "./providers/gemini.js";
import type { GenerateQuestionsParams } from "./providers/types.js";

// Production generation path: a real end user uploaded this file through the
// web app, so the backend itself must call an AI provider - there's no
// developer sitting in a Claude Code session to do the reading. See the
// content-to-quiz skill for the development/seeding equivalent of this idea,
// which reads content directly in-session instead of calling either API.
//
// Which provider actually runs is chosen by AI_PROVIDER (see src/env.ts) -
// "claude" (default) or "gemini" - so cost/quality can be swapped per
// deployment without touching this file or the calling routes.
export async function generateQuestionsFromDocument(params: GenerateQuestionsParams) {
  if (env.AI_PROVIDER === "gemini") {
    return generateQuestionsWithGemini(params);
  }
  return generateQuestionsWithClaude(params);
}
