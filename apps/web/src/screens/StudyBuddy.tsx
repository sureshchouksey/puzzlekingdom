import { useEffect, useRef, useState } from "react";
import { getClassSubjects, getTutorConversation, sendTutorMessage, startTutorConversation } from "../api";
import type { PkClass, Subject, TutorConversation, TutorMessage, TutorMessageMode, TutorQuestionContext } from "../types";
import { Layout, styles } from "./Layout";

// The Study Buddy chat screen has two ways in - see
// plan/AI-Study-Mentor-Agent-Plan.md, Section 10 steps 6/7.
//
// `pkClass` drives the original "general" flow from Home: pick a subject
// within the already-chosen class, then chat (contextType: "general") -
// resuming today's thread for that profile+class+subject if one exists.
//
// `questionContext` drives the newer "Explain this to me" flow, launched
// from one specific wrong answer in Quiz's stage report or Results. The
// class/subject/question are already known there, so this skips the
// subject-picker step entirely and starts a `contextType: "question"`
// conversation straight away - resuming the existing thread for that
// exact question if one exists (e.g. a second tap on the same wrong
// answer), per POST /tutor/conversations' resume rules.
//
// Exactly one of the two is expected to be passed by the caller (App.tsx
// enforces this via which Screen variant led here); this component
// doesn't otherwise care which one it is once `subject`/`classId` are
// resolved.
type ChatBubble = {
  role: "student" | "agent";
  content: string;
  mode?: TutorMessageMode;
};

export function StudyBuddy({
  pkClass,
  questionContext,
  onBack,
}: {
  pkClass?: PkClass;
  questionContext?: TutorQuestionContext;
  onBack: () => void;
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  // Pre-populated in the question-context flow, since the subject is
  // already known - this is what makes the "which subject" picker screen
  // below never render in that case.
  const [subject, setSubject] = useState<Subject | null>(
    questionContext ? { id: questionContext.subjectId, name: questionContext.subjectName } : null
  );
  const [conversation, setConversation] = useState<TutorConversation | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  // Pre-filled with the question text itself in the "Explain this to me"
  // flow, so the child can just hit Send to ask about exactly what they
  // got wrong - or edit it into a more specific doubt first. Plain
  // useState initializer, so this only runs once per mount (StudyBuddy is
  // freshly mounted each time App.tsx switches into the "studyBuddy"
  // screen from Quiz/Results, since it's a different component in the
  // switch beforehand).
  const [draft, setDraft] = useState(questionContext ? questionContext.questionText : "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const classId = questionContext ? questionContext.classId : pkClass?.id;

  useEffect(() => {
    if (questionContext || !pkClass) return;
    getClassSubjects(pkClass.id)
      .then(setSubjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, [pkClass, questionContext]);

  useEffect(() => {
    if (!subject || !classId) return;
    setError(null);
    startTutorConversation(
      questionContext
        ? {
            classId,
            subjectId: subject.id,
            contextType: "question",
            questionId: questionContext.questionId,
            attemptId: questionContext.attemptId,
          }
        : { classId, subjectId: subject.id, contextType: "general" }
    )
      .then((conv) => {
        setConversation(conv);
        // Resuming an existing conversation can have real history -
        // starting a brand new one just returns an empty list, which is
        // fine to render as-is.
        return getTutorConversation(conv.id);
      })
      .then((transcript) => {
        setMessages(transcript.messages.map((m: TutorMessage) => ({ role: m.role, content: m.content })));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not start a Study Buddy chat"));
  }, [subject, classId, questionContext]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || !conversation || sending) return;
    setDraft("");
    setSending(true);
    setError(null);
    // Shown immediately, before the reply comes back - a real AI reply
    // can take a couple of seconds (Section 10 step 4's calibration runs
    // measured ~2s), and a chat that just sits blank until then reads as
    // broken to a child.
    setMessages((prev) => [...prev, { role: "student", content: text }]);
    try {
      const result = await sendTutorMessage(conversation.id, text);
      setMessages((prev) => [...prev, { role: "agent", content: result.reply, mode: result.mode }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong sending that message");
    } finally {
      setSending(false);
    }
  }

  if (!subject) {
    return (
      <Layout title="Ask your Study Buddy" onBack={onBack}>
        <p style={{ color: "#5a5148", marginBottom: 24 }}>Which subject do you want to talk about?</p>
        {subjects === null && !error && <p style={styles.muted}>Loading...</p>}
        {subjects && subjects.length === 0 && <p style={styles.muted}>No subjects yet for this class.</p>}
        {subjects && subjects.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 320 }}>
            {subjects.map((s) => (
              <button key={s.id} style={styles.secondaryButton} onClick={() => setSubject(s)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        {error && <p style={styles.error}>{error}</p>}
      </Layout>
    );
  }

  const title = questionContext ? `Explain this question — ${subject.name}` : `Study Buddy - ${subject.name}`;

  return (
    <Layout title={title} onBack={onBack}>
      {questionContext && (
        <div style={{ ...styles.card, background: "#fbf8f1", border: "1px solid #d8cfb8" }}>
          <p
            style={{
              ...styles.muted,
              fontWeight: 600,
              marginBottom: 8,
              textTransform: "uppercase",
              fontSize: 12,
              letterSpacing: 0.5,
            }}
          >
            Explaining
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.5 }}>{questionContext.questionText}</p>
        </div>
      )}

      <div
        style={{
          border: "1px solid #e3ddd0",
          borderRadius: 10,
          padding: 16,
          minHeight: 320,
          maxHeight: 420,
          overflowY: "auto",
          marginBottom: 16,
          background: "#fffdf8",
        }}
      >
        {conversation === null && !error && <p style={styles.muted}>Getting your Study Buddy ready...</p>}
        {messages.length === 0 && conversation && (
          <p style={styles.muted}>
            {questionContext
              ? "Ask me anything about this question - I'm here to help!"
              : `Ask me anything about ${subject.name} - I'm here to help!`}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "student" ? "flex-end" : "flex-start",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: 12,
                fontSize: 15,
                lineHeight: 1.4,
                background: m.role === "student" ? "#1a3c6e" : m.mode === "blocked" ? "#f6f1e6" : "#f0ece0",
                color: m.role === "student" ? "#fff" : "#241d1a",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type your question..."
          disabled={!conversation || sending}
          style={{
            flex: 1,
            padding: "10px 14px",
            fontSize: 15,
            borderRadius: 8,
            border: "1px solid #c3c2b7",
          }}
        />
        <button
          style={styles.primaryButton}
          onClick={handleSend}
          disabled={!conversation || sending || !draft.trim()}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
