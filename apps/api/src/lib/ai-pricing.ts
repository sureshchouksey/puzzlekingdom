import { env } from "../env.js";
import { countClaudeInputTokens } from "../services/providers/claude.js";
import { countGeminiInputTokens } from "../services/providers/gemini.js";
import type { GenerateQuestionsParams } from "../services/providers/types.js";

// Public per-million-token USD pricing, checked against provider pricing
// pages (September 2026). These change over time - if a provider updates
// pricing, update the constants here rather than anywhere else.
const PRICING = {
  claude: { model: "claude-sonnet-4-5", inputPerMillion: 3, outputPerMillion: 15 },
  gemini: { model: "gemini-3.8-flash", inputPerMillion: 0.75, outputPerMillion: 3.75 },
} as const;

// Rough output-token budget per generated question (question text + 4
// options + explanation, plus a little JSON-structure overhead), based on
// observed real generations. Actual output varies with question complexity,
// so treat the resulting cost as an estimate, not an exact figure.
const OUTPUT_TOKENS_PER_QUESTION = 200;
const OUTPUT_TOKENS_OVERHEAD = 60;

export type ProviderCostEstimate = {
  provider: "claude" | "gemini";
  model: string;
  available: boolean;
  reason?: string;
  requestedQuestionCount: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCostUsd?: number;
};

function estimateOutputTokens(count: number): number {
  return count * OUTPUT_TOKENS_PER_QUESTION + OUTPUT_TOKENS_OVERHEAD;
}

function estimateCost(provider: "claude" | "gemini", inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[provider];
  return (inputTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion;
}

// Returns a cost estimate for both providers so a user can choose before
// generation actually runs. A provider is marked unavailable (rather than
// omitted) when its API key isn't configured, so the caller can still show
// it in a UI with an explanation instead of silently hiding the option.
export async function estimateGenerationCosts(
  params: GenerateQuestionsParams
): Promise<ProviderCostEstimate[]> {
  const count = params.count ?? 8;

  const [claudeResult, geminiResult] = await Promise.allSettled([
    env.ANTHROPIC_API_KEY ? countClaudeInputTokens(params) : Promise.reject(new Error("no key")),
    env.GEMINI_API_KEY ? countGeminiInputTokens(params) : Promise.reject(new Error("no key")),
  ]);

  const outputTokens = estimateOutputTokens(count);

  const claude: ProviderCostEstimate =
    claudeResult.status === "fulfilled"
      ? {
          provider: "claude",
          model: PRICING.claude.model,
          available: true,
          requestedQuestionCount: count,
          estimatedInputTokens: claudeResult.value,
          estimatedOutputTokens: outputTokens,
          estimatedCostUsd: estimateCost("claude", claudeResult.value, outputTokens),
        }
      : {
          provider: "claude",
          model: PRICING.claude.model,
          available: false,
          reason: env.ANTHROPIC_API_KEY ? "Could not reach Anthropic to count tokens." : "ANTHROPIC_API_KEY not configured.",
          requestedQuestionCount: count,
        };

  const gemini: ProviderCostEstimate =
    geminiResult.status === "fulfilled"
      ? {
          provider: "gemini",
          model: env.GEMINI_MODEL,
          available: true,
          requestedQuestionCount: count,
          estimatedInputTokens: geminiResult.value,
          estimatedOutputTokens: outputTokens,
          estimatedCostUsd: estimateCost("gemini", geminiResult.value, outputTokens),
        }
      : {
          provider: "gemini",
          model: env.GEMINI_MODEL,
          available: false,
          reason: env.GEMINI_API_KEY ? "Could not reach Gemini to count tokens." : "GEMINI_API_KEY not configured.",
          requestedQuestionCount: count,
        };

  return [claude, gemini];
}
