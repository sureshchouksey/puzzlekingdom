import { useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Home } from "./screens/Home";
import { ClassPicker } from "./screens/ClassPicker";
import { SubjectPicker } from "./screens/SubjectPicker";
import { Quiz } from "./screens/Quiz";
import { Results } from "./screens/Results";
import { Upload } from "./screens/Upload";
import { Reports } from "./screens/Reports";
import { Leaderboard } from "./screens/Leaderboard";
import type { AssembleQuizResponse, PkClass, Profile } from "./types";

type Screen =
  | { name: "welcome" }
  | { name: "home" }
  | { name: "classPicker" }
  | { name: "subjectPicker"; pkClass: PkClass }
  | { name: "quiz"; quiz: AssembleQuizResponse }
  | { name: "results"; attemptId: string }
  | { name: "upload" }
  | { name: "reports" }
  | { name: "leaderboard" };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
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
        />
      );
    case "home":
      return (
        <Home
          name={profile?.name ?? null}
          onPlay={() => setScreen({ name: "classPicker" })}
          onAddContent={() => setScreen({ name: "upload" })}
          onViewReports={() => setScreen({ name: "reports" })}
          onViewLeaderboard={() => setScreen({ name: "leaderboard" })}
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
        <Quiz quiz={screen.quiz} onSubmitted={(attemptId) => setScreen({ name: "results", attemptId })} />
      );
    case "results":
      return (
        <Results
          attemptId={screen.attemptId}
          onPlayAgain={() =>
            setScreen(lastClass ? { name: "subjectPicker", pkClass: lastClass } : { name: "classPicker" })
          }
        />
      );
    case "upload":
      return <Upload onBack={() => setScreen({ name: "home" })} />;
    case "reports":
      return <Reports onBack={() => setScreen({ name: "home" })} />;
    case "leaderboard":
      return <Leaderboard onBack={() => setScreen({ name: "home" })} />;
  }
}
