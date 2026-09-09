import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Beaker,
  BookOpen,
  Calculator,
  Castle,
  Check,
  Compass,
  ListChecks,
  Lock,
  Palette,
  Play,
  Shuffle,
  Sparkles,
  Star,
} from "lucide-react";
import { assembleQuiz, getClassSubjects, getQuizInProgress, getTopicReports, getTopics, resumeQuiz } from "../api";
import type {
  AssembleQuizResponse,
  PkClass,
  Profile,
  QuestJourney,
  QuestJourneyItem,
  Subject,
  TopicReport,
} from "../types";
import { Button } from "../components/ui/button";

// "Topic Practice" quizzes clear in stages of 10 questions, tracked and
// resumable (see QuizInProgress below) - the "serious study" mode.
const STAGE_SIZE = 10;

// "Quest Journey" quizzes run one topic at a time as a single, un-staged
// quiz - so we ask the backend for a stage bigger than any topic's
// question bank could be. The API clamps stageSize to the actual question
// count (Math.min(requested, picked.length)), which collapses totalStages
// to exactly 1 no matter how many questions the topic has. A quest that's
// abandoned before its one stage is submitted just stays "current" next
// time (no partial credit to lose), so quests don't need the same
// resume-by-attempt tracking Topic Practice does.
const QUEST_STAGE_SIZE = 9999;

// A topic counts as mastered at the same accuracy bar Reports.tsx uses for
// its "emerald" (green) tier, so "quest complete" here means the same
// thing "doing well" means everywhere else in the app.
const COMPLETE_THRESHOLD = 0.75;

const JEWELS = ["emerald", "sapphire", "ruby", "amethyst", "gold"] as const;
type Jewel = (typeof JEWELS)[number];

const JEWEL_TEXT: Record<Jewel, string> = {
  emerald: "text-emerald",
  sapphire: "text-sapphire",
  ruby: "text-ruby",
  amethyst: "text-amethyst",
  gold: "text-primary",
};
const JEWEL_FILL: Record<Jewel, string> = {
  emerald: "bg-emerald",
  sapphire: "bg-sapphire",
  ruby: "bg-ruby",
  amethyst: "bg-amethyst",
  gold: "bg-primary",
};
const JEWEL_GLOW: Record<Jewel, string> = {
  emerald: "shadow-[0_0_0_8px_oklch(0.68_0.14_162/0.16)]",
  sapphire: "shadow-[0_0_0_8px_oklch(0.65_0.14_245/0.16)]",
  ruby: "shadow-[0_0_0_8px_oklch(0.63_0.185_18/0.16)]",
  amethyst: "shadow-[0_0_0_8px_oklch(0.66_0.15_305/0.16)]",
  gold: "shadow-glow",
};

// Subjects don't carry an icon/color from the backend, so we recognise the
// common Year 3 subject names and fall back to cycling the jewel palette
// for anything else (custom subjects an admin adds later still look good).
function subjectVisual(name: string, index: number): { icon: typeof Calculator; jewel: Jewel } {
  const lower = name.toLowerCase();
  if (lower.includes("math")) return { icon: Calculator, jewel: "emerald" };
  if (lower.includes("english") || lower.includes("liter")) return { icon: BookOpen, jewel: "ruby" };
  if (lower.includes("science")) return { icon: Beaker, jewel: "sapphire" };
  if (lower.includes("art")) return { icon: Palette, jewel: "amethyst" };
  return { icon: Sparkles, jewel: JEWELS[index % JEWELS.length] };
}

type NodeState = "completed" | "current" | "locked";
type QuestNode = QuestJourneyItem & { state: NodeState; accuracy: number | null };

// Turns an ordered topic list into a Lovable-style quest path: topics
// complete in order, one "current" quest unlocked at a time, everything
// after it locked - driven by each topic's real saved accuracy
// (buildTopicBreakdown on the API), not mock progress data.
function buildQuestNodes(items: QuestJourneyItem[], accuracyFor: (item: QuestJourneyItem) => number | null): QuestNode[] {
  let currentAssigned = false;
  return items.map((item) => {
    const accuracy = accuracyFor(item);
    if (accuracy !== null && accuracy >= COMPLETE_THRESHOLD) {
      return { ...item, state: "completed", accuracy };
    }
    if (!currentAssigned) {
      currentAssigned = true;
      return { ...item, state: "current", accuracy };
    }
    return { ...item, state: "locked", accuracy };
  });
}

function starsFor(accuracy: number | null): number {
  if (accuracy === null) return 0;
  if (accuracy >= 0.95) return 3;
  if (accuracy >= 0.85) return 2;
  return 1;
}

type InProgress = { attemptId: string; topic: string | null; stagesCleared: number; totalStages: number };

type Mode = "quest" | "practice";

