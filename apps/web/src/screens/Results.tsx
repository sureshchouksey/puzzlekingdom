import { useEffect, useMemo, useState } from "react";
import { ArrowRight, PartyPopper, Sparkles } from "lucide-react";
import { assembleQuiz, getResults } from "../api";
import { AnswerReviewCard } from "../components/AnswerReviewCard";
import type { AssembleQuizResponse, Profile, QuestJourney, QuizResults, ResultsAnswer, TutorQuestionContext } from "../types";
import { Button } from "../components/ui/button";

// Same single-stage sentinel SubjectPicker.tsx uses for a Quest Journey -
// the API clamps it down to however many questions the next topic
// actually has, so it always comes back as exactly one stage.
const ALL_SUBJECTS_STAGE_SIZE = 9999;

// Same grouping approach as the Quiz screen: show each passage once, right
// before the review cards for the questions that came from it.
function groupByDocument(answers: ResultsAnswer[]): { documentId: string; passage: string | null; answers: ResultsAnswer[] }[] {
  const groups: { documentId: string; passage: string | null; answers: ResultsAnswer[] }[] = [];
  const indexByDocument = new Map<string, number>();
  for (const a of answers) {
    const key = a.documentId ?? `unknown-${a.questionId}`;
    let idx = indexByDocument.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByDocument.set(key, idx);
      groups.push({ documentId: key, passage: a.passage, answers: [] });
    }
    groups[idx].answers.push(a);
  }
  return groups;
}

export function Results({
  attemptId,
  journey,
  profile,
  onQuizReady,
  onPlayAgain,
  onExplain,
}: {
  attemptId: string;
  // Only set when this attempt was one stop on a Quest Journey (see
  // SubjectPicker.tsx) - lets this screen offer "Next quest" straight into
  // the next topic instead of just "Play again".
  journey?: QuestJourney;
  profile: Profile;
  onQuizReady: (quiz: AssembleQuizResponse, journey?: QuestJourney) => void;
  onPlayAgain: () => void;
  // "Explain this to me" on a wrong answer - Section 10 step 7. Same
  // guard as Quiz.tsx: only offered when results.classId and the
  // question's own text are both actually present.
  onExplain: (context: TutorQuestionContext) => void;
}) {
  const [results, setResults] = useState<QuizResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextLoading, setNextLoading] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);

  const nextItem = journey && journey.index + 1 < journey.items.length ? journey.items[journey.index + 1] : null;
  const journeyFinished = journey !== undefined && nextItem === null;

  async function startNextQuest() {
    if (!journey || !nextItem) return;
    const nextIndex = journey.index + 1;
    setNextLoading(true);
    setNextError(null);
    try {
      const quiz = await assembleQuiz({
        subjectName: nextItem.subjectName,
        classId: journey.pkClass.id,
        topic: nextItem.topic,
        profileId: profile.id,
        stageSize: ALL_SUBJECTS_STAGE_SIZE,
      });
      onQuizReady(quiz, { ...journey, index: nextIndex });
    } catch (err) {
      setNextError(err instanceof Error ? err.message : "Failed to start the next quest");
    } finally {
      setNextLoading(false);
    }
  }

  useEffect(() => {
    getResults(attemptId)
      .then(setResults)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load results"));
  }, [attemptId]);

  const groups = useMemo(() => groupByDocument(results?.answers ?? []), [results]);

  if (error) {
    return (
      <main className="night-sky relative flex min-h-screen items-center justify-center overflow-hidden px-6">
        <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
        <p className="relative text-sm font-medium text-destructive">{error}</p>
      </main>
    );
  }

  if (!results) {
    return (
      <main className="night-sky relative flex min-h-screen items-center justify-center overflow-hidden px-6">
        <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
        <p className="relative text-muted-foreground">Loading results...</p>
      </main>
    );
  }

  const scored = results.score !== null;
  const percent = scored && results.totalQuestions > 0 ? Math.round(((results.score ?? 0) / results.totalQuestions) * 100) : null;
  const passed = percent !== null && percent >= 70;
  let answerNumber = 0;

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-16">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-2xl px-6 py-10">
        <header className="text-center">
          <span className="animate-float shadow-glow mx-auto grid size-20 place-items-center rounded-full bg-primary text-primary-foreground">
            {passed ? <PartyPopper className="size-9" /> : <Sparkles className="size-9" />}
          </span>
          <h1 className="mt-4 text-3xl">{results.subjectName ?? "Quiz"} results</h1>
          {scored && (
            <p className="mt-1 text-muted-foreground">
              {results.score} of {results.totalQuestions} correct{percent !== null ? ` (${percent}%)` : ""}
            </p>
          )}
        </header>

        <div className="mt-8 rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest">
          {groups.map((group) => (
            <div key={group.documentId}>
              {group.passage && (
                <div className="mb-4 rounded-2xl bg-secondary/50 p-5">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Passage</p>
                  <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{group.passage}</div>
                </div>
              )}

              <ol className="space-y-3">
                {group.answers.map((a) => {
                  answerNumber += 1;
                  return (
                    <AnswerReviewCard
                      key={a.questionId}
                      answer={a}
                      displayNumber={answerNumber}
                      onExplain={
                        a.questionText && results.classId
                          ? () =>
                              onExplain({
                                classId: results.classId!,
                                subjectId: results.subjectId,
                                subjectName: results.subjectName ?? "",
                                questionId: a.questionId,
                                questionText: a.questionText!,
                                attemptId,
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </ol>
            </div>
          ))}
        </div>

        {journey && (
          <div className="mt-7 flex flex-col items-center gap-3">
            {nextItem && (
              <>
                <Button size="lg" className="rounded-full font-display" onClick={startNextQuest} disabled={nextLoading}>
                  {nextLoading ? "Starting..." : `Next quest: ${nextItem.topic}`}
                  <ArrowRight className="size-4" />
                </Button>
                <p className="text-xs text-muted-foreground">{nextItem.subjectName}</p>
              </>
            )}
            {journeyFinished && (
              <>
                <p className="font-display text-lg font-bold text-primary">Quest journey complete!</p>
                <Button size="lg" variant="secondary" className="rounded-full font-display" onClick={onPlayAgain}>
                  Back to subjects
                </Button>
              </>
            )}
            {nextError && <p className="text-sm font-medium text-destructive">{nextError}</p>}
          </div>
        )}

        {!journey && (
          <div className="mt-7 flex justify-center">
            <Button size="lg" className="rounded-full font-display" onClick={onPlayAgain}>
              Play again
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
