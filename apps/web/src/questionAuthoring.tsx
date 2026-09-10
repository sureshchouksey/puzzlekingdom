// Shared type-aware question-authoring building blocks - originally
// built inside AdminDashboard.tsx's Questions tab for editing one
// question at a time, extracted here 10 September 2026 so Upload.tsx's
// "I already have questions" bulk-entry flow can offer the exact same
// type picker and per-type fields (all 8 types from
// Question-Types-and-Content-Authoring-Plan.md) instead of its old
// MCQ-only form. AdminDashboard.tsx imports from here now too, rather
// than keeping its own copy.
import { Button } from "./components/ui/button";
import type { AdminQuestionWriteInput, QuestionType, QuizOption } from "./types";

// Labels shown in the type picker and on non-mcq question cards - order
// here is the order the picker lists them in, matching the plan doc's
// own ordering (MCQ first since it's the existing/default type).
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  true_false: "True / False",
  fill_blank: "Fill in the blank",
  missing_number: "Missing number",
  missing_spelling: "Missing spelling",
  match_column: "Match the column",
  short_answer: "Short answer",
  long_answer: "Long answer",
};

export const QUESTION_TYPE_ORDER: QuestionType[] = [
  "mcq",
  "true_false",
  "fill_blank",
  "missing_number",
  "missing_spelling",
  "match_column",
  "short_answer",
  "long_answer",
];

export const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const;

export const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";

// Draft shape shared by "edit an existing question", "add a question to
// an existing document" (both in AdminDashboard.tsx), and now Upload.tsx's
// bulk manual-entry cards. options/correctIndex are used for mcq/
// true_false (options as plain strings keyed by position, correctIndex
// picks which one is right, so the UI never has to juggle option ids
// directly); acceptedAnswers/pairs/rubricKeyPoints hold the other 6
// types' answerPayload shapes in editable form - see draftToWriteInput
// for how each maps to what the backend's validateQuestionShape actually
// expects.
export type QuestionDraft = {
  questionType: QuestionType;
  questionText: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topics: string;
  tip: string;
  imageUrl: string;
  acceptedAnswers: string[];
  pairs: { left: string; right: string }[];
  rubricKeyPoints: string[];
};

export function emptyQuestionDraft(questionType: QuestionType = "mcq"): QuestionDraft {
  return {
    questionType,
    questionText: "",
    options: ["", "", "", ""],
    correctIndex: 0,
    explanation: "",
    topics: "",
    tip: "",
    imageUrl: "",
    acceptedAnswers: [""],
    pairs: [
      { left: "", right: "" },
      { left: "", right: "" },
    ],
    rubricKeyPoints: [""],
  };
}

// Converts a draft into the wire shape the backend expects - used both
// for AdminDashboard's create/update-one-question calls (documentId set)
// and Upload.tsx's bulk-create call (documentId omitted; the server
// assigns every question in the batch to the one document it creates).
export function draftToWriteInput(d: QuestionDraft, documentId?: string): AdminQuestionWriteInput {
  const topics = d.topics
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const base = {
    documentId,
    questionType: d.questionType,
    questionText: d.questionText.trim(),
    explanation: d.explanation.trim(),
    topics: topics.length ? topics : undefined,
    tip: d.tip.trim() || undefined,
    imageUrl: d.imageUrl.trim() || undefined,
  };

  switch (d.questionType) {
    case "mcq": {
      const options: QuizOption[] = d.options.map((text, i) => ({ id: OPTION_LABELS[i], text: text.trim() }));
      return { ...base, options, correctOptionId: OPTION_LABELS[d.correctIndex], answerPayload: null };
    }
    case "true_false": {
      const options: QuizOption[] = [
        { id: "true", text: "True" },
        { id: "false", text: "False" },
      ];
      return { ...base, options, correctOptionId: d.correctIndex === 0 ? "true" : "false", answerPayload: null };
    }
    case "fill_blank":
    case "missing_number":
    case "missing_spelling": {
      const acceptedAnswers = d.acceptedAnswers.map((a) => a.trim()).filter(Boolean);
      return { ...base, options: [], correctOptionId: "", answerPayload: { acceptedAnswers } };
    }
    case "match_column": {
      const rows = d.pairs.map((p) => ({ left: p.left.trim(), right: p.right.trim() })).filter((p) => p.left && p.right);
      return {
        ...base,
        options: [],
        correctOptionId: "",
        answerPayload: {
          left: rows.map((r) => r.left),
          right: rows.map((r) => r.right),
          correctPairs: rows.map((_, i) => [i, i] as [number, number]),
        },
      };
    }
    case "short_answer":
    case "long_answer": {
      const rubricKeyPoints = d.rubricKeyPoints.map((r) => r.trim()).filter(Boolean);
      return { ...base, options: [], correctOptionId: "", answerPayload: { rubricKeyPoints } };
    }
  }
}

