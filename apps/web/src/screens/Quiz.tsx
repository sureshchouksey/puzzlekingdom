import { useMemo, useState } from "react";
import { submitQuiz } from "../api";
import type { AssembleQuizResponse, QuizQuestion } from "../types";
import { Layout, styles } from "./Layout";

// Groups questions by their source document, in first-appearance order, so
// a passage-based document's story is only shown once, before all of its
// questions - rather than repeating it, or showing questions with no
// context at all.
function groupByDocument(qs: QuizQuestion[]): { documentId: string; passage: string | null; questions: QuizQuestion[] }[] {
  const groups: { documentId: string; passage: string | null; questions: QuizQuestion[] }[] = [];
  const indexByDocument = new Map<string, number>();
  for (const q of qs) {
    let idx = indexByDocument.get(q.documentId);
    if (idx === undefined) {
      idx = groups.length;
      indexByDocument.set(q.documentId, idx);
      groups.push({ documentId: q.documentId, passage: q.passage, questions: [] });
    }
    groups[idx].questions.push(q);
  }
  return groups;
}

export function Quiz({
  quiz,
  onSubmitted,
}: {
  quiz: AssembleQuizResponse;
  onSubmitted: (attemptId: string) => void;
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupByDocument(quiz.questions), [quiz.questions]);
  const allAnswered = quiz.questions.every((q) => selections[q.id]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const answers = quiz.questions.map((q) => ({ questionId: q.id, selectedOptionId: selections[q.id] }));
      await submitQuiz({ attemptId: quiz.attemptId, answers });
      onSubmitted(quiz.attemptId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit quiz");
      setSubmitting(false);
    }
  }

  let questionNumber = 0;

  return (
    <Layout title={`${quiz.subjectName} quiz`}>
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
                Read this passage, then answer the questions below
              </p>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 15 }}>{group.passage}</div>
            </div>
          )}

          {group.questions.map((q) => {
            questionNumber += 1;
            return (
              <div key={q.id} style={styles.card}>
                <p style={{ fontWeight: 600, marginBottom: 12 }}>
                  {questionNumber}. {q.questionText}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {q.options.map((opt) => (
                    <label
                      key={opt.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #e3ddd0",
                        cursor: "pointer",
                        background: selections[q.id] === opt.id ? "#f6f1e6" : "transparent",
                      }}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={selections[q.id] === opt.id}
                        onChange={() => setSelections((prev) => ({ ...prev, [q.id]: opt.id }))}
                      />
                      {opt.text}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <button style={styles.primaryButton} onClick={submit} disabled={!allAnswered || submitting}>
        {submitting ? "Submitting..." : "Submit answers"}
      </button>
      {!allAnswered && <p style={{ ...styles.muted, marginTop: 8 }}>Answer every question to submit.</p>}
      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
