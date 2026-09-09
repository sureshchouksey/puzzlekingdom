import { useEffect, useState } from "react";
import { ArrowLeft, LogOut, Settings2, Target, TrendingUp } from "lucide-react";
import { getAdminUsers, getReports, getTopicReports } from "../api";
import type { AdminUserSummary, AttemptReport, TopicReport } from "../types";
import { Button } from "../components/ui/button";

// Accuracy-tiered bar tint, same rule as Reports.tsx's child-facing view -
// red/gold/emerald says how well a topic is going, not which subject it's
// from (unlike the Lovable reference's static per-subject jewel colors,
// which don't map onto this app's real, continuously-varying accuracy).
function accuracyTint(accuracy: number | null): string {
  if (accuracy === null) return "bg-muted-foreground";
  if (accuracy < 0.5) return "bg-ruby";
  if (accuracy < 0.75) return "bg-primary";
  return "bg-emerald";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// A calm, read-only weekly-style summary for one child at a time - the
// same admin account as AdminDashboard.tsx (there is no separate parent
// role; see App.tsx's Screen type comment), but presenting the data the
// way a parent actually wants to see it rather than raw CRUD tables.
// Modeled on the Lovable reference's own /parent route
// (pixel-perfect-replica/src/routes/parent.tsx: stat cards, topic
// strengths, a suggested-focus callout, recent sessions table) using
// real data from GET /reports and /reports/topics scoped by ?profileId=
// (an admin-only override those routes already support) rather than the
// reference's static mock streak/minutes-practiced fields, which this
// app doesn't track.
export function ParentDashboard({
  onBack,
  onOpenAdminTools,
  onLogOut,
}: {
  onBack: () => void;
  onOpenAdminTools: () => void;
  onLogOut: () => void;
}) {
  const [profiles, setProfiles] = useState<AdminUserSummary[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [topicReports, setTopicReports] = useState<TopicReport[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminUsers()
      .then((rows) => {
        setProfiles(rows);
        if (rows.length > 0) setSelectedProfileId(rows[0].profileId);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load players"));
  }, []);

  useEffect(() => {
    if (!selectedProfileId) return;
    setTopicReports(null);
    setAttempts(null);
    Promise.all([getTopicReports({ profileId: selectedProfileId }), getReports({ profileId: selectedProfileId, limit: 10 })])
      .then(([topics, history]) => {
        setTopicReports(topics);
        setAttempts(history);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reports"));
  }, [selectedProfileId]);

  const child = profiles?.find((p) => p.profileId === selectedProfileId) ?? null;
  const needsWork = (topicReports ?? []).filter((t) => t.accuracy !== null && t.accuracy < 0.7).slice(0, 3);

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back to the kingdom">
              <ArrowLeft className="size-5" />
            </Button>
            <div>
              <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Parent dashboard</p>
              <h1 className="text-3xl">Weekly summary</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {profiles?.map((p) => (
              <Button
                key={p.profileId}
                variant={p.profileId === selectedProfileId ? "default" : "secondary"}
                className="rounded-full font-display"
                onClick={() => setSelectedProfileId(p.profileId)}
              >
                {p.name}
              </Button>
            ))}
            <Button variant="secondary" className="rounded-full" onClick={onOpenAdminTools}>
              <Settings2 className="size-4" />
              Admin tools
            </Button>
            <Button variant="secondary" className="rounded-full" onClick={onLogOut}>
              <LogOut className="size-4" />
              Log out
            </Button>
          </div>
        </header>

        {error && <p className="mt-6 text-sm font-medium text-destructive">{error}</p>}
        {profiles === null && !error && <p className="mt-8 text-muted-foreground">Loading players...</p>}
        {profiles && profiles.length === 0 && <p className="mt-8 text-muted-foreground">No players yet.</p>}

        {child && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: TrendingUp, label: "Quizzes played", value: `${child.quizzesPlayed}` },
                { icon: Target, label: "Stages cleared", value: `${child.stagesCleared}` },
                {
                  icon: TrendingUp,
                  label: "Accuracy",
                  value: child.accuracy !== null ? `${Math.round(child.accuracy * 100)}%` : "–",
                },
                {
                  icon: TrendingUp,
                  label: "Last active",
                  value: child.lastActive ? formatDate(child.lastActive) : "Never yet",
                },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
                  <s.icon className="size-5 text-primary" />
                  <p className="mt-3 text-3xl font-display font-extrabold">{s.value}</p>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </section>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <section className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
                <h2 className="text-xl">Topic strengths</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Accuracy across every topic {child.name} has attempted.
                </p>
                {topicReports === null && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}
                {topicReports && topicReports.length === 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">No completed quizzes yet.</p>
                )}
                {topicReports && topicReports.length > 0 && (
                  <ul className="mt-5 space-y-4">
                    {topicReports.map((t) => (
                      <li key={t.topic}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-semibold">{t.topic}</span>
                          <span className="text-muted-foreground">
                            {t.correct}/{t.total} correct · {t.attempts} {t.attempts === 1 ? "attempt" : "attempts"}
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

              <section className="rounded-2xl border border-border bg-card p-6">
                <h2 className="flex items-center gap-2 text-xl">
                  <Target className="size-5 text-primary" />
                  Suggested focus
                </h2>
                {topicReports !== null && needsWork.length === 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nothing under 70% right now - {child.name} is doing great across the board.
                  </p>
                )}
                {needsWork.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {needsWork.map((t) => (
                      <li key={t.topic} className="flex items-center justify-between gap-3">
                        <span className="font-semibold">{t.topic}</span>
                        <span className="text-muted-foreground">
                          {t.accuracy !== null ? `${Math.round(t.accuracy * 100)}%` : "–"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="mt-6 rounded-2xl border border-border bg-card p-6">
              <h2 className="text-xl">Recent sessions</h2>
              {attempts === null && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}
              {attempts && attempts.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No completed quizzes yet.</p>}
              {attempts && attempts.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="pb-2 font-semibold">When</th>
                        <th className="pb-2 font-semibold">Activity</th>
                        <th className="pb-2 text-right font-semibold">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {attempts.map((a) => {
                        const pct = a.totalQuestions > 0 ? Math.round(((a.score ?? 0) / a.totalQuestions) * 100) : 0;
                        return (
                          <tr key={a.id}>
                            <td className="py-3 text-muted-foreground">{formatDate(a.completedAt)}</td>
                            <td className="py-3 font-semibold">
                              {a.subjectName}
                              {a.className ? ` · ${a.className}` : ""}
                            </td>
                            <td className="py-3 text-right">
                              <span
                                className={`rounded-full px-3 py-1 font-bold ${
                                  pct >= 70 ? "bg-primary/15 text-primary" : "bg-secondary text-foreground"
                                }`}
                              >
                                {a.score ?? 0}/{a.totalQuestions}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
