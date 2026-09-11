import { useEffect, useState } from "react";
import { ArrowLeft, Briefcase, GraduationCap, Heart, Landmark, LogOut, Plus, Target, Users } from "lucide-react";
import {
  addFamilyProfile,
  bootstrapChildPin,
  getFamilyFeatures,
  getFamilyMetricsSummary,
  getFamilyProfiles,
  getReports,
  getTopicReports,
  logout,
  updateFamilyFeatures,
} from "../api";
import type {
  AttemptReport,
  ChildActivitySummary,
  FamilyFeatureFlags,
  FamilyMetricsSummary,
  FamilyOwner,
  GameKey,
  MetricsPeriod,
  Profile,
  TopicReport,
} from "../types";
import type { Title } from "../avatars";
import { avatarFile } from "../avatars";
import { Button } from "../components/ui/button";
import { AvatarPicker } from "../components/AvatarPicker";
import { StarPinDots, PinKeypad } from "../components/PinPad";
import { GAME_META } from "./Arcade";

// "Xh Ym" (or just "Ym" under an hour, "0m" for no activity at all) -
// shared by every activity-time display on this screen.
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Same accuracy-tiered bar tint as ParentDashboard.tsx/Reports.tsx's own
// copies - red/gold/emerald says how well a topic is going, not which
// subject it's from.
function accuracyTint(accuracy: number | null): string {
  if (accuracy === null) return "bg-muted-foreground";
  if (accuracy < 0.5) return "bg-ruby";
  if (accuracy < 0.75) return "bg-primary";
  return "bg-emerald";
}

const PERIOD_LABELS: Record<MetricsPeriod, string> = { day: "Today", week: "This week", month: "This month" };

// The 4 family-level feature toggles ("bigger plan for family/parent
// dashboard" request, 11 September 2026). Per direct user instruction
// ("Just add toggle right now we will implement in phase 3 and phase 4,
// just create a dashboard only"), only childEducationEnabled gates
// something real today - the reports/activity views already built
// above. The other three just reveal a "coming soon" placeholder once
// turned on; the real integrations (SmartClassify-style IT/Council job
// matching, council activity feeds, health tracking) are deferred to a
// later phase.
const FEATURE_META: Record<
  keyof FamilyFeatureFlags,
  { label: string; description: string; icon: typeof Heart; comingSoon: boolean }
> = {
  childEducationEnabled: {
    label: "Child Education",
    description: "Quiz reports, topic strengths and time in the Kingdom for each child.",
    icon: GraduationCap,
    comingSoon: false,
  },
  childHealthEnabled: {
    label: "Child Health",
    description: "Track each child's health and wellbeing.",
    icon: Heart,
    comingSoon: true,
  },
  itJobsEnabled: {
    label: "IT Jobs",
    description: "IT job openings near you, matched to your profile.",
    icon: Briefcase,
    comingSoon: true,
  },
  councilJobsEnabled: {
    label: "Council Jobs",
    description: "NHS, schools, nursery, library and volunteer roles near you.",
    icon: Landmark,
    comingSoon: true,
  },
};

// One accent per child, cycling through the app's own jewel-tone
// palette (same tokens accuracyTint already draws on) so a family's
// cards are quick to tell apart at a glance. Written as literal
// Tailwind class names (not built from a template string) so the
// Tailwind content scanner actually picks them up.
const CHILD_ACCENTS: { bg: string; text: string; border: string }[] = [
  { bg: "bg-ruby", text: "text-ruby", border: "border-ruby" },
  { bg: "bg-sapphire", text: "text-sapphire", border: "border-sapphire" },
  { bg: "bg-emerald", text: "text-emerald", border: "border-emerald" },
  { bg: "bg-amethyst", text: "text-amethyst", border: "border-amethyst" },
];

