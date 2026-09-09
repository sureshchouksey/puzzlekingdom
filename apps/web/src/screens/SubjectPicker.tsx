import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Beaker,
  BookOpen,
  Calculator,
  Castle,
  Check,
  Compass,
  Lock,
  Palette,
  Play,
  Sparkles,
  Star,
} from "lucide-react";
import { assembleQuiz, getClassSubjects, getTopicReports, getTopics } from "../api";
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

// Every quiz clears a "stage" - a checkpoint partway through - every 10
// questions. Not user-configurable: the number of stages is simply
// however many groups of 10 the subject's question count makes. This
// only applies when a player picks one subject (and optionally one
// topic) directly - see ALL_SUBJECTS_STAGE_SIZE below for the other mode.
const STAGE_SIZE = 10;

// "All subjects" journeys run one topic at a time as a single, un-staged
// quiz - so we ask the backend for a stage bigger than any topic's
// question bank could be. The API clamps stageSize to the actual question
// count (Math.min(requested, picked.length)), which collapses totalStages
// to exactly 1 no matter how many questions the topic has.
const ALL_SUBJECTS_STAGE_SIZE = 9999;

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

// Turns an ordered subject+topic list into a Lovable-style quest path:
// topics complete in order, one "current" quest unlocked at a time,
// everything after it locked - driven by each topic's real saved
// accuracy (buildTopicBreakdown on the API), not mock progress data.
// Shared by both the single-subject quest map and the "All subjects"
// journey - they only differ in which items/accuracy they pass in.
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

