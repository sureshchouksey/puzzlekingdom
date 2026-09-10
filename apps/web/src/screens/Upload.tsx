import { useState } from "react";
import { FileUp, PenLine, Plus, Sparkles } from "lucide-react";
import { estimateGeneration, generateQuestions, saveManualQuestions, uploadDocument } from "../api";
import type { AiProvider, ManualQuestionInput, ProviderCostEstimate } from "../types";
import { Button } from "../components/ui/button";
import {
  draftIsValid,
  draftToWriteInput,
  emptyQuestionDraft,
  inputClass,
  QUESTION_TYPE_LABELS,
  QuestionTypeFields,
  type QuestionDraft,
} from "../questionAuthoring";

type Mode = "ai" | "manual";
type Step = "form" | "uploading" | "estimating" | "choosing" | "generating" | "done" | "error";

// A tab inside the admin dashboard (not a standalone screen anymore -
// content management is admin-only, see AdminDashboard.tsx). onDone fires
// when the "Done" button is clicked after a successful save, so the
// dashboard can refresh its question list to reflect what was just added.
//
// Redesigned 10 September 2026 so the manual "I already have questions"
// path supports all 8 question types from
// Question-Types-and-Content-Authoring-Plan.md, not just MCQ - it now
// shares the exact same type picker and per-type fields
// (questionAuthoring.tsx's QuestionTypeFields) that AdminDashboard's
// Questions tab uses to edit one question, so a CSSE-style paper mixing
// MCQ, fill-in-blank, and match-the-column questions can be entered in
// one batch. AI generation stays multiple-choice-only for now (see
// Question-Types-and-Content-Authoring-Plan.md's "deliberately skipped"
// note on extending the Gemini/Claude prompts to the new types) - that
// path is unchanged, just visually tidied up to match.
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

  // Manual-entry path state - one QuestionDraft per card, each with its
  // own question type (default mcq, changeable per card).
  const [drafts, setDrafts] = useState<QuestionDraft[]>([emptyQuestionDraft()]);
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

  function updateDraft(index: number, next: QuestionDraft) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? next : d)));
  }

  async function handleSaveManual() {
    if (!subjectName.trim() || drafts.some((d) => !draftIsValid(d))) return;
    setError(null);
    setStep("generating"); // reused as a generic "saving" spinner state
    try {
      const questions: ManualQuestionInput[] = drafts.map((d) => draftToWriteInput(d));
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

  const allManualComplete = drafts.length > 0 && drafts.every(draftIsValid);

  return (
    <div>
      {step === "form" && (
        <div className="mb-6 flex gap-2.5">
          <Button size="sm" variant={mode === "ai" ? "default" : "secondary"} onClick={() => setMode("ai")}>
            <Sparkles className="size-4" />
            Generate with AI
          </Button>
          <Button size="sm" variant={mode === "manual" ? "default" : "secondary"} onClick={() => setMode("manual")}>
            <PenLine className="size-4" />
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
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="mb-5 flex items-start gap-2 text-sm text-muted-foreground">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                Upload a question paper and an AI provider drafts multiple-choice questions from it - review the cost
                estimate before anything is generated. Currently produces multiple-choice questions only; for the
                other 7 question types, use &ldquo;I already have questions&rdquo; instead.
              </p>

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
            </div>
          )}

          {mode === "manual" && (
            <>
              <div className="mb-5 rounded-2xl border border-border bg-card p-5">
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <PenLine className="mt-0.5 size-4 shrink-0 text-primary" />
                  Type in questions you already know the answers to (like a real past paper) - these get saved
                  straight to the database with no AI call, so there's no cost and the answers are exactly what you
                  typed. Pick a type per question below - MCQ, True/False, Fill in the blank, Missing number, Missing
                  spelling, Match the column, Short answer, or Long answer - and mix as many types as you like in one
                  batch.
                </p>

                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm text-muted-foreground">
                    Reading passage (optional) - for comprehension questions that all refer back to one story, paste
                    it here and it'll be shown to the quiz-taker before these questions. Leave blank for
                    self-contained questions (like Maths) that don't need one.
                  </span>
                  <textarea
                    value={passage}
                    onChange={(e) => setPassage(e.target.value)}
                    placeholder="Paste the story or passage here..."
                    rows={5}
                    className={`${inputClass} w-full font-sans`}
                  />
                </label>
              </div>

              <div className="space-y-3">
                {drafts.map((draft, i) => (
                  <div key={i} className="rounded-2xl border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold">Question {i + 1}</span>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                          {QUESTION_TYPE_LABELS[draft.questionType]}
                        </span>
                      </div>
                      {drafts.length > 1 && (
                        <button
                          onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-sm font-medium text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <QuestionTypeFields draft={draft} onChange={(next) => updateDraft(i, next)} />
                  </div>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-2.5">
                <Button
                  variant="secondary"
                  onClick={() => setDrafts((prev) => [...prev, emptyQuestionDraft(prev[prev.length - 1]?.questionType)])}
                >
                  <Plus className="size-4" />
                  Add another question
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
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="mb-4 flex items-center gap-2 font-semibold text-emerald">
            <FileUp className="size-5" />
            {resultMessage}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setStep("form");
              setResultMessage(null);
              setFile(null);
              setDocumentId(null);
              setDrafts([emptyQuestionDraft()]);
              setPassage("");
              onDone?.();
            }}
          >
            Done - add more
          </Button>
        </div>
      )}

      {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