export function SubjectPicker({
  pkClass,
  profile,
  onBack,
  onQuizReady,
}: {
  pkClass: PkClass;
  profile: Profile;
  onBack: () => void;
  // journey is only set for a Quest Journey quiz - Results.tsx uses it to
  // offer "next quest" and jump straight into the next topic.
  onQuizReady: (quiz: AssembleQuizResponse, journey?: QuestJourney) => void;
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  const [topics, setTopics] = useState<string[] | null>(null);
  const [topicReports, setTopicReports] = useState<TopicReport[] | null>(null);
  const [inProgress, setInProgress] = useState<InProgress[] | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClassSubjects(pkClass.id)
      .then(setSubjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, [pkClass.id]);

  // Topics are needed by both modes, so fetch them as soon as a subject
  // is picked, before the player has even chosen a mode.
  useEffect(() => {
    if (!selectedSubject) {
      setTopics(null);
      return;
    }
    setTopics(null);
    getTopics({ classId: pkClass.id, subjectName: selectedSubject })
      .then(setTopics)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load topics"));
  }, [pkClass.id, selectedSubject]);

  // Quest Journey needs each topic's real accuracy to lay out the path.
  useEffect(() => {
    if (!selectedSubject || mode !== "quest") {
      setTopicReports(null);
      return;
    }
    setTopicReports(null);
    getTopicReports({ classId: pkClass.id, subjectName: selectedSubject })
      .then(setTopicReports)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the quest map"));
  }, [pkClass.id, selectedSubject, mode]);

  // Topic Practice needs to know which topics (or "mixed practice", keyed
  // null) already have an in-progress attempt, so it can offer "Continue"
  // instead of "Start".
  useEffect(() => {
    if (!selectedSubject || mode !== "practice") {
      setInProgress(null);
      return;
    }
    setInProgress(null);
    getQuizInProgress({ profileId: profile.id, subjectName: selectedSubject, classId: pkClass.id })
      .then(setInProgress)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to check for quizzes in progress"));
  }, [pkClass.id, selectedSubject, mode, profile.id]);

  async function startQuest(index: number, items: QuestJourneyItem[]) {
    const item = items[index];
    if (!item) return;
    setLoading(true);
    setError(null);
    try {
      const quiz = await assembleQuiz({
        subjectName: item.subjectName,
        classId: pkClass.id,
        topic: item.topic,
        profileId: profile.id,
        stageSize: QUEST_STAGE_SIZE,
      });
      onQuizReady(quiz, { pkClass, items, index });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start quest");
    } finally {
      setLoading(false);
    }
  }

  async function startPractice(topic?: string) {
    if (!selectedSubject) return;
    setLoading(true);
    setError(null);
    const resumable = inProgress?.some((r) => r.topic === (topic ?? null));
    try {
      const quiz = resumable
        ? await resumeQuiz({ profileId: profile.id, subjectName: selectedSubject, classId: pkClass.id, topic }).catch(() =>
            assembleQuiz({
              subjectName: selectedSubject,
              classId: pkClass.id,
              topic,
              profileId: profile.id,
              stageSize: STAGE_SIZE,
            })
          )
        : await assembleQuiz({
            subjectName: selectedSubject,
            classId: pkClass.id,
            topic,
            profileId: profile.id,
            stageSize: STAGE_SIZE,
          });
      onQuizReady(quiz);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start quiz");
    } finally {
      setLoading(false);
    }
  }

  const step: "subject" | "mode" | "quest" | "practice" = !selectedSubject ? "subject" : !mode ? "mode" : mode;

  function goBack() {
    if (step === "quest" || step === "practice") setMode(null);
    else if (step === "mode") setSelectedSubject(null);
    else onBack();
  }

  const subjectIndex = subjects?.findIndex((s) => s.name === selectedSubject) ?? 0;
  const jewel: Jewel = selectedSubject ? subjectVisual(selectedSubject, subjectIndex).jewel : "gold";

  const questNodes: QuestNode[] | null =
    topics && topicReports
      ? buildQuestNodes(
          topics.map((topic) => ({ subjectName: selectedSubject!, topic })),
          (item) => topicReports.find((r) => r.topic === item.topic)?.accuracy ?? null
        )
      : null;
  const doneCount = questNodes?.filter((n) => n.state === "completed").length ?? 0;
  const allDone = questNodes !== null && questNodes.length > 0 && doneCount === questNodes.length;

  function inProgressFor(topic: string | undefined): InProgress | undefined {
    return inProgress?.find((r) => r.topic === (topic ?? null));
  }

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-16">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={goBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className={`text-xs font-semibold tracking-[0.28em] uppercase ${step === "subject" ? "text-primary/80" : JEWEL_TEXT[jewel]}`}>
              {step === "subject" ? "Choose your subject" : `${pkClass.name} · ${selectedSubject}`}
            </p>
            <h1 className="text-gold-shimmer text-3xl sm:text-4xl">
              {step === "subject" && "Pick a subject"}
              {step === "mode" && "How do you want to practice?"}
              {step === "quest" && "Quest Journey"}
              {step === "practice" && "Topic Practice"}
            </h1>
          </div>
          <span className="size-9" />
        </header>

        {step === "subject" && (
          <section className="mx-auto mt-10 w-full max-w-2xl flex-1">
            {subjects === null && !error && (
              <p className="mt-8 text-center text-muted-foreground">Loading subjects...</p>
            )}
            {subjects && subjects.length === 0 && (
              <p className="mt-8 text-center text-muted-foreground">
                No subjects yet for {pkClass.name} — add some content first.
              </p>
            )}

            {subjects && subjects.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2">
                {subjects.map((s, i) => {
                  const { icon: Icon, jewel: j } = subjectVisual(s.name, i);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSubject(s.name)}
                      style={{ animationDelay: `${i * 90}ms` }}
                      className="animate-pop-in shadow-quest group flex flex-col items-center rounded-3xl border border-border/70 bg-card/85 p-7 text-center backdrop-blur transition-transform hover:-translate-y-1.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span
                        className={`animate-float grid size-20 place-items-center rounded-full bg-secondary shadow-inner ${JEWEL_TEXT[j]}`}
                      >
                        <Icon className="size-10" />
                      </span>
                      <span className="mt-4 text-2xl font-display font-bold">{s.name}</span>
                      <span className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-display font-bold text-primary-foreground">
                        Choose
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {step === "mode" && (
          <section className="mx-auto mt-10 w-full max-w-xl flex-1">
            <div className="grid gap-5">
              <button
                onClick={() => setMode("quest")}
                className="animate-pop-in shadow-quest flex items-center gap-4 rounded-3xl border border-border/70 bg-card/85 p-6 text-left backdrop-blur transition-transform hover:-translate-y-1 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className={`animate-float grid size-16 shrink-0 place-items-center rounded-full bg-secondary shadow-inner ${JEWEL_TEXT[jewel]}`}>
                  <Compass className="size-8" />
                </span>
                <span className="flex-1">
                  <span className="block text-xl font-display font-bold">Quest Journey</span>
                  <span className="block text-sm text-muted-foreground">
                    Every topic in order, one quest at a time - no stages, just go.
                  </span>
                </span>
              </button>

              <button
                onClick={() => setMode("practice")}
                style={{ animationDelay: "90ms" }}
                className="animate-pop-in shadow-quest flex items-center gap-4 rounded-3xl border border-border/70 bg-card/85 p-6 text-left backdrop-blur transition-transform hover:-translate-y-1 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className={`animate-float grid size-16 shrink-0 place-items-center rounded-full bg-secondary shadow-inner ${JEWEL_TEXT[jewel]}`}>
                  <ListChecks className="size-8" />
                </span>
                <span className="flex-1">
                  <span className="block text-xl font-display font-bold">Topic Practice</span>
                  <span className="block text-sm text-muted-foreground">
                    Pick any topic, clear it stage by stage - pick up right where you left off.
                  </span>
                </span>
              </button>
            </div>
          </section>
        )}

        {step === "quest" && (
          <section className="mx-auto mt-6 w-full max-w-2xl flex-1">
            {questNodes === null && !error && (
              <p className="mt-8 text-center text-muted-foreground">Loading your quest map...</p>
            )}

            {questNodes !== null && questNodes.length === 0 && (
              <p className="mt-8 text-center text-muted-foreground">
                No topics are tagged yet for {selectedSubject} — add some topic-tagged content first.
              </p>
            )}

            {questNodes !== null && questNodes.length > 0 && (
              <>
                <div className="mx-auto max-w-sm rounded-full bg-card/70 p-1.5">
                  <div className="relative h-3 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${JEWEL_FILL[jewel]}`}
                      style={{ width: `${(doneCount / questNodes.length) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 pb-1 text-center text-xs font-semibold text-muted-foreground">
                    {doneCount} of {questNodes.length} quests complete
                  </p>
                </div>

                <div className="relative mt-10">
                  <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-gradient-to-b from-border via-border to-transparent" />

                  <ol className="relative space-y-8">
                    {questNodes.map((node, i) => {
                      const side = i % 2 === 0 ? "sm:mr-auto sm:pr-10" : "sm:ml-auto sm:pl-10";
                      return (
                        <li
                          key={node.topic}
                          className={`animate-pop-in flex w-full items-center gap-4 sm:w-1/2 ${side} ${
                            i % 2 === 0 ? "sm:flex-row-reverse sm:text-right" : ""
                          }`}
                          style={{ animationDelay: `${i * 70}ms` }}
                        >
                          <NodeBadge state={node.state} jewel={jewel} index={i + 1} />
                          <div
                            className={`flex-1 rounded-3xl border border-border/70 bg-card/80 px-5 py-4 backdrop-blur ${
                              node.state === "locked" ? "opacity-55" : "shadow-quest"
                            }`}
                          >
                            <p className="text-lg font-display font-bold">{node.topic}</p>
                            {node.state === "completed" && (
                              <p className={`mt-1 flex items-center gap-1 text-sm ${JEWEL_TEXT[jewel]} sm:justify-end`}>
                                {Array.from({ length: 3 }).map((_, s) => (
                                  <Star
                                    key={s}
                                    className={`size-4 ${s < starsFor(node.accuracy) ? "fill-current" : "opacity-30"}`}
                                  />
                                ))}
                              </p>
                            )}
                            {node.state === "current" && (
                              <Button
                                size="sm"
                                className="mt-3 rounded-full font-display"
                                onClick={() => startQuest(i, questNodes.map(({ subjectName, topic }) => ({ subjectName, topic })))}
                                disabled={loading}
                              >
                                <Play className="size-4" /> {loading ? "Starting..." : "Start quest"}
                              </Button>
                            )}
                            {node.state === "locked" && (
                              <p className="mt-1 text-sm text-muted-foreground">
                                Finish the quest before this one to unlock
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>

                  {allDone && (
                    <div className="mt-12 flex flex-col items-center">
                      <span
                        className={`animate-float grid size-24 place-items-center rounded-full border-2 bg-card/80 ${JEWEL_TEXT[jewel]} ${JEWEL_GLOW[jewel]}`}
                        style={{ borderColor: "currentColor" }}
                      >
                        <Castle className="size-11" />
                      </span>
                      <p className={`mt-3 text-xl font-display font-bold ${JEWEL_TEXT[jewel]}`}>Quest complete!</p>
                      <p className="text-sm text-muted-foreground">Every {selectedSubject} topic mastered so far</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {step === "practice" && (
          <section className="mx-auto mt-6 w-full max-w-2xl flex-1">
            {topics === null && !error && <p className="mt-8 text-center text-muted-foreground">Loading topics...</p>}

            {topics && (
              <div className="grid gap-3 sm:grid-cols-2">
                <PracticeCard
                  icon={Shuffle}
                  jewel={jewel}
                  title="Mixed practice"
                  subtitle="A bit of everything"
                  inProgress={inProgressFor(undefined)}
                  loading={loading}
                  onClick={() => startPractice(undefined)}
                />
                {topics.map((t) => (
                  <PracticeCard
                    key={t}
                    icon={ListChecks}
                    jewel={jewel}
                    title={t}
                    inProgress={inProgressFor(t)}
                    loading={loading}
                    onClick={() => startPractice(t)}
                  />
                ))}
              </div>
            )}

            {topics && topics.length === 0 && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                No topics tagged yet for {selectedSubject} - mixed practice covers every question saved for this
                subject.
              </p>
            )}
          </section>
        )}

        {error && <p className="mt-6 text-center text-sm font-medium text-destructive">{error}</p>}
      </div>
    </main>
  );
}

function PracticeCard({
  icon: Icon,
  jewel,
  title,
  subtitle,
  inProgress,
  loading,
  onClick,
}: {
  icon: typeof Calculator;
  jewel: Jewel;
  title: string;
  subtitle?: string;
  inProgress?: InProgress;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="animate-pop-in shadow-quest flex items-center gap-3 rounded-2xl border border-border/70 bg-card/80 p-4 text-left backdrop-blur transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
    >
      <span className={`grid size-11 shrink-0 place-items-center rounded-full bg-secondary ${JEWEL_TEXT[jewel]}`}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-semibold">{title}</span>
        {subtitle && !inProgress && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
        {inProgress && (
          <span className={`block text-xs font-semibold ${JEWEL_TEXT[jewel]}`}>
            Continue — stage {inProgress.stagesCleared + 1} of {inProgress.totalStages}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-display font-bold ${
          inProgress ? `${JEWEL_FILL[jewel]} text-background` : "bg-secondary text-foreground"
        }`}
      >
        {inProgress ? "Continue" : "Start"}
      </span>
    </button>
  );
}

function NodeBadge({ state, jewel, index }: { state: NodeState; jewel: Jewel; index: number }) {
  if (state === "completed") {
    return (
      <span
        className={`grid size-16 shrink-0 place-items-center rounded-full ${JEWEL_FILL[jewel]} ${JEWEL_GLOW[jewel]} text-background`}
      >
        <Check className="size-7" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="animate-float shadow-glow grid size-16 shrink-0 place-items-center rounded-full bg-primary text-2xl font-display font-extrabold text-primary-foreground">
        {index}
      </span>
    );
  }
  return (
    <span className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-border bg-secondary/70 text-muted-foreground">
      <Lock className="size-6" />
    </span>
  );
}
