import { useEffect, useState } from "react";
import { ArrowLeft, Play } from "lucide-react";
import { assembleQuiz, getClassSubjects, getTopics } from "../api";
import type { AssembleQuizResponse, PkClass, Profile, Subject } from "../types";
import { Button } from "../components/ui/button";

// Every quiz clears a "stage" - a checkpoint partway through - every 10
// questions. Not user-configurable: the number of stages is simply
// however many groups of 10 the subject's question count makes.
const STAGE_SIZE = 10;

export function SubjectPicker({
  pkClass,
  profile,
  onBack,
  onQuizReady,
}: {
  pkClass: PkClass;
  profile: Profile;
  onBack: () => void;
  onQuizReady: (quiz: AssembleQuizResponse) => void;
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[] | null>(null);
  // null = "all topics" (no filter applied)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubjects(null);
    setSelectedSubject(null);
    setTopics(null);
    setSelectedTopic(null);
    setError(null);
    getClassSubjects(pkClass.id)
      .then(setSubjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load subjects"));
  }, [pkClass.id]);

  useEffect(() => {
    if (!selectedSubject) {
      setTopics(null);
      setSelectedTopic(null);
      return;
    }
    setSelectedTopic(null);
    getTopics({ classId: pkClass.id, subjectName: selectedSubject })
      .then(setTopics)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load topics"));
  }, [pkClass.id, selectedSubject]);

  async function startQuiz() {
    if (!selectedSubject) return;
    setLoading(true);
    setError(null);
    try {
      const quiz = await assembleQuiz({
        subjectName: selectedSubject,
        classId: pkClass.id,
        topic: selectedTopic ?? undefined,
        profileId: profile.id,
        stageSize: STAGE_SIZE,
      });
      onQuizReady(quiz);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start quiz");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="night-sky relative min-h-screen overflow-hidden">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className="text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">{pkClass.name}</p>
            <h1 className="text-2xl sm:text-3xl">Pick a subject</h1>
          </div>
          <span className="size-9" />
        </header>

        <section className="animate-pop-in mx-auto mt-10 w-full max-w-lg rounded-3xl border border-border/70 bg-card/80 p-7 backdrop-blur shadow-quest">
          {subjects === null && !error && <p className="text-center text-muted-foreground">Loading subjects...</p>}
          {subjects && subjects.length === 0 && (
            <p className="text-center text-muted-foreground">No subjects yet for {pkClass.name} — add some content first.</p>
          )}

          {subjects && subjects.length > 0 && (
            <>
              <div className="flex flex-wrap justify-center gap-2.5">
                {subjects.map((s) => (
                  <Button
                    key={s.id}
                    variant={selectedSubject === s.name ? "default" : "secondary"}
                    className="rounded-full font-display"
                    onClick={() => setSelectedSubject(s.name)}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>

              {selectedSubject && topics && topics.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2.5 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Focus on a topic (optional)
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      variant={selectedTopic === null ? "default" : "secondary"}
                      size="sm"
                      className="rounded-full"
                      onClick={() => setSelectedTopic(null)}
                    >
                      All topics
                    </Button>
                    {topics.map((t) => (
                      <Button
                        key={t}
                        variant={selectedTopic === t ? "default" : "secondary"}
                        size="sm"
                        className="rounded-full"
                        onClick={() => setSelectedTopic(t)}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {selectedSubject && (
                <>
                  <p className="mt-6 text-center text-sm text-muted-foreground">
                    Every question saved for this subject{selectedTopic ? " and topic" : ""} will be included, in
                    stages of {STAGE_SIZE} questions each.
                  </p>

                  <Button
                    size="lg"
                    className="mt-6 h-14 w-full rounded-2xl text-lg font-display"
                    onClick={startQuiz}
                    disabled={loading}
                  >
                    <Play className="size-5 fill-current" />
                    {loading ? "Starting..." : "Start quiz"}
                  </Button>
                </>
              )}
            </>
          )}

          {error && <p className="mt-4 text-center text-sm font-medium text-destructive">{error}</p>}
        </section>
      </div>
    </main>
  );
}
