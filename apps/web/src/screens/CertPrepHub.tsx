import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bird,
  BookOpen,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Compass,
  ExternalLink,
  GraduationCap,
  LayoutGrid,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";
import { getClassSubjects, getFeatures } from "../api";
import type { PkClass, Subject } from "../types";
import { Button } from "../components/ui/button";
import { CERT_COURSE_INFO } from "../data/certCourseInfo";
import { CERT_EXAM_INFO } from "../data/certExamInfo";

// Landing screen for the family owner's own study space (18 September
// 2026, generalized to multiple certifications the same day) - reached
// from FamilyDashboard's "Certification prep" card via App.tsx's
// handleOpenCertPrep, which swaps the stored session token to a
// dedicated "study profile" first. Deliberately styled with the same
// neutral ".parchment" system as FamilyDashboard/ParentDashboard/
// AdminDashboard, not the kid-facing night-sky/gold quiz chrome.
//
// Flow rework (19 September 2026, direct user request - "First user
// select the course... every time user will select certification type
// on mock test, flash cards and progress reports, this is repeatable
// part"): the certification is now chosen exactly once, right here, not
// re-asked by every downstream screen. Two internal steps:
//
//   1. "certification" - only shown when there's actually more than one
//      certification seeded (see the auto-select effect below, which
//      skips straight past this today, since only one certification
//      exists). Adding a second certification later is purely a seeding
//      step - this step and the list it renders are already generic.
//   2. "hub" - everything about the chosen certification: its Content
//      (the topic list every quiz/flashcard/Arcade session pulls from),
//      Exam details (the existing collapsible reference card), and the
//      four actions - Take a quiz, Flashcards, Mock test, Progress
//      report - each now called with the certification's subject name
//      already in hand.
//
// Each of those four downstream screens (SubjectPicker/Flashcards/
// MockTest/Reports) accepts an optional initialSubject prop that skips
// its own "choose a certification" step entirely when set - see each
// file's own comment for how. "Take a quiz" specifically drops the
// player straight onto SubjectPicker's mode step (Quest / Topic Practice
// / Arcade), which is the "3 options" the quiz tile promises.
export function CertPrepHub({
  certPrepClass,
  initialSubject,
  onSubjectSelected,
  onTakeQuiz,
  onOpenStudyBuddy,
  onFlashcards,
  onMockTest,
  onViewProgress,
  onExit,
}: {
  certPrepClass: PkClass | null;
  // Lifted up to App.tsx (19 September 2026 bug fix - "back redirection
  // is not working as expected from quiz, mock test, progress report,
  // flash cards"). This screen used to hold the chosen certification
  // only in its own local state, which React throws away every time
  // App.tsx swaps this screen out for Flashcards/MockTest/Reports/
  // SubjectPicker - so "back" from any of those remounted CertPrepHub
  // from scratch and, with more than one certification now seeded
  // (Foundations + Professional), dropped the player onto the
  // "choose a certification" list instead of back into the hub they'd
  // just been using. initialSubject restores the previous choice on
  // remount; onSubjectSelected reports every choice (auto-selected or
  // tapped) back up to App.tsx so the next remount has it.
  initialSubject?: string | null;
  onSubjectSelected: (subjectName: string) => void;
  onTakeQuiz: (subjectName: string) => void;
  // "Ask your Study Buddy" (19 September 2026) - same chat StudyBuddy.tsx
  // already gives kids from Home/SubjectPicker, now a first-class tile
  // here too so a family owner studying doesn't have to dig into a
  // Quest map to find it (see StudyBuddy.tsx's initialSubjectName for
  // how it skips straight to the chat instead of asking which subject).
  onOpenStudyBuddy: (subjectName: string) => void;
  onFlashcards: (subjectName: string) => void;
  onMockTest: (subjectName: string) => void;
  onViewProgress: (subjectName: string) => void;
  onExit: () => void;
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(initialSubject ?? null);
  // Same kill-switch SubjectPicker/Home/StudyBuddy already check before
  // showing their own "Ask Sage" entry points - fails open (true) while
  // loading, same convention as everywhere else it's fetched.
  const [studyBuddyEnabled, setStudyBuddyEnabled] = useState(true);
  useEffect(() => {
    getFeatures()
      .then((f) => setStudyBuddyEnabled(f.studyBuddyEnabled))
      .catch(() => {});
  }, []);

  // Keeps App.tsx's own copy in sync with whichever certification is
  // actually selected here - whether the player tapped one or the
  // single-certification auto-select effect below picked it for them.
  useEffect(() => {
    if (selectedSubject) onSubjectSelected(selectedSubject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubject]);

  useEffect(() => {
    if (!certPrepClass) {
      setSubjects([]);
      return;
    }
    getClassSubjects(certPrepClass.id)
      .then(setSubjects)
      .catch(() => setSubjects([]));
  }, [certPrepClass]);

  // Skips straight past "choose a certification" the moment there's
  // nothing to actually choose between - true today whenever exactly one
  // certification is seeded, even though two (Foundations, Professional)
  // usually are.
  useEffect(() => {
    if (subjects && subjects.length === 1 && !selectedSubject) {
      setSelectedSubject(subjects[0].name);
    }
  }, [subjects, selectedSubject]);

  const contentReady = certPrepClass !== null;
  const hasMultipleCerts = (subjects?.length ?? 0) > 1;
  const step: "certification" | "hub" = selectedSubject ? "hub" : "certification";

  // The certification step is only ever reachable when there's more
  // than one to pick from (see the auto-select effect above) - so
  // backing out of the hub either returns to that list, or leaves the
  // study space entirely when there was never a real choice to make.
  function backFromHub() {
    if (hasMultipleCerts) setSelectedSubject(null);
    else onExit();
  }

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <header className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-card to-card p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 shrink-0 rounded-full"
              onClick={step === "hub" ? backFromHub : onExit}
              aria-label="Back"
            >
              <ArrowLeft className="size-5" />
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <GraduationCap className="size-6" />
                </span>
                <div>
                  <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Your study space</p>
                  <h1 className="text-3xl">{step === "hub" && selectedSubject ? selectedSubject : "Certification prep"}</h1>
                </div>
              </div>

              <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                {step === "certification"
                  ? "Original practice questions and flashcards, independently written to cover the same topics as Anthropic's certification course. Choose a certification to get started."
                  : "Original practice questions and flashcards, independently written to cover the same topics as this certification's course."}
              </p>
              <p className="mt-2 max-w-xl text-xs text-muted-foreground/70">
                Not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" is a trademark of Anthropic, PBC.
              </p>

              {subjects === null && contentReady && (
                <p className="mt-5 text-sm text-muted-foreground">Loading your certifications...</p>
              )}
            </div>
          </div>
        </header>

        {!contentReady && (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Quiz content hasn't been added to your kingdom yet - run migration 0028 and the seed:questions command, then
            reopen this study space.
          </p>
        )}
        {contentReady && subjects !== null && subjects.length === 0 && (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No certifications have been seeded yet - run seed:questions for at least one, then reopen this study space.
          </p>
        )}

        {step === "certification" && subjects !== null && subjects.length > 1 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Choose a certification</h2>
            <div className="mt-3 flex flex-col gap-3">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSubject(s.name)}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <GraduationCap className="size-5" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">{s.name}</span>
                    {CERT_EXAM_INFO[s.name] && (
                      <span className="block text-xs text-muted-foreground">{CERT_EXAM_INFO[s.name].abbreviation}</span>
                    )}
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "hub" && selectedSubject && (
          <>
            <section className="mt-8 rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  <Compass className="size-4" />
                  Content
                </h2>
                {CERT_COURSE_INFO[selectedSubject] && (
                  <a
                    href={CERT_COURSE_INFO[selectedSubject].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    View the official course
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Every question, flashcard and Arcade game below was independently written to cover {selectedSubject}
                &apos;s own topics - pick any action and it&apos;s already scoped to this certification.
              </p>

              {/* The real Anthropic Skilljar learning path's own module
                  breakdown (19 September 2026, direct user request -
                  "course content should be like this [URL], add this URL
                  as ref also") - only shown for a certification
                  CERT_COURSE_INFO actually has an entry for. */}
              {CERT_COURSE_INFO[selectedSubject] && (
                <ol className="mt-4 flex flex-col gap-2">
                  {CERT_COURSE_INFO[selectedSubject].modules.map((mod, i) => (
                    <li key={mod.name} className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 p-3">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="text-sm font-semibold">{mod.name}</p>
                          <p className="shrink-0 text-xs text-muted-foreground">{mod.durationMinutes} min</p>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{mod.focus}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {CERT_EXAM_INFO[selectedSubject] && (
              <section className="mt-6">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  <Target className="size-4" />
                  Exam details
                </h2>
                <div className="mt-3">
                  <ExamInfoCard subjectName={selectedSubject} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Sourced from an independent third-party study guide, not an official Anthropic exam spec - Anthropic's
                  own course pages don't publish question counts, timing, or domain weightings. Treat every number
                  above as indicative only; some of these exams haven't launched yet and their details may still
                  change.
                </p>
              </section>
            )}

            {hasMultipleCerts && (
              <button
                type="button"
                onClick={backFromHub}
                className="mt-4 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
              >
                &larr; Change certification
              </button>
            )}

            <div className="mt-8">
              <button
                type="button"
                onClick={() => onTakeQuiz(selectedSubject)}
                className="group relative flex w-full items-center gap-5 overflow-hidden rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card p-6 text-left transition-colors hover:border-primary sm:p-7"
              >
                <span className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-primary/10 transition-transform group-hover:scale-110" />
                <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <LayoutGrid className="size-6" />
                </span>
                <div className="relative">
                  <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                    Take a quiz
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase">
                      <Sparkles className="size-3" />
                      Start here
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Quest, Topic Practice or Arcade - straight in, no need to pick {selectedSubject} again.
                  </p>
                </div>
              </button>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {studyBuddyEnabled && (
                  <button
                    type="button"
                    onClick={() => onOpenStudyBuddy(selectedSubject)}
                    className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-primary/60"
                  >
                    <span className="grid size-10 place-items-center rounded-xl bg-sapphire text-primary-foreground">
                      <Bird className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">Ask your Study Buddy</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Chat with Sage about anything in {selectedSubject} - a concept, a wrong answer, or just to
                        review.
                      </p>
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onFlashcards(selectedSubject)}
                  className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-primary/60"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-amethyst text-primary-foreground">
                    <BookOpen className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Flashcards</p>
                    <p className="mt-1 text-sm text-muted-foreground">Flip through key terms and concepts at your own pace.</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onMockTest(selectedSubject)}
                  className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-primary/60"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-ruby text-primary-foreground">
                    <Timer className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Mock test</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      A timed, full-length run with no feedback until you finish - just like exam day.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onViewProgress(selectedSubject)}
                  className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-primary/60"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-emerald text-primary-foreground">
                    <ChartColumn className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Progress report</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      See your accuracy and time spent by topic, same as a child's own reports.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </>
        )}

        <Button variant="secondary" className="mt-8 gap-2" onClick={onExit}>
          <GraduationCap className="size-4" />
          Exit study space
        </Button>
      </div>
    </div>
  );
}

// One collapsible reference card per certification - closed by default so
// the hub itself stays short; expands to the question count, timing,
// passing score, cost, and domain-weighting breakdown from certExamInfo.ts.
function ExamInfoCard({ subjectName }: { subjectName: string }) {
  const [open, setOpen] = useState(false);
  const info = CERT_EXAM_INFO[subjectName];
  if (!info) return null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">
          {subjectName} <span className="font-normal text-muted-foreground">({info.abbreviation})</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Questions</dt>
              <dd className="font-medium">{info.questions}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Duration</dt>
              <dd className="font-medium">{info.durationMinutes} min</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Passing score</dt>
              <dd className="font-medium">{info.passingScore}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cost</dt>
              <dd className="font-medium">{info.cost}</dd>
            </div>
          </dl>

          <p className="mt-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Domain weightings</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {info.domains.map((domain) => (
              <li key={domain.name} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{domain.name}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${domain.weight * 2.5}%` }} />
                </span>
                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{domain.weight}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
