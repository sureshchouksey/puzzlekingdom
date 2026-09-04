import { useEffect, useState } from "react";
import { getClasses, getClassSubjects, getReports, getSubjects, getTopicReports } from "../api";
import type { AttemptReport, PkClass, Subject, TopicReport } from "../types";
import { Layout, styles } from "./Layout";

function pillStyle(selected: boolean) {
  return {
    ...styles.secondaryButton,
    padding: "6px 14px",
    fontSize: 13,
    background: selected ? "#1a3c6e" : styles.secondaryButton.background,
    color: selected ? "#fff" : styles.secondaryButton.color,
  };
}

function accuracyColor(accuracy: number | null): string {
  if (accuracy === null) return "#8a8177";
  if (accuracy < 0.5) return "#c0392b";
  if (accuracy < 0.75) return "#c78a1f";
  return "#1baf7a";
}

function AccuracyBar({ accuracy }: { accuracy: number | null }) {
  const pct = accuracy === null ? 0 : Math.round(accuracy * 100);
  return (
    <div style={{ background: "#eee7d8", borderRadius: 6, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, background: accuracyColor(accuracy), height: "100%" }} />
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Reports({ onBack }: { onBack: () => void }) {
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selectedSubjectName, setSelectedSubjectName] = useState<string | null>(null);

  const [topicReports, setTopicReports] = useState<TopicReport[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Class filter options, fetched once.
  useEffect(() => {
    getClasses()
      .then(setClasses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load classes"));
  }, []);

  // Subject filter options depend on which class (if any) is selected.
  useEffect(() => {
    setSelectedSubjectName(null);
    const load = selectedClassId ? getClassSubjects(selectedClassId) : getSubjects();
    load.then(setSubjects).catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, [selectedClassId]);

  // The actual report data, re-fetched whenever a filter changes.
  useEffect(() => {
    const params = { classId: selectedClassId ?? undefined, subjectName: selectedSubjectName ?? undefined };
    setTopicReports(null);
    setAttempts(null);
    Promise.all([getTopicReports(params), getReports(params)])
      .then(([topics, history]) => {
        setTopicReports(topics);
        setAttempts(history);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reports"));
  }, [selectedClassId, selectedSubjectName]);

  return (
    <Layout title="Progress reports" onBack={onBack}>
      {classes && classes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ ...styles.muted, display: "block", marginBottom: 8 }}>Class</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button style={pillStyle(selectedClassId === null)} onClick={() => setSelectedClassId(null)}>
              All classes
            </button>
            {classes.map((c) => (
              <button key={c.id} style={pillStyle(selectedClassId === c.id)} onClick={() => setSelectedClassId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {subjects && subjects.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <span style={{ ...styles.muted, display: "block", marginBottom: 8 }}>Subject</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button style={pillStyle(selectedSubjectName === null)} onClick={() => setSelectedSubjectName(null)}>
              All subjects
            </button>
            {subjects.map((s) => (
              <button
                key={s.id}
                style={pillStyle(selectedSubjectName === s.name)}
                onClick={() => setSelectedSubjectName(s.name)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}

      <h2 style={{ fontSize: 17, marginBottom: 12 }}>Topics to focus on</h2>
      {topicReports === null && !error && <p style={styles.muted}>Loading...</p>}
      {topicReports && topicReports.length === 0 && (
        <p style={{ ...styles.muted, marginBottom: 28 }}>No completed quizzes yet for this filter.</p>
      )}
      {topicReports && topicReports.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          {topicReports.map((t) => (
            <div key={t.topic} style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{t.topic}</span>
                <span style={{ ...styles.muted, fontSize: 13 }}>
                  {t.correct}/{t.total} correct · {t.attempts} {t.attempts === 1 ? "quiz" : "quizzes"}
                </span>
              </div>
              <AccuracyBar accuracy={t.accuracy} />
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 17, marginBottom: 12 }}>Recent quizzes</h2>
      {attempts === null && !error && <p style={styles.muted}>Loading...</p>}
      {attempts && attempts.length === 0 && <p style={styles.muted}>No completed quizzes yet for this filter.</p>}
      {attempts && attempts.length > 0 && (
        <div>
          {attempts.map((a) => (
            <div key={a.id} style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>
                  {a.subjectName}
                  {a.className ? ` · ${a.className}` : ""}
                </span>
                <span style={{ ...styles.muted, fontSize: 13 }}>{formatDate(a.completedAt)}</span>
              </div>
              <p style={{ marginBottom: a.topicBreakdown && Object.keys(a.topicBreakdown).length > 0 ? 10 : 0 }}>
                Score: <strong>{a.score ?? 0}</strong> / {a.totalQuestions}
              </p>
              {a.topicBreakdown && Object.keys(a.topicBreakdown).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(a.topicBreakdown).map(([topic, stats]) => (
                    <span
                      key={topic}
                      style={{
                        fontSize: 12,
                        padding: "3px 8px",
                        borderRadius: 12,
                        background: "#f6f1e6",
                        border: "1px solid #e3ddd0",
                        color: "#5a5148",
                      }}
                    >
                      {topic}: {stats.correct}/{stats.total}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
