import { useMemo, useState } from "react";
import { submitStage } from "../api";
import type { AssembleQuizResponse, QuizQuestion, SubmitStageResponse } from "../types";
import { Layout, styles } from "./Layout";

// Groups a stage's questions by their source document, in first-appearance
// order, so a passage-based document's story is only shown once, before
// all of its questions - rather than repeating it, or showing questions
// with no context at all.
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

// Splits the (already randomized) question list into fixed-size stages,
// positionally - the same chunking the backend uses to compute
// stagesCleared, so both sides always agree on what "stage N" means.
function chunkIntoStages(qs: QuizQuestion[], stageSize: number): QuizQuestion[][] {
  const stages: QuizQuestion[][] = [];
  for (let i = 0; i < qs.length; i += stageSize) {
    stages.push(qs.slice(i, i + stageSize));
  }
  return stages;
}

export function Quiz({
  quiz,
  onSubmitted,
}: {
  quiz: AssembleQuizResponse;
  onSubmitted: (attemptId: string) => void;
}) {
  const stages = useMemo(() => chunkIntoStages(quiz.questions, quiz.stageSize), [quiz.questions, quiz.stageSize]);

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set right after a non-final stage is scored - shows the "stage
  // cleared" interstitial until the player chooses to continue.
  const [stageResult, setStageResult] = useState<SubmitStageResponse | null>(null);

  const currentStage = stages[currentStageIndex] ?? [];
  const groups = useMemo(() => groupByDocument(currentStage), [currentStage]);
  const allAnswered = currentStage.every((q) => selections[q.id]);

  async function finishStage() {
    setSubmitting(true);
    setError(null);
    try {
      const answers = currentStage.map((q) => ({ questionId: q.id, selectedOptionId: selections[q.id] }));
      const result = await submitStage({ attemptId: quiz.attemptId, answers });
      if (result.isComplete) {
        onSubmitted(quiz.attemptId);
      } else {
        setStageResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit stage");
    } finally {
      setSubmitting(false);
    }
  }

  function continueToNextStage() {
    setStageResult(null);
    setCurrentStageIndex((i) => i + 1);
  }

  // Below the pass cutoff - the backend never recorded this stage's
  // answers, so the same stage can simply be retaken: clear this stage's
  // picks and drop back to the question screen at the same stage index.
  function retryStage() {
    setStageResult(null);
    setSelections((prev) => {
      const next = { ...prev };
      for (const q of currentStage) delete next[q.id];
      return next;
    });
  }

  if (stageResult) {
    const stagesToGo = stageResult.totalStages - stageResult.stagesCleared;
    const stagePercent = stageResult.stageTotal > 0 ? Math.round((stageResult.stageScore / stageResult.stageTotal) * 100) : 0;
    const cutoffPercent = Math.round(stageResult.passThreshold * 100);
    let reviewNumber = 0;
    return (
      <Layout title={`${quiz.subjectName} quiz`}>
        <div
          style={{
            ...styles.card,
            textAlign: "center",
            padding: 24,
            borderColor: stageResult.passed ? undefined : "#eb6834",
            background: stageResult.passed ? undefined : "#fdf3ef",
          }}
        >
          <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {stageResult.passed ? `🎉 Stage ${stageResult.stagesCleared} cleared!` : "Not quite — give this stage another go"}
          </p>
          <p style={styles.muted}>
            {stageResult.stageScore} / {stageResult.stageTotal} correct this stage ({stagePercent}%)
            {stageResult.passed
              ? stagesToGo > 0
                ? ` — ${stagesToGo} stage${stagesToGo === 1 ? "" : "s"} to go`
                : ""
              : ` — you need at least ${cutoffPercent}% to clear a stage`}
          </p>
        </div>

        {stageResult.answers.map((a) => {
          reviewNumber += 1;
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
                {reviewNumber}. {a.questionText} {a.isCorrect ? "✅" : "❌"}
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
            </div>
          );
        })}

        {stageResult.passed ? (
          <button style={styles.primaryButton} onClick={continueToNextStage}>
            Continue to stage {stageResult.stagesCleared + 1}
          </button>
        ) : (
          <button style={styles.primaryButton} onClick={retryStage}>
            Retry this stage
          </button>
        )}
      </Layout>
    );
  }

  let questionNumber = 0;

  return (
    <Layout title={`${quiz.subjectName} quiz — stage ${currentStageIndex + 1} of ${stages.length}`}>
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

      <button style={styles.primaryButton} onClick={finishStage} disabled={!allAnswered || submitting}>
        {submitting ? "Submitting..." : currentStageIndex + 1 === stages.length ? "Finish quiz" : "Finish stage"}
      </button>
      {!allAnswered && <p style={{ ...styles.muted, marginTop: 8 }}>Answer every question to continue.</p>}
      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
