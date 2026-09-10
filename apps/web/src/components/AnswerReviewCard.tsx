// Per-question review card, shared by Quiz.tsx's "stage cleared"
// interstitial and Results.tsx's final results screen - both show the
// same information (what was picked, what was correct, explanation/tip)
// for one answered question, just from slightly different response
// shapes (StageAnswerReview vs ResultsAnswer). Rather than duplicate the
// same 8-way questionType branch in both screens (and risk them drifting
// apart), this takes the small common subset both types satisfy and
// renders once.
import { Check, MessageCircle } from "lucide-react";
import type { AnswerPayload, QuestionType, QuizOption, SpellingIssue } from "../types";

export type AnswerReviewData = {
  questionId: string;
  questionText: string | null;
  questionType: QuestionType;
  options: QuizOption[];
  selectedOptionId: string | null;
  selectedPayload: unknown;
  correctOptionId: string | null;
  answerPayload: AnswerPayload | null;
  explanation: string | null;
  tip: string | null;
  isCorrect: boolean;
  score: number | null;
  spellingIssues: SpellingIssue[] | null;
};

function submittedText(selectedPayload: unknown): string {
  if (selectedPayload && typeof selectedPayload === "object" && "text" in selectedPayload) {
    const t = (selectedPayload as { text?: unknown }).text;
    return typeof t === "string" ? t : "";
  }
  return "";
}

function submittedPairs(selectedPayload: unknown): [number, number][] {
  if (selectedPayload && typeof selectedPayload === "object" && "pairs" in selectedPayload) {
    const p = (selectedPayload as { pairs?: unknown }).pairs;
    if (Array.isArray(p)) return p as [number, number][];
  }
  return [];
}

export function AnswerReviewCard({
  answer,
  displayNumber,
  onExplain,
}: {
  answer: AnswerReviewData;
  displayNumber: number;
  // "Explain this to me" - only offered when this attempt has a class to
  // scope the chat to (see Quiz.tsx/Results.tsx's own guard on
  // quiz.classId / results.classId before passing this in at all).
  onExplain?: () => void;
}) {
  const a = answer;
  // short_answer/long_answer are never scored (score stays null - see
  // lib/scoring.ts), so a.isCorrect there is always false by convention,
  // not because the answer was actually wrong. Treat "unscored" as its
  // own neutral state rather than reusing the wrong-answer styling.
  const isScored = a.score !== null;
  const showExplain = isScored && !a.isCorrect && !!onExplain;

  return (
    <li className="rounded-2xl bg-secondary/60 p-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
            !isScored ? "bg-secondary text-muted-foreground" : a.isCorrect ? "bg-emerald text-background" : "bg-primary/25 text-primary"
          }`}
        >
          {isScored && a.isCorrect ? <Check className="size-4" strokeWidth={3} /> : displayNumber}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">{a.questionText}</p>

          {(a.questionType === "mcq" || a.questionType === "true_false") && (
            <div className="mt-2 flex flex-col gap-1">
              {a.options.map((opt) => {
                const isSelected = opt.id === a.selectedOptionId;
                const isCorrectOption = opt.id === a.correctOptionId;
                return (
                  <p
                    key={opt.id}
                    className={`text-sm ${
                      isCorrectOption ? "font-semibold text-emerald" : isSelected ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {isSelected ? "→ " : ""}
                    {opt.text}
                    {isCorrectOption ? " (correct)" : ""}
                  </p>
                );
              })}
            </div>
          )}

          {(a.questionType === "fill_blank" || a.questionType === "missing_number" || a.questionType === "missing_spelling") && (
            <div className="mt-2 text-sm">
              <p className={a.isCorrect ? "font-semibold text-emerald" : "text-destructive"}>
                Your answer: {submittedText(a.selectedPayload) || "(no answer)"}
              </p>
              {!a.isCorrect && a.answerPayload?.acceptedAnswers && a.answerPayload.acceptedAnswers.length > 0 && (
                <p className="mt-1 text-muted-foreground">Accepted: {a.answerPayload.acceptedAnswers.join(", ")}</p>
              )}
            </div>
          )}

          {a.questionType === "match_column" && a.answerPayload?.left && (
            <div className="mt-2 space-y-1 text-sm">
              {a.answerPayload.left.map((leftText, li) => {
                const pairs = submittedPairs(a.selectedPayload);
                const correctPairs = a.answerPayload?.correctPairs ?? [];
                const chosenRightIndex = pairs.find(([l]) => l === li)?.[1];
                const correctRightIndex = correctPairs.find(([l]) => l === li)?.[1];
                const chosenRightText = chosenRightIndex !== undefined ? a.answerPayload?.right?.[chosenRightIndex] : undefined;
                const correctRightText = correctRightIndex !== undefined ? a.answerPayload?.right?.[correctRightIndex] : undefined;
                const matched = chosenRightIndex !== undefined && chosenRightIndex === correctRightIndex;
                return (
                  <p key={li} className={matched ? "font-medium text-emerald" : "text-destructive"}>
                    {leftText} → {chosenRightText ?? "(no match)"}
                    {!matched && correctRightText ? ` · correct: ${correctRightText}` : ""}
                  </p>
                );
              })}
              {a.score !== null && <p className="mt-1 text-xs text-muted-foreground">{Math.round(a.score * 100)}% of pairs matched</p>}
            </div>
          )}

          {(a.questionType === "short_answer" || a.questionType === "long_answer") && (
            <div className="mt-2 text-sm">
              <p className="whitespace-pre-wrap">Your answer: {submittedText(a.selectedPayload) || "(no answer)"}</p>
              {a.spellingIssues && a.spellingIssues.length > 0 && (
                <p className="mt-1.5 text-primary">
                  Spelling to double-check: {a.spellingIssues.map((s) => s.word).join(", ")}
                </p>
              )}
              {a.answerPayload?.rubricKeyPoints && a.answerPayload.rubricKeyPoints.length > 0 && (
                <div className="mt-2 rounded-xl bg-primary/12 p-3 text-primary">
                  <p className="font-semibold">Model answer, to compare with your own:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {a.answerPayload.rubricKeyPoints.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {a.explanation && <p className="mt-2 text-sm text-muted-foreground italic">{a.explanation}</p>}
          {a.tip && (
            <p className="mt-2 rounded-xl bg-primary/12 p-3 text-sm text-primary">
              <strong>Tip:</strong> {a.tip}
            </p>
          )}
          {showExplain && (
            <button
              onClick={onExplain}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              <MessageCircle className="size-3.5" />
              Explain this to me
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
