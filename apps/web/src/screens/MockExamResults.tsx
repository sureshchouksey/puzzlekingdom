import { useEffect, useState } from "react";
import { ArrowLeft, Award, RotateCcw } from "lucide-react";
import { getResults } from "../api";
import { CERT_EXAM_INFO } from "../data/certExamInfo";
import type { QuizResults } from "../types";
import { Button } from "../components/ui/button";
import { AnswerReviewCard } from "../components/AnswerReviewCard";

// Report screen for a PASSED mock exam (18 September 2026) - reached only
// when Quiz.tsx's exam-mode finishStage() calls onSubmitted, which only
// happens once the whole (single-stage) attempt clears the 70% bar. A
// failed attempt never leaves Quiz.tsx at all - it shows its own neutral
// "below the passing mark" review inline (see Quiz.tsx's stageResult
// branch), since nothing gets persisted server-side for a failed
// attempt (no attemptId to fetch results for) and there's nothing this
// screen could show that Quiz.tsx doesn't already.
export function MockExamResults({
  attemptId,
  onRetake,
  onExit,
}: {
  attemptId: string;
  onRetake: (subjectName: string) => void;
  onExit: () => void;
}) {
  const [results, setResults] = useState<QuizResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResults(null);
    setError(null);
    getResults(attemptId)
      .then(setResults)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your results"));
  }, [attemptId]);

  const examInfo = results ? CERT_EXAM_INFO[results.subjectName ?? ""] : undefined;
  const percent =
    results && results.totalQuestions > 0 ? Math.round(((results.score ?? 0) / results.totalQuestions) * 100) : 0;

  const topicRows = results
    ? Object.entries(results.topicBreakdown).sort(([a], [b]) => {
        const order = examInfo?.domains.map((d) => d.name) ?? [];
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
      })
    : [];

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onExit} aria-label="Back to study space">
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Mock exam result</p>
            <h1 className="text-3xl">{results?.subjectName ?? "Loading..."}</h1>
          </div>
        </header>

        {error && <p className="mt-6 text-sm font-medium text-destructive">{error}</p>}
        {!results && !error && <p className="mt-8 text-muted-foreground">Loading your results...</p>}

        {results && (
          <>
            <div className="mt-8 rounded-2xl border border-primary/40 bg-accent p-6 text-center">
              <span className="animate-pop-in mx-auto grid size-16 place-items-center rounded-full bg-primary text-primary-foreground">
                <Award className="size-8" />
              </span>
              <p className="mt-3 text-2xl font-semibold text-primary">Passed this mock exam</p>
              <p className="mt-1 text-muted-foreground">
                {results.score} / {results.totalQuestions} correct ({percent}%)
              </p>
              {examInfo && (
                <p className="mt-3 text-xs text-muted-foreground">
                  The real {examInfo.abbreviation} exam passes at a scaled score of {examInfo.passingScore} - not the
                  same formula as this app's own 70%-to-pass bar, so treat this as a strong practice signal, not a
                  guarantee.
                </p>
              )}
            </div>

            {topicRows.length > 0 && (
              <section className="mt-8">
                <h2 className="text-sm font-semibold text-muted-foreground">By domain</h2>
                <div className="mt-3 flex flex-col gap-3">
                  {topicRows.map(([topic, { correct, total }]) => {
                    const topicPercent = total > 0 ? Math.round((correct / total) * 100) : 0;
                    return (
                      <div key={topic} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium">{topic}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {correct}/{total} ({topicPercent}%)
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${topicPercent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-sm font-semibold text-muted-foreground">Full review</h2>
              <ol className="mt-3 space-y-3">
                {results.answers.map((a, i) => (
                  <AnswerReviewCard key={a.questionId} answer={a} displayNumber={i + 1} />
                ))}
              </ol>
            </section>

            <div className="mt-8 flex flex-col gap-2">
              <Button size="lg" className="gap-2" onClick={() => onRetake(results.subjectName ?? "")}>
                <RotateCcw className="size-4" />
                Retake mock exam
              </Button>
              <Button variant="secondary" size="lg" onClick={onExit}>
                Back to study space
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
