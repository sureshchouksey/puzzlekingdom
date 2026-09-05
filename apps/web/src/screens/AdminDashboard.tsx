import { Fragment, useEffect, useMemo, useState } from "react";
import {
  createAdminQuestion,
  deleteAdminQuestion,
  generateTutorInsights,
  getAdminQuestions,
  getAdminUsers,
  getTutorConversation,
  getTutorConversationsForProfile,
  getTutorInsights,
  getTutorSettings,
  logout,
  resetProfilePin,
  updateAdminQuestion,
  updateTutorSettings,
} from "../api";
import type {
  AdminQuestion,
  AdminQuestionWriteInput,
  AdminUser,
  AdminUserSummary,
  QuizOption,
  TutorConversation,
  TutorInsightsResponse,
  TutorSettings,
  TutorTranscript,
} from "../types";
import { Layout, styles } from "./Layout";
import { Upload } from "./Upload";

type Tab = "questions" | "users" | "content" | "studyBuddy";

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

// One profile's doubt-tracking breakdown + growth insights (Section 10
// step 8) - rendered inline below its row in UsersTab when expanded,
// rather than a separate screen, since this is a small amount of
// admin-only detail per profile, not a whole new area of the app.
// Fetched lazily (only once a row is actually expanded) since most
// profiles won't be looked at on a given admin visit.
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

  if (error) return <p style={styles.error}>{error}</p>;
  if (data === null) return <p style={styles.muted}>Loading Study Buddy insights...</p>;

  const { breakdown, insights } = data;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <p style={{ ...styles.muted, margin: 0 }}>
          Last 30 days: {breakdown.totalAgentReplies} Study Buddy repl{breakdown.totalAgentReplies === 1 ? "y" : "ies"}
          {breakdown.ungroundedCount > 0 ? `, ${breakdown.ungroundedCount} with no matching lesson content` : ""}.
        </p>
        <button style={styles.secondaryButton} onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate insights"}
        </button>
      </div>

      {notice && <p style={{ ...styles.muted, fontStyle: "italic", marginBottom: 12 }}>{notice}</p>}

      {breakdown.topicCounts.length === 0 && insights.length === 0 && (
        <p style={styles.muted}>No Study Buddy activity in the last 30 days.</p>
      )}

      {breakdown.topicCounts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: insights.length > 0 ? 16 : 0 }}>
          {breakdown.topicCounts.map((t) => (
            <span
              key={t.topic}
              style={{
                fontSize: 13,
                padding: "4px 10px",
                borderRadius: 999,
                background: "#f6f1e6",
                border: "1px solid #c3c2b7",
              }}
            >
              {t.topic} ×{t.count}
            </span>
          ))}
        </div>
      )}

      {insights.map((i) => (
        <div key={i.id} style={{ ...styles.card, background: "#fbf8f1", border: "1px solid #d8cfb8" }}>
          <p style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{i.topic}</p>
          <p style={{ fontSize: 14, marginBottom: 4 }}>{i.insightText}</p>
          <p style={{ ...styles.muted, fontSize: 12, margin: 0 }}>
            Generated {new Date(i.generatedAt).toLocaleDateString()}
          </p>
        </div>
      ))}
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
            <Fragment key={r.profileId}>
              <tr style={{ borderBottom: expandedProfileId === r.profileId ? "none" : "1px solid #e3ddd0" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: "8px 12px" }}>{r.title ?? "–"}</td>
                <td style={{ padding: "8px 12px" }}>{r.hasPin ? "Set" : "Not set yet"}</td>
                <td style={{ padding: "8px 12px" }}>{r.quizzesPlayed}</td>
                <td style={{ padding: "8px 12px" }}>{r.stagesCleared}</td>
                <td style={{ padding: "8px 12px" }}>{r.accuracy !== null ? `${Math.round(r.accuracy * 100)}%` : "–"}</td>
                <td style={{ padding: "8px 12px" }}>{r.lastActive ? new Date(r.lastActive).toLocaleDateString() : "–"}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => setExpandedProfileId(expandedProfileId === r.profileId ? null : r.profileId)}
                    style={{ background: "none", border: "none", color: "#1a3c6e", cursor: "pointer", fontSize: 13, marginRight: 12 }}
                  >
                    {expandedProfileId === r.profileId ? "Hide Study Buddy" : "Study Buddy"}
                  </button>
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
              {expandedProfileId === r.profileId && (
                <tr style={{ borderBottom: "1px solid #e3ddd0" }}>
                  <td colSpan={8} style={{ padding: "0 12px 16px" }}>
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

  if (error) return <p style={styles.error}>{error}</p>;
  if (draft === null) return <p style={styles.muted}>Loading settings...</p>;

  const dirty = settings !== null && JSON.stringify(settings) !== JSON.stringify(draft);

  return (
    <div style={{ ...styles.card, maxWidth: 420 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={draft.tutorEnabled}
          onChange={(e) => setDraft({ ...draft, tutorEnabled: e.target.checked })}
        />
        <span>Study Buddy is {draft.tutorEnabled ? "on" : "off"} for everyone</span>
      </label>

      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>Daily message cap, per profile</span>
        <input
          type="number"
          min={1}
          value={draft.tutorDailyCapPerProfile}
          onChange={(e) => setDraft({ ...draft, tutorDailyCapPerProfile: Math.max(1, Number(e.target.value) || 1) })}
          style={{ padding: "8px 12px", fontSize: 14, width: 120 }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>
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
          style={{ padding: "8px 12px", fontSize: 14, width: 160 }}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button style={styles.primaryButton} onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving..." : "Save"}
        </button>
        {saved && !dirty && <span style={{ ...styles.muted, fontSize: 13 }}>Saved.</span>}
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

  if (error) return <p style={styles.error}>{error}</p>;

  return (
    <div>
      <select
        value={selectedProfileId}
        onChange={(e) => setSelectedProfileId(e.target.value)}
        style={{ padding: "8px 12px", fontSize: 14, marginBottom: 16 }}
      >
        <option value="">Pick a player...</option>
        {profiles?.map((p) => (
          <option key={p.profileId} value={p.profileId}>
            {p.name}
          </option>
        ))}
      </select>

      {selectedProfileId && conversations === null && <p style={styles.muted}>Loading conversations...</p>}
      {selectedProfileId && conversations !== null && conversations.length === 0 && (
        <p style={styles.muted}>No Study Buddy conversations yet for this player.</p>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {conversations && conversations.length > 0 && (
          <div style={{ minWidth: 220 }}>
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedConversationId(c.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 8,
                  ...styles.secondaryButton,
                  background: selectedConversationId === c.id ? "#1a3c6e" : styles.secondaryButton.background,
                  color: selectedConversationId === c.id ? "#fff" : styles.secondaryButton.color,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {c.className ?? "?"} · {c.subjectName ?? "?"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {c.contextType === "question" ? "Explain this to me" : "General chat"} · last active{" "}
                  {new Date(c.lastMessageAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}

        {transcript && (
          <div style={{ flex: 1, minWidth: 260, border: "1px solid #e3ddd0", borderRadius: 10, padding: 16, maxHeight: 420, overflowY: "auto" }}>
            {transcript.messages.length === 0 && <p style={styles.muted}>No messages in this conversation yet.</p>}
            {transcript.messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "student" ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "8px 12px",
                    borderRadius: 10,
                    fontSize: 14,
                    background: m.role === "student" ? "#1a3c6e" : "#f0ece0",
                    color: m.role === "student" ? "#fff" : "#241d1a",
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StudyBuddyTab() {
  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Settings</h2>
      <StudyBuddySettingsPanel />
      <h2 style={{ fontSize: 16, margin: "28px 0 12px" }}>Conversations</h2>
      <StudyBuddyConversationsPanel />
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
        {(["questions", "users", "content", "studyBuddy"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...styles.secondaryButton,
              background: tab === t ? "#1a3c6e" : styles.secondaryButton.background,
              color: tab === t ? "#fff" : styles.secondaryButton.color,
            }}
          >
            {t === "questions" ? "Questions" : t === "users" ? "Users" : t === "content" ? "Add content" : "Study Buddy"}
          </button>
        ))}
        <button onClick={handleLogOut} style={{ ...styles.secondaryButton, marginLeft: "auto" }}>
          Log out
        </button>
      </div>

      {tab === "questions" && <QuestionsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "content" && <Upload />}
      {tab === "studyBuddy" && <StudyBuddyTab />}
    </Layout>
  );
}
