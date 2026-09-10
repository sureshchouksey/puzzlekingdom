import { useEffect, useMemo, useState } from "react";
import {
  Bird,
  CalendarClock,
  FileUp,
  Gamepad2,
  Key,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Search,
  Settings2,
  Sparkles,
  Target,
  ToggleLeft,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { avatarFile } from "../avatars";
import {
  clearTutorInsights,
  createAdminQuestion,
  createAdminSubject,
  createAdminTopic,
  deleteAdminQuestion,
  deleteAdminTopic,
  deleteAdminUser,
  generateTutorInsights,
  getAdminQuestions,
  getAdminTopics,
  getAdminUsers,
  getClasses,
  getSubjects,
  getTopics,
  getAppSettings,
  getTutorConversation,
  getTutorConversationsForProfile,
  getTutorInsights,
  logout,
  resetProfilePin,
  updateAdminQuestion,
  updateAdminTopic,
  updateAppSettings,
} from "../api";
import type {
  AdminQuestion,
  AdminTopic,
  AdminUser,
  AdminUserSummary,
  AppSettings,
  PkClass,
  Subject,
  TopicDifficulty,
  TutorConversation,
  TutorInsightsResponse,
  TutorTranscript,
} from "../types";
import { Button } from "../components/ui/button";
import { Upload } from "./Upload";
import {
  emptyQuestionDraft,
  draftIsValid,
  draftToWriteInput,
  inputClass,
  QuestionForm,
  QUESTION_TYPE_LABELS,
  type QuestionDraft,
} from "../questionAuthoring";

type Tab = "questions" | "topics" | "users" | "content" | "studyBuddy" | "features";

// Fills a QuestionDraft from an existing DB question, for the "edit"
// flow - Upload.tsx never needs this (it only ever creates new
// questions), so it stays local to AdminDashboard.tsx rather than moving
// into the shared questionAuthoring.tsx module.
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

// Replaces window.confirm() everywhere in this dashboard (delete
// question/topic/user, reset PIN, clear insights) - added 10 September
// 2026 after a real click-through found that native confirm() silently
// no-ops inside the embedded Browser pane used to test this app (no
// dialog appears, confirm() just returns false, so the button looked
// completely dead with no error shown). An in-app dialog works the same
// everywhere - a real browser tab, an embedded pane, any future webview -
// and is also friendlier to browser-automation tooling in general, which
// is warned off triggering native JS dialogs. One instance per component
// that needs it (QuestionsTab/TopicsTab/UsersTab each get their own;
// StudyBuddyInsightsPanel is a separate component so it gets its own
// too) - only ever one confirmation pending at a time within that
// component, which matches how these dashboards are actually used.
function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  busy,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <p className="mb-4 text-sm">{message}</p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function useConfirm() {
  const [pending, setPending] = useState<{ message: string; action: () => void | Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);

  function requestConfirm(message: string, action: () => void | Promise<void>) {
    setPending({ message, action });
  }

  async function handleConfirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.action();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const dialog = pending ? (
    <ConfirmDialog message={pending.message} onConfirm={handleConfirm} onCancel={() => setPending(null)} busy={busy} />
  ) : null;

  return { requestConfirm, dialog };
}

const QUESTIONS_PAGE_SIZE = 10;

function QuestionsTab() {
  const [rows, setRows] = useState<AdminQuestion[] | null>(null);
  // Class/subject/topic are proper dropdowns, cascading the same way the
  // rest of the app narrows topic - class and subject pick from the
  // catalog (getClasses/getSubjects, same lists TopicsTab uses), and the
  // topic dropdown is repopulated from GET /topics (classes.ts) - the
  // distinct topic tags that actually exist on questions.topics for the
  // chosen class+subject, so every option is guaranteed to match at least
  // one question. Empty string means "all" for each.
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [subjectsList, setSubjectsList] = useState<Subject[] | null>(null);
  const [classId, setClassId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [topicOptions, setTopicOptions] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<QuestionDraft | null>(null);
  const [addingDocumentId, setAddingDocumentId] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<QuestionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([]);
  const { requestConfirm, dialog } = useConfirm();

  function load(pageCursor: string | undefined) {
    setError(null);
    getAdminQuestions({
      classId: classId || undefined,
      subjectName: subjectName.trim() || undefined,
      topic: topic || undefined,
      search: search.trim() || undefined,
      limit: QUESTIONS_PAGE_SIZE,
      cursor: pageCursor,
    })
      .then((res) => {
        setRows(res.questions);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load questions"));
  }

  function resetAndLoad() {
    setCursorHistory([]);
    setCursor(undefined);
    load(undefined);
  }

  useEffect(() => {
    Promise.all([getClasses(), getSubjects()])
      .then(([c, s]) => {
        setClasses(c);
        setSubjectsList(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load classes/subjects"));
  }, []);

  // Repopulate the topic dropdown whenever class or subject changes -
  // narrowing either one can make the previously-selected topic no
  // longer exist for this combination, so it's cleared rather than left
  // pointing at a topic that would silently match nothing.
  useEffect(() => {
    getTopics({ classId: classId || undefined, subjectName: subjectName.trim() || undefined })
      .then((opts) => {
        setTopicOptions(opts);
        setTopic((current) => (opts.includes(current) ? current : ""));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load topics"));
  }, [classId, subjectName]);

  function goNext() {
    if (!nextCursor) return;
    setCursorHistory((h) => [...h, cursor]);
    setCursor(nextCursor);
    load(nextCursor);
  }

  function goPrev() {
    setCursorHistory((h) => {
      const prev = h[h.length - 1];
      setCursor(prev);
      load(prev);
      return h.slice(0, -1);
    });
  }

  useEffect(() => load(undefined), []);

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
      load(cursor);
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
      load(cursor);
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
      load(cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create question");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {dialog}
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass}>
          <option value="">All classes</option>
          {classes?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={subjectName} onChange={(e) => setSubjectName(e.target.value)} className={inputClass}>
          <option value="">All subjects</option>
          {subjectsList?.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} className={inputClass}>
          <option value="">All topics</option>
          {topicOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") resetAndLoad();
          }}
          placeholder="Search question text"
          className={inputClass}
        />
        <Button size="sm" variant="secondary" onClick={resetAndLoad}>
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
                    onClick={() => requestConfirm("Delete this question? This can't be undone.", () => handleDelete(q.id))}
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

      {rows !== null && rows.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button size="sm" variant="secondary" onClick={goPrev} disabled={cursorHistory.length === 0}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {cursorHistory.length + 1}</span>
          <Button size="sm" variant="secondary" onClick={goNext} disabled={!nextCursor}>
            Next
          </Button>
        </div>
      )}
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
  const { requestConfirm, dialog } = useConfirm();

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

  function handleDelete(id: string, name: string) {
    requestConfirm(`Delete topic "${name}"? This can't be undone.`, async () => {
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
    });
  }

  return (
    <div>
      {dialog}
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
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { requestConfirm, dialog } = useConfirm();

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

  // Added 10 September 2026 after a live click-through turned up stale
  // rows from an early prototype of this feature - lets an admin wipe
  // them out directly rather than waiting on a valid GEMINI_API_KEY to
  // regenerate (which upserts per-topic, so a topic that's gone quiet
  // never gets its stale row overwritten).
  function handleClear() {
    requestConfirm(`Clear all stored Study Buddy insights for ${profileName}? This can't be undone.`, async () => {
      setClearing(true);
      setError(null);
      setNotice(null);
      try {
        await clearTutorInsights(profileId);
        load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to clear insights");
      } finally {
        setClearing(false);
      }
    });
  }

  if (error) return <p className="text-sm font-medium text-destructive">{error}</p>;
  if (data === null) return <p className="text-sm text-muted-foreground">Loading Study Buddy insights...</p>;

  const { breakdown, insights } = data;

  return (
    <div>
      {dialog}
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          Last 30 days: {breakdown.totalAgentReplies} Study Buddy repl{breakdown.totalAgentReplies === 1 ? "y" : "ies"}
          {breakdown.ungroundedCount > 0 ? `, ${breakdown.ungroundedCount} with no matching lesson content` : ""}.
        </p>
        <div className="flex shrink-0 gap-2">
          {data.insights.length > 0 && (
            <Button size="sm" variant="secondary" className="text-destructive" onClick={handleClear} disabled={clearing}>
              {clearing ? "Clearing..." : "Clear"}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating..." : "Generate insights"}
          </Button>
        </div>
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

// Looks up the avatar image the same way Leaderboard.tsx does (shared
// list in ../avatars.ts) - falls back to the old generic per-title image
// for profiles created before avatar choice existed.
function usersTabAvatarSrc(avatarId: string | null, title: string | null): string {
  return avatarFile(avatarId) ?? (title === "Princess" ? "/princess.png" : "/prince.png");
}

// Same red/gold/emerald accuracy tiering as ParentDashboard.tsx's
// accuracyTint - kept as its own small local copy rather than a shared
// import, matching this file's existing convention of each
// section/screen owning its own tiny formatting helpers.
function usersTabAccuracyTint(accuracy: number | null): string {
  if (accuracy === null) return "bg-muted-foreground";
  if (accuracy < 0.5) return "bg-ruby";
  if (accuracy < 0.75) return "bg-primary";
  return "bg-emerald";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Redesigned 10 September 2026 (the plain table felt too bare for a
// roster this central) - stat tiles up top for an at-a-glance read on
// the whole player base, then one card per player (avatar, badges, an
// accuracy bar) instead of a spreadsheet row, matching the card language
// QuestionsTab/TopicsTab already use elsewhere in this file and the
// stat-tile pattern ParentDashboard.tsx established for the same
// AdminUserSummary data. Search is plain client-side filtering (the
// roster is one unpaginated GET /admin/users call, unlike Questions'
// paginated list) rather than another round trip.
const USERS_PAGE_SIZE = 10;

function UsersTab() {
  const [rows, setRows] = useState<AdminUserSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Which profile's Study Buddy panel is open, if any - only one at a
  // time, and its own component (above) handles its own data fetching.
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  // Client-side pagination, 10 per page - the whole roster already loads
  // in one GET /admin/users call (unlike Questions, which is server-
  // paginated), so paging just slices what's already in memory. 1-based
  // to match the "Page N" label shown next to Prev/Next.
  const { requestConfirm, dialog } = useConfirm();
  const [page, setPage] = useState(1);

  function load() {
    getAdminUsers()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"));
  }

  useEffect(load, []);

  function handleResetPin(profileId: string, name: string) {
    requestConfirm(`Reset ${name}'s PIN? They'll be asked to choose a new one next time they enter their name.`, async () => {
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
    });
  }

  function handleDeleteUser(profileId: string, name: string) {
    requestConfirm(
      `Permanently delete ${name}? This removes their profile and every quiz, Study Buddy chat, and game they've played. This can't be undone.`,
      async () => {
        setDeletingId(profileId);
        setError(null);
        try {
          await deleteAdminUser(profileId);
          if (expandedProfileId === profileId) setExpandedProfileId(null);
          load();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to delete profile");
        } finally {
          setDeletingId(null);
        }
      }
    );
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !rows) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  useEffect(() => {
    setPage(1);
  }, [search, rows]);

  const totalPages = filteredRows ? Math.max(1, Math.ceil(filteredRows.length / USERS_PAGE_SIZE)) : 1;
  const pagedRows = filteredRows?.slice((page - 1) * USERS_PAGE_SIZE, page * USERS_PAGE_SIZE);

  const stats = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const withAccuracy = rows.filter((r) => r.accuracy !== null);
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      totalPlayers: rows.length,
      totalQuizzes: rows.reduce((sum, r) => sum + r.quizzesPlayed, 0),
      avgAccuracy:
        withAccuracy.length > 0 ? withAccuracy.reduce((sum, r) => sum + (r.accuracy ?? 0), 0) / withAccuracy.length : null,
      activeThisWeek: rows.filter((r) => r.lastActive && new Date(r.lastActive).getTime() >= weekAgo).length,
    };
  }, [rows]);

  if (error) return <p className="text-sm font-medium text-destructive">{error}</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No players yet.</p>;

  return (
    <div>
      {dialog}
      {stats && (
        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Users, label: "Players", value: `${stats.totalPlayers}` },
            { icon: TrendingUp, label: "Quizzes played", value: `${stats.totalQuizzes}` },
            {
              icon: Target,
              label: "Average accuracy",
              value: stats.avgAccuracy !== null ? `${Math.round(stats.avgAccuracy * 100)}%` : "–",
            },
            { icon: Sparkles, label: "Active this week", value: `${stats.activeThisWeek}` },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
              <s.icon className="size-5 text-primary" />
              <p className="mt-3 text-3xl font-display font-extrabold">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </section>
      )}

      <div className="relative mb-4 max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players by name"
          className={`${inputClass} w-full pl-9`}
        />
      </div>

      {filteredRows && filteredRows.length === 0 && (
        <p className="text-sm text-muted-foreground">No players match &ldquo;{search}&rdquo;.</p>
      )}

      <div className="space-y-3">
        {pagedRows?.map((r) => (
          <div key={r.profileId} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <img
                  src={usersTabAvatarSrc(r.avatarId, r.title)}
                  alt=""
                  className="size-14 shrink-0 rounded-xl border-2 border-border bg-secondary object-cover"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-lg font-bold">{r.name}</p>
                    {r.title && (
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                        {r.title}
                      </span>
                    )}
                    {r.quizzesPlayed === 0 && (
                      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">New</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Key className="size-3.5" />
                      {r.hasPin ? "PIN set" : "No PIN yet"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3.5" />
                      {r.lastActive ? `Active ${timeAgo(r.lastActive)}` : "Never played"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={expandedProfileId === r.profileId ? "default" : "secondary"}
                  onClick={() => setExpandedProfileId(expandedProfileId === r.profileId ? null : r.profileId)}
                >
                  <MessageCircle className="size-4" />
                  Study Buddy
                </Button>
                {r.hasPin && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-destructive"
                    onClick={() => handleResetPin(r.profileId, r.name)}
                    disabled={resettingId === r.profileId}
                  >
                    <Key className="size-4" />
                    {resettingId === r.profileId ? "Resetting..." : "Reset PIN"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDeleteUser(r.profileId, r.name)}
                  disabled={deletingId === r.profileId}
                >
                  <Trash2 className="size-4" />
                  {deletingId === r.profileId ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-lg font-display font-bold">{r.quizzesPlayed}</p>
                <p className="text-xs text-muted-foreground">Quizzes played</p>
              </div>
              <div>
                <p className="text-lg font-display font-bold">{r.stagesCleared}</p>
                <p className="text-xs text-muted-foreground">Stages cleared</p>
              </div>
              <div>
                <p className="text-lg font-display font-bold">{r.questionsAnswered}</p>
                <p className="text-xs text-muted-foreground">Questions answered</p>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <p className="text-lg font-display font-bold">
                    {r.accuracy !== null ? `${Math.round(r.accuracy * 100)}%` : "–"}
                  </p>
                </div>
                <p className="mb-1.5 text-xs text-muted-foreground">Accuracy</p>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full ${usersTabAccuracyTint(r.accuracy)}`}
                    style={{ width: `${r.accuracy === null ? 0 : Math.round(r.accuracy * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {expandedProfileId === r.profileId && (
              <div className="mt-4 border-t border-border pt-4">
                <StudyBuddyInsightsPanel profileId={r.profileId} profileName={r.name} />
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredRows && filteredRows.length > USERS_PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      )}
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
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    getAppSettings()
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
      const updated = await updateAppSettings(draft);
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

// One row for one on/off flag - shared by the Study Buddy/Arcade master
// switches and the 5 per-game toggles below, so every row lines up the
// same way whether or not it's indented under a parent.
function FlagRow({
  checked,
  onChange,
  label,
  description,
  disabled,
  indent,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <label className={`mb-3 flex items-start gap-2.5 last:mb-0 ${disabled ? "opacity-50" : "cursor-pointer"} ${indent ? "ml-7" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="block font-medium">
          {label} {checked ? "on" : "off"}
        </span>
        {description && <span className="block text-sm text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

// Flag-based feature management (migration 0023, admin request 10
// September 2026): one place to turn any optional feature on/off for
// every player at once, no code change needed. Reuses the exact same
// app_settings singleton and GET/PATCH /admin/settings round trip
// StudyBuddySettingsPanel above already established - this panel just
// surfaces a different subset of the same row (the on/off switches,
// not the caps/resource-access settings, which stay in the Study Buddy
// tab where they've always lived). The 5 game rows are ANDed with the
// Arcade master switch on the backend (games.ts's isGameEnabled) - shown
// disabled-but-still-checked here when Arcade itself is off, so turning
// Arcade back on doesn't silently un-toggle a game an admin had
// deliberately left on.
function FeaturesTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAppSettings()
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"));
  }, []);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateAppSettings(draft);
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
    <div>
      <h2 className="mb-1 text-lg">Features</h2>
      <p className="mb-4 max-w-xl text-sm text-muted-foreground">
        Turn any of these off to hide the feature for every player right away - the button or menu entry
        disappears from the app, not just an error message if they try it.
      </p>

      <div className="max-w-[480px] rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-4">
          <Bird className="size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <FlagRow
              checked={draft.tutorEnabled}
              onChange={(v) => setDraft({ ...draft, tutorEnabled: v })}
              label="Study Buddy"
              description="The whole Ask Sage / chat feature, including riddles and jokes below."
            />
          </div>
        </div>

        <div className="mb-4 border-b border-border pb-4">
          <FlagRow
            checked={draft.tutorFunContentEnabled}
            onChange={(v) => setDraft({ ...draft, tutorFunContentEnabled: v })}
            label="Riddles, jokes & fun content"
            description="The riddle/joke/tongue-twister/trivia quick chips inside Study Buddy chat."
          />
        </div>

        <div className="flex items-start gap-2 border-b border-border pb-2">
          <Gamepad2 className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <FlagRow
              checked={draft.arcadeEnabled}
              onChange={(v) => setDraft({ ...draft, arcadeEnabled: v })}
              label="Arcade"
              description="Quick-fire practice games - turning this off hides all 5 games at once."
            />
            <FlagRow
              checked={draft.gameSpellingSprintEnabled}
              onChange={(v) => setDraft({ ...draft, gameSpellingSprintEnabled: v })}
              label="Spelling Sprint"
              disabled={!draft.arcadeEnabled}
              indent
            />
            <FlagRow
              checked={draft.gameMissingLettersEnabled}
              onChange={(v) => setDraft({ ...draft, gameMissingLettersEnabled: v })}
              label="Missing Letters"
              disabled={!draft.arcadeEnabled}
              indent
            />
            <FlagRow
              checked={draft.gameWordMeaningMatchEnabled}
              onChange={(v) => setDraft({ ...draft, gameWordMeaningMatchEnabled: v })}
              label="Word Meaning Match"
              disabled={!draft.arcadeEnabled}
              indent
            />
            <FlagRow
              checked={draft.gameHomophoneHunterEnabled}
              onChange={(v) => setDraft({ ...draft, gameHomophoneHunterEnabled: v })}
              label="Homophone Hunter"
              disabled={!draft.arcadeEnabled}
              indent
            />
            <FlagRow
              checked={draft.gamePrefixSuffixBuilderEnabled}
              onChange={(v) => setDraft({ ...draft, gamePrefixSuffixBuilderEnabled: v })}
              label="Prefix/Suffix Builder"
              disabled={!draft.arcadeEnabled}
              indent
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save"}
          </Button>
          {saved && !dirty && <span className="text-sm text-muted-foreground">Saved.</span>}
        </div>
      </div>
    </div>
  );
}

const TABS: { key: Tab; label: string; icon: typeof Bird }[] = [
  { key: "questions", label: "Questions", icon: FileUp },
  { key: "topics", label: "Topics", icon: LayoutGrid },
  { key: "users", label: "Users", icon: Users },
  { key: "content", label: "Add content", icon: FileUp },
  { key: "studyBuddy", label: "Study Buddy", icon: Settings2 },
  { key: "features", label: "Features", icon: ToggleLeft },
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
          {tab === "features" && <FeaturesTab />}
        </div>
      </div>
    </div>
  );
}
