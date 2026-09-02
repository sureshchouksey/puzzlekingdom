import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";
import { generatedQuestionSetSchema } from "../lib/question-schema.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const RETURN_QUESTIONS_TOOL: Anthropic.Tool = {
  name: "return_questions",
  description: "Return the generated multiple-choice questions.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            questionText: { type: "string" },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Short option id, e.g. 'a', 'b', 'c', 'd'" },
                  text: { type: "string" },
                },
                required: ["id", "text"],
              },
            },
            correctOptionId: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["questionText", "options", "correctOptionId", "explanation"],
        },
      },
    },
    required: ["questions"],
  },
};

// Production generation path: a real end user uploaded this file through the
// web app, so the backend itself must call Claude - there's no developer
// sitting in a Claude Code session to do the reading. See the content-to-quiz
// skill for the development/seeding equivalent of this same idea.
export async function generateQuestionsFromDocument(params: {
  fileBase64: string;
  mimeType: string;
  subjectName: string;
  count?: number;
}) {
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

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    tools: [RETURN_QUESTIONS_TOOL],
    tool_choice: { type: "tool", name: "return_questions" },
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text:
              `This is course content for the subject "${params.subjectName}", aimed at a UK primary-school ` +
              `child. Read it and write ${count} multiple-choice questions that test understanding of what's ` +
              `actually in this content - not general knowledge. Each question needs exactly 4 options with ` +
              `short ids ("a"-"d"), exactly one correct answer, and a one-sentence explanation a child could ` +
              `learn from. Base every question strictly on the material provided; never invent facts that ` +
              `aren't in the content.`,
          },
        ],
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
