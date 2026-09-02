import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../env.js";
import { generatedQuestionSetSchema } from "../../lib/question-schema.js";
import { QUESTIONS_JSON_SCHEMA, buildGenerationPrompt } from "../../lib/question-json-schema.js";
import type { GenerateQuestionsParams } from "./types.js";

const RETURN_QUESTIONS_TOOL: Anthropic.Tool = {
  name: "return_questions",
  description: "Return the generated multiple-choice questions.",
  input_schema: QUESTIONS_JSON_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

let anthropic: Anthropic | undefined;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic;
}

export async function generateQuestionsWithClaude(params: GenerateQuestionsParams) {
  const count = params.count ?? 8;

  const documentBlock =
    params.mimeType === "application/pdf"
      ? {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: params.fileBase64 },
        }
      : {
          type: "image" as const,
          source: { type: "base64" as const, media_type: params.mimeType as "image/png" | "image/jpeg" | "image/webp", data: params.fileBase64 },
        };

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    tools: [RETURN_QUESTIONS_TOOL],
    tool_choice: { type: "tool", name: "return_questions" },
    messages: [
      {
        role: "user",
        content: [documentBlock, { type: "text", text: buildGenerationPrompt({ subjectName: params.subjectName, count }) }],
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block with generated questions.");
  }

  const input = toolUse.input as { questions: unknown };
  return generatedQuestionSetSchema.parse(input.questions);
}
