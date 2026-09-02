import { z } from "zod";

// Shape of one AI-generated (or hand-authored) multiple-choice question,
// shared by the production generation service, the content-seeding CLI
// script, and the "convert course content to quiz" skill.

export const generatedOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const generatedQuestionSchema = z
  .object({
    questionText: z.string().min(1),
    options: z.array(generatedOptionSchema).min(3).max(6),
    correctOptionId: z.string().min(1),
    explanation: z.string().min(1),
  })
  .refine((q) => q.options.some((o) => o.id === q.correctOptionId), {
    message: "correctOptionId must match the id of one of the options",
  });

export const generatedQuestionSetSchema = z.array(generatedQuestionSchema).min(1);

export type GeneratedOption = z.infer<typeof generatedOptionSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