function FeatureToggleRow({
  flagKey,
  checked,
  disabled,
  onChange,
}: {
  flagKey: keyof FamilyFeatureFlags;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const meta = FEATURE_META[flagKey];
  const Icon = meta.icon;
  return (
    <div className={`flex items-center gap-4 rounded-2xl border border-border bg-card p-4 ${disabled ? "opacity-60" : ""}`}>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
        <Icon className="size-5" />
      </span>
      <div className="flex-1">
        <p className="font-semibold">{meta.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
      </div>
      {meta.comingSoon && (
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
          Coming soon
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={meta.label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`flex h-[26px] w-[46px] shrink-0 items-center rounded-full p-[3px] transition-colors ${checked ? "bg-primary" : "bg-border"}`}
      >
        <span
          className={`size-5 rounded-full bg-primary-foreground shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}

// One child's "Time in the Kingdom" card - total time, a couple of
// highlights, and a tiny daily-trend bar chart (no charting dependency,
// matching the app's current zero-chart-library baseline - each bar is
// just a div sized relative to that child's own busiest day). Used both
// in the family-wide grid and (slightly differently) atop the single-
// child detail view below.
function ChildActivityCard({ child }: { child: ChildActivitySummary }) {
  const maxSeconds = Math.max(1, ...child.dailyTrend.map((d) => d.seconds));
  const topGameLabel = child.topGame ? GAME_META[child.topGame as GameKey]?.title ?? child.topGame : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-border bg-card p-6">
      <div>
        <p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Time in the Kingdom</p>
        <p className="font-display text-3xl font-extrabold text-primary">{formatDuration(child.totalSeconds)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Active {child.activeDays} {child.activeDays === 1 ? "day" : "days"}
          {child.topTopic && ` · Mostly ${child.topTopic}`}
          {topGameLabel && ` · Loves ${topGameLabel}`}
        </p>
      </div>
      {child.dailyTrend.length > 0 && (
        <div className="flex h-12 items-end gap-1.5">
          {child.dailyTrend.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${formatDuration(d.seconds)}`}
              className={`min-h-1 w-2.5 rounded-t bg-primary ${d.seconds === maxSeconds ? "" : "opacity-40"}`}
              style={{ height: `${Math.max(10, (d.seconds / maxSeconds) * 100)}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One child's read-only detail view - what tapping a child's card now
// opens (11 September 2026, per direct user feedback after trying the
// PIN-to-play flow live: tapping a child felt like it should show how
// they're doing, not hand the parent's device over to that child's own
// session). No PIN, never leaves the parent dashboard. Scoped via
// GET /reports(/topics)?profileId= - now safe for a family owner to call
// with another profile's id, since routes/reports.ts checks the
// requested profile actually belongs to the caller's own family (fixed
// alongside this view; see that route's own comment).
function ChildDetailView({
  profile,
  activity,
  educationEnabled,
  onBack,
}: {
  profile: Profile;
  activity: ChildActivitySummary | undefined;
  educationEnabled: boolean;
  onBack: () => void;
}) {
  const [topicReports, setTopicReports] = useState<TopicReport[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Nothing to fetch while the family has Child Education turned off -
    // see the "Family features" panel on FamilyDashboard.tsx below.
    if (!educationEnabled) return;
    setTopicReports(null);
    setAttempts(null);
    setError(null);
    Promise.all([getTopicReports({ profileId: profile.id }), getReports({ profileId: profile.id, limit: 10 })])
      .then(([topics, history]) => {
        setTopicReports(topics);
        setAttempts(history);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reports"));
  }, [profile.id, educationEnabled]);

  const needsWork = (topicReports ?? []).filter((t) => t.accuracy !== null && t.accuracy < 0.7).slice(0, 3);

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        <h2 className="text-xl font-semibold">{profile.name}</h2>
      </div>

      {!educationEnabled && (
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          Child Education tracking is turned off for your family. Turn it on in Family features below to see {profile.name}
          &apos;s reports and activity time.
        </p>
      )}

      {educationEnabled && (
        <>
          {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}

          {activity && (
            <div className="mt-4">
              <ChildActivityCard child={activity} />
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold">Topic strengths</h3>
          <p className="mt-1 text-sm text-muted-foreground">Accuracy across every topic {profile.name} has attempted.</p>
          {topicReports === null && !error && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}
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
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="size-5 text-primary" />
            Suggested focus
          </h3>
          {topicReports !== null && needsWork.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing under 70% right now - {profile.name} is doing great across the board.
            </p>
          )}
          {needsWork.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {needsWork.map((t) => (
                <li key={t.topic} className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{t.topic}</span>
                  <span className="text-muted-foreground">{t.accuracy !== null ? `${Math.round(t.accuracy * 100)}%` : "–"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Recent sessions</h3>
        {attempts === null && !error && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}
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
  );
}

// Track 7: what a logged-in family owner sees - only their own kids (GET
// /families/me/profiles, never another family's), a way to add another
// child, and (11 September 2026) a read-only detail view of any one
// child's progress and activity time when their card is tapped.
//
// Actually playing as a child is deliberately NOT done from here anymore
// - per direct user feedback, tapping a child used to prompt for their
// PIN and hand the parent's device straight into that child's own Home
// screen, which felt like the wrong action for a tap on the family
// dashboard. A child now plays the same way they always could
// independently of this screen: from the app's own Welcome screen, by
// typing their name and PIN themselves.
type Step =
  | { kind: "list" }
  | { kind: "addChildInfo" }
  | { kind: "addChildAvatar"; nickname: string; yearGroup: string }
  // Brand-new child, hasPin always false - reuses the existing
  // setProfilePin bootstrap, same as Welcome.tsx's newTitle -> setPin step.
  | { kind: "addChildPin"; profile: Profile }
  | { kind: "childDetail"; profile: Profile };

export function FamilyDashboard({
  owner,
  onLogOut,
}: {
  owner: FamilyOwner;
  onLogOut: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [period, setPeriod] = useState<MetricsPeriod>("week");
  const [metrics, setMetrics] = useState<FamilyMetricsSummary | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  // "Family features" panel state (11 September 2026) - null while
  // loading, treated as childEducationEnabled: true in the meantime so
  // the existing reports/activity views never flash hidden then shown.
  const [features, setFeatures] = useState<FamilyFeatureFlags | null>(null);
  const [featuresError, setFeaturesError] = useState<string | null>(null);
  const [savingFeature, setSavingFeature] = useState<keyof FamilyFeatureFlags | null>(null);
  const [nickname, setNickname] = useState("");
  const [yearGroup, setYearGroup] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinField, setPinField] = useState<"pin" | "confirm">("pin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Time in the Kingdom" - re-fetched whenever the day/week/month toggle
  // changes, mirroring refreshProfiles' own fetch-on-mount pattern above.
  // Shared across both the family-wide grid and each child's own detail
  // view (see ChildDetailView's `activity` prop below) - one fetch, no
  // extra round trip just because a child's card was tapped.
  useEffect(() => {
    getFamilyMetricsSummary({ period })
      .then(setMetrics)
      .catch((err) => setMetricsError(err instanceof Error ? err.message : "Failed to load activity"));
  }, [period]);

  useEffect(() => {
    getFamilyFeatures()
      .then(setFeatures)
      .catch((err) => setFeaturesError(err instanceof Error ? err.message : "Failed to load family features"));
  }, []);

  // Optimistic toggle - flips the switch immediately, then confirms
  // against the server; reverts and surfaces an error if the PATCH
  // fails. Only one toggle can be mid-save at a time (savingFeature),
  // same lightweight "disable the row you just pressed" pattern as
  // AdminDashboard.tsx's own flag rows.
  async function toggleFeature(key: keyof FamilyFeatureFlags, next: boolean) {
    if (!features || savingFeature) return;
    const previous = features;
    setFeatures({ ...features, [key]: next });
    setFeaturesError(null);
    setSavingFeature(key);
    try {
      const updated = await updateFamilyFeatures({ [key]: next });
      setFeatures(updated);
    } catch (err) {
      setFeatures(previous);
      setFeaturesError(err instanceof Error ? err.message : "Failed to update family features");
    } finally {
      setSavingFeature(null);
    }
  }

  function refreshProfiles() {
    getFamilyProfiles()
      .then(setProfiles)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your children"));
  }

  function resetForm() {
    setStep({ kind: "list" });
    setNickname("");
    setYearGroup("");
    setPin("");
    setConfirmPin("");
    setPinField("pin");
    setError(null);
  }

  async function handleAddChildPin(profile: Profile) {
    if (pin.length !== 4) {
      setError("PIN must be 4 digits");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // bootstrapChildPin, not setProfilePin - the family owner's own
      // token must stay active (see that function's own comment).
      await bootstrapChildPin(profile.id, { pin });
      refreshProfiles();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set PIN");
      setSubmitting(false);
    }
  }

  async function handleCreateProfile(title: Title, avatarId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const created = await addFamilyProfile({ nickname, yearGroup: yearGroup.trim() || undefined, title, avatarId });
      setStep({ kind: "addChildPin", profile: created });
      setPin("");
      setConfirmPin("");
      setPinField("pin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add child");
    } finally {
      setSubmitting(false);
    }
  }

  // Only used by addChildPin now (PIN + Confirm sharing one keypad, same
  // auto-advance pattern as Welcome.tsx's pressSetPinDigit) - the second
  // "just one PIN field" mode this used to also support was for the
  // enterPin/"play as this child" step, which is gone (see the Step type
  // comment above).
  function pressPinDigit(d: string) {
    if (pinField === "pin") {
      if (pin.length < 4) {
        const next = pin + d;
        setPin(next);
        if (next.length === 4) setPinField("confirm");
      }
    } else if (confirmPin.length < 4) {
      setConfirmPin(confirmPin + d);
    }
  }

  function backspacePin() {
    if (pinField === "confirm") {
      if (confirmPin.length > 0) setConfirmPin(confirmPin.slice(0, -1));
      else setPinField("pin");
    } else {
      setPin(pin.slice(0, -1));
    }
  }

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              <Users className="size-5" />
            </span>
            <div>
              <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Puzzle Kingdom</p>
              <h1 className="text-2xl">Your family</h1>
              <p className="text-sm text-muted-foreground">{owner.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              logout();
              onLogOut();
            }}
            className="gap-2"
          >
            <LogOut className="size-4" />
            Log out
          </Button>
        </header>

        {error && step.kind === "list" && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}

        {step.kind === "list" && (
          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Your children</h2>
                <p className="mt-1 text-sm text-muted-foreground">Tap a child to see their reports and time in the Kingdom.</p>
              </div>
              {(features === null || features.childEducationEnabled) && (
                <div className="flex gap-2">
                  {(Object.keys(PERIOD_LABELS) as MetricsPeriod[]).map((p) => (
                    <Button key={p} size="sm" variant={period === p ? "default" : "secondary"} onClick={() => setPeriod(p)}>
                      {PERIOD_LABELS[p]}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {metricsError && (features === null || features.childEducationEnabled) && (
              <p className="mt-3 text-sm font-medium text-destructive">{metricsError}</p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {profiles === null && <p className="text-sm text-muted-foreground">Loading...</p>}
              {profiles?.map((p, i) => {
                const file = avatarFile(p.avatarId);
                const accent = CHILD_ACCENTS[i % CHILD_ACCENTS.length];
                const showActivity = features === null || features.childEducationEnabled;
                const activity = metrics?.children.find((c) => c.profileId === p.id);
                const maxSeconds = activity ? Math.max(1, ...activity.dailyTrend.map((d) => d.seconds)) : 1;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setStep({ kind: "childDetail", profile: p });
                      setError(null);
                    }}
                    className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                  >
                    <div className="flex items-center gap-3.5">
                      {file ? (
                        <img
                          src={file}
                          alt=""
                          className={`size-14 shrink-0 rounded-full border-2 object-cover ${accent.border}`}
                        />
                      ) : (
                        <span
                          className={`grid size-14 shrink-0 place-items-center rounded-full text-lg font-semibold text-primary-foreground ${accent.bg}`}
                        >
                          {p.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[p.title, p.yearGroup].filter(Boolean).join(" · ") || "Tap to see their progress"}
                        </p>
                      </div>
                    </div>
                    {showActivity && (
                      <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5">
                        <div>
                          <p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                            {PERIOD_LABELS[period]}
                          </p>
                          <p className={`font-display text-xl font-extrabold ${accent.text}`}>
                            {activity ? formatDuration(activity.totalSeconds) : metrics ? "0m" : "..."}
                          </p>
                        </div>
                        {activity && activity.dailyTrend.length > 0 && (
                          <div className="flex h-8 items-end gap-[3px]">
                            {activity.dailyTrend.map((d) => (
                              <div
                                key={d.date}
                                title={`${d.date}: ${formatDuration(d.seconds)}`}
                                className={`min-h-1 w-1.5 rounded-t ${accent.bg} ${d.seconds === maxSeconds ? "" : "opacity-40"}`}
                                style={{ height: `${Math.max(10, (d.seconds / maxSeconds) * 100)}%` }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setStep({ kind: "addChildInfo" });
                  setNickname("");
                  setYearGroup("");
                  setError(null);
                }}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
              >
                <Plus className="size-4" />
                Add a child
              </button>
            </div>
          </section>
        )}

        {step.kind === "list" && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Family features</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn on the features your family wants to use. Child Education is ready today - the rest are coming soon.
            </p>

            {featuresError && <p className="mt-3 text-sm font-medium text-destructive">{featuresError}</p>}
            {!features && !featuresError && <p className="mt-3 text-sm text-muted-foreground">Loading...</p>}

            {features && (
              <div className="mt-4 flex flex-col gap-3">
                {(Object.keys(FEATURE_META) as (keyof FamilyFeatureFlags)[]).map((key) => (
                  <FeatureToggleRow
                    key={key}
                    flagKey={key}
                    checked={features[key]}
                    disabled={savingFeature === key}
                    onChange={(next) => toggleFeature(key, next)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {step.kind === "childDetail" && (
          <ChildDetailView
            profile={step.profile}
            activity={metrics?.children.find((c) => c.profileId === step.profile.id)}
            educationEnabled={features === null || features.childEducationEnabled}
            onBack={resetForm}
          />
        )}

        {step.kind === "addChildInfo" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Add a child</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use a nickname, not their real name - keeps things private.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!nickname.trim()) return;
                setStep({ kind: "addChildAvatar", nickname: nickname.trim(), yearGroup: yearGroup.trim() });
              }}
              className="mt-6 text-left"
            >
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Nickname</span>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <label className="mb-6 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Year group (optional)</span>
                <input
                  value={yearGroup}
                  onChange={(e) => setYearGroup(e.target.value)}
                  placeholder="Year 3"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <Button type="submit" className="w-full" disabled={!nickname.trim()}>
                Continue
              </Button>
            </form>
            <button
              type="button"
              onClick={resetForm}
              className="mx-auto mt-5 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
            >
              &larr; Back
            </button>
          </div>
        )}

        {step.kind === "addChildAvatar" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Hi {step.nickname}! Pick an avatar.</h2>
            <div className="mt-6">
              <AvatarPicker onPick={(title, avatarId) => handleCreateProfile(title, avatarId)} />
            </div>
            {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
            <button
              type="button"
              onClick={resetForm}
              className="mx-auto mt-5 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
            >
              &larr; Back
            </button>
          </div>
        )}

        {step.kind === "addChildPin" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Choose a 4-digit PIN for {step.profile.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">They'll use it every time they play.</p>
            <div className="mt-6">
              <p className={`mb-2 text-xs font-semibold tracking-wide uppercase ${pinField === "pin" ? "text-primary" : "text-muted-foreground"}`}>
                PIN
              </p>
              <StarPinDots value={pin} />
            </div>
            <div className="mt-5">
              <p className={`mb-2 text-xs font-semibold tracking-wide uppercase ${pinField === "confirm" ? "text-primary" : "text-muted-foreground"}`}>
                Confirm
              </p>
              <StarPinDots value={confirmPin} />
            </div>
            <PinKeypad onDigit={pressPinDigit} onBackspace={backspacePin} onBack={resetForm} />
            <Button
              onClick={() => handleAddChildPin(step.profile)}
              disabled={submitting || pin.length !== 4 || confirmPin.length !== 4}
              size="lg"
              className="mt-6 h-14 w-full rounded-2xl text-lg"
            >
              {submitting ? "Saving..." : "Save PIN"}
            </Button>
            {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
