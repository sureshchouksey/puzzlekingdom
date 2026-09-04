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
    // Free-text tag array within this question's subject (e.g.
    // ["Fractions, Decimals & Percentages", "Word Problems"]) - a question
    // can carry more than one tag, for filtering/search. Optional - older
    // content and AI-generated content that hasn't been topic-tagged yet
    // just leaves this unset.
    topics: z.array(z.string().min(1)).min(1).optional(),
    // A memorable trick/strategy for getting this question right, distinct
    // from `explanation`. Optional - older content and AI-generated
    // content that hasn't been tip-written yet just leaves this unset.
    tip: z.string().min(1).optional(),
  })
  .refine((q) => q.options.some((o) => o.id === q.correctOptionId), {
    message: "correctOptionId must match the id of one of the options",
  });

export const generatedQuestionSetSchema = z.array(generatedQuestionSchema).min(1);

export type GeneratedOption = z.infer<typeof generatedOptionSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
