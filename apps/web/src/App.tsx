import { useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Home } from "./screens/Home";
import { ClassPicker } from "./screens/ClassPicker";
import { SubjectPicker } from "./screens/SubjectPicker";
import { Quiz } from "./screens/Quiz";
import { Results } from "./screens/Results";
import { Reports } from "./screens/Reports";
import { Leaderboard } from "./screens/Leaderboard";
import { AdminLogin } from "./screens/AdminLogin";
import { AdminDashboard } from "./screens/AdminDashboard";
import { StudyBuddy } from "./screens/StudyBuddy";
import type { AdminUser, AssembleQuizResponse, PkClass, Profile, TutorQuestionContext } from "./types";

type Screen =
  | { name: "welcome" }
  | { name: "home" }
  | { name: "classPicker" }
  | { name: "subjectPicker"; pkClass: PkClass }
  | { name: "quiz"; quiz: AssembleQuizResponse }
  | { name: "results"; attemptId: string }
  | { name: "reports" }
  | { name: "leaderboard" }
  | { name: "adminLogin" }
  | { name: "adminDashboard" }
  | { name: "studyBuddyClassPicker" }
  // Exactly one of pkClass/questionContext is set, depending on which
  // entry point led here (Home's general chat vs. "Explain this to me"
  // on a wrong answer - see StudyBuddy.tsx for the full explanation).
  | { name: "studyBuddy"; pkClass?: PkClass; questionContext?: TutorQuestionContext };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "welcome" });
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
          onAdminLogin={() => setScreen({ name: "adminLogin" })}
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
          <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 24px" }}>
            <p style={{ color: "#5a5148" }}>Something went wrong - please refresh and pick a player again.</p>
          </main>
        );
      }
      return (
        <SubjectPicker
          pkClass={screen.pkClass}
          profile={profile}
          onBack={() => setScreen({ name: "classPicker" })}
          onQuizReady={(quiz) => setScreen({ name: "quiz", quiz })}
        />
      );
    }
    case "quiz":
      return (
        <Quiz
          quiz={screen.quiz}
          onSubmitted={(attemptId) => setScreen({ name: "results", attemptId })}
          onExplain={(questionContext) => setScreen({ name: "studyBuddy", questionContext })}
        />
      );
    case "results":
      return (
        <Results
          attemptId={screen.attemptId}
          onPlayAgain={() =>
            setScreen(lastClass ? { name: "subjectPicker", pkClass: lastClass } : { name: "classPicker" })
          }
          onExplain={(questionContext) => setScreen({ name: "studyBuddy", questionContext })}
        />
      );
    case "reports":
      return <Reports onBack={() => setScreen({ name: "home" })} />;
    case "leaderboard":
      return <Leaderboard onBack={() => setScreen({ name: "home" })} />;
    case "adminLogin":
      return (
        <AdminLogin
          onBack={() => setScreen({ name: "welcome" })}
          onLoggedIn={(loggedInAdmin) => {
            setAdmin(loggedInAdmin);
            setScreen({ name: "adminDashboard" });
          }}
        />
      );
    case "adminDashboard":
      if (!admin) {
        return (
          <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 24px" }}>
            <p style={{ color: "#5a5148" }}>Something went wrong - please log in again.</p>
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
