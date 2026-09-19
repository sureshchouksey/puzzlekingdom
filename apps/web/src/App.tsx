import { useState } from "react";
import { Welcome } from "./screens/Welcome";
import { ParentLogin } from "./screens/ParentLogin";
import { FamilyDashboard } from "./screens/FamilyDashboard";
import { Home } from "./screens/Home";
import { ClassPicker } from "./screens/ClassPicker";
import { SubjectPicker } from "./screens/SubjectPicker";
import { Quiz } from "./screens/Quiz";
import { Results } from "./screens/Results";
import { Reports } from "./screens/Reports";
import { Leaderboard } from "./screens/Leaderboard";
import { AdminLogin } from "./screens/AdminLogin";
import { AdminDashboard } from "./screens/AdminDashboard";
import { ParentDashboard } from "./screens/ParentDashboard";
import { StudyBuddy } from "./screens/StudyBuddy";
import { CertPrepHub } from "./screens/CertPrepHub";
import { Flashcards } from "./screens/Flashcards";
import { MockTest } from "./screens/MockTest";
import { MockExamResults } from "./screens/MockExamResults";
import { Legal } from "./screens/Legal";
import { assembleQuiz, ensureStudyProfile, getAuthToken, getClasses, mintStudyProfileSession, setAuthToken } from "./api";
import { mockExamTimeLimitMinutes } from "./data/certExamInfo";
import type { AdminUser, AssembleQuizResponse, FamilyOwner, PkClass, Profile, QuestJourney, TutorQuestionContext } from "./types";

