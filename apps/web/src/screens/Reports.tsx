import { useEffect, useState } from "react";
import { ArrowLeft, Beaker, BookOpen, Calculator, Palette, Sparkles, Star, Target, TrendingUp, Trophy } from "lucide-react";
import { getClasses, getClassSubjects, getReports, getSubjects, getTopicReports } from "../api";
import type { AttemptReport, PkClass, Subject, TopicReport } from "../types";
import { Button } from "../components/ui/button";

// Same subject -> icon/jewel recognition SubjectPicker.tsx's quest map
// uses, duplicated locally (this screen doesn't share state with it) so a
// quiz's subject in the history list gets the same visual identity it has
// everywhere else in the app, instead of a flat unstyled list.
const JEWELS = ["emerald", "sapphire", "ruby", "amethyst", "gold"] as const;
type Jewel = (typeof JEWELS)[number];

const JEWEL_TEXT: Record<Jewel, string> = {
  emerald: "text-emerald",
  sapphire: "text-sapphire",
  ruby: "text-ruby",
  amethyst: "text-amethyst",
  gold: "text-primary",
};

function subjectVisual(name: string, index: number): { icon: typeof Calculator; jewel: Jewel } {
  const lower = name.toLowerCase();
  if (lower.includes("math")) return { icon: Calculator, jewel: "emerald" };
  if (lower.includes("english") || lower.includes("liter")) return { icon: BookOpen, jewel: "ruby" };
  if (lower.includes("science")) return { icon: Beaker, jewel: "sapphire" };
  if (lower.includes("art")) return { icon: Palette, jewel: "amethyst" };
  return { icon: Sparkles, jewel: JEWELS[index % JEWELS.length] };
}

// Accuracy-tiered tint (red/gold/emerald) for bars and badges - real topic
// accuracy can land anywhere on the scale, so the color says how well a
// topic is going rather than which subject it's from.
function accuracyTint(accuracy: number | null): string {
  if (accuracy === null) return "bg-muted-foreground";
  if (accuracy < 0.5) return "bg-ruby";
  if (accuracy < 0.75) return "bg-primary";
  return "bg-emerald";
}
function accuracyText(accuracy: number | null): string {
  if (accuracy === null) return "text-muted-foreground";
  if (accuracy < 0.5) return "text-ruby";
  if (accuracy < 0.75) return "text-primary";
  return "text-emerald";
}

