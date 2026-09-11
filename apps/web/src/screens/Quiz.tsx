import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, PartyPopper, Sparkles } from "lucide-react";
import { submitStage } from "../api";
import { useActivityHeartbeat } from "../hooks/useActivityHeartbeat";
import { AnswerReviewCard } from "../components/AnswerReviewCard";
import type { AssembleQuizResponse, QuizQuestion, SelectedPayload, SubmitStageResponse, TutorQuestionContext } from "../types";
import { Button } from "../components/ui/button";

// Splits the (already randomized) question list into fixed-size stages,
// positionally - the same chunking the backend uses to compute
// stagesCleared, so both sides always agree on what "stage N" means.
function chunkIntoStages(qs: QuizQuestion[], stageSize: number): QuizQuestion[][] {
  const stages: QuizQuestion[][] = [];
  for (let i = 0; i < qs.length; i += stageSize) {
    stages.push(qs.slice(i, i + stageSize));
  }
  return stages;
}

const LETTERS = "ABCDEFGH";

// In-progress answer for one question, kept separately from the
// on-the-wire shape (SelectedPayload / selectedOptionId) - this is what
// the on-screen controls actually manipulate as the player works through
// a question. mcq/true_false use "option"; fill_blank/missing_number/
// missing_spelling/short_answer/long_answer use "text"; match_column
// uses "pairs" (built up one tap at a time - see the match-column UI
// below).
type DraftAnswer =
  | { kind: "option"; optionId: string }
  | { kind: "text"; text: string }
  | { kind: "pairs"; pairs: [number, number][] };

function isQuestionAnswered(question: QuizQuestion, answer: DraftAnswer | undefined): boolean {
  if (!answer) return false;
  if (answer.kind === "option") return answer.optionId.length > 0;
  if (answer.kind === "text") return answer.text.trim().length > 0;
  // match_column: answered once every left item has been paired with
  // something - partial pairing (e.g. 2 of 5 done) doesn't count yet.
  const total = question.answerPayload?.left?.length ?? 0;
  return total > 0 && answer.pairs.length >= total;
}

function toSubmittedAnswer(
  questionId: string,
  answer: DraftAnswer | undefined
): { questionId: string; selectedOptionId?: string; selectedPayload?: SelectedPayload } {
  if (!answer) return { questionId };
  if (answer.kind === "option") return { questionId, selectedOptionId: answer.optionId };
  if (answer.kind === "text") return { questionId, selectedPayload: { text: answer.text } };
  return { questionId, selectedPayload: { pairs: answer.pairs } };
}

