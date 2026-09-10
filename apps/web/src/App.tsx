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
import type { AdminUser, AssembleQuizResponse, FamilyOwner, PkClass, Profile, QuestJourney, TutorQuestionContext } from "./types";

type Screen =
  | { name: "welcome" }
  | { name: "home" }
  | { name: "classPicker" }
  | { name: "subjectPicker"; pkClass: PkClass }
  // journey is set only for a Quest Journey quiz - Results.tsx uses it
  // to jump straight into the next topic without returning to SubjectPicker.
  | { name: "quiz"; quiz: AssembleQuizResponse; journey?: QuestJourney }
  | { name: "results"; attemptId: string; journey?: QuestJourney }
  | { name: "reports" }
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
  | { name: "studyBuddy"; pkClass?: PkClass; questionContext?: TutorQuestionContext };

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

  switch (screen.name) {
    case "welcome":
      return (
        <Welcome
          onEnter={(enteredProfile) => {
            setProfile(enteredProfile);
            setScreen({ name: "home" });
          }}
          onParentDashboard={() => setScreen({ name: "parentLogin" })}
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
          onBack={() => setScreen({ name: "home" })}
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
          onBack={() => setScreen({ name: "classPicker" })}
          onQuizReady={(quiz, journey) => setScreen({ name: "quiz", quiz, journey })}
          onGoHome={() => setScreen({ name: "home" })}
          onOpenStudyBuddy={() => setScreen({ name: "studyBuddy", pkClass: screen.pkClass })}
          onViewLeaderboard={() => setScreen({ name: "leaderboard" })}
          onViewReports={() => setScreen({ name: "reports" })}
        />
      );
    }
    case "quiz":
      return (
        <Quiz
          quiz={screen.quiz}
          onExit={() => setScreen(lastClass ? { name: "subjectPicker", pkClass: lastClass } : { name: "classPicker" })}
          onSubmitted={(attemptId) => setScreen({ name: "results", attemptId, journey: screen.journey })}
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
            setScreen(lastClass ? { name: "subjectPicker", pkClass: lastClass } : { name: "classPicker" })
          }
          onExplain={(questionContext) => setScreen({ name: "studyBuddy", questionContext })}
        />
      );
    }
    case "reports":
      return <Reports onBack={() => setScreen({ name: "home" })} />;
    case "leaderboard":
      return <Leaderboard onBack={() => setScreen({ name: "home" })} />;
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
          onLogOut={() => {
            setFamilyOwner(null);
            setScreen({ name: "welcome" });
          }}
          onEnter={(enteredProfile) => {
            setProfile(enteredProfile);
            setFamilyOwner(null);
            setScreen({ name: "home" });
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
          onBack={() => setScreen({ name: "home" })}
        />
      );
  }
}