// Same 4-star band the Quest Journey map uses (70/80/90/100%), so a
// topic's stars mean the same thing here that they do there.
function starsFor(accuracy: number | null): number {
  if (accuracy === null) return 0;
  if (accuracy >= 1) return 4;
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.8) return 2;
  if (accuracy >= 0.7) return 1;
  return 0;
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

  // Overview stats, computed client-side from the same two calls above -
  // no new backend endpoint needed for an at-a-glance "how am I doing"
  // summary at the top of the page.
  const totalCorrect = topicReports?.reduce((sum, t) => sum + t.correct, 0) ?? 0;
  const totalAnswered = topicReports?.reduce((sum, t) => sum + t.total, 0) ?? 0;
  const overallAccuracy = totalAnswered > 0 ? totalCorrect / totalAnswered : null;
  const totalStars = topicReports?.reduce((sum, t) => sum + starsFor(t.accuracy), 0) ?? 0;

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
            <h1 className="text-gold-shimmer text-3xl sm:text-4xl">My progress</h1>
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

        {topicReports && topicReports.length > 0 && (
          <section className="animate-pop-in mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-3xl border border-border/70 bg-card/85 p-4 text-center backdrop-blur shadow-quest sm:p-5">
              <span className="mx-auto grid size-11 place-items-center rounded-full bg-secondary text-primary">
                <Trophy className="size-5" />
              </span>
              <p className="mt-2 text-2xl font-display font-extrabold sm:text-3xl">{attempts?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground sm:text-sm">Quizzes done</p>
            </div>
            <div className="rounded-3xl border border-border/70 bg-card/85 p-4 text-center backdrop-blur shadow-quest sm:p-5">
              <span className={`mx-auto grid size-11 place-items-center rounded-full bg-secondary ${accuracyText(overallAccuracy)}`}>
                <TrendingUp className="size-5" />
              </span>
              <p className="mt-2 text-2xl font-display font-extrabold sm:text-3xl">
                {overallAccuracy !== null ? `${Math.round(overallAccuracy * 100)}%` : "–"}
              </p>
              <p className="text-xs text-muted-foreground sm:text-sm">Overall accuracy</p>
            </div>
            <div className="rounded-3xl border border-border/70 bg-card/85 p-4 text-center backdrop-blur shadow-quest sm:p-5">
              <span className="mx-auto grid size-11 place-items-center rounded-full bg-secondary text-primary">
                <Star className="size-5 fill-current" />
              </span>
              <p className="mt-2 text-2xl font-display font-extrabold sm:text-3xl">{totalStars}</p>
              <p className="text-xs text-muted-foreground sm:text-sm">Stars earned</p>
            </div>
          </section>
        )}

        <section className="animate-pop-in mt-6 rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest">
          <h2 className="flex items-center gap-2 text-xl">
            <Target className="size-5 text-primary" />
            Topics to focus on
          </h2>
          {topicReports === null && !error && <p className="mt-4 text-muted-foreground">Loading...</p>}
          {topicReports && topicReports.length === 0 && (
            <p className="mt-4 text-muted-foreground">No completed quizzes yet for this filter.</p>
          )}
          {topicReports && topicReports.length > 0 && (
            <ul className="mt-5 space-y-5">
              {topicReports.map((t) => (
                <li key={t.topic}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-display font-bold">{t.topic}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.correct}/{t.total} correct · {t.attempts} {t.attempts === 1 ? "quiz" : "quizzes"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`text-sm font-display font-bold ${accuracyText(t.accuracy)}`}>
                        {t.accuracy !== null ? `${Math.round(t.accuracy * 100)}%` : "–"}
                      </span>
                      <div className="flex gap-0.5">
                        {Array.from({ length: 4 }).map((_, s) => (
                          <Star
                            key={s}
                            className={`size-3 ${
                              s < starsFor(t.accuracy) ? `${accuracyText(t.accuracy)} fill-current` : "text-muted-foreground opacity-30"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
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

        <section className="animate-pop-in mt-6 rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest">
          <h2 className="flex items-center gap-2 text-xl">
            <TrendingUp className="size-5 text-primary" />
            Recent quizzes
          </h2>
          {attempts === null && !error && <p className="mt-4 text-muted-foreground">Loading...</p>}
          {attempts && attempts.length === 0 && (
            <p className="mt-4 text-muted-foreground">No completed quizzes yet for this filter.</p>
          )}
          {attempts && attempts.length > 0 && (
            <ul className="mt-5 space-y-3">
              {attempts.map((a, i) => {
                const pct = a.totalQuestions > 0 ? Math.round(((a.score ?? 0) / a.totalQuestions) * 100) : 0;
                const { icon: Icon, jewel } = subjectVisual(a.subjectName, i);
                return (
                  <li key={a.id} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-secondary/40 p-4">
                    <span className={`grid size-11 shrink-0 place-items-center rounded-full bg-secondary ${JEWEL_TEXT[jewel]}`}>
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-display font-bold">
                          {a.subjectName}
                          {a.className ? ` · ${a.className}` : ""}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold text-background ${accuracyTint(
                            a.totalQuestions > 0 ? pct / 100 : null
                          )}`}
                        >
                          {pct}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(a.completedAt)} · Score {a.score ?? 0}/{a.totalQuestions}
                      </p>
                      {a.topicBreakdown && Object.keys(a.topicBreakdown).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Object.entries(a.topicBreakdown).map(([topic, stats]) => (
                            <span key={topic} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                              {topic}: {stats.correct}/{stats.total}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
