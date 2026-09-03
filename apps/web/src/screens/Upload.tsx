import { useState } from "react";
import { estimateGeneration, generateQuestions, saveManualQuestions, uploadDocument } from "../api";
import type { AiProvider, ManualQuestionInput, ProviderCostEstimate } from "../types";
import { Layout, styles } from "./Layout";

type Mode = "ai" | "manual";
type Step = "form" | "uploading" | "estimating" | "choosing" | "generating" | "done" | "error";

const OPTION_LABELS = ["a", "b", "c", "d"] as const;

type Draft = {
  questionText: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
};

function emptyDraft(): Draft {
  return { questionText: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" };
}

function draftIsComplete(d: Draft): boolean {
  return d.questionText.trim().length > 0 && d.options.every((o) => o.trim().length > 0) && d.explanation.trim().length > 0;
}

export function Upload({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>("ai");
  const [subjectName, setSubjectName] = useState("");

  // AI-generation path state
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState(8);
  const [step, setStep] = useState<Step>("form");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<ProviderCostEstimate[]>([]);
  const [provider, setProvider] = useState<AiProvider>("claude");

  // Manual-entry path state
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [passage, setPassage] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  async function handleUploadAndEstimate() {
    if (!file || !subjectName.trim()) return;
    setError(null);
    setStep("uploading");
    try {
      const uploaded = await uploadDocument({ file, subjectName: subjectName.trim() });
      setDocumentId(uploaded.id);

      setStep("estimating");
      const estimateRes = await estimateGeneration({ documentId: uploaded.id, count });
      setEstimates(estimateRes.estimates);
      const firstAvailable = estimateRes.estimates.find((e) => e.available);
      if (firstAvailable) setProvider(firstAvailable.provider);
      setStep("choosing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setStep("error");
    }
  }

  async function handleGenerate() {
    if (!documentId) return;
    setError(null);
    setStep("generating");
    try {
      const res = await generateQuestions({ documentId, provider, count });
      setResultMessage(`Generated ${res.questionCount} questions using ${res.provider}.`);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setStep("error");
    }
  }

  function updateDraft(index: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function updateOption(index: number, optionIndex: number, value: string) {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== index) return d;
        const options = [...d.options] as Draft["options"];
        options[optionIndex] = value;
        return { ...d, options };
      })
    );
  }

  async function handleSaveManual() {
    if (!subjectName.trim() || drafts.some((d) => !draftIsComplete(d))) return;
    setError(null);
    setStep("generating"); // reused as a generic "saving" spinner state
    try {
      const questions: ManualQuestionInput[] = drafts.map((d) => ({
        questionText: d.questionText.trim(),
        options: d.options.map((text, i) => ({ id: OPTION_LABELS[i], text: text.trim() })),
        correctOptionId: OPTION_LABELS[d.correctIndex],
        explanation: d.explanation.trim(),
      }));
      const res = await saveManualQuestions({
        subjectName: subjectName.trim(),
        passage: passage.trim() || undefined,
        questions,
      });
      setResultMessage(`Saved ${res.questionCount} question(s) to the database - no AI call needed.`);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save questions");
      setStep("error");
    }
  }

  const allManualComplete = drafts.length > 0 && drafts.every(draftIsComplete);

  return (
    <Layout title="Add new content" onBack={onBack}>
      {step === "form" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <button
            onClick={() => setMode("ai")}
            style={{
              ...styles.secondaryButton,
              background: mode === "ai" ? "#1a3c6e" : styles.secondaryButton.background,
              color: mode === "ai" ? "#fff" : styles.secondaryButton.color,
            }}
          >
            Generate with AI
          </button>
          <button
            onClick={() => setMode("manual")}
            style={{
              ...styles.secondaryButton,
              background: mode === "manual" ? "#1a3c6e" : styles.secondaryButton.background,
              color: mode === "manual" ? "#fff" : styles.secondaryButton.color,
            }}
          >
            I already have questions
          </button>
        </div>
      )}

      {(step === "form" || step === "uploading") && (
        <>
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>Subject</span>
            <input
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="e.g. Maths"
              style={{ padding: "8px 12px", fontSize: 15, width: 240 }}
            />
          </label>

          {mode === "ai" && (
            <>
              <label style={{ display: "block", marginBottom: 16 }}>
                <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>PDF or image of the content</span>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>

              <label style={{ display: "block", marginBottom: 20 }}>
                <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>
                  Number of questions to generate
                </span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  style={{ padding: "8px 12px", fontSize: 15, width: 80 }}
                />
              </label>

              <button
                style={styles.primaryButton}
                onClick={handleUploadAndEstimate}
                disabled={!file || !subjectName.trim() || step === "uploading"}
              >
                {step === "uploading" ? "Uploading..." : "Upload & get cost estimate"}
              </button>
            </>
          )}

          {mode === "manual" && (
            <>
              <p style={{ ...styles.muted, marginBottom: 20 }}>
                Type in questions you already know the answers to (like a real past paper) - these get saved
                straight to the database with no AI call, so there's no cost and the answers are exactly what
                you typed.
              </p>

              <label style={{ display: "block", marginBottom: 20 }}>
                <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>
                  Reading passage (optional) - for comprehension questions that all refer back to one story,
                  paste it here and it'll be shown to the quiz-taker before these questions. Leave blank for
                  self-contained questions (like Maths) that don't need one.
                </span>
                <textarea
                  value={passage}
                  onChange={(e) => setPassage(e.target.value)}
                  placeholder="Paste the story or passage here..."
                  rows={6}
                  style={{ padding: "8px 12px", fontSize: 14, width: "100%", boxSizing: "border-box", fontFamily: "inherit" }}
                />
              </label>

              {drafts.map((draft, i) => (
                <div key={i} style={styles.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontWeight: 600 }}>Question {i + 1}</span>
                    {drafts.length > 1 && (
                      <button
                        onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                        style={{ background: "none", border: "none", color: "#8a1f11", cursor: "pointer", fontSize: 13 }}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <input
                    value={draft.questionText}
                    onChange={(e) => updateDraft(i, { questionText: e.target.value })}
                    placeholder="Question text"
                    style={{ padding: "8px 12px", fontSize: 15, width: "100%", marginBottom: 10, boxSizing: "border-box" }}
                  />

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {draft.options.map((opt, oi) => (
                      <div key={oi} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="radio"
                          name={`correct-${i}`}
                          checked={draft.correctIndex === oi}
                          onChange={() => updateDraft(i, { correctIndex: oi })}
                          title="Mark as the correct answer"
                        />
                        <input
                          value={opt}
                          onChange={(e) => updateOption(i, oi, e.target.value)}
                          placeholder={`Option ${OPTION_LABELS[oi].toUpperCase()}${draft.correctIndex === oi ? " (correct)" : ""}`}
                          style={{ padding: "6px 10px", fontSize: 14, flex: 1 }}
                        />
                      </div>
                    ))}
                  </div>

                  <textarea
                    value={draft.explanation}
                    onChange={(e) => updateDraft(i, { explanation: e.target.value })}
                    placeholder="Explanation shown after the child answers"
                    rows={2}
                    style={{ padding: "8px 12px", fontSize: 14, width: "100%", boxSizing: "border-box", fontFamily: "inherit" }}
                  />
                </div>
              ))}

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button style={styles.secondaryButton} onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}>
                  + Add another question
                </button>
                <button
                  style={styles.primaryButton}
                  onClick={handleSaveManual}
                  disabled={!subjectName.trim() || !allManualComplete}
                >
                  Save {drafts.length} question{drafts.length === 1 ? "" : "s"} to database
                </button>
              </div>
            </>
          )}
        </>
      )}

      {step === "estimating" && <p style={styles.muted}>Checking cost for each AI provider...</p>}

      {step === "choosing" && (
        <>
          <p style={{ marginBottom: 12 }}>Choose which AI generates the questions:</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {estimates.map((est) => (
              <label
                key={est.provider}
                style={{
                  ...styles.card,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: est.available ? "pointer" : "not-allowed",
                  opacity: est.available ? 1 : 0.5,
                  marginBottom: 0,
                }}
              >
                <input
                  type="radio"
                  name="provider"
                  checked={provider === est.provider}
                  disabled={!est.available}
                  onChange={() => setProvider(est.provider)}
                />
                <div>
                  <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{est.provider}</div>
                  <div style={styles.muted}>{est.model}</div>
                  {est.available ? (
                    <div style={{ fontSize: 14 }}>
                      ~{est.estimatedInputTokens} in / ~{est.estimatedOutputTokens} out tokens &mdash; est. $
                      {est.estimatedCostUsd?.toFixed(5)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, color: "#8a1f11" }}>{est.reason}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
          <button style={styles.primaryButton} onClick={handleGenerate}>
            Generate {count} questions with {provider}
          </button>
        </>
      )}

      {step === "generating" && (
        <p style={styles.muted}>{mode === "ai" ? "Generating questions - this can take up to 20 seconds..." : "Saving..."}</p>
      )}

      {step === "done" && (
        <>
          <p style={{ color: "#0f6b45", fontWeight: 600, marginBottom: 16 }}>{resultMessage}</p>
          <button style={styles.secondaryButton} onClick={onBack}>
            Done
          </button>
        </>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
