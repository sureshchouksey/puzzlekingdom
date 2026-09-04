import { useEffect, useState } from "react";
import { getClasses, getLeaderboard } from "../api";
import type { LeaderboardEntry, PkClass } from "../types";
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

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClasses()
      .then((cs) => {
        setClasses(cs);
        // Default to the first class, since the leaderboard is meant to
        // compare like-for-like - a Year 3 stage isn't the same as an 11+
        // stage, so "all classes combined" isn't a meaningful default.
        if (cs.length > 0) setSelectedClassId(cs[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load classes"));
  }, []);

  useEffect(() => {
    setEntries(null);
    getLeaderboard({ classId: selectedClassId ?? undefined })
      .then((rows) => setEntries(rows.filter((r) => r.quizzesPlayed > 0)))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load leaderboard"));
  }, [selectedClassId]);

  return (
    <Layout title="Leaderboard" onBack={onBack}>
      {classes && classes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {classes.map((c) => (
            <button key={c.id} style={pillStyle(selectedClassId === c.id)} onClick={() => setSelectedClassId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}

      {entries === null && !error && <p style={styles.muted}>Loading...</p>}
      {entries && entries.length === 0 && <p style={styles.muted}>No quizzes played here yet - be the first!</p>}

      {entries && entries.length > 0 && (
        <div>
          {entries.map((e, i) => (
            <div
              key={e.profileId}
              style={{
                ...styles.card,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div style={{ fontSize: 22, width: 32, textAlign: "center" }}>{MEDALS[i] ?? `#${i + 1}`}</div>
              <img
                src={e.title === "Princess" ? "/princess.png" : "/prince.png"}
                alt={e.title ?? "Player"}
                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{e.name}</div>
                <div style={{ ...styles.muted, fontSize: 13 }}>
                  {e.quizzesPlayed} {e.quizzesPlayed === 1 ? "quiz" : "quizzes"} ·{" "}
                  {e.accuracy === null ? "—" : `${Math.round(e.accuracy * 100)}% accuracy`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a3c6e" }}>{e.stagesCleared}</div>
                <div style={{ ...styles.muted, fontSize: 12 }}>stages cleared</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