export function SubjectPicker({
  pkClass,
  profile,
  onBack,
  onQuizReady,
}: {
  pkClass: PkClass;
  profile: Profile;
  onBack: () => void;
  // journey is only set for an "All subjects" quest - Results.tsx uses it
  // to offer "next quest" and jump straight into the next topic.
  onQuizReady: (quiz: AssembleQuizResponse, journey?: QuestJourney) => void;
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);

  // Single-subject mode.
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[] | null>(null);
  const [topicReports, setTopicReports] = useState<TopicReport[] | null>(null);

  // "All subjects" mode: every subject's topics flattened into one
  // ordered journey, with accuracy looked up by "subject::topic" so two
  // subjects that happen to share a topic name don't collide.
  const [allSubjectsMode, setAllSubjectsMode] = useState(false);
  const [journeyItems, setJourneyItems] = useState<QuestJourneyItem[] | null>(null);
  const [journeyAccuracy, setJourneyAccuracy] = useState<Map<string, number | null> | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClassSubjects(pkClass.id)
      .then(setSubjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, [pkClass.id]);

  useEffect(() => {
    if (!selectedSubject) {
      setTopics(null);
      setTopicReports(null);
      return;
    }
    setTopics(null);
    setTopicReports(null);
    Promise.all([
      getTopics({ classId: pkClass.id, subjectName: selectedSubject }),
      getTopicReports({ classId: pkClass.id, subjectName: selectedSubject }),
    ])
      .then(([t, r]) => {
        setTopics(t);
        setTopicReports(r);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the quest map"));
  }, [pkClass.id, selectedSubject]);

  useEffect(() => {
    if (!allSubjectsMode || !subjects) {
      setJourneyItems(null);
      setJourneyAccuracy(null);
      return;
    }
    setJourneyItems(null);
    setJourneyAccuracy(null);
    Promise.all(
      subjects.map((s) =>
        Promise.all([
          getTopics({ classId: pkClass.id, subjectName: s.name }),
          getTopicReports({ classId: pkClass.id, subjectName: s.name }),
        ]).then(([t, r]) => ({ subjectName: s.name, topics: t, reports: r }))
      )
    )
      .then((bySubject) => {
        const items: QuestJourneyItem[] = [];
        const accuracy = new Map<string, number | null>();
        for (const { subjectName, topics: subjectTopics, reports } of bySubject) {
          for (const topic of subjectTopics) {
            items.push({ subjectName, topic });
            const report = reports.find((r) => r.topic === topic);
            accuracy.set(`${subjectName}::${topic}`, report?.accuracy ?? null);
          }
        }
        setJourneyItems(items);
        setJourneyAccuracy(accuracy);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the quest journey"));
  }, [allSubjectsMode, subjects, pkClass.id]);

  async function startQuiz(topic?: string) {
    if (!selectedSubject) return;
    setLoading(true);
    setError(null);
    try {
      const quiz = await assembleQuiz({
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

  async function startJourneyQuest(index: number, items: QuestJourneyItem[]) {
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
        stageSize: ALL_SUBJECTS_STAGE_SIZE,
      });
      onQuizReady(quiz, { pkClass, items, index });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start quest");
    } finally {
      setLoading(false);
    }
  }

  const step: "subject" | "quest" = selectedSubject || allSubjectsMode ? "quest" : "subject";

  function goBackFromQuest() {
    setSelectedSubject(null);
    setAllSubjectsMode(false);
  }

  const singleJewel = selectedSubject ? subjectVisual(selectedSubject, subjects?.findIndex((s) => s.name === selectedSubject) ?? 0).jewel : "gold";
  const overallJewel: Jewel = allSubjectsMode ? "gold" : singleJewel;

  const questNodes: QuestNode[] | null = allSubjectsMode
    ? journeyItems && journeyAccuracy
      ? buildQuestNodes(journeyItems, (item) => journeyAccuracy.get(`${item.subjectName}::${item.topic}`) ?? null)
      : null
    : topics && topicReports
      ? buildQuestNodes(
          topics.map((topic) => ({ subjectName: selectedSubject!, topic })),
          (item) => topicReports.find((r) => r.topic === item.topic)?.accuracy ?? null
        )
      : null;

  const doneCount = questNodes?.filter((n) => n.state === "completed").length ?? 0;
  const allDone = questNodes !== null && questNodes.length > 0 && doneCount === questNodes.length;

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-16">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => (step === "quest" ? goBackFromQuest() : onBack())}
            aria-label="Back"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className={`text-xs font-semibold tracking-[0.28em] uppercase ${step === "quest" ? JEWEL_TEXT[overallJewel] : "text-primary/80"}`}>
              {step === "subject" ? "Choose your subject" : allSubjectsMode ? `${pkClass.name} · Quest journey` : `${pkClass.name} · Quests`}
            </p>
            <h1 className="text-gold-shimmer text-3xl sm:text-4xl">
              {step === "subject" ? "Pick a subject" : allSubjectsMode ? "All subjects" : selectedSubject}
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
              <>
                <button
                  onClick={() => setAllSubjectsMode(true)}
                  className="animate-pop-in shadow-quest group mb-5 flex w-full items-center gap-4 rounded-3xl border border-border/70 bg-card/85 p-6 text-left backdrop-blur transition-transform hover:-translate-y-1 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="animate-float grid size-16 shrink-0 place-items-center rounded-full bg-secondary text-primary shadow-inner">
                    <Compass className="size-8" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-xl font-display font-bold">All subjects</span>
                    <span className="block text-sm text-muted-foreground">One topic at a time, across every subject</span>
                  </span>
                  <span className="hidden shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-display font-bold text-primary-foreground sm:inline-block">
                    Start
                  </span>
                </button>

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
              </>
            )}
          </section>
        )}

        {step === "quest" && (
          <section className="mx-auto mt-6 w-full max-w-2xl flex-1">
            {questNodes === null && !error && (
              <p className="mt-8 text-center text-muted-foreground">
                Loading your {allSubjectsMode ? "quest journey" : "quest map"}...
              </p>
            )}

            {questNodes !== null && questNodes.length === 0 && !allSubjectsMode && (
              <div className="animate-pop-in mt-8 rounded-3xl border border-border/70 bg-card/80 p-6 text-center backdrop-blur shadow-quest">
                <p className="text-sm text-muted-foreground">
                  Every question saved for {selectedSubject} will be included, in stages of {STAGE_SIZE} questions
                  each.
                </p>
                <Button
                  size="lg"
                  className="mt-5 h-14 w-full rounded-2xl text-lg font-display"
                  onClick={() => startQuiz(undefined)}
                  disabled={loading}
                >
                  <Play className="size-5 fill-current" />
                  {loading ? "Starting..." : "Start quiz"}
                </Button>
              </div>
            )}

            {questNodes !== null && questNodes.length === 0 && allSubjectsMode && (
              <p className="mt-8 text-center text-muted-foreground">
                No topics are tagged yet across your subjects — add some topic-tagged content first.
              </p>
            )}

            {questNodes !== null && questNodes.length > 0 && (
              <>
                <div className="mx-auto max-w-sm rounded-full bg-card/70 p-1.5">
                  <div className="relative h-3 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${JEWEL_FILL[overallJewel]}`}
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
                      const nodeJewel = allSubjectsMode
                        ? subjectVisual(node.subjectName, subjects?.findIndex((s) => s.name === node.subjectName) ?? 0).jewel
                        : overallJewel;
                      return (
                        <li
                          key={`${node.subjectName}::${node.topic}`}
                          className={`animate-pop-in flex w-full items-center gap-4 sm:w-1/2 ${side} ${
                            i % 2 === 0 ? "sm:flex-row-reverse sm:text-right" : ""
                          }`}
                          style={{ animationDelay: `${i * 70}ms` }}
                        >
                          <NodeBadge state={node.state} jewel={nodeJewel} index={i + 1} />
                          <div
                            className={`flex-1 rounded-3xl border border-border/70 bg-card/80 px-5 py-4 backdrop-blur ${
                              node.state === "locked" ? "opacity-55" : "shadow-quest"
                            }`}
                          >
                            {allSubjectsMode && (
                              <p className={`text-xs font-semibold tracking-wide uppercase ${JEWEL_TEXT[nodeJewel]}`}>{node.subjectName}</p>
                            )}
                            <p className="text-lg font-display font-bold">{node.topic}</p>
                            {node.state === "completed" && (
                              <p className={`mt-1 flex items-center gap-1 text-sm ${JEWEL_TEXT[nodeJewel]} sm:justify-end`}>
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
                                onClick={() =>
                                  allSubjectsMode && journeyItems
                                    ? startJourneyQuest(i, journeyItems)
                                    : startQuiz(node.topic)
                                }
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
                        className={`animate-float grid size-24 place-items-center rounded-full border-2 bg-card/80 ${JEWEL_TEXT[overallJewel]} ${JEWEL_GLOW[overallJewel]}`}
                        style={{ borderColor: "currentColor" }}
                      >
                        <Castle className="size-11" />
                      </span>
                      <p className={`mt-3 text-xl font-display font-bold ${JEWEL_TEXT[overallJewel]}`}>Quest complete!</p>
                      <p className="text-sm text-muted-foreground">
                        {allSubjectsMode ? "Every topic mastered so far" : `Every ${selectedSubject} topic mastered so far`}
                      </p>
                    </div>
                  )}
                </div>

                {!allSubjectsMode && (
                  <div className="mt-10 flex justify-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-full font-display"
                      onClick={() => startQuiz(undefined)}
                      disabled={loading}
                    >
                      Practice all topics mixed
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {error && <p className="mt-6 text-center text-sm font-medium text-destructive">{error}</p>}
      </div>
    </main>
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
