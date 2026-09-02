import { useEffect, useState } from "react";
import { getResults } from "../api";
import type { QuizResults } from "../types";
import { Layout, styles } from "./Layout";

export function Results({ attemptId, onPlayAgain }: { attemptId: string; onPlayAgain: () => void }) {
  const [results, setResults] = useState<QuizResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getResults(attemptId)
      .then(setResults)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load results"));
  }, [attemptId]);

  if (error) {
    return (
      <Layout title="Results">
        <p style={styles.error}>{error}</p>
      </Layout>
    );
  }

  if (!results) {
    return (
      <Layout title="Results">
        <p style={styles.muted}>Loading results...</p>
      </Layout>
    );
  }

  return (
    <Layout title={`${results.subjectName ?? "Quiz"} results`}>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
        Score: {results.score} / {results.totalQuestions}
      </p>

      {results.answers.map((a, i) => (
        <div
          key={a.questionId}
          style={{
            ...styles.card,
            borderColor: a.isCorrect ? "#1baf7a" : "#eb6834",
            background: a.isCorrect ? "#effaf5" : "#fdf3ef",
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            {i + 1}. {a.questionText} {a.isCorrect ? "✅" : "❌"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {a.options.map((opt) => {
              const isSelected = opt.id === a.selectedOptionId;
              const isCorrectOption = opt.id === a.correctOptionId;
              return (
                <div
                  key={opt.id}
                  style={{
                    fontSize: 14,
                    fontWeight: isCorrectOption ? 700 : 400,
                    color: isCorrectOption ? "#0f6b45" : isSelected ? "#a8391a" : "#241d1a",
                  }}
                >
                  {isSelected ? "→ " : "  "}
                  {opt.text}
                  {isCorrectOption ? " (correct)" : ""}
                </div>
              );
            })}
          </div>
          {a.explanation && <p style={{ ...styles.muted, fontStyle: "italic" }}>{a.explanation}</p>}
        </div>
      ))}

      <button style={styles.primaryButton} onClick={onPlayAgain}>
        Play again
      </button>
    </Layout>
  );
}
