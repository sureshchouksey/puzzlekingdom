import { useState } from "react";
import { submitQuiz } from "../api";
import type { AssembleQuizResponse } from "../types";
import { Layout, styles } from "./Layout";

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

  return (
    <Layout title={`${quiz.subjectName} quiz`}>
      {quiz.questions.map((q, i) => (
        <div key={q.id} style={styles.card}>
          <p style={{ fontWeight: 600, marginBottom: 12 }}>
            {i + 1}. {q.questionText}
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
      ))}

      <button style={styles.primaryButton} onClick={submit} disabled={!allAnswered || submitting}>
        {submitting ? "Submitting..." : "Submit answers"}
      </button>
      {!allAnswered && <p style={{ ...styles.muted, marginTop: 8 }}>Answer every question to submit.</p>}
      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
