import { useEffect, useMemo, useState } from "react";
import {
  createAdminQuestion,
  deleteAdminQuestion,
  getAdminQuestions,
  getAdminUsers,
  logout,
  resetProfilePin,
  updateAdminQuestion,
} from "../api";
import type { AdminQuestion, AdminQuestionWriteInput, AdminUser, AdminUserSummary, QuizOption } from "../types";
import { Layout, styles } from "./Layout";
import { Upload } from "./Upload";

type Tab = "questions" | "users" | "content";

const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const;

// Draft shape shared by both the "edit an existing question" and "add a
// question to an existing document" forms below - options as plain
// strings keyed by position, correctIndex picks which one is right, so
// the UI never has to juggle option ids directly.
type QuestionDraft = {
  questionText: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topics: string;
  tip: string;
};

function draftFromQuestion(q: AdminQuestion): QuestionDraft {
  return {
    questionText: q.questionText,
    options: q.options.map((o) => o.text),
    correctIndex: Math.max(q.options.findIndex((o) => o.id === q.correctOptionId), 0),
    explanation: q.explanation,
    topics: (q.topics ?? []).join(", "),
    tip: q.tip ?? "",
  };
}

function draftToWriteInput(d: QuestionDraft, documentId?: string): AdminQuestionWriteInput {
  const options: QuizOption[] = d.options.map((text, i) => ({ id: OPTION_LABELS[i], text: text.trim() }));
  const topics = d.topics
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    documentId,
    questionText: d.questionText.trim(),
    options,
    correctOptionId: OPTION_LABELS[d.correctIndex],
    explanation: d.explanation.trim(),
    topics: topics.length ? topics : undefined,
    tip: d.tip.trim() || undefined,
  };
}

