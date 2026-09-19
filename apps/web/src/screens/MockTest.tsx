import { useEffect, useRef, useState } from "react";
import { AlarmClock, ArrowLeft, ChevronRight, ListChecks, Timer } from "lucide-react";
import { assembleQuiz, getClassSubjects } from "../api";
import { CERT_EXAM_INFO, mockExamTimeLimitMinutes } from "../data/certExamInfo";
import type { AssembleQuizResponse, PkClass, Profile, Subject } from "../types";
import { Button } from "../components/ui/button";

type Step = "certification" | "intro";

// Mock Test entry flow (18 September 2026) - reached from CertPrepHub.
// Two short steps: pick a certification, then a confirmation screen that
// sets real-exam-timed expectations before Quiz.tsx takes over in "exam"
// mode. The quiz itself is assembled here (stageSize deliberately huge so
// the backend clamps it down to "every question this certification has,
// as one single stage" - see quizzes.ts's own comment on stageSize
// clamping) so the intro screen can show the real question count before
// the player commits, and so the whole exam is graded once at the end
// rather than the kid quiz flow's per-10-question staging.
export function MockTest({
  certPrepClass,
  profile,
  initialSubject,
  onStart,
  onBack,
}: {
  certPrepClass: PkClass | null;
  profile: Profile;
  // Set only by Certification Prep's hub (19 September 2026 flow
  // rework), which now picks the certification once, upfront - this
  // skips the "certification" step entirely and assembles the exam for
  // that certification automatically on mount instead.
  initialSubject?: string;
  onStart: (quiz: AssembleQuizResponse, timeLimitMinutes: number) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<Step>("certification");
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);

  const [assembling, setAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<AssembleQuizResponse | null>(null);

  useEffect(() => {
    if (!certPrepClass) {
      setSubjects([]);
      return;
    }
    getClassSubjects(certPrepClass.id)
      .then(setSubjects)
      .catch((err) => setSubjectsError(err instanceof Error ? err.message : "Failed to load certifications"));
  }, [certPrepClass]);

  async function chooseSubject(subjectName: string) {
    if (!certPrepClass) return;
    setAssembling(true);
    setAssembleError(null);
    try {
      // A deliberately oversized stageSize - the backend clamps it to
      // however many questions this subject actually has, so this always
      // produces exactly one stage covering the whole certification.
      const assembled = await assembleQuiz({
        subjectName,
        classId: certPrepClass.id,
        profileId: profile.id,
        stageSize: 500,
      });
      setQuiz(assembled);
      setStep("intro");
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : "Failed to start the mock exam");
    } finally {
      setAssembling(false);
    }
  }

  // Fires chooseSubject once, automatically, the moment the class is
  // ready - same effect as tapping the certification in the list below,
  // just triggered on mount instead. The ref guards against React 18's
  // dev-mode double-invoke re-assembling (and re-consuming) the exam.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!initialSubject || !certPrepClass || autoStarted.current) return;
    autoStarted.current = true;
    chooseSubject(initialSubject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubject, certPrepClass]);

  function goBack() {
    if (step === "intro") {
      // initialSubject means there was never a real "certification" step
      // here - it was chosen upstream on CertPrepHub - so backing out of
      // "intro" leaves Mock Test entirely instead of re-showing a
      // one-item certification list.
      if (initialSubject) {
        onBack();
      } else {
        setStep("certification");
        setQuiz(null);
      }
    } else onBack();
  }

  const examInfo = quiz ? CERT_EXAM_INFO[quiz.subjectName] : undefined;
  const actualCount = quiz?.questions.length ?? 0;
  const timeLimitMinutes = quiz ? mockExamTimeLimitMinutes(quiz.subjectName, actualCount) : 0;
  const perQuestionSeconds = examInfo ? Math.round((examInfo.durationMinutes * 60) / examInfo.questions) : null;

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={goBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">
              {step === "certification" ? "Mock Test" : "Ready when you are"}
            </p>
            <h1 className="text-3xl">
              {step === "certification" ? (initialSubject ?? "Choose a certification") : quiz?.subjectName}
            </h1>
          </div>
        </header>

        {/* initialSubject: the certification was already chosen on
            CertPrepHub, so chooseSubject fires automatically on mount
            (see the effect above) - this just shows a brief "preparing"
            state instead of a one-item list that would flash and vanish. */}
        {step === "certification" && initialSubject && (
          <section className="mt-8">
            {assembleError && <p className="text-sm font-medium text-destructive">{assembleError}</p>}
            <p className="text-muted-foreground">Preparing your mock exam...</p>
          </section>
        )}

        {step === "certification" && !initialSubject && (
          <section className="mt-8">
            {subjectsError && <p className="text-sm font-medium text-destructive">{subjectsError}</p>}
            {assembleError && <p className="mt-2 text-sm font-medium text-destructive">{assembleError}</p>}
            {subjects === null && !subjectsError && <p className="text-muted-foreground">Loading certifications...</p>}
            {subjects !== null && subjects.length === 0 && !subjectsError && (
              <p className="text-muted-foreground">No certifications have been seeded into this study space yet.</p>
            )}
            <div className="flex flex-col gap-3">
              {subjects?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={assembling}
                  onClick={() => chooseSubject(s.name)}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-slate-50">
                    <Timer className="size-5" />
                  </span>
                  <span className="flex-1 font-semibold">{s.name}</span>
                  {assembling ? (
                    <span className="text-xs text-muted-foreground">Preparing...</span>
                  ) : (
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "intro" && quiz && (
          <section className="mt-8">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ListChecks className="size-4 text-primary" />
                {actualCount} question{actualCount === 1 ? "" : "s"} in this run
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {examInfo
                  ? `The official ${examInfo.abbreviation} exam has ${examInfo.questions} questions over ${examInfo.durationMinutes} minutes (about ${perQuestionSeconds}s per question). This run uses every question currently seeded for this certification, timed at the same pace.`
                  : "This run uses every question currently seeded for this certification."}
              </p>

              <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
                <AlarmClock className="size-4 text-primary" />
                {timeLimitMinutes} minute{timeLimitMinutes === 1 ? "" : "s"} on the clock
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                The timer starts as soon as you begin and submits automatically at zero. You can move between
                questions freely, but you won't see what's right or wrong until you finish.
              </p>

              <p className="mt-4 text-xs text-muted-foreground">
                Scoring here uses this app's own 70%-to-pass bar, not the real exam's scaled score - see the study
                space's Exam details for how those differ.
              </p>
            </div>

            <Button size="lg" className="mt-6 w-full gap-2" onClick={() => onStart(quiz, timeLimitMinutes)}>
              <Timer className="size-4" />
              Start mock exam
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={goBack}>
              {initialSubject ? "Back" : "Choose a different certification"}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
