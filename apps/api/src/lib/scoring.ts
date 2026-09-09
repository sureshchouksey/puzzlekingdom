// Per-question grading, branching by question_type - the core of build
// order step 4 in Question-Types-and-Content-Authoring-Plan.md
// ("Scoring-engine impact"). Used by POST /quizzes/:id/submit
// (routes/quizzes.ts) but kept separate and DB-free so it's easy to
// reason about (and smoke-test) on its own.

// A subset of the questions row - just what's needed to grade one
// answer, so this doesn't need a real DB row to call.
export type GradableQuestion = {
  questionType:
    | "mcq"
    | "true_false"
    | "fill_blank"
    | "missing_number"
    | "missing_spelling"
    | "match_column"
    | "short_answer"
    | "long_answer";
  correctOptionId: string;
  answerPayload: Record<string, unknown> | null;
};

// What the client submits for one question - selectedOptionId for
// mcq/true_false (unchanged from the original API), selectedPayload for
// every other type. Both optional since the request body is untrusted
// input, not because a caller should send both.
export type SubmittedAnswer = {
  questionId: string;
  selectedOptionId?: string;
  selectedPayload?: unknown;
};

export type GradeResult = {
  isCorrect: boolean;
  // Null means "excluded from the stage total" (short/long answer) -
  // see the migration 0013 comment on quiz_attempt_answers.score.
  score: number | null;
};

function normalize(value: unknown, caseSensitive: boolean): string {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function submittedText(submitted: SubmittedAnswer): unknown {
  const payload = submitted.selectedPayload;
  if (payload && typeof payload === "object" && "text" in payload) {
    return (payload as { text?: unknown }).text;
  }
  return undefined;
}

// fill_blank/missing_number (case-insensitive) and missing_spelling
// (case-sensitive, since spelling is the point) all use the same
// "matches any accepted answer" mechanism - see the data model table in
// Question-Types-and-Content-Authoring-Plan.md.
function gradeAcceptedAnswer(question: GradableQuestion, submitted: SubmittedAnswer, caseSensitive: boolean): GradeResult {
  const accepted = Array.isArray(question.answerPayload?.acceptedAnswers)
    ? (question.answerPayload!.acceptedAnswers as unknown[])
    : [];
  const normalizedSubmitted = normalize(submittedText(submitted), caseSensitive);
  const isCorrect =
    normalizedSubmitted.length > 0 && accepted.some((a) => normalize(a, caseSensitive) === normalizedSubmitted);
  return { isCorrect, score: isCorrect ? 1 : 0 };
}

type Pair = [number, number];

function asPairList(value: unknown): Pair[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is Pair => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number");
}

// Match-the-column partial credit: score is the fraction of
// answerPayload.correctPairs actually matched by the submitted pairs,
// per the user's own resolution (60% pass floor, star-banded above it -
// see "Star bands" in Question-Types-and-Content-Authoring-Plan.md).
// isCorrect (used elsewhere to decide whether to show the tip) means
// every pair was matched, not just past the 60% floor.
function gradeMatchColumn(question: GradableQuestion, submitted: SubmittedAnswer): GradeResult {
  const correctPairs = asPairList(question.answerPayload?.correctPairs);
  if (correctPairs.length === 0) return { isCorrect: false, score: 0 };

  const payload =
    submitted.selectedPayload && typeof submitted.selectedPayload === "object"
      ? (submitted.selectedPayload as { pairs?: unknown }).pairs
      : undefined;
  const submittedPairs = asPairList(payload);

  const correctKeys = new Set(correctPairs.map(([l, r]) => `${l}:${r}`));
  const matched = submittedPairs.filter(([l, r]) => correctKeys.has(`${l}:${r}`)).length;

  const score = Math.min(matched / correctPairs.length, 1);
  return { isCorrect: score === 1, score };
}

// Grades one submitted answer against its question. See
// "Scoring-engine impact" in Question-Types-and-Content-Authoring-Plan.md
// for the type-by-type breakdown this mirrors.
export function gradeAnswer(question: GradableQuestion, submitted: SubmittedAnswer): GradeResult {
  switch (question.questionType) {
    case "mcq":
    case "true_false": {
      const isCorrect = !!submitted.selectedOptionId && question.correctOptionId === submitted.selectedOptionId;
      return { isCorrect, score: isCorrect ? 1 : 0 };
    }
    case "fill_blank":
    case "missing_number":
      return gradeAcceptedAnswer(question, submitted, false);
    case "missing_spelling":
      return gradeAcceptedAnswer(question, submitted, true);
    case "match_column":
      return gradeMatchColumn(question, submitted);
    case "short_answer":
    case "long_answer":
      // Excluded from auto-scoring in Phase 1 (automated spelling
      // feedback is a separate pass - build order step 5, not yet
      // built). isCorrect is false so a caller that forgets to check
      // `score === null` first doesn't mistake this for a win; the null
      // score is what actually excludes it from a stage's total.
      return { isCorrect: false, score: null };
  }
}

// Star bands layered on top of a percentage, on the existing stage pass
// gate (70/85/95 -> 1/2/3) - see "Star bands" in
// Question-Types-and-Content-Authoring-Plan.md. Only meaningful for a
// percent that already cleared the pass threshold; callers that haven't
// checked that should treat a 0 return as "not applicable", not "failed".
export function starsForPercent(percent: number): 0 | 1 | 2 | 3 {
  if (percent >= 0.95) return 3;
  if (percent >= 0.85) return 2;
  if (percent >= 0.7) return 1;
  return 0;
}
