// A single JSON-Schema description of the generated-question shape, shared
// by every AI provider (Claude's forced tool-use, Gemini's structured JSON
// output) so the prompt contract stays identical regardless of which model
// actually generates the questions. The final source of truth for whether a
// generated set is valid is still `generatedQuestionSetSchema` (Zod) in
// question-schema.ts, run on the result after the provider returns it.

export const QUESTIONS_JSON_SCHEMA = {
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
} as const;

export function buildGenerationPrompt(params: { subjectName: string; count: number }): string {
  return (
    `This is course content for the subject "${params.subjectName}", aimed at a UK primary-school ` +
    `child. Read it and write ${params.count} multiple-choice questions that test understanding of ` +
    `what's actually in this content - not general knowledge. Each question needs exactly 4 options ` +
    `with short ids ("a"-"d"), exactly one correct answer, and a one-sentence explanation a child ` +
    `could learn from. Base every question strictly on the material provided; never invent facts ` +
    `that aren't in the content.`
  );
}
