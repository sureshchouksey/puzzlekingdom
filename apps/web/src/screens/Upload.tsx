import { useState } from "react";
import { estimateGeneration, generateQuestions, uploadDocument } from "../api";
import type { AiProvider, ProviderCostEstimate } from "../types";
import { Layout, styles } from "./Layout";

type Step = "form" | "uploading" | "estimating" | "choosing" | "generating" | "done" | "error";

export function Upload({ onBack }: { onBack: () => void }) {
  const [subjectName, setSubjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState(8);
  const [step, setStep] = useState<Step>("form");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<ProviderCostEstimate[]>([]);
  const [provider, setProvider] = useState<AiProvider>("claude");
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

  return (
    <Layout title="Add new content" onBack={onBack}>
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

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>PDF or image of the content</span>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>Number of questions to generate</span>
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

      {step === "generating" && <p style={styles.muted}>Generating questions - this can take up to 20 seconds...</p>}

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
