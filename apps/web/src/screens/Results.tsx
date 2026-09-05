import { useEffect, useMemo, useState } from "react";
import { getResults } from "../api";
import type { QuizResults, ResultsAnswer, TutorQuestionContext } from "../types";
import { Layout, styles } from "./Layout";

// Same grouping approach as the Quiz screen: show each passage once, right
// before the review cards for the questions that came from it.
function groupByDocument(answers: ResultsAnswer[]): { documentId: string; passage: string | null; answers: ResultsAnswer[] }[] {
  const groups: { documentId: string; passage: string | null; answers: ResultsAnswer[] }[] = [];
  const indexByDocument = new Map<string, number>();
  for (const a of answers) {
    const key = a.documentId ?? `unknown-${a.questionId}`;
    let idx = indexByDocument.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByDocument.set(key, idx);
      groups.push({ documentId: key, passage: a.passage, answers: [] });
    }
    groups[idx].answers.push(a);
  }
  return groups;
}

export function Results({
  attemptId,
  onPlayAgain,
  onExplain,
}: {
  attemptId: string;
  onPlayAgain: () => void;
  // "Explain this to me" on a wrong answer - Section 10 step 7. Same
  // guard as Quiz.tsx: only offered when results.classId and the
  // question's own text are both actually present.
  onExplain: (context: TutorQuestionContext) => void;
}) {
  const [results, setResults] = useState<QuizResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getResults(attemptId)
      .then(setResults)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load results"));
  }, [attemptId]);

  const groups = useMemo(() => groupByDocument(results?.answers ?? []), [results]);

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

  let answerNumber = 0;

  return (
    <Layout title={`${results.subjectName ?? "Quiz"} results`}>
      <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
        Score: {results.score} / {results.totalQuestions}
      </p>

      {groups.map((group) => (
        <div key={group.documentId}>
          {group.passage && (
            <div
              style={{
                ...styles.card,
                background: "#fbf8f1",
                border: "1px solid #d8cfb8",
              }}
            >
              <p style={{ ...styles.muted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", fontSize: 12, letterSpacing: 0.5 }}>
                Passage
              </p>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 15 }}>{group.passage}</div>
            </div>
          )}

          {group.answers.map((a) => {
            answerNumber += 1;
            return (
              <div
                key={a.questionId}
                style={{
                  ...styles.card,
                  borderColor: a.isCorrect ? "#1baf7a" : "#eb6834",
                  background: a.isCorrect ? "#effaf5" : "#fdf3ef",
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: 8 }}>
                  {answerNumber}. {a.questionText} {a.isCorrect ? "✅" : "❌"}
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
                        {isSelected ? "→ " : "  "}
                        {opt.text}
                        {isCorrectOption ? " (correct)" : ""}
                      </div>
                    );
                  })}
                </div>
                {a.explanation && <p style={{ ...styles.muted, fontStyle: "italic" }}>{a.explanation}</p>}
                {a.tip && (
                  <p style={{ fontSize: 13, marginTop: 8, color: "#8a4b12" }}>
                    💡 <strong>Tip:</strong> {a.tip}
                  </p>
                )}
                {!a.isCorrect && a.questionText && results.classId && (
                  <button
                    style={styles.linkButton}
                    onClick={() =>
                      onExplain({
                        classId: results.classId!,
                        subjectId: results.subjectId,
                        subjectName: results.subjectName ?? "",
                        questionId: a.questionId,
                        questionText: a.questionText!,
                        attemptId,
                      })
                    }
                  >
                    💬 Explain this to me
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <button style={styles.primaryButton} onClick={onPlayAgain}>
        Play again
      </button>
    </Layout>
  );
}
