import { useEffect, useState } from "react";
import { assembleQuiz, getClassSubjects, getTopics } from "../api";
import type { AssembleQuizResponse, PkClass, Profile, Subject } from "../types";
import { Layout, styles } from "./Layout";

// Every quiz clears a "stage" - a checkpoint partway through - every 10
// questions. Not user-configurable: the number of stages is simply
// however many groups of 10 the subject's question count makes.
const STAGE_SIZE = 10;

function pillStyle(selected: boolean, small = false) {
  return {
    ...styles.secondaryButton,
    ...(small ? { padding: "6px 14px", fontSize: 13 } : {}),
    background: selected ? "#1a3c6e" : styles.secondaryButton.background,
    color: selected ? "#fff" : styles.secondaryButton.color,
  };
}

export function SubjectPicker({
  pkClass,
  profile,
  onBack,
  onQuizReady,
}: {
  pkClass: PkClass;
  profile: Profile;
  onBack: () => void;
  onQuizReady: (quiz: AssembleQuizResponse) => void;
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[] | null>(null);
  // null = "all topics" (no filter applied)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubjects(null);
    setSelectedSubject(null);
    setTopics(null);
    setSelectedTopic(null);
    setError(null);
    getClassSubjects(pkClass.id)
      .then(setSubjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, [pkClass.id]);

  useEffect(() => {
    if (!selectedSubject) {
      setTopics(null);
      setSelectedTopic(null);
      return;
    }
    setSelectedTopic(null);
    getTopics({ classId: pkClass.id, subjectName: selectedSubject })
      .then(setTopics)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load topics"));
  }, [pkClass.id, selectedSubject]);

  async function startQuiz() {
    if (!selectedSubject) return;
    setLoading(true);
    setError(null);
    try {
      const quiz = await assembleQuiz({
        subjectName: selectedSubject,
        classId: pkClass.id,
        topic: selectedTopic ?? undefined,
        profileId: profile.id,
        stageSize: STAGE_SIZE,
      });
      onQuizReady(quiz);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start quiz");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout title={`${pkClass.name} — pick a subject`} onBack={onBack}>
      {subjects === null && !error && <p style={styles.muted}>Loading subjects...</p>}
      {subjects && subjects.length === 0 && (
        <p style={styles.muted}>No subjects yet for {pkClass.name} - add some content first.</p>
      )}

      {subjects && subjects.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
            {subjects.map((s) => (
              <button key={s.id} onClick={() => setSelectedSubject(s.name)} style={pillStyle(selectedSubject === s.name)}>
                {s.name}
              </button>
            ))}
          </div>

          {selectedSubject && topics && topics.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <span style={{ ...styles.muted, display: "block", marginBottom: 8 }}>Focus on a topic (optional)</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => setSelectedTopic(null)} style={pillStyle(selectedTopic === null, true)}>
                  All topics
                </button>
                {topics.map((t) => (
                  <button key={t} onClick={() => setSelectedTopic(t)} style={pillStyle(selectedTopic === t, true)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedSubject && (
            <>
              <p style={{ ...styles.muted, marginBottom: 20, fontSize: 13 }}>
                Every question saved for this subject{selectedTopic ? " and topic" : ""} will be included, in stages of {STAGE_SIZE} questions each.
              </p>

              <button style={styles.primaryButton} onClick={startQuiz} disabled={loading}>
                {loading ? "Starting..." : "Start quiz"}
              </button>
            </>
          )}
        </>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