export function Quiz({
  quiz,
  onExit,
  onSubmitted,
  onExplain,
}: {
  quiz: AssembleQuizResponse;
  // Lets the player back out mid-quiz - e.g. to pick a different topic or
  // subject. Safe at any point: an answer is only ever saved once "Finish
  // stage" is clicked and passes (see finishStage below and the backend's
  // own comment on /quizzes/:id/submit), so leaving before that discards
  // nothing that was ever persisted in the first place.
  onExit: () => void;
  onSubmitted: (attemptId: string) => void;
  // "Explain this to me" on a wrong answer - Section 10 step 7. Only
  // wired up when quiz.classId is actually set (see AssembleQuizResponse)
  // - the app's own UI always supplies one, but the type keeps it
  // nullable since the backend route itself doesn't require one.
  onExplain: (context: TutorQuestionContext) => void;
}) {
  const stages = useMemo(() => chunkIntoStages(quiz.questions, quiz.stageSize), [quiz.questions, quiz.stageSize]);

  // Resumed quizzes (see resumeQuiz in api.ts) carry stagesCleared -
  // start at that stage instead of stage 1, so the player picks up
  // exactly where they left off rather than redoing cleared stages.
  const [currentStageIndex, setCurrentStageIndex] = useState(quiz.stagesCleared ?? 0);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set right after a non-final stage is scored - shows the "stage
  // cleared" interstitial until the player chooses to continue.
  const [stageResult, setStageResult] = useState<SubmitStageResponse | null>(null);

  const currentStage = stages[currentStageIndex] ?? [];
  // One question shown at a time on-screen (mobile-friendly) - this tracks
  // which question within the current stage is showing, separately from
  // currentStageIndex which tracks which stage.
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const question = currentStage[currentQuestionIndex];
  const isAnswered = question ? isQuestionAnswered(question, answers[question.id]) : false;
  const isLastQuestion = currentQuestionIndex === currentStage.length - 1;
  const allAnswered = currentStage.every((q) => isQuestionAnswered(q, answers[q.id]));

  // Activity time tracking (11 September 2026) - see useActivityHeartbeat.ts.
  // Tagged with the current question's own topic tag, when it has one, so
  // time-on-task can be broken down per topic on the family/admin metrics
  // dashboards.
  useActivityHeartbeat({
    activityType: "quiz",
    subjectId: quiz.subjectId,
    classId: quiz.classId ?? undefined,
    quizAttemptId: quiz.attemptId,
    topic: question?.topics?.[0],
  });

  // match_column's "tap a left item, then tap a right item to pair them"
  // flow needs to know which left item is currently armed - reset
  // whenever the on-screen question changes so an armed selection from
  // one match-the-column question never bleeds into the next.
  const [armedLeftIndex, setArmedLeftIndex] = useState<number | null>(null);
  useEffect(() => {
    setArmedLeftIndex(null);
  }, [question?.id]);

  function setTextAnswer(questionId: string, text: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: { kind: "text", text } }));
  }

  function pickOption(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: { kind: "option", optionId } }));
  }

  function toggleArmLeft(leftIndex: number) {
    setArmedLeftIndex((prev) => (prev === leftIndex ? null : leftIndex));
  }

  function pairWithRight(questionId: string, rightIndex: number) {
    if (armedLeftIndex === null) return;
    setAnswers((prev) => {
      const existing = prev[questionId];
      const pairs = existing?.kind === "pairs" ? existing.pairs.filter(([l]) => l !== armedLeftIndex) : [];
      return { ...prev, [questionId]: { kind: "pairs", pairs: [...pairs, [armedLeftIndex, rightIndex]] } };
    });
    setArmedLeftIndex(null);
  }

  function unpairLeft(questionId: string, leftIndex: number) {
    setAnswers((prev) => {
      const existing = prev[questionId];
      if (existing?.kind !== "pairs") return prev;
      return { ...prev, [questionId]: { kind: "pairs", pairs: existing.pairs.filter(([l]) => l !== leftIndex) } };
    });
  }

  async function finishStage() {
    setSubmitting(true);
    setError(null);
    try {
      const stageAnswers = currentStage.map((q) => toSubmittedAnswer(q.id, answers[q.id]));
      const result = await submitStage({ attemptId: quiz.attemptId, answers: stageAnswers });
      if (result.isComplete) {
        onSubmitted(quiz.attemptId);
      } else {
        setStageResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit stage");
    } finally {
      setSubmitting(false);
    }
  }

  function continueToNextStage() {
    setStageResult(null);
    setCurrentQuestionIndex(0);
    setCurrentStageIndex((i) => i + 1);
  }

  // Below the pass cutoff - the backend never recorded this stage's
  // answers, so the same stage can simply be retaken: clear this stage's
  // picks and drop back to the question screen at the same stage index.
  function retryStage() {
    setStageResult(null);
    setCurrentQuestionIndex(0);
    setAnswers((prev) => {
      const next = { ...prev };
      for (const q of currentStage) delete next[q.id];
      return next;
    });
  }

  if (stageResult) {
    const stagesToGo = stageResult.totalStages - stageResult.stagesCleared;
    const stagePercent = stageResult.stageTotal > 0 ? Math.round((stageResult.stageScore / stageResult.stageTotal) * 100) : 0;
    const cutoffPercent = Math.round(stageResult.passThreshold * 100);
    let reviewNumber = 0;

    return (
      <main className="night-sky relative min-h-screen overflow-hidden pb-16">
        <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
        <div className="relative mx-auto w-full max-w-2xl px-6 py-10">
          <header className="flex items-center justify-between gap-4">
            <Button variant="ghost" size="icon" className="rounded-full" onClick={onExit} aria-label="Exit quiz">
              <ArrowLeft className="size-5" />
            </Button>
            <div className="flex-1 text-center">
              <span className="animate-float shadow-glow mx-auto grid size-20 place-items-center rounded-full bg-primary text-primary-foreground">
                {stageResult.passed ? <PartyPopper className="size-9" /> : <Sparkles className="size-9" />}
              </span>
              <h1 className="mt-4 text-3xl">
                {stageResult.passed ? `Stage ${stageResult.stagesCleared} cleared!` : "Not quite — give this stage another go"}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {stageResult.stageScore} / {stageResult.stageTotal} correct this stage ({stagePercent}%)
              </p>
            </div>
            <span className="size-9" />
          </header>

          <div className="mt-8 rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest">
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Stage score</span>
              <span className="text-primary">{stagePercent}%</span>
            </div>
            <div className="relative mt-3 h-4 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${stagePercent}%` }} />
              <span className="absolute top-0 h-full w-0.5 bg-foreground/60" style={{ left: `${cutoffPercent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {stageResult.passed
                ? stagesToGo > 0
                  ? `${stagesToGo} stage${stagesToGo === 1 ? "" : "s"} to go`
                  : "That was the last stage!"
                : `You need at least ${cutoffPercent}% to clear a stage — the line shows the target.`}
            </p>

            <ol className="mt-6 space-y-3">
              {stageResult.answers.map((a) => {
                reviewNumber += 1;
                return (
                  <AnswerReviewCard
                    key={a.questionId}
                    answer={a}
                    displayNumber={reviewNumber}
                    onExplain={
                      quiz.classId
                        ? () =>
                            onExplain({
                              classId: quiz.classId!,
                              subjectId: quiz.subjectId,
                              subjectName: quiz.subjectName,
                              questionId: a.questionId,
                              questionText: a.questionText,
                              attemptId: quiz.attemptId,
                            })
                        : undefined
                    }
                  />
                );
              })}
            </ol>
          </div>

          <div className="mt-7 flex justify-center">
            {stageResult.passed ? (
              <Button size="lg" className="rounded-full font-display" onClick={continueToNextStage}>
                Continue to stage {stageResult.stagesCleared + 1}
              </Button>
            ) : (
              <Button size="lg" className="rounded-full font-display" onClick={retryStage}>
                Retry this stage
              </Button>
            )}
          </div>
        </div>
      </main>
    );
  }

  const draft = question ? answers[question.id] : undefined;

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-24">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-2xl px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onExit} aria-label="Exit quiz">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className="text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">{quiz.subjectName}</p>
            <h1 className="text-2xl sm:text-3xl">
              Stage {currentStageIndex + 1} of {stages.length}
            </h1>
          </div>
          <span className="size-9" />
        </header>

        {/* Per-question progress within the current stage (e.g. "2 / 10") -
            shown one question at a time so it's usable on a phone screen,
            rather than a long scroll of every question in the stage. */}
        <div className="mx-auto mt-6 max-w-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>
              Question {currentQuestionIndex + 1} / {currentStage.length}
            </span>
            <span>{Math.round(((currentQuestionIndex + 1) / Math.max(currentStage.length, 1)) * 100)}%</span>
          </div>
          <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${((currentQuestionIndex + 1) / Math.max(currentStage.length, 1)) * 100}%` }}
            />
          </div>
        </div>

        {question && (
          <div className="mt-8 space-y-6">
            {question.passage && (
              <div className="rounded-3xl border border-border/70 bg-secondary/50 p-6 backdrop-blur">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Read this passage, then answer the question below
                </p>
                <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{question.passage}</div>
              </div>
            )}

            <section
              key={question.id}
              className="animate-pop-in rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest sm:p-7"
            >
              <h2 className="text-lg leading-snug font-semibold sm:text-xl">{question.questionText}</h2>
              {question.imageUrl && (
                <img src={question.imageUrl} alt="" className="mt-4 max-h-64 w-full rounded-2xl object-contain" />
              )}

              {(question.questionType === "mcq" || question.questionType === "true_false") && (
                <div className="mt-5 grid gap-3">
                  {question.options.map((opt, i) => (
                    <button
                      key={opt.id}
                      onClick={() => pickOption(question.id, opt.id)}
                      className={`rounded-2xl border-2 px-5 py-3.5 text-left font-semibold transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                        draft?.kind === "option" && draft.optionId === opt.id
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-secondary/60"
                      }`}
                    >
                      {question.questionType === "mcq" && <span className="mr-3 text-muted-foreground">{LETTERS[i] ?? ""}</span>}
                      {opt.text}
                    </button>
                  ))}
                </div>
              )}

              {(question.questionType === "fill_blank" ||
                question.questionType === "missing_number" ||
                question.questionType === "missing_spelling") && (
                <div className="mt-5">
                  <input
                    value={draft?.kind === "text" ? draft.text : ""}
                    onChange={(e) => setTextAnswer(question.id, e.target.value)}
                    placeholder="Type your answer"
                    autoCapitalize={question.questionType === "missing_spelling" ? "none" : undefined}
                    className="w-full rounded-2xl border-2 border-border bg-secondary/60 px-5 py-3.5 text-lg font-semibold outline-none focus-visible:border-primary"
                  />
                </div>
              )}

              {(question.questionType === "short_answer" || question.questionType === "long_answer") && (
                <div className="mt-5">
                  <textarea
                    value={draft?.kind === "text" ? draft.text : ""}
                    onChange={(e) => setTextAnswer(question.id, e.target.value)}
                    placeholder="Write your answer"
                    rows={question.questionType === "long_answer" ? 6 : 3}
                    className="w-full rounded-2xl border-2 border-border bg-secondary/60 px-5 py-3.5 font-sans text-[15px] leading-relaxed outline-none focus-visible:border-primary"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    This isn't marked right or wrong - your spelling and a model answer are shown once you finish the stage.
                  </p>
                </div>
              )}

              {question.questionType === "match_column" && question.answerPayload?.left && (
                <div className="mt-5">
                  <p className="mb-3 text-sm text-muted-foreground">Tap an item on the left, then tap its match on the right.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      {question.answerPayload.left.map((text, li) => {
                        const pairs = draft?.kind === "pairs" ? draft.pairs : [];
                        const pairedRight = pairs.find(([l]) => l === li);
                        const isArmed = armedLeftIndex === li;
                        return (
                          <button
                            key={li}
                            onClick={() => (pairedRight ? unpairLeft(question.id, li) : toggleArmLeft(li))}
                            className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                              pairedRight
                                ? "border-primary bg-primary/15 text-primary"
                                : isArmed
                                  ? "border-primary bg-primary/25 text-primary"
                                  : "border-border bg-secondary/60"
                            }`}
                          >
                            {text}
                            {pairedRight ? " ✓" : ""}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-col gap-2">
                      {(question.answerPayload.right ?? []).map((text, ri) => {
                        const pairs = draft?.kind === "pairs" ? draft.pairs : [];
                        const usedByLeft = pairs.find(([, r]) => r === ri)?.[0];
                        const isUsed = usedByLeft !== undefined;
                        return (
                          <button
                            key={ri}
                            onClick={() => (isUsed ? unpairLeft(question.id, usedByLeft) : pairWithRight(question.id, ri))}
                            disabled={!isUsed && armedLeftIndex === null}
                            className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              isUsed ? "border-primary bg-primary/15 text-primary" : "border-border bg-secondary/60"
                            }`}
                          >
                            {text}
                            {isUsed ? " ✓" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center">
          <div className="flex w-full max-w-sm items-center gap-3">
            <Button
              variant="secondary"
              size="lg"
              className="h-14 flex-1 rounded-2xl text-base font-display"
              onClick={() => setCurrentQuestionIndex((i) => Math.max(0, i - 1))}
              disabled={currentQuestionIndex === 0}
            >
              Previous
            </Button>
            {isLastQuestion ? (
              <Button
                size="lg"
                className="h-14 flex-[1.4] rounded-2xl text-lg font-display"
                onClick={finishStage}
                disabled={!allAnswered || submitting}
              >
                {submitting ? "Submitting..." : currentStageIndex + 1 === stages.length ? "Finish quiz" : "Finish stage"}
              </Button>
            ) : (
              <Button
                size="lg"
                className="h-14 flex-[1.4] rounded-2xl text-lg font-display"
                onClick={() => setCurrentQuestionIndex((i) => Math.min(currentStage.length - 1, i + 1))}
                disabled={!isAnswered}
              >
                Next
              </Button>
            )}
          </div>
          {!isAnswered && <p className="mt-3 text-sm text-muted-foreground">Answer this question to continue.</p>}
          {error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}
        </div>
      </div>
    </main>
  );
}