function draftIsValid(d: QuestionDraft): boolean {
  return (
    d.questionText.trim().length > 0 &&
    d.options.length >= 3 &&
    d.options.every((o) => o.trim().length > 0) &&
    d.explanation.trim().length > 0
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
  return (
    <div style={{ ...styles.card, marginBottom: 12 }}>
      <input
        value={draft.questionText}
        onChange={(e) => onChange({ ...draft, questionText: e.target.value })}
        placeholder="Question text"
        style={{ padding: "8px 12px", fontSize: 15, width: "100%", marginBottom: 10, boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {draft.options.map((opt, oi) => (
          <div key={oi} style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              style={{ padding: "6px 10px", fontSize: 14, flex: 1 }}
            />
            {draft.options.length > 3 && (
              <button
                onClick={() => {
                  const options = draft.options.filter((_, i) => i !== oi);
                  const correctIndex = draft.correctIndex === oi ? 0 : draft.correctIndex > oi ? draft.correctIndex - 1 : draft.correctIndex;
                  onChange({ ...draft, options, correctIndex });
                }}
                style={{ background: "none", border: "none", color: "#8a1f11", cursor: "pointer", fontSize: 13 }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {draft.options.length < 6 && (
          <button
            onClick={() => onChange({ ...draft, options: [...draft.options, ""] })}
            style={{ background: "none", border: "none", color: "#1a3c6e", cursor: "pointer", fontSize: 13, alignSelf: "flex-start" }}
          >
            + Add option
          </button>
        )}
      </div>
      <textarea
        value={draft.explanation}
        onChange={(e) => onChange({ ...draft, explanation: e.target.value })}
        placeholder="Explanation"
        rows={2}
        style={{ padding: "8px 12px", fontSize: 14, width: "100%", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 10 }}
      />
      <input
        value={draft.topics}
        onChange={(e) => onChange({ ...draft, topics: e.target.value })}
        placeholder="Topics, comma-separated (optional)"
        style={{ padding: "8px 12px", fontSize: 14, width: "100%", marginBottom: 10, boxSizing: "border-box" }}
      />
      <input
        value={draft.tip}
        onChange={(e) => onChange({ ...draft, tip: e.target.value })}
        placeholder="Tip (optional)"
        style={{ padding: "8px 12px", fontSize: 14, width: "100%", marginBottom: 12, boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 10 }}>
        <button style={styles.primaryButton} onClick={onSave} disabled={saving || !draftIsValid(draft)}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button style={styles.secondaryButton} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
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
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={subjectName}
          onChange={(e) => setSubjectName(e.target.value)}
          placeholder="Filter by subject"
          style={{ padding: "8px 12px", fontSize: 14 }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search question text"
          style={{ padding: "8px 12px", fontSize: 14 }}
        />
        <button style={styles.secondaryButton} onClick={load}>
          Search
        </button>
        {documentOptions.length > 0 && !addingDocumentId && (
          <button
            style={styles.secondaryButton}
            onClick={() => {
              setAddingDocumentId(documentOptions[0].documentId);
              setAddDraft({ questionText: "", options: ["", "", "", ""], correctIndex: 0, explanation: "", topics: "", tip: "" });
            }}
          >
            + Add question
          </button>
        )}
      </div>

      {addingDocumentId && addDraft && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>Attach to document</span>
            <select
              value={addingDocumentId}
              onChange={(e) => setAddingDocumentId(e.target.value)}
              style={{ padding: "8px 12px", fontSize: 14 }}
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

      {error && <p style={styles.error}>{error}</p>}
      {rows === null && <p style={styles.muted}>Loading...</p>}
      {rows !== null && rows.length === 0 && <p style={styles.muted}>No questions found.</p>}

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
          <div key={q.id} style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{q.questionText}</div>
                <div style={styles.muted}>
                  {q.subjectName}
                  {q.className ? ` · ${q.className}` : ""}
                  {q.topics && q.topics.length > 0 ? ` · ${q.topics.join(", ")}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  style={styles.secondaryButton}
                  onClick={() => {
                    setEditingId(q.id);
                    setEditDraft(draftFromQuestion(q));
                  }}
                >
                  Edit
                </button>
                <button
                  style={{ ...styles.secondaryButton, color: "#8a1f11" }}
                  onClick={() => {
                    if (window.confirm("Delete this question? This can't be undone.")) handleDelete(q.id);
                  }}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function UsersTab() {
  const [rows, setRows] = useState<AdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

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

  if (error) return <p style={styles.error}>{error}</p>;
  if (rows === null) return <p style={styles.muted}>Loading...</p>;
  if (rows.length === 0) return <p style={styles.muted}>No players yet.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e3ddd0" }}>
            <th style={{ padding: "8px 12px" }}>Name</th>
            <th style={{ padding: "8px 12px" }}>Title</th>
            <th style={{ padding: "8px 12px" }}>PIN</th>
            <th style={{ padding: "8px 12px" }}>Quizzes</th>
            <th style={{ padding: "8px 12px" }}>Stages cleared</th>
            <th style={{ padding: "8px 12px" }}>Accuracy</th>
            <th style={{ padding: "8px 12px" }}>Last active</th>
            <th style={{ padding: "8px 12px" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.profileId} style={{ borderBottom: "1px solid #e3ddd0" }}>
              <td style={{ padding: "8px 12px", fontWeight: 600 }}>{r.name}</td>
              <td style={{ padding: "8px 12px" }}>{r.title ?? "–"}</td>
              <td style={{ padding: "8px 12px" }}>{r.hasPin ? "Set" : "Not set yet"}</td>
              <td style={{ padding: "8px 12px" }}>{r.quizzesPlayed}</td>
              <td style={{ padding: "8px 12px" }}>{r.stagesCleared}</td>
              <td style={{ padding: "8px 12px" }}>{r.accuracy !== null ? `${Math.round(r.accuracy * 100)}%` : "–"}</td>
              <td style={{ padding: "8px 12px" }}>{r.lastActive ? new Date(r.lastActive).toLocaleDateString() : "–"}</td>
              <td style={{ padding: "8px 12px" }}>
                {r.hasPin && (
                  <button
                    onClick={() => handleResetPin(r.profileId, r.name)}
                    disabled={resettingId === r.profileId}
                    style={{ background: "none", border: "none", color: "#8a1f11", cursor: "pointer", fontSize: 13 }}
                  >
                    {resettingId === r.profileId ? "Resetting..." : "Reset PIN"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Admin control center: question management, the user roster, and content
// upload/generation all live here now - the standalone Upload screen and
// Home's open "Add new content" button are both gone, since managing
// content is admin-only.
export function AdminDashboard({ admin, onLogOut }: { admin: AdminUser; onLogOut: () => void }) {
  const [tab, setTab] = useState<Tab>("questions");

  function handleLogOut() {
    logout();
    onLogOut();
  }

  return (
    <Layout title={`Admin · ${admin.username}`}>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        {(["questions", "users", "content"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...styles.secondaryButton,
              background: tab === t ? "#1a3c6e" : styles.secondaryButton.background,
              color: tab === t ? "#fff" : styles.secondaryButton.color,
            }}
          >
            {t === "questions" ? "Questions" : t === "users" ? "Users" : "Add content"}
          </button>
        ))}
        <button onClick={handleLogOut} style={{ ...styles.secondaryButton, marginLeft: "auto" }}>
          Log out
        </button>
      </div>

      {tab === "questions" && <QuestionsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "content" && <Upload />}
    </Layout>
  );
}
