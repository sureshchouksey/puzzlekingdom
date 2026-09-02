import { useEffect, useState } from "react";
import { assembleQuiz, getSubjects } from "../api";
import type { AssembleQuizResponse, Subject } from "../types";
import { Layout, styles } from "./Layout";

export function SubjectPicker({
  onBack,
  onQuizReady,
}: {
  onBack: () => void;
  onQuizReady: (quiz: AssembleQuizResponse) => void;
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSubjects()
      .then(setSubjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, []);

  async function startQuiz() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const quiz = await assembleQuiz({ subjectName: selected, count });
      onQuizReady(quiz);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start quiz");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout title="Pick a subject" onBack={onBack}>
      {subjects === null && !error && <p style={styles.muted}>Loading subjects...</p>}
      {subjects && subjects.length === 0 && <p style={styles.muted}>No subjects yet - add some content first.</p>}

      {subjects && subjects.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
            {subjects.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.name)}
                style={{
                  ...styles.secondaryButton,
                  background: selected === s.name ? "#1a3c6e" : styles.secondaryButton.background,
                  color: selected === s.name ? "#fff" : styles.secondaryButton.color,
                }}
              >
                {s.name}
              </button>
            ))}
          </div>

          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>Number of questions</span>
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              style={{ padding: "8px 12px", fontSize: 15, width: 80 }}
            />
          </label>

          <button style={styles.primaryButton} onClick={startQuiz} disabled={!selected || loading}>
            {loading ? "Starting..." : "Start quiz"}
          </button>
        </>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