type Screen =
  | { name: "welcome" }
  | { name: "legal"; tab?: "privacy" | "terms"; returnTo?: Screen }
  | { name: "home" }
  | { name: "classPicker" }
  // initialSubject is set only by Certification Prep (19 September 2026
  // flow rework) - see CertPrepHub.tsx's own comment for why.
  | { name: "subjectPicker"; pkClass: PkClass; initialSubject?: string }
  // journey is set only for a Quest Journey quiz - Results.tsx uses it
  // to jump straight into the next topic without returning to SubjectPicker.
  // examMode/timeLimitMinutes are set only by the Mock Test flow (see
  // MockTest.tsx/handleRetakeMockExam below) - every other caller leaves
  // them undefined and Quiz.tsx behaves exactly as it always has.
  | { name: "quiz"; quiz: AssembleQuizResponse; journey?: QuestJourney; examMode?: boolean; timeLimitMinutes?: number }
  | { name: "results"; attemptId: string; journey?: QuestJourney }
  | { name: "reports"; pkClass?: PkClass; initialSubject?: string }
  | { name: "leaderboard" }
  // intent decides where a successful admin login lands - the raw admin
  // tools (reached only via the /admin URL below), or the friendlier
  // parent summary view (ParentDashboard.tsx, reached via ParentLogin's
  // admin-fallback path). There is no separate "parent" role on the
  // backend, since this is a single-family app.
  | { name: "adminLogin"; intent: "admin" | "parent" }
  | { name: "adminDashboard" }
  | { name: "parentDashboard" }
  // Track 7 (10 September 2026 merge): the one grown-up entry point from
  // Welcome's "Parent dashboard" button - tries a family owner's PIN
  // login/signup first, falls back to the shared platform-admin
  // username+password (see ParentLogin.tsx). Replaces the old separate
  // familyAuth screen.
  | { name: "parentLogin" }
  | { name: "familyDashboard" }
  | { name: "studyBuddyClassPicker" }
  // Exactly one of pkClass/questionContext is set, depending on which
  // entry point led here (Home's general chat vs. "Explain this to me"
  // on a wrong answer - see StudyBuddy.tsx for the full explanation).
  // initialSubjectName is a third, lighter option set only by
  // Certification Prep's own "Ask your Study Buddy" tile (19 September
  // 2026) - see StudyBuddy.tsx's own comment on it.
  | {
      name: "studyBuddy";
      pkClass?: PkClass;
      questionContext?: TutorQuestionContext;
      initialSubjectName?: string;
      returnTo?: Extract<Screen, { name: "results" }>;
    }
  // Claude Certified Architect - Professional prep (18 September 2026):
  // reached from FamilyDashboard's "Certification prep" card. Reuses the
  // existing profile-based quiz flow under a dedicated study profile (see
  // handleOpenCertPrep/exitStudyMode below) rather than building a
  // separate quiz engine.
  | { name: "certPrepHub" }
  | { name: "flashcards"; initialSubject?: string }
  // Mock Test (18 September 2026): a timed, full-length, no-feedback-
  // until-the-end run through everything seeded for one certification -
  // see MockTest.tsx and Quiz.tsx's "exam" mode. A passed attempt lands
  // on mockExamResults; a failed one never leaves Quiz.tsx at all (see
  // MockExamResults.tsx's own comment on why).
  | { name: "mockTest"; initialSubject?: string }
  | { name: "mockExamResults"; attemptId: string };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [familyOwner, setFamilyOwner] = useState<FamilyOwner | null>(null);
  // Light /admin routing (no router library, no support anywhere else in
  // the app): a direct browser navigation to /admin lands straight on
  // admin login instead of the kid-facing Welcome screen. The "Admin
  // login" button on Welcome is gone (see Welcome.tsx) - this URL is now
  // the only way in. Read once at mount; the URL is never pushed to or
  // read again after that; the "Not you? Start over"/logout flows just
  // return to the in-memory "welcome" screen state, not to "/".
  const [screen, setScreen] = useState<Screen>(() =>
    window.location.pathname === "/admin" ? { name: "adminLogin", intent: "admin" } : { name: "welcome" }
  );
  // Remembers the last class picked, so "play again" from Results can jump
  // straight back to that class's subject picker instead of starting the
  // whole class -> subject -> topic flow over from scratch.
  const [lastClass, setLastClass] = useState<PkClass | null>(null);
  // Set only while the family owner is in "study mode" (Certification
  // Prep) - holds their own family_owner session token so it can be
  // restored when they exit back to FamilyDashboard. The app only ever
  // keeps one token in localStorage at a time (see api.ts's
  // AUTH_TOKEN_STORAGE_KEY), so swapping to the study profile's token
  // would otherwise silently log the family owner out.
  const [studyReturnToken, setStudyReturnToken] = useState<string | null>(null);
  // The seeded "Professional Certifications" class, fetched once when
  // study mode opens (18 September 2026 fix) - lets "Take a quiz" jump
  // straight into SubjectPicker's own quest/practice picker for that one
  // class, instead of dropping the family owner onto ClassPicker's full
  // Reception-through-Year-5 list, which is what happened before this
  // fix and is the whole reason this state exists. Stays null (and
  // "Take a quiz" stays disabled, see CertPrepHub's contentReady prop)
  // until the class actually exists in the database - i.e. until 0028's
  // migration + seed:questions have both been run.
  const [certPrepClass, setCertPrepClass] = useState<PkClass | null>(null);
  // Which certification is currently selected inside Certification Prep
  // (19 September 2026 bug fix - see CertPrepHub.tsx's own comment on
  // initialSubject/onSubjectSelected for why this has to live here
  // rather than inside CertPrepHub itself: App.tsx unmounts CertPrepHub
  // every time it swaps in Flashcards/MockTest/Reports/SubjectPicker, so
  // anything CertPrepHub alone remembered was lost on the way back).
  const [certPrepSubject, setCertPrepSubject] = useState<string | null>(null);

  // Enters Certification Prep: mints (or reuses) the family owner's own
  // "study profile", swaps the stored session token to it (so the
  // existing profile-based Quiz.tsx flow works completely unmodified),
  // and looks up the seeded "Professional Certifications" class so
  // CertPrepHub's "Take a quiz" can skip ClassPicker entirely. Saves the
  // family owner's own token first so exitStudyMode can restore it.
  async function handleOpenCertPrep() {
    if (!familyOwner) return;
    const ownerToken = getAuthToken();
    try {
      const classesPromise = getClasses();
      await ensureStudyProfile();
      const { profile: studyProfile, token } = await mintStudyProfileSession();
      const classes = await classesPromise;
      setStudyReturnToken(ownerToken);
      setAuthToken(token);
      setProfile(studyProfile);
      setCertPrepClass(classes.find((c) => c.name === "Professional Certifications") ?? null);
      setScreen({ name: "certPrepHub" });
    } catch (err) {
      console.error("Failed to open Certification Prep:", err);
    }
  }

  // Leaves study mode: restores the family owner's own session token and
  // returns to FamilyDashboard. Used instead of "go home" from any
  // screen reached while studyReturnToken is set. Also clears lastClass
  // so a later kid session never inherits the cert-prep class by
  // accident (ClassPicker's own onClassSelected overwrites it anyway,
  // but there's no reason to carry stale state past a mode switch).
  function exitStudyMode() {
    if (studyReturnToken) setAuthToken(studyReturnToken);
    setStudyReturnToken(null);
    setProfile(null);
    setLastClass(null);
    setCertPrepSubject(null);
    setScreen({ name: "familyDashboard" });
  }

  async function handleRetakeMockExam(subjectName: string) {
    if (!certPrepClass || !profile) return;
    try {
      const quiz = await assembleQuiz({
        subjectName,
        classId: certPrepClass.id,
        profileId: profile.id,
        stageSize: 500,
      });
      const timeLimitMinutes = mockExamTimeLimitMinutes(subjectName, quiz.questions.length);
      setScreen({ name: "quiz", quiz, examMode: true, timeLimitMinutes });
    } catch (err) {
      console.error("Failed to retake mock exam:", err);
    }
  }

  switch (screen.name) {
    case "welcome":
      return (
        <Welcome
          onEnter={(enteredProfile) => {
            setProfile(enteredProfile);
            setScreen({ name: "home" });
          }}
          onParentDashboard={() => setScreen({ name: "parentLogin" })}
          onOpenLegal={(tab) => setScreen({ name: "legal", tab, returnTo: { name: "welcome" } })}
        />
      );
    case "legal":
      return (
        <Legal
          initialTab={screen.tab}
          onBack={() => setScreen(screen.returnTo ?? { name: "welcome" })}
        />
      );
    case "home":
      return (
        <Home
          name={profile?.name ?? null}
          onPlay={() => setScreen({ name: "classPicker" })}
          onViewReports={() => setScreen({ name: "reports" })}
          onViewLeaderboard={() => setScreen({ name: "leaderboard" })}
          onOpenStudyBuddy={() => setScreen({ name: "studyBuddyClassPicker" })}
        />
      );
    case "classPicker":
      return (
        <ClassPicker
          onBack={() => (studyReturnToken ? exitStudyMode() : setScreen({ name: "home" }))}
          onClassSelected={(pkClass) => {
            setLastClass(pkClass);
            setScreen({ name: "subjectPicker", pkClass });
          }}
        />
      );
    case "subjectPicker": {
      // profile is always set by the time this screen is reachable -
      // Welcome sets it before Home (and everything past Home) ever
      // renders - but guard defensively rather than pass null through.
      if (!profile) {
        return (
          <main className="night-sky flex min-h-screen items-center justify-center px-6">
            <p className="text-muted-foreground">Something went wrong - please refresh and pick a player again.</p>
          </main>
        );
      }
      return (
        <SubjectPicker
          pkClass={screen.pkClass}
          profile={profile}
          initialSubject={screen.initialSubject}
          onBack={() => setScreen(studyReturnToken ? { name: "certPrepHub" } : { name: "classPicker" })}
          onQuizReady={(quiz, journey) => setScreen({ name: "quiz", quiz, journey })}
          onGoHome={() => (studyReturnToken ? exitStudyMode() : setScreen({ name: "home" }))}
          onOpenStudyBuddy={() => setScreen({ name: "studyBuddy", pkClass: screen.pkClass })}
          onViewLeaderboard={() => setScreen({ name: "leaderboard" })}
          onViewReports={() => setScreen({ name: "reports", pkClass: screen.pkClass })}
        />
      );
    }
    case "quiz":
      return (
        <Quiz
          quiz={screen.quiz}
          mode={screen.examMode ? "exam" : "kid"}
          timeLimitMinutes={screen.timeLimitMinutes}
          onExit={() =>
            screen.examMode
              ? setScreen({ name: "certPrepHub" })
              : studyReturnToken && lastClass
                ? setScreen({ name: "subjectPicker", pkClass: lastClass, initialSubject: certPrepSubject ?? undefined })
                : setScreen(lastClass ? { name: "subjectPicker", pkClass: lastClass } : { name: "classPicker" })
          }
          onSubmitted={(attemptId) =>
            screen.examMode
              ? setScreen({ name: "mockExamResults", attemptId })
              : setScreen({ name: "results", attemptId, journey: screen.journey })
          }
          onExplain={(questionContext) => setScreen({ name: "studyBuddy", questionContext })}
        />
      );
    case "results": {
      // profile is always set by the time Results is reachable - it's only
      // ever entered via Quiz, which is only ever entered via SubjectPicker,
      // which already guards on profile being set - but stay defensive.
      if (!profile) {
        return (
          <main className="night-sky flex min-h-screen items-center justify-center px-6">
            <p className="text-muted-foreground">Something went wrong - please refresh and pick a player again.</p>
          </main>
        );
      }
      return (
        <Results
          attemptId={screen.attemptId}
          journey={screen.journey}
          profile={profile}
          onQuizReady={(quiz, journey) => setScreen({ name: "quiz", quiz, journey })}
          onPlayAgain={() =>
            setScreen(
              studyReturnToken && lastClass
                ? { name: "subjectPicker", pkClass: lastClass, initialSubject: certPrepSubject ?? undefined }
                : lastClass
                  ? { name: "subjectPicker", pkClass: lastClass }
                  : { name: "classPicker" }
            )
          }
          onExplain={(questionContext) =>
            setScreen({
              name: "studyBuddy",
              questionContext,
              returnTo: { name: "results", attemptId: screen.attemptId, journey: screen.journey },
            })
          }
        />
      );
    }
    case "reports":
      return (
        <Reports
          initialClass={screen.pkClass}
          initialSubject={screen.initialSubject}
          onBack={() =>
            setScreen(
              studyReturnToken
                ? { name: "certPrepHub" }
                : screen.pkClass
                  ? { name: "subjectPicker", pkClass: screen.pkClass }
                  : { name: "home" }
            )
          }
        />
      );
    case "leaderboard":
      return <Leaderboard onBack={() => setScreen(studyReturnToken ? { name: "certPrepHub" } : { name: "home" })} />;
    case "adminLogin":
      return (
        <AdminLogin
          intent={screen.intent}
          onBack={() => setScreen({ name: "welcome" })}
          onLoggedIn={(loggedInAdmin) => {
            setAdmin(loggedInAdmin);
            if (screen.intent === "parent") setScreen({ name: "parentDashboard" });
            else setScreen({ name: "adminDashboard" });
          }}
        />
      );
    case "adminDashboard":
      if (!admin) {
        return (
          <main className="parchment flex min-h-screen items-center justify-center px-6">
            <p className="text-muted-foreground">Something went wrong - please log in again.</p>
          </main>
        );
      }
      return (
        <AdminDashboard
          admin={admin}
          onLogOut={() => {
            setAdmin(null);
            setScreen({ name: "welcome" });
          }}
        />
      );
    case "parentDashboard":
      if (!admin) {
        return (
          <main className="parchment flex min-h-screen items-center justify-center px-6">
            <p className="text-muted-foreground">Something went wrong - please log in again.</p>
          </main>
        );
      }
      return (
        <ParentDashboard
          onBack={() => setScreen({ name: "welcome" })}
          onOpenAdminTools={() => setScreen({ name: "adminDashboard" })}
          onLogOut={() => {
            setAdmin(null);
            setScreen({ name: "welcome" });
          }}
        />
      );
    case "parentLogin":
      return (
        <ParentLogin
          onBack={() => setScreen({ name: "welcome" })}
          onFamilyLoggedIn={(loggedInOwner) => {
            setFamilyOwner(loggedInOwner);
            setScreen({ name: "familyDashboard" });
          }}
          onAdminLoggedIn={(loggedInAdmin) => {
            setAdmin(loggedInAdmin);
            setScreen({ name: "parentDashboard" });
          }}
        />
      );
    case "familyDashboard":
      if (!familyOwner) {
        return (
          <main className="parchment flex min-h-screen items-center justify-center px-6">
            <p className="text-muted-foreground">Something went wrong - please log in again.</p>
          </main>
        );
      }
      return (
        <FamilyDashboard
          owner={familyOwner}
          onOpenCertPrep={handleOpenCertPrep}
          onLogOut={() => {
            setFamilyOwner(null);
            setScreen({ name: "welcome" });
          }}
        />
      );
    // A separate class picker instance from "classPicker" above - same
    // component, different next step (studyBuddy's subject picker rather
    // than quiz assembly's subjectPicker).
    case "studyBuddyClassPicker":
      return (
        <ClassPicker
          onBack={() => setScreen({ name: "home" })}
          onClassSelected={(pkClass) => setScreen({ name: "studyBuddy", pkClass })}
        />
      );
    case "studyBuddy":
      return (
        <StudyBuddy
          pkClass={screen.pkClass}
          questionContext={screen.questionContext}
          initialSubjectName={screen.initialSubjectName}
          onBack={() =>
            screen.returnTo
              ? setScreen(screen.returnTo)
              : setScreen(studyReturnToken ? { name: "certPrepHub" } : { name: "home" })
          }
        />
      );
    case "certPrepHub":
      return (
        <CertPrepHub
          certPrepClass={certPrepClass}
          initialSubject={certPrepSubject}
          onSubjectSelected={setCertPrepSubject}
          onOpenStudyBuddy={(subjectName) => {
            if (!certPrepClass) return;
            setScreen({ name: "studyBuddy", pkClass: certPrepClass, initialSubjectName: subjectName });
          }}
          onTakeQuiz={(subjectName) => {
            if (!certPrepClass) return;
            setLastClass(certPrepClass);
            setScreen({ name: "subjectPicker", pkClass: certPrepClass, initialSubject: subjectName });
          }}
          onFlashcards={(subjectName) => setScreen({ name: "flashcards", initialSubject: subjectName })}
          onMockTest={(subjectName) => setScreen({ name: "mockTest", initialSubject: subjectName })}
          onViewProgress={(subjectName) =>
            setScreen({ name: "reports", pkClass: certPrepClass ?? undefined, initialSubject: subjectName })
          }
          onExit={exitStudyMode}
        />
      );
    case "flashcards":
      return (
        <Flashcards
          certPrepClass={certPrepClass}
          initialSubject={screen.initialSubject}
          onBack={() => setScreen({ name: "certPrepHub" })}
        />
      );
    case "mockTest": {
      if (!profile) {
        return (
          <main className="parchment flex min-h-screen items-center justify-center px-6">
            <p className="text-muted-foreground">Something went wrong - please refresh and pick a player again.</p>
          </main>
        );
      }
      return (
        <MockTest
          certPrepClass={certPrepClass}
          profile={profile}
          initialSubject={screen.initialSubject}
          onStart={(quiz, timeLimitMinutes) => setScreen({ name: "quiz", quiz, examMode: true, timeLimitMinutes })}
          onBack={() => setScreen({ name: "certPrepHub" })}
        />
      );
    }
    case "mockExamResults":
      return (
        <MockExamResults
          attemptId={screen.attemptId}
          onRetake={handleRetakeMockExam}
          onExit={() => setScreen({ name: "certPrepHub" })}
        />
      );
  }
}
