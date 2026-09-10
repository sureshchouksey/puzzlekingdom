import { Fragment, useEffect, useMemo, useState } from "react";
import { Bird, FileUp, LayoutGrid, LogOut, Settings2, Users } from "lucide-react";
import {
  createAdminQuestion,
  createAdminSubject,
  createAdminTopic,
  deleteAdminQuestion,
  deleteAdminTopic,
  generateTutorInsights,
  getAdminQuestions,
  getAdminTopics,
  getAdminUsers,
  getClasses,
  getSubjects,
  getTutorConversation,
  getTutorConversationsForProfile,
  getTutorInsights,
  getTutorSettings,
  logout,
  resetProfilePin,
  updateAdminQuestion,
  updateAdminTopic,
  updateTutorSettings,
} from "../api";
import type {
  AdminQuestion,
  AdminQuestionWriteInput,
  AdminTopic,
  AdminUser,
  AdminUserSummary,
  PkClass,
  QuestionType,
  QuizOption,
  Subject,
  TopicDifficulty,
  TutorConversation,
  TutorInsightsResponse,
  TutorSettings,
  TutorTranscript,
} from "../types";
import { Button } from "../components/ui/button";
import { Upload } from "./Upload";

type Tab = "questions" | "topics" | "users" | "content" | "studyBuddy";

// Labels shown in the type picker and on non-mcq question cards - order
// here is the order the picker lists them in, matching the plan doc's
// own ordering (MCQ first since it's the existing/default type).
const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  true_false: "True / False",
  fill_blank: "Fill in the blank",
  missing_number: "Missing number",
  missing_spelling: "Missing spelling",
  match_column: "Match the column",
  short_answer: "Short answer",
  long_answer: "Long answer",
};
const QUESTION_TYPE_ORDER: QuestionType[] = [
  "mcq",
  "true_false",
  "fill_blank",
  "missing_number",
  "missing_spelling",
  "match_column",
  "short_answer",
  "long_answer",
];

const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const;

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";

