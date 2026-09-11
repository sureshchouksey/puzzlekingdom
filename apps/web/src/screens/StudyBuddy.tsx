import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpenText, Bird, Dices, GraduationCap, Laugh, Lightbulb, Puzzle as PuzzleIcon, Send } from "lucide-react";
import { getClassSubjects, getFeatures, getTutorConversation, sendTutorMessage, startTutorConversation } from "../api";
import { useActivityHeartbeat } from "../hooks/useActivityHeartbeat";
import type { PkClass, Subject, TutorConversation, TutorMessage, TutorMessageMode, TutorQuestionContext } from "../types";
import { Button } from "../components/ui/button";

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

function BackHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <header className="flex items-center justify-between gap-4">
      <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
        <ArrowLeft className="size-5" />
      </Button>
      <div className="text-center">
        {subtitle && <p className="text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">{subtitle}</p>}
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
      </div>
      <span className="size-9" />
    </header>
  );
}

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

  // Flag-based feature management (migration 0023) - gates the fun-
  // content quick chips just below (Play a game/Riddle/Joke/Tongue
  // twister/Reveal answer all route to the same riddle/joke/tongue-
  // twister/trivia bank server-side, see tutor.ts's fun_request branch).
  // Defaults to true (fail open) while loading - matches the same
  // convention Home.tsx/SubjectPicker.tsx use for their own entry points.
  const [funContentEnabled, setFunContentEnabled] = useState(true);
  useEffect(() => {
    getFeatures()
      .then((f) => setFunContentEnabled(f.funContentEnabled))
      .catch(() => {});
  }, []);

  const classId = questionContext ? questionContext.classId : pkClass?.id;

  // Activity time tracking (11 September 2026) - see
  // useActivityHeartbeat.ts. Only enabled once a conversation actually
  // exists (the greeting has landed), so opening the subject picker step
  // never counts as "study_buddy" time on its own.
  useActivityHeartbeat({
    activityType: "study_buddy",
    classId,
    subjectId: subject?.id,
    tutorConversationId: conversation?.id,
    enabled: !!conversation,
  });

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

  async function handleSend(override?: string) {
    const text = (override ?? draft).trim();
    if (!text || !conversation || sending) return;
    if (!override) setDraft("");
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
      <main className="night-sky relative min-h-screen overflow-hidden">
        <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
          <BackHeader title="Ask your Study Buddy" onBack={onBack} />
          <section className="mx-auto mt-10 flex w-full max-w-sm flex-1 flex-col gap-3">
            <p className="text-center text-muted-foreground">Which subject do you want to talk about?</p>
            {subjects === null && !error && <p className="mt-4 text-center text-muted-foreground">Loading...</p>}
            {subjects && subjects.length === 0 && (
              <p className="mt-4 text-center text-muted-foreground">No subjects yet for this class.</p>
            )}
            {subjects?.map((s) => (
              <button
                key={s.id}
                onClick={() => setSubject(s)}
                className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card/80 p-4 text-left backdrop-blur transition-transform hover:-translate-y-0.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                  <Bird className="size-5" />
                </span>
                <span className="font-display font-semibold">{s.name}</span>
              </button>
            ))}
            {error && <p className="text-center text-sm font-medium text-destructive">{error}</p>}
          </section>
        </div>
      </main>
    );
  }

  const title = questionContext ? "Explain this question" : "Study Buddy";

  return (
    <main className="night-sky relative flex min-h-screen flex-col overflow-hidden">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
        <BackHeader title={title} subtitle={subject.name} onBack={onBack} />

        {questionContext && (
          <div className="mt-5 rounded-2xl border border-border/70 bg-secondary/50 p-4 backdrop-blur">
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Explaining</p>
            <p className="text-[15px] leading-relaxed">{questionContext.questionText}</p>
          </div>
        )}

        <section className="mt-5 flex-1 space-y-4 overflow-y-auto pb-4">
          {conversation === null && !error && (
            <p className="my-auto text-center text-muted-foreground">Getting your Study Buddy ready...</p>
          )}
          {messages.length === 0 && conversation && (
            <div className="flex items-end gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                <Bird className="size-4" />
              </span>
              <p className="animate-pop-in max-w-[78%] rounded-3xl rounded-bl-lg border border-border/70 bg-card/85 px-5 py-3 text-base leading-relaxed backdrop-blur">
                {questionContext
                  ? "Ask me anything about this question - I'm here to help!"
                  : `Ask me anything about ${subject.name} - I'm here to help!`}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex items-end gap-2 ${m.role === "student" ? "justify-end" : ""}`}>
              {m.role === "agent" && (
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                  <Bird className="size-4" />
                </span>
              )}
              <p
                className={`animate-pop-in max-w-[78%] rounded-3xl px-5 py-3 text-base leading-relaxed whitespace-pre-wrap ${
                  m.role === "student"
                    ? "rounded-br-lg bg-primary text-primary-foreground"
                    : m.mode === "blocked"
                      ? "rounded-bl-lg bg-secondary/70 text-muted-foreground"
                      : "rounded-bl-lg border border-border/70 bg-card/85 backdrop-blur"
                }`}
              >
                {m.content}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </section>

        {/* Quick-action chips - a friendly, low-friction way to ask for
            fun content without typing. Each just sends a short natural-
            language phrase through the normal chat flow; the backend's
            NLP intent classifier (tutorIntent.ts) is what actually
            recognizes it as a "fun_request" and serves it from the
            fun_content bank - these buttons are a shortcut into that same
            path, not a separate one. Only shown for the free-chat flow
            (not the "explain this question" flow, which has its own
            focused purpose), and hidden once sending is in flight so a
            child can't double-fire a request. */}
        {!questionContext && conversation && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {[
              // "Play a game" (with no further specifics) and the four
              // chips after "Quiz me!" all route to the same fun_content
              // bank server-side (tutorIntent.ts's keyword fallback picks
              // a random riddle/joke/tongue-twister/puzzle for the bare
              // "Can we play a game?" phrase) - so all 5 are gated
              // together by funContentEnabled below, distinct from "Quiz
              // me!" itself, which is real curriculum content
              // (tutorQuizGame.ts) and always stays on.
              ...(funContentEnabled ? [{ label: "Play a game", icon: Dices, text: "Can we play a game?" }] : []),
              // Real curriculum questions from this chat's own class/
              // subject (tutorQuizGame.ts) - distinct from the riddle/
              // joke/trivia chips below, which stay general fun content.
              { label: "Quiz me!", icon: GraduationCap, text: "Give me a real practice question from my lessons!" },
              ...(funContentEnabled
                ? [
                    { label: "Riddle", icon: PuzzleIcon, text: "Give me a riddle!" },
                    { label: "Joke", icon: Laugh, text: "Tell me a joke!" },
                    { label: "Tongue twister", icon: BookOpenText, text: "Give me a tongue twister!" },
                    // Riddles/jokes/puzzles/trivia deliberately withhold their
                    // answer until asked (see funContent.ts's
                    // formatFunContentReply) - this chip is the easy, discoverable
                    // way for a child to ask, rather than needing to type
                    // something like "what's the answer" themselves.
                    { label: "Reveal answer", icon: Lightbulb, text: "What's the answer?" },
                  ]
                : []),
            ].map(({ label, icon: Icon, text }) => (
              <button
                key={label}
                type="button"
                disabled={sending}
                onClick={() => handleSend(text)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card/80 px-3.5 py-2 text-sm font-medium backdrop-blur transition-transform hover:-translate-y-0.5 hover:border-primary/60 disabled:pointer-events-none disabled:opacity-50"
              >
                <Icon className="size-4 text-primary" />
                {label}
              </button>
            ))}
          </div>
        )}

        <form
          className="sticky bottom-4 mb-2 flex items-center gap-2 rounded-full border border-border/70 bg-card/90 p-2 backdrop-blur shadow-quest"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your question..."
            disabled={!conversation || sending}
            className="min-w-0 flex-1 bg-transparent px-4 py-2 text-base outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            disabled={!conversation || sending || !draft.trim()}
            aria-label="Send"
          >
            <Send className="size-5" />
          </Button>
        </form>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      </div>
    </main>
  );
}
