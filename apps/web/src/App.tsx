import { useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Home } from "./screens/Home";
import { SubjectPicker } from "./screens/SubjectPicker";
import { Quiz } from "./screens/Quiz";
import { Results } from "./screens/Results";
import { Upload } from "./screens/Upload";
import type { AssembleQuizResponse } from "./types";

type Screen =
  | { name: "welcome" }
  | { name: "home" }
  | { name: "subjectPicker" }
  | { name: "quiz"; quiz: AssembleQuizResponse }
  | { name: "results"; attemptId: string }
  | { name: "upload" };

export default function App() {
  const [name, setName] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "welcome" });

  switch (screen.name) {
    case "welcome":
      return (
        <Welcome
          onEnter={(enteredName) => {
            setName(enteredName);
            setScreen({ name: "home" });
          }}
        />
      );
    case "home":
      return (
        <Home
          name={name}
          onPlay={() => setScreen({ name: "subjectPicker" })}
          onAddContent={() => setScreen({ name: "upload" })}
        />
      );
    case "subjectPicker":
      return (
        <SubjectPicker
          onBack={() => setScreen({ name: "home" })}
          onQuizReady={(quiz) => setScreen({ name: "quiz", quiz })}
        />
      );
    case "quiz":
      return (
        <Quiz quiz={screen.quiz} onSubmitted={(attemptId) => setScreen({ name: "results", attemptId })} />
      );
    case "results":
      return <Results attemptId={screen.attemptId} onPlayAgain={() => setScreen({ name: "subjectPicker" })} />;
    case "upload":
      return <Upload onBack={() => setScreen({ name: "home" })} />;
  }
}