// Draft shape shared by both the "edit an existing question" and "add a
// question to an existing document" forms below. options/correctIndex
// are used for mcq/true_false (options as plain strings keyed by
// position, correctIndex picks which one is right, so the UI never has
// to juggle option ids directly); acceptedAnswers/pairs/rubricKeyPoints
// hold the other 6 types' answerPayload shapes in editable form - see
// draftToWriteInput for how each maps to what admin.ts's
// validateQuestionShape actually expects.
type QuestionDraft = {
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

function emptyQuestionDraft(questionType: QuestionType = "mcq"): QuestionDraft {
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

function draftFromQuestion(q: AdminQuestion): QuestionDraft {
  const payload = q.answerPayload ?? {};
  const pairs =
    payload.left && payload.left.length > 0
      ? payload.left.map((left, i) => ({ left, right: payload.right?.[i] ?? "" }))
      : [
          { left: "", right: "" },
          { left: "", right: "" },
        ];
  return {
    questionType: q.questionType,
    questionText: q.questionText,
    options: q.questionType === "mcq" ? q.options.map((o) => o.text) : ["", "", "", ""],
    correctIndex:
      q.questionType === "mcq" || q.questionType === "true_false"
        ? Math.max(q.options.findIndex((o) => o.id === q.correctOptionId), 0)
        : 0,
    explanation: q.explanation,
    topics: (q.topics ?? []).join(", "),
    tip: q.tip ?? "",
    imageUrl: q.imageUrl ?? "",
    acceptedAnswers: payload.acceptedAnswers && payload.acceptedAnswers.length > 0 ? payload.acceptedAnswers : [""],
    pairs,
    rubricKeyPoints: payload.rubricKeyPoints && payload.rubricKeyPoints.length > 0 ? payload.rubricKeyPoints : [""],
  };
}

function draftToWriteInput(d: QuestionDraft, documentId?: string): AdminQuestionWriteInput {
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

function draftIsValid(d: QuestionDraft): boolean {
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
function StringListEditor({
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

function QuestionForm({
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
  // Switching type resets the type-specific fields to a fresh default,
  // keeping only what's shared across every type (question text,
  // explanation, topics, tip, image) - the old type's
  // options/answerPayload wouldn't validate against the new type anyway
  // (see admin.ts's validateQuestionShape), so there's nothing useful to
  // carry over.
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
    <div className="mb-3 rounded-xl border border-border bg-card p-4">
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
                name="correct-option"
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
                name="correct-option"
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

function QuestionsTab() {
  const [rows, setRows] = useState<AdminQuestion[] | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<QuestionDraft | null>(null);
  const [addingDocumentId, setAddingDocumentId] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<QuestionDraft | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    getAdminQuestions({ subjectName: subjectName.trim() || undefined, search: search.trim() || undefined, limit: 50 })
      .then((res) => setRows(res.questions))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load questions"));
  }

  useEffect(load, []);

  // No document-picker endpoint yet - "add question" attaches to a
  // document that already has at least one question, chosen from what's
  // currently loaded. Use the Content tab first if there's nothing to
  // attach to yet.
  const documentOptions = useMemo(() => {
    const seen = new Map<string, { documentId: string; label: string }>();
    for (const q of rows ?? []) {
      if (!seen.has(q.documentId)) {
        seen.set(q.documentId, { documentId: q.documentId, label: `${q.subjectName}${q.className ? ` (${q.className})` : ""}` });
      }
    }
    return [...seen.values()];
  }, [rows]);

  async function handleSaveEdit() {
    if (!editingId || !editDraft) return;
    setBusy(true);
    setError(null);
    try {
      await updateAdminQuestion(editingId, draftToWriteInput(editDraft));
      setEditingId(null);
      setEditDraft(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save question");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteAdminQuestion(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete question");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (!addingDocumentId || !addDraft) return;
    setBusy(true);
    setError(null);
    try {
      await createAdminQuestion(draftToWriteInput(addDraft, addingDocumentId));
      setAddingDocumentId(null);
      setAddDraft(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create question");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={subjectName}
          onChange={(e) => setSubjectName(e.target.value)}
          placeholder="Filter by subject"
          className={inputClass}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search question text"
          className={inputClass}
        />
        <Button size="sm" variant="secondary" onClick={load}>
          Search
        </Button>
        {documentOptions.length > 0 && !addingDocumentId && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAddingDocumentId(documentOptions[0].documentId);
              setAddDraft(emptyQuestionDraft());
            }}
          >
            + Add question
          </Button>
        )}
      </div>

      {addingDocumentId && addDraft && (
        <div className="mb-4">
          <label className="mb-2 block">
            <span className="mb-1.5 block text-sm text-muted-foreground">Attach to document</span>
            <select
              value={addingDocumentId}
              onChange={(e) => setAddingDocumentId(e.target.value)}
              className={inputClass}
            >
              {documentOptions.map((opt) => (
                <option key={opt.documentId} value={opt.documentId}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <QuestionForm
            draft={addDraft}
            onChange={setAddDraft}
            onSave={handleAdd}
            onCancel={() => {
              setAddingDocumentId(null);
              setAddDraft(null);
            }}
            saving={busy}
          />
        </div>
      )}

      {error && <p className="mb-3 text-sm font-medium text-destructive">{error}</p>}
      {rows === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-muted-foreground">No questions found.</p>}

      <div className="space-y-3">
        {rows?.map((q) =>
          editingId === q.id && editDraft ? (
            <QuestionForm
              key={q.id}
              draft={editDraft}
              onChange={setEditDraft}
              onSave={handleSaveEdit}
              onCancel={() => {
                setEditingId(null);
                setEditDraft(null);
              }}
              saving={busy}
            />
          ) : (
            <div key={q.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{q.questionText}</p>
                    {q.questionType !== "mcq" && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        {QUESTION_TYPE_LABELS[q.questionType]}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {q.subjectName}
                    {q.className ? ` · ${q.className}` : ""}
                    {q.topics && q.topics.length > 0 ? ` · ${q.topics.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingId(q.id);
                      setEditDraft(draftFromQuestion(q));
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-destructive"
                    onClick={() => {
                      if (window.confirm("Delete this question? This can't be undone.")) handleDelete(q.id);
                    }}
                    disabled={busy}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// One profile's doubt-tracking breakdown + growth insights (Section 10
// step 8) - rendered inline below its row in UsersTab when expanded,
// rather than a separate screen, since this is a small amount of
// admin-only detail per profile, not a whole new area of the app.
// Fetched lazily (only once a row is actually expanded) since most
// profiles won't be looked at on a given admin visit.
// Shared by TopicsTab's "add" and "edit" forms. Defined at module scope
// (not nested inside TopicsTab) so its identity is stable across
// TopicsTab re-renders - a component defined inside another component's
// body gets recreated (and its inputs remount, dropping focus) on every
// keystroke otherwise.
type TopicDraft = { classId: string; subjectId: string; name: string; displayOrder: string; difficulty: TopicDifficulty };

function TopicFormFields({
  draft,
  onChange,
  classes,
  subjectsList,
}: {
  draft: TopicDraft;
  onChange: (d: TopicDraft) => void;
  classes: PkClass[];
  subjectsList: Subject[];
}) {
  return (
    <div className="mb-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <select value={draft.classId} onChange={(e) => onChange({ ...draft, classId: e.target.value })} className={inputClass}>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={draft.subjectId} onChange={(e) => onChange({ ...draft, subjectId: e.target.value })} className={inputClass}>
        {subjectsList.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        placeholder="Topic name"
        className={inputClass}
      />
      <input
        type="number"
        value={draft.displayOrder}
        onChange={(e) => onChange({ ...draft, displayOrder: e.target.value })}
        placeholder="Display order"
        className={inputClass}
      />
      <select
        value={draft.difficulty}
        onChange={(e) => onChange({ ...draft, difficulty: e.target.value as TopicDifficulty })}
        className={inputClass}
      >
        <option value="beginner">Beginner</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
      </select>
    </div>
  );
}

const DIFFICULTY_LABEL: Record<TopicDifficulty, string> = { beginner: "Beginner", medium: "Medium", hard: "Hard" };

// Subject + topic management (build order step 3/7 in
// Question-Types-and-Content-Authoring-Plan.md) - topics are class+
// subject scoped, ordered, and carry a difficulty tag that drives both
// the quest map's node sequence and the Beginner/Medium/Hard reward
// labels. Subjects here are just name + create, since they're otherwise
// flat and already listed by the public GET /subjects.
function TopicsTab() {
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [subjectsList, setSubjectsList] = useState<Subject[] | null>(null);
  const [rows, setRows] = useState<AdminTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TopicDraft | null>(null);
  const [addDraft, setAddDraft] = useState<TopicDraft | null>(null);

  function load() {
    setError(null);
    Promise.all([getClasses(), getSubjects(), getAdminTopics()])
      .then(([c, s, t]) => {
        setClasses(c);
        setSubjectsList(s);
        setRows(t);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load topics"));
  }

  useEffect(load, []);

  function blankDraft(): TopicDraft {
    return {
      classId: classes?.[0]?.id ?? "",
      subjectId: subjectsList?.[0]?.id ?? "",
      name: "",
      displayOrder: "0",
      difficulty: "beginner",
    };
  }

  async function handleAddSubject() {
    const name = newSubjectName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await createAdminSubject(name);
      setNewSubjectName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create subject");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAdd() {
    if (!addDraft || !addDraft.classId || !addDraft.subjectId || !addDraft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createAdminTopic({
        classId: addDraft.classId,
        subjectId: addDraft.subjectId,
        name: addDraft.name.trim(),
        displayOrder: Number(addDraft.displayOrder) || 0,
        difficulty: addDraft.difficulty,
      });
      setAddDraft(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create topic");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !editDraft || !editDraft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await updateAdminTopic(editingId, {
        classId: editDraft.classId,
        subjectId: editDraft.subjectId,
        name: editDraft.name.trim(),
        displayOrder: Number(editDraft.displayOrder) || 0,
        difficulty: editDraft.difficulty,
      });
      setEditingId(null);
      setEditDraft(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save topic");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete topic "${name}"? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAdminTopic(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete topic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-sm font-semibold">Add a subject</p>
        <div className="flex gap-2">
          <input
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
            placeholder="Subject name (e.g. Religion)"
            className={`${inputClass} flex-1`}
          />
          <Button size="sm" variant="secondary" onClick={handleAddSubject} disabled={busy || !newSubjectName.trim()}>
            Add subject
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Topics drive both the quest map's node order and the Beginner/Medium/Hard difficulty labels.
        </p>
        {!addDraft && classes && subjectsList && (
          <Button size="sm" onClick={() => setAddDraft(blankDraft())} disabled={classes.length === 0 || subjectsList.length === 0}>
            + Add topic
          </Button>
        )}
      </div>

      {addDraft && classes && subjectsList && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <TopicFormFields draft={addDraft} onChange={setAddDraft} classes={classes} subjectsList={subjectsList} />
          <div className="flex gap-2.5">
            <Button size="sm" onClick={handleSaveAdd} disabled={busy || !addDraft.classId || !addDraft.subjectId || !addDraft.name.trim()}>
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAddDraft(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mb-3 text-sm font-medium text-destructive">{error}</p>}
      {rows === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-muted-foreground">No topics yet.</p>}

      <div className="space-y-3">
        {rows?.map((t) =>
          editingId === t.id && editDraft && classes && subjectsList ? (
            <div key={t.id} className="rounded-xl border border-border bg-card p-4">
              <TopicFormFields draft={editDraft} onChange={setEditDraft} classes={classes} subjectsList={subjectsList} />
              <div className="flex gap-2.5">
                <Button size="sm" onClick={handleSaveEdit} disabled={busy || !editDraft.name.trim()}>
                  {busy ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingId(null);
                    setEditDraft(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="font-semibold">{t.name}</p>
                <p className="text-sm text-muted-foreground">
                  {t.subjectName} · {t.className} · order {t.displayOrder} · {DIFFICULTY_LABEL[t.difficulty]}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingId(t.id);
                    setEditDraft({
                      classId: t.classId,
                      subjectId: t.subjectId,
                      name: t.name,
                      displayOrder: String(t.displayOrder),
                      difficulty: t.difficulty,
                    });
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-destructive"
                  onClick={() => handleDelete(t.id, t.name)}
                  disabled={busy}
                >
                  Delete
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function StudyBuddyInsightsPanel({ profileId, profileName }: { profileId: string; profileName: string }) {
  const [data, setData] = useState<TutorInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    setError(null);
    getTutorInsights(profileId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load Study Buddy insights"));
  }

  useEffect(load, [profileId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateTutorInsights(profileId);
      if (result.generated) {
        load();
      } else {
        setNotice(`${profileName} hasn't asked enough questions on any one topic yet - nothing new to summarize.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate insights");
    } finally {
      setGenerating(false);
    }
  }

  if (error) return <p className="text-sm font-medium text-destructive">{error}</p>;
  if (data === null) return <p className="text-sm text-muted-foreground">Loading Study Buddy insights...</p>;

  const { breakdown, insights } = data;

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          Last 30 days: {breakdown.totalAgentReplies} Study Buddy repl{breakdown.totalAgentReplies === 1 ? "y" : "ies"}
          {breakdown.ungroundedCount > 0 ? `, ${breakdown.ungroundedCount} with no matching lesson content` : ""}.
        </p>
        <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate insights"}
        </Button>
      </div>

      {notice && <p className="mb-3 text-sm text-muted-foreground italic">{notice}</p>}

      {breakdown.topicCounts.length === 0 && insights.length === 0 && (
        <p className="text-sm text-muted-foreground">No Study Buddy activity in the last 30 days.</p>
      )}

      {breakdown.topicCounts.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${insights.length > 0 ? "mb-4" : ""}`}>
          {breakdown.topicCounts.map((t) => (
            <span key={t.topic} className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs">
              {t.topic} ×{t.count}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {insights.map((i) => (
          <div key={i.id} className="rounded-xl border border-border bg-secondary/40 p-3.5">
            <p className="mb-1 text-xs font-semibold">{i.topic}</p>
            <p className="mb-1 text-sm">{i.insightText}</p>
            <p className="m-0 text-xs text-muted-foreground">
              Generated {new Date(i.generatedAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersTab() {
  const [rows, setRows] = useState<AdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  // Which profile's Study Buddy panel is open, if any - only one at a
  // time, and its own component (above) handles its own data fetching.
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);

  function load() {
    getAdminUsers()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"));
  }

  useEffect(load, []);

  async function handleResetPin(profileId: string, name: string) {
    if (!window.confirm(`Reset ${name}'s PIN? They'll be asked to choose a new one next time they enter their name.`)) return;
    setResettingId(profileId);
    setError(null);
    try {
      await resetProfilePin(profileId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset PIN");
    } finally {
      setResettingId(null);
    }
  }

  if (error) return <p className="text-sm font-medium text-destructive">{error}</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No players yet.</p>;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-semibold">Name</th>
            <th className="px-4 py-2 font-semibold">Title</th>
            <th className="px-4 py-2 font-semibold">PIN</th>
            <th className="px-4 py-2 font-semibold">Quizzes</th>
            <th className="px-4 py-2 font-semibold">Stages cleared</th>
            <th className="px-4 py-2 font-semibold">Accuracy</th>
            <th className="px-4 py-2 font-semibold">Last active</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <Fragment key={r.profileId}>
              <tr>
                <td className="px-4 py-3 font-semibold">{r.name}</td>
                <td className="px-4 py-3">{r.title ?? "–"}</td>
                <td className="px-4 py-3">{r.hasPin ? "Set" : "Not set yet"}</td>
                <td className="px-4 py-3">{r.quizzesPlayed}</td>
                <td className="px-4 py-3">{r.stagesCleared}</td>
                <td className="px-4 py-3">{r.accuracy !== null ? `${Math.round(r.accuracy * 100)}%` : "–"}</td>
                <td className="px-4 py-3">{r.lastActive ? new Date(r.lastActive).toLocaleDateString() : "–"}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button
                    onClick={() => setExpandedProfileId(expandedProfileId === r.profileId ? null : r.profileId)}
                    className="mr-3 text-sm font-semibold text-primary hover:underline"
                  >
                    {expandedProfileId === r.profileId ? "Hide Study Buddy" : "Study Buddy"}
                  </button>
                  {r.hasPin && (
                    <button
                      onClick={() => handleResetPin(r.profileId, r.name)}
                      disabled={resettingId === r.profileId}
                      className="text-sm font-semibold text-destructive hover:underline"
                    >
                      {resettingId === r.profileId ? "Resetting..." : "Reset PIN"}
                    </button>
                  )}
                </td>
              </tr>
              {expandedProfileId === r.profileId && (
                <tr>
                  <td colSpan={8} className="px-4 pb-4">
                    <StudyBuddyInsightsPanel profileId={r.profileId} profileName={r.name} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The on/off toggle + caps, and a per-profile conversation browser -
// Section 10 step 9's "Study Buddy tab", deliberately separate from step
// 8's inline per-profile insights panel in the Users tab (see that
// step's own note on the split). Settings and conversation-browsing are
// independent concerns sharing one tab purely because both are
// admin-only Study Buddy housekeeping, not because they interact.
function StudyBuddySettingsPanel() {
  const [settings, setSettings] = useState<TutorSettings | null>(null);
  const [draft, setDraft] = useState<TutorSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    getTutorSettings()
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"));
  }

  useEffect(load, []);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateTutorSettings(draft);
      setSettings(updated);
      setDraft(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="text-sm font-medium text-destructive">{error}</p>;
  if (draft === null) return <p className="text-sm text-muted-foreground">Loading settings...</p>;

  const dirty = settings !== null && JSON.stringify(settings) !== JSON.stringify(draft);

  return (
    <div className="max-w-[420px] rounded-xl border border-border bg-card p-4">
      <label className="mb-4 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={draft.tutorEnabled}
          onChange={(e) => setDraft({ ...draft, tutorEnabled: e.target.checked })}
        />
        <span>Study Buddy is {draft.tutorEnabled ? "on" : "off"} for everyone</span>
      </label>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">Daily message cap, per profile</span>
        <input
          type="number"
          min={1}
          value={draft.tutorDailyCapPerProfile}
          onChange={(e) => setDraft({ ...draft, tutorDailyCapPerProfile: Math.max(1, Number(e.target.value) || 1) })}
          className={`${inputClass} w-[120px]`}
        />
      </label>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">
          Shared daily budget across everyone (optional - not enforced yet, see the plan doc)
        </span>
        <input
          type="number"
          min={1}
          value={draft.tutorSharedDailyBudget ?? ""}
          placeholder="No shared limit"
          onChange={(e) =>
            setDraft({ ...draft, tutorSharedDailyBudget: e.target.value === "" ? null : Math.max(1, Number(e.target.value) || 1) })
          }
          className={`${inputClass} w-40`}
        />
      </label>

      <div className="mb-4 border-t border-border pt-4">
        <p className="mb-1 text-sm font-medium">Resource access</p>
        <p className="mb-3 text-sm text-muted-foreground">
          What Study Buddy is allowed to use when answering an academic question. All three on is normal
          behaviour - turn one off to test or restrict how a reply gets built.
        </p>

        <label className="mb-3 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={draft.tutorUseConceptGuides}
            onChange={(e) => setDraft({ ...draft, tutorUseConceptGuides: e.target.checked })}
          />
          <span>Concept guides {draft.tutorUseConceptGuides ? "on" : "off"} - match against lesson guides, not just questions</span>
        </label>

        <label className="mb-3 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={draft.tutorUseCache}
            onChange={(e) => setDraft({ ...draft, tutorUseCache: e.target.checked })}
          />
          <span>Cached answers {draft.tutorUseCache ? "on" : "off"} - reuse a previous real answer to the same question</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={draft.tutorUseGemini}
            onChange={(e) => setDraft({ ...draft, tutorUseGemini: e.target.checked })}
          />
          <span>Gemini {draft.tutorUseGemini ? "on" : "off"} - when off, matched content is served directly with no AI rephrasing</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {saved && !dirty && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </div>
  );
}

// One profile's chat history, read-only - picked from a dropdown rather
// than a search, since this is a small, single-family instance where
// the whole roster fits comfortably in one <select>.
function StudyBuddyConversationsPanel() {
  const [profiles, setProfiles] = useState<AdminUserSummary[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [conversations, setConversations] = useState<TutorConversation[] | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TutorTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminUsers()
      .then(setProfiles)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load profiles"));
  }, []);

  useEffect(() => {
    if (!selectedProfileId) {
      setConversations(null);
      return;
    }
    setError(null);
    setConversations(null);
    setSelectedConversationId(null);
    setTranscript(null);
    getTutorConversationsForProfile(selectedProfileId)
      .then(setConversations)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversations"));
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedConversationId) {
      setTranscript(null);
      return;
    }
    setError(null);
    getTutorConversation(selectedConversationId)
      .then(setTranscript)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load transcript"));
  }, [selectedConversationId]);

  if (error) return <p className="text-sm font-medium text-destructive">{error}</p>;

  return (
    <div>
      <select
        value={selectedProfileId}
        onChange={(e) => setSelectedProfileId(e.target.value)}
        className={`${inputClass} mb-4`}
      >
        <option value="">Pick a player...</option>
        {profiles?.map((p) => (
          <option key={p.profileId} value={p.profileId}>
            {p.name}
          </option>
        ))}
      </select>

      {selectedProfileId && conversations === null && <p className="text-sm text-muted-foreground">Loading conversations...</p>}
      {selectedProfileId && conversations !== null && conversations.length === 0 && (
        <p className="text-sm text-muted-foreground">No Study Buddy conversations yet for this player.</p>
      )}

      <div className="flex flex-wrap gap-6">
        {conversations && conversations.length > 0 && (
          <div className="min-w-[220px] space-y-2">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedConversationId(c.id)}
                className={`block w-full rounded-lg border px-3 py-2 text-left text-sm shadow-sm transition-colors ${
                  selectedConversationId === c.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                <div className="font-semibold">
                  {c.className ?? "?"} · {c.subjectName ?? "?"}
                </div>
                <div className="text-xs opacity-85">
                  {c.contextType === "question" ? "Explain this to me" : "General chat"} · last active{" "}
                  {new Date(c.lastMessageAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}

        {transcript && (
          <div className="max-h-[420px] min-w-[260px] flex-1 overflow-y-auto rounded-xl border border-border bg-card p-4">
            {transcript.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages in this conversation yet.</p>}
            <div className="space-y-2.5">
              {transcript.messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "student" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "student" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudyBuddyTab() {
  return (
    <div>
      <h2 className="mb-3 text-lg">Settings</h2>
      <StudyBuddySettingsPanel />
      <h2 className="mt-7 mb-3 text-lg">Conversations</h2>
      <StudyBuddyConversationsPanel />
    </div>
  );
}

const TABS: { key: Tab; label: string; icon: typeof Bird }[] = [
  { key: "questions", label: "Questions", icon: FileUp },
  { key: "topics", label: "Topics", icon: LayoutGrid },
  { key: "users", label: "Users", icon: Users },
  { key: "content", label: "Add content", icon: FileUp },
  { key: "studyBuddy", label: "Study Buddy", icon: Settings2 },
];

// Admin control center: question management, the user roster, and content
// upload/generation all live here now - the standalone Upload screen and
// Home's open "Add new content" button are both gone, since managing
// content is admin-only. Grown-up surface, so it uses the warm
// ".parchment" scope rather than the child-facing night-sky/gold system
// - see src/styles.css and plan/Lovable-Design-Migration-Plan.md, and the
// Lovable reference's own /admin route (pixel-perfect-replica/src/
// routes/admin.tsx), which this shell follows closely: a tab row on the
// right of the header, cards in a bordered/rounded style, tables with a
// tinted header row.
export function AdminDashboard({ admin, onLogOut }: { admin: AdminUser; onLogOut: () => void }) {
  const [tab, setTab] = useState<Tab>("questions");

  function handleLogOut() {
    logout();
    onLogOut();
  }

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Puzzle Kingdom admin</p>
            <h1 className="text-2xl">{admin.username}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <Button key={t.key} size="sm" variant={tab === t.key ? "default" : "secondary"} onClick={() => setTab(t.key)}>
                {t.label}
              </Button>
            ))}
            <Button size="sm" variant="secondary" onClick={handleLogOut}>
              <LogOut className="size-4" />
              Log out
            </Button>
          </div>
        </header>

        <div className="mt-6">
          {tab === "questions" && <QuestionsTab />}
          {tab === "topics" && <TopicsTab />}
          {tab === "users" && <UsersTab />}
          {tab === "content" && <Upload />}
          {tab === "studyBuddy" && <StudyBuddyTab />}
        </div>
      </div>
    </div>
  );
}