export function draftIsValid(d: QuestionDraft): boolean {
  if (d.questionText.trim().length === 0 || d.explanation.trim().length === 0) return false;
  switch (d.questionType) {
    case "mcq":
      return d.options.length >= 3 && d.options.every((o) => o.trim().length > 0);
    case "true_false":
      return true;
    case "fill_blank":
    case "missing_number":
    case "missing_spelling":
      return d.acceptedAnswers.some((a) => a.trim().length > 0);
    case "match_column":
      return d.pairs.filter((p) => p.left.trim().length > 0 && p.right.trim().length > 0).length >= 2;
    case "short_answer":
    case "long_answer":
      return d.rubricKeyPoints.some((r) => r.trim().length > 0);
  }
}

// A reorderable list of plain-text entries - shared by fill-in-blank/
// missing-number/missing-spelling's "accepted answers" and short/long
// answer's "model answer key points", the two places a question needs a
// growable list of strings rather than a fixed shape.
export function StringListEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className={`${inputClass} flex-1`}
          />
          {values.length > 1 && (
            <button
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              className="text-sm font-medium text-destructive hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button onClick={() => onChange([...values, ""])} className="self-start text-sm font-semibold text-primary hover:underline">
        + Add
      </button>
    </div>
  );
}

// The type picker plus every per-type field (options grid, accepted
// answers, pair builder, rubric key points) and the fields shared by
// every type (explanation, topics, tip, image URL) - everything a
// question needs EXCEPT a save/cancel footer, so both QuestionForm below
// (single question, its own Save/Cancel) and Upload.tsx's bulk cards
// (one shared "Save all" button, a per-card Remove instead) can wrap it
// differently.
export function QuestionTypeFields({ draft, onChange }: { draft: QuestionDraft; onChange: (d: QuestionDraft) => void }) {
  // Switching type resets the type-specific fields to a fresh default,
  // keeping only what's shared across every type (question text,
  // explanation, topics, tip, image) - the old type's
  // options/answerPayload wouldn't validate against the new type anyway
  // (see the backend's validateQuestionShape), so there's nothing useful
  // to carry over.
  function setType(questionType: QuestionType) {
    onChange({
      ...emptyQuestionDraft(questionType),
      questionText: draft.questionText,
      explanation: draft.explanation,
      topics: draft.topics,
      tip: draft.tip,
      imageUrl: draft.imageUrl,
    });
  }

  return (
    <>
      <label className="mb-2.5 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">Question type</span>
        <select value={draft.questionType} onChange={(e) => setType(e.target.value as QuestionType)} className={`${inputClass} w-full`}>
          {QUESTION_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {QUESTION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <input
        value={draft.questionText}
        onChange={(e) => onChange({ ...draft, questionText: e.target.value })}
        placeholder="Question text"
        className={`${inputClass} mb-2.5 w-full`}
      />

      {draft.questionType === "mcq" && (
        <div className="mb-2.5 flex flex-col gap-1.5">
          {draft.options.map((opt, oi) => (
            <div key={oi} className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-option-${draft.questionType}`}
                checked={draft.correctIndex === oi}
                onChange={() => onChange({ ...draft, correctIndex: oi })}
                title="Mark as the correct answer"
              />
              <input
                value={opt}
                onChange={(e) => {
                  const options = [...draft.options];
                  options[oi] = e.target.value;
                  onChange({ ...draft, options });
                }}
                placeholder={`Option ${OPTION_LABELS[oi].toUpperCase()}`}
                className={`${inputClass} flex-1`}
              />
              {draft.options.length > 3 && (
                <button
                  onClick={() => {
                    const options = draft.options.filter((_, i) => i !== oi);
                    const correctIndex = draft.correctIndex === oi ? 0 : draft.correctIndex > oi ? draft.correctIndex - 1 : draft.correctIndex;
                    onChange({ ...draft, options, correctIndex });
                  }}
                  className="text-sm font-medium text-destructive hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {draft.options.length < 6 && (
            <button
              onClick={() => onChange({ ...draft, options: [...draft.options, ""] })}
              className="self-start text-sm font-semibold text-primary hover:underline"
            >
              + Add option
            </button>
          )}
        </div>
      )}

      {draft.questionType === "true_false" && (
        <div className="mb-2.5 flex flex-col gap-1.5">
          {(["True", "False"] as const).map((label, oi) => (
            <label key={label} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`correct-option-${draft.questionType}`}
                checked={draft.correctIndex === oi}
                onChange={() => onChange({ ...draft, correctIndex: oi })}
                title="Mark as the correct answer"
              />
              {label}
            </label>
          ))}
        </div>
      )}

      {(draft.questionType === "fill_blank" || draft.questionType === "missing_number" || draft.questionType === "missing_spelling") && (
        <div className="mb-2.5">
          <p className="mb-1.5 text-sm text-muted-foreground">
            Accepted answers
            {draft.questionType === "missing_spelling" ? " (checked exactly as spelled - case-sensitive)" : " (any one of these counts as correct)"}
          </p>
          <StringListEditor
            values={draft.acceptedAnswers}
            onChange={(acceptedAnswers) => onChange({ ...draft, acceptedAnswers })}
            placeholder="Accepted answer"
          />
        </div>
      )}

      {draft.questionType === "match_column" && (
        <div className="mb-2.5">
          <p className="mb-1.5 text-sm text-muted-foreground">Pairs to match (each row is one correct pair - at least 2 needed)</p>
          <div className="flex flex-col gap-1.5">
            {draft.pairs.map((pair, pi) => (
              <div key={pi} className="flex items-center gap-2">
                <input
                  value={pair.left}
                  onChange={(e) => {
                    const pairs = [...draft.pairs];
                    pairs[pi] = { ...pairs[pi], left: e.target.value };
                    onChange({ ...draft, pairs });
                  }}
                  placeholder="Left item"
                  className={`${inputClass} flex-1`}
                />
                <span className="text-muted-foreground">&#8596;</span>
                <input
                  value={pair.right}
                  onChange={(e) => {
                    const pairs = [...draft.pairs];
                    pairs[pi] = { ...pairs[pi], right: e.target.value };
                    onChange({ ...draft, pairs });
                  }}
                  placeholder="Right item"
                  className={`${inputClass} flex-1`}
                />
                {draft.pairs.length > 2 && (
                  <button
                    onClick={() => onChange({ ...draft, pairs: draft.pairs.filter((_, i) => i !== pi) })}
                    className="text-sm font-medium text-destructive hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => onChange({ ...draft, pairs: [...draft.pairs, { left: "", right: "" }] })}
              className="self-start text-sm font-semibold text-primary hover:underline"
            >
              + Add pair
            </button>
          </div>
        </div>
      )}

      {(draft.questionType === "short_answer" || draft.questionType === "long_answer") && (
        <div className="mb-2.5">
          <p className="mb-1.5 text-sm text-muted-foreground">
            Model answer key points (shown afterward for the child to self-compare - not auto-graded for content, only spell-checked)
          </p>
          <StringListEditor
            values={draft.rubricKeyPoints}
            onChange={(rubricKeyPoints) => onChange({ ...draft, rubricKeyPoints })}
            placeholder="Key point"
          />
        </div>
      )}

      <textarea
        value={draft.explanation}
        onChange={(e) => onChange({ ...draft, explanation: e.target.value })}
        placeholder="Explanation"
        rows={2}
        className={`${inputClass} mb-2.5 w-full font-sans`}
      />
      <input
        value={draft.topics}
        onChange={(e) => onChange({ ...draft, topics: e.target.value })}
        placeholder="Topics, comma-separated (optional)"
        className={`${inputClass} mb-2.5 w-full`}
      />
      <input
        value={draft.tip}
        onChange={(e) => onChange({ ...draft, tip: e.target.value })}
        placeholder="Tip (optional)"
        className={`${inputClass} mb-2.5 w-full`}
      />
      <input
        value={draft.imageUrl}
        onChange={(e) => onChange({ ...draft, imageUrl: e.target.value })}
        placeholder="Image URL (optional)"
        className={`${inputClass} mb-3 w-full`}
      />
    </>
  );
}

// Full form for editing/adding ONE question in place - AdminDashboard.tsx's
// Questions tab (its own Save/Cancel per question, since each edit/add is
// its own API call). Upload.tsx's bulk cards use QuestionTypeFields
// directly instead, since they share one "Save all" button across every
// draft rather than saving one at a time.
export function QuestionForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: QuestionDraft;
  onChange: (d: QuestionDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="mb-3 rounded-xl border border-border bg-card p-4">
      <QuestionTypeFields draft={draft} onChange={onChange} />
      <div className="flex gap-2.5">
        <Button size="sm" onClick={onSave} disabled={saving || !draftIsValid(draft)}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
