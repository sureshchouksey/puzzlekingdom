import { useEffect, useState } from "react";
import { ArrowLeft, Target, TrendingUp } from "lucide-react";
import { getClasses, getClassSubjects, getReports, getSubjects, getTopicReports } from "../api";
import type { AttemptReport, PkClass, Subject, TopicReport } from "../types";
import { Button } from "../components/ui/button";

// Accuracy-tiered bar tint (red/gold/emerald), since - unlike the Lovable
// reference's static per-subject jewel colors - real topic accuracy here
// can land anywhere on the scale and the color should say something
// about *how well* a topic is going, not just which subject it's from.
function accuracyTint(accuracy: number | null): string {
  if (accuracy === null) return "bg-muted-foreground";
  if (accuracy < 0.5) return "bg-ruby";
  if (accuracy < 0.75) return "bg-primary";
  return "bg-emerald";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Reports({ onBack }: { onBack: () => void }) {
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selectedSubjectName, setSelectedSubjectName] = useState<string | null>(null);

  const [topicReports, setTopicReports] = useState<TopicReport[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Class filter options, fetched once.
  useEffect(() => {
    getClasses()
      .then(setClasses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load classes"));
  }, []);

  // Subject filter options depend on which class (if any) is selected.
  useEffect(() => {
    setSelectedSubjectName(null);
    const load = selectedClassId ? getClassSubjects(selectedClassId) : getSubjects();
    load.then(setSubjects).catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, [selectedClassId]);

  // The actual report data, re-fetched whenever a filter changes.
  useEffect(() => {
    const params = { classId: selectedClassId ?? undefined, subjectName: selectedSubjectName ?? undefined };
    setTopicReports(null);
    setAttempts(null);
    Promise.all([getTopicReports(params), getReports(params)])
      .then(([topics, history]) => {
        setTopicReports(topics);
        setAttempts(history);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reports"));
  }, [selectedClassId, selectedSubjectName]);

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-16">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-3xl px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className="text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">Just for you</p>
            <h1 className="text-3xl sm:text-4xl">My progress</h1>
          </div>
          <span className="size-9" />
        </header>

        {(classes && classes.length > 0) || (subjects && subjects.length > 0) ? (
          <section className="mt-6 flex flex-col items-center gap-3">
            {classes && classes.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant={selectedClassId === null ? "default" : "secondary"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setSelectedClassId(null)}
                >
                  All classes
                </Button>
                {classes.map((c) => (
                  <Button
                    key={c.id}
                    variant={selectedClassId === c.id ? "default" : "secondary"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setSelectedClassId(c.id)}
                  >
                    {c.name}
                  </Button>
                ))}
              </div>
            )}
            {subjects && subjects.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant={selectedSubjectName === null ? "default" : "secondary"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setSelectedSubjectName(null)}
                >
                  All subjects
                </Button>
                {subjects.map((s) => (
                  <Button
                    key={s.id}
                    variant={selectedSubjectName === s.name ? "default" : "secondary"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setSelectedSubjectName(s.name)}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {error && <p className="mt-4 text-center text-sm font-medium text-destructive">{error}</p>}

        <section className="mt-6 rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest">
          <h2 className="flex items-center gap-2 text-xl">
            <Target className="size-5 text-primary" />
            Topics to focus on
          </h2>
          {topicReports === null && !error && <p className="mt-4 text-muted-foreground">Loading...</p>}
          {topicReports && topicReports.length === 0 && (
            <p className="mt-4 text-muted-foreground">No completed quizzes yet for this filter.</p>
          )}
          {topicReports && topicReports.length > 0 && (
            <ul className="mt-5 space-y-4">
              {topicReports.map((t) => (
                <li key={t.topic}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{t.topic}</span>
                    <span className="text-muted-foreground">
                      {t.correct}/{t.total} correct · {t.attempts} {t.attempts === 1 ? "quiz" : "quizzes"}
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${accuracyTint(t.accuracy)}`}
                      style={{ width: `${t.accuracy === null ? 0 : Math.round(t.accuracy * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest">
          <h2 className="flex items-center gap-2 text-xl">
            <TrendingUp className="size-5 text-primary" />
            Recent quizzes
          </h2>
          {attempts === null && !error && <p className="mt-4 text-muted-foreground">Loading...</p>}
          {attempts && attempts.length === 0 && (
            <p className="mt-4 text-muted-foreground">No completed quizzes yet for this filter.</p>
          )}
          {attempts && attempts.length > 0 && (
            <ul className="mt-4 divide-y divide-border/60">
              {attempts.map((a) => (
                <li key={a.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold">
                      {a.subjectName}
                      {a.className ? ` · ${a.className}` : ""}
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">{formatDate(a.completedAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Score: <span className="font-semibold text-foreground">{a.score ?? 0}</span> / {a.totalQuestions}
                  </p>
                  {a.topicBreakdown && Object.keys(a.topicBreakdown).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(a.topicBreakdown).map(([topic, stats]) => (
                        <span key={topic} className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
                          {topic}: {stats.correct}/{stats.total}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
