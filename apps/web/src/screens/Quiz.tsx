import { useMemo, useState } from "react";
import { Check, MessageCircle, PartyPopper, Sparkles } from "lucide-react";
import { submitStage } from "../api";
import type { AssembleQuizResponse, QuizQuestion, SubmitStageResponse, TutorQuestionContext } from "../types";
import { Button } from "../components/ui/button";

// Groups a stage's questions by their source document, in first-appearance
// order, so a passage-based document's story is only shown once, before
// all of its questions - rather than repeating it, or showing questions
// with no context at all.
function groupByDocument(qs: QuizQuestion[]): { documentId: string; passage: string | null; questions: QuizQuestion[] }[] {
  const groups: { documentId: string; passage: string | null; questions: QuizQuestion[] }[] = [];
  const indexByDocument = new Map<string, number>();
  for (const q of qs) {
    let idx = indexByDocument.get(q.documentId);
    if (idx === undefined) {
      idx = groups.length;
      indexByDocument.set(q.documentId, idx);
      groups.push({ documentId: q.documentId, passage: q.passage, questions: [] });
    }
    groups[idx].questions.push(q);
  }
  return groups;
}

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

export function Quiz({
  quiz,
  onSubmitted,
  onExplain,
}: {
  quiz: AssembleQuizResponse;
  onSubmitted: (attemptId: string) => void;
  // "Explain this to me" on a wrong answer - Section 10 step 7. Only
  // wired up when quiz.classId is actually set (see AssembleQuizResponse)
  // - the app's own UI always supplies one, but the type keeps it
  // nullable since the backend route itself doesn't require it.
  onExplain: (context: TutorQuestionContext) => void;
}) {
  const stages = useMemo(() => chunkIntoStages(quiz.questions, quiz.stageSize), [quiz.questions, quiz.stageSize]);

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set right after a non-final stage is scored - shows the "stage
  // cleared" interstitial until the player chooses to continue.
  const [stageResult, setStageResult] = useState<SubmitStageResponse | null>(null);

  const currentStage = stages[currentStageIndex] ?? [];
  const groups = useMemo(() => groupByDocument(currentStage), [currentStage]);
  const allAnswered = currentStage.every((q) => selections[q.id]);

  async function finishStage() {
    setSubmitting(true);
    setError(null);
    try {
      const answers = currentStage.map((q) => ({ questionId: q.id, selectedOptionId: selections[q.id] }));
      const result = await submitStage({ attemptId: quiz.attemptId, answers });
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
    setCurrentStageIndex((i) => i + 1);
  }

  // Below the pass cutoff - the backend never recorded this stage's
  // answers, so the same stage can simply be retaken: clear this stage's
  // picks and drop back to the question screen at the same stage index.
  function retryStage() {
    setStageResult(null);
    setSelections((prev) => {
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
          <header className="text-center">
            <span className="animate-float shadow-glow mx-auto grid size-20 place-items-center rounded-full bg-primary text-primary-foreground">
              {stageResult.passed ? <PartyPopper className="size-9" /> : <Sparkles className="size-9" />}
            </span>
            <h1 className="mt-4 text-3xl">
              {stageResult.passed ? `Stage ${stageResult.stagesCleared} cleared!` : "Not quite — give this stage another go"}
            </h1>
            <p className="mt-1 text-muted-foreground">
              {stageResult.stageScore} / {stageResult.stageTotal} correct this stage ({stagePercent}%)
            </p>
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
                  <li key={a.questionId} className="rounded-2xl bg-secondary/60 p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                          a.isCorrect ? "bg-emerald text-background" : "bg-primary/25 text-primary"
                        }`}
                      >
                        {a.isCorrect ? <Check className="size-4" strokeWidth={3} /> : reviewNumber}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{a.questionText}</p>
                        <div className="mt-2 flex flex-col gap-1">
                          {a.options.map((opt) => {
                            const isSelected = opt.id === a.selectedOptionId;
                            const isCorrectOption = opt.id === a.correctOptionId;
                            return (
                              <p
                                key={opt.id}
                                className={`text-sm ${
                                  isCorrectOption
                                    ? "font-semibold text-emerald"
                                    : isSelected
                                      ? "text-destructive"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {isSelected ? "→ " : ""}
                                {opt.text}
                                {isCorrectOption ? " (correct)" : ""}
                              </p>
                            );
                          })}
                        </div>
                        {a.explanation && <p className="mt-2 text-sm text-muted-foreground italic">{a.explanation}</p>}
                        {a.tip && (
                          <p className="mt-2 rounded-xl bg-primary/12 p-3 text-sm text-primary">
                            <strong>Tip:</strong> {a.tip}
                          </p>
                        )}
                        {!a.isCorrect && quiz.classId && (
                          <button
                            onClick={() =>
                              onExplain({
                                classId: quiz.classId!,
                                subjectId: quiz.subjectId,
                                subjectName: quiz.subjectName,
                                questionId: a.questionId,
                                questionText: a.questionText,
                                attemptId: quiz.attemptId,
                              })
                            }
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

  let questionNumber = 0;

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-24">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-2xl px-6 py-8">
        <header className="text-center">
          <p className="text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">{quiz.subjectName}</p>
          <h1 className="text-2xl sm:text-3xl">
            Stage {currentStageIndex + 1} of {stages.length}
          </h1>
        </header>

        <div className="mx-auto mt-6 flex max-w-sm items-center gap-2">
          {stages.map((_, i) => (
            <span
              key={i}
              className={`h-2.5 flex-1 rounded-full ${
                i < currentStageIndex ? "bg-primary" : i === currentStageIndex ? "bg-primary/50" : "bg-secondary"
              }`}
            />
          ))}
        </div>

        <div className="mt-8 space-y-6">
          {groups.map((group) => (
            <div key={group.documentId} className="space-y-6">
              {group.passage && (
                <div className="rounded-3xl border border-border/70 bg-secondary/50 p-6 backdrop-blur">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Read this passage, then answer the questions below
                  </p>
                  <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{group.passage}</div>
                </div>
              )}

              {group.questions.map((q) => {
                questionNumber += 1;
                return (
                  <section
                    key={q.id}
                    className="animate-pop-in rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest sm:p-7"
                  >
                    <h2 className="text-lg leading-snug font-semibold sm:text-xl">
                      {questionNumber}. {q.questionText}
                    </h2>
                    <div className="mt-5 grid gap-3">
                      {q.options.map((opt, i) => (
                        <button
                          key={opt.id}
                          onClick={() => setSelections((prev) => ({ ...prev, [q.id]: opt.id }))}
                          className={`rounded-2xl border-2 px-5 py-3.5 text-left font-semibold transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                            selections[q.id] === opt.id
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-secondary/60"
                          }`}
                        >
                          <span className="mr-3 text-muted-foreground">{LETTERS[i] ?? ""}</span>
                          {opt.text}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center">
          <Button
            size="lg"
            className="h-14 w-full max-w-sm rounded-2xl text-lg font-display"
            onClick={finishStage}
            disabled={!allAnswered || submitting}
          >
            {submitting ? "Submitting..." : currentStageIndex + 1 === stages.length ? "Finish quiz" : "Finish stage"}
          </Button>
          {!allAnswered && <p className="mt-3 text-sm text-muted-foreground">Answer every question to continue.</p>}
          {error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}
        </div>
      </div>
    </main>
  );
}
