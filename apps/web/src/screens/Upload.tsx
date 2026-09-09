import { useState } from "react";
import { estimateGeneration, generateQuestions, saveManualQuestions, uploadDocument } from "../api";
import type { AiProvider, ManualQuestionInput, ProviderCostEstimate } from "../types";
import { Button } from "../components/ui/button";

type Mode = "ai" | "manual";
type Step = "form" | "uploading" | "estimating" | "choosing" | "generating" | "done" | "error";

const OPTION_LABELS = ["a", "b", "c", "d"] as const;

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

// A tab inside the admin dashboard (not a standalone screen anymore -
// content management is admin-only, see AdminDashboard.tsx). onDone fires
// when the "Done" button is clicked after a successful save, so the
// dashboard can refresh its question list to reflect what was just added.
export function Upload({ onDone }: { onDone?: () => void }) {
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
    <div>
      {step === "form" && (
        <div className="mb-6 flex gap-2.5">
          <Button size="sm" variant={mode === "ai" ? "default" : "secondary"} onClick={() => setMode("ai")}>
            Generate with AI
          </Button>
          <Button size="sm" variant={mode === "manual" ? "default" : "secondary"} onClick={() => setMode("manual")}>
            I already have questions
          </Button>
        </div>
      )}

      {(step === "form" || step === "uploading") && (
        <>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm text-muted-foreground">Subject</span>
            <input
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="e.g. Maths"
              className={`${inputClass} w-60`}
            />
          </label>

          {mode === "ai" && (
            <>
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm text-muted-foreground">PDF or image of the content</span>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm"
                />
              </label>

              <label className="mb-5 block">
                <span className="mb-1.5 block text-sm text-muted-foreground">Number of questions to generate</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className={`${inputClass} w-20`}
                />
              </label>

              <Button onClick={handleUploadAndEstimate} disabled={!file || !subjectName.trim() || step === "uploading"}>
                {step === "uploading" ? "Uploading..." : "Upload & get cost estimate"}
              </Button>
            </>
          )}

          {mode === "manual" && (
            <>
              <p className="mb-5 text-sm text-muted-foreground">
                Type in questions you already know the answers to (like a real past paper) - these get saved
                straight to the database with no AI call, so there's no cost and the answers are exactly what
                you typed.
              </p>

              <label className="mb-5 block">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Reading passage (optional) - for comprehension questions that all refer back to one story,
                  paste it here and it'll be shown to the quiz-taker before these questions. Leave blank for
                  self-contained questions (like Maths) that don't need one.
                </span>
                <textarea
                  value={passage}
                  onChange={(e) => setPassage(e.target.value)}
                  placeholder="Paste the story or passage here..."
                  rows={6}
                  className={`${inputClass} w-full font-sans`}
                />
              </label>

              <div className="space-y-3">
                {drafts.map((draft, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="font-semibold">Question {i + 1}</span>
                      {drafts.length > 1 && (
                        <button
                          onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-sm font-medium text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <input
                      value={draft.questionText}
                      onChange={(e) => updateDraft(i, { questionText: e.target.value })}
                      placeholder="Question text"
                      className={`${inputClass} mb-2.5 w-full`}
                    />

                    <div className="mb-2.5 flex flex-col gap-1.5">
                      {draft.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
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
                            className={`${inputClass} flex-1`}
                          />
                        </div>
                      ))}
                    </div>

                    <textarea
                      value={draft.explanation}
                      onChange={(e) => updateDraft(i, { explanation: e.target.value })}
                      placeholder="Explanation shown after the child answers"
                      rows={2}
                      className={`${inputClass} w-full font-sans`}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-2 flex gap-2.5">
                <Button variant="secondary" onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}>
                  + Add another question
                </Button>
                <Button onClick={handleSaveManual} disabled={!subjectName.trim() || !allManualComplete}>
                  Save {drafts.length} question{drafts.length === 1 ? "" : "s"} to database
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {step === "estimating" && <p className="text-sm text-muted-foreground">Checking cost for each AI provider...</p>}

      {step === "choosing" && (
        <>
          <p className="mb-3">Choose which AI generates the questions:</p>
          <div className="mb-5 space-y-2.5">
            {estimates.map((est) => (
              <label
                key={est.provider}
                className={`flex items-center gap-3 rounded-xl border border-border bg-card p-4 ${
                  est.available ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
              >
                <input
                  type="radio"
                  name="provider"
                  checked={provider === est.provider}
                  disabled={!est.available}
                  onChange={() => setProvider(est.provider)}
                />
                <div>
                  <div className="font-semibold capitalize">{est.provider}</div>
                  <div className="text-sm text-muted-foreground">{est.model}</div>
                  {est.available ? (
                    <div className="text-sm">
                      ~{est.estimatedInputTokens} in / ~{est.estimatedOutputTokens} out tokens &mdash; est. $
                      {est.estimatedCostUsd?.toFixed(5)}
                    </div>
                  ) : (
                    <div className="text-sm text-destructive">{est.reason}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
          <Button onClick={handleGenerate}>
            Generate {count} questions with {provider}
          </Button>
        </>
      )}

      {step === "generating" && (
        <p className="text-sm text-muted-foreground">
          {mode === "ai" ? "Generating questions - this can take up to 20 seconds..." : "Saving..."}
        </p>
      )}

      {step === "done" && (
        <>
          <p className="mb-4 font-semibold text-emerald">{resultMessage}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setStep("form");
              setResultMessage(null);
              setFile(null);
              setDocumentId(null);
              setDrafts([emptyDraft()]);
              setPassage("");
              onDone?.();
            }}
          >
            Done - add more
          </Button>
        </>
      )}

      {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
