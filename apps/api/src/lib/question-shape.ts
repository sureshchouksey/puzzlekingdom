import { z } from "zod";

// The 8 question types from Question-Types-and-Content-Authoring-Plan.md's
// "Data model recommendation" - mcq/true_false keep using the existing
// options/correctOptionId columns (true_false is just mcq's shape fixed to
// two options, rendered as a toggle on the frontend); everything else
// stores its answer shape in answerPayload instead and leaves
// options/correctOptionId empty (see lib/scoring.ts's GradableQuestion for
// exactly what each type's answerPayload holds).
//
// Kept as its own plain string-literal tuple (matching db/schema.ts's
// `questionType` pgEnum values exactly) rather than deriving from the
// Drizzle enum, since Zod's z.enum needs a literal tuple, not a Drizzle
// enum object - same reasoning as this file's predecessor, admin.ts,
// which is where this used to live before /documents/manual needed the
// same type-validation logic for its own bulk-create path (see
// validateQuestionShape below).
export const QUESTION_TYPES = [
  "mcq",
  "true_false",
  "fill_blank",
  "missing_number",
  "missing_spelling",
  "match_column",
  "short_answer",
  "long_answer",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type QuestionOption = { id: string; text: string };

export const questionOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

// Validates + normalizes one question's type-specific shape - shared by
// admin.ts's POST/PATCH /admin/questions (single question, attached to an
// existing document) and documents.ts's POST /documents/manual (a whole
// document's worth of typed questions created in one call), so the
// per-type rules only live in one place. Returns the final
// options/correctOptionId/answerPayload to persist (non-mcq types always
// persist an empty options array + empty correctOptionId, since those DB
// columns are NOT NULL but semantically unused once answerPayload is
// what scoring.ts actually reads) or an error string.
export function validateQuestionShape(
  questionType: QuestionType,
  options: QuestionOption[],
  correctOptionId: string,
  answerPayload: Record<string, unknown> | null
):
  | { ok: true; options: QuestionOption[]; correctOptionId: string; answerPayload: Record<string, unknown> | null }
  | { ok: false; error: string } {
  switch (questionType) {
    case "mcq": {
      if (options.length < 3) return { ok: false, error: "An MCQ question needs at least 3 options" };
      if (!correctOptionId || !options.some((o) => o.id === correctOptionId)) {
        return { ok: false, error: "correctOptionId must match the id of one of the options" };
      }
      return { ok: true, options, correctOptionId, answerPayload: null };
    }
    case "true_false": {
      if (options.length !== 2) return { ok: false, error: "A True/False question needs exactly 2 options" };
      if (!correctOptionId || !options.some((o) => o.id === correctOptionId)) {
        return { ok: false, error: "correctOptionId must match the id of one of the options" };
      }
      return { ok: true, options, correctOptionId, answerPayload: null };
    }
    case "fill_blank":
    case "missing_number":
    case "missing_spelling": {
      const accepted = answerPayload?.acceptedAnswers;
      if (!Array.isArray(accepted) || accepted.length === 0 || !accepted.every((a) => typeof a === "string" && a.trim().length > 0)) {
        return { ok: false, error: "At least one accepted answer is required" };
      }
      return { ok: true, options: [], correctOptionId: "", answerPayload: { acceptedAnswers: accepted } };
    }
    case "match_column": {
      const left = answerPayload?.left;
      const right = answerPayload?.right;
      const correctPairs = answerPayload?.correctPairs;
      const validList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
      if (!validList(left) || !validList(right) || left.length !== right.length || left.length < 2) {
        return { ok: false, error: "Match the column needs at least 2 pairs, with both sides filled in" };
      }
      if (
        !Array.isArray(correctPairs) ||
        correctPairs.length !== left.length ||
        !correctPairs.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number")
      ) {
        return { ok: false, error: "correctPairs must have one [leftIndex, rightIndex] entry per pair" };
      }
      return { ok: true, options: [], correctOptionId: "", answerPayload: { left, right, correctPairs } };
    }
    case "short_answer":
    case "long_answer": {
      const rubric = answerPayload?.rubricKeyPoints;
      if (!Array.isArray(rubric) || rubric.length === 0 || !rubric.every((a) => typeof a === "string" && a.trim().length > 0)) {
        return { ok: false, error: "At least one rubric key point (used as the model answer) is required" };
      }
      return { ok: true, options: [], correctOptionId: "", answerPayload: { rubricKeyPoints: rubric } };
    }
  }
}
