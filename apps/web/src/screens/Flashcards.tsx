import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Layers, Shuffle, SquareStack } from "lucide-react";
import { getClassSubjects, getFlashcards } from "../api";
import type { Flashcard, PkClass, Subject } from "../types";
import { Button } from "../components/ui/button";

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type Step = "certification" | "topic" | "cards";

// Flashcards study screen for Certification Prep (18 September 2026,
// redesigned the same day into a proper certification -> topic -> cards
// wizard, mirroring SubjectPicker's own cascading subject -> mode -> quest
// step pattern rather than showing every filter on one crowded screen).
// Reached from CertPrepHub; stays authenticated as the family owner's own
// study profile the whole time, no further token swap happens here (see
// App.tsx's handleOpenCertPrep/exitStudyMode).
//
// Certification isn't hardcoded: the first step fetches every subject
// seeded under the study space's class, so a new certification only ever
// needs seeding, not a code change here.
//
// initialSubject (19 September 2026 flow rework): set only by
// Certification Prep's hub, which now picks the certification once,
// upfront - this skips the "certification" step entirely and jumps
// straight to "topic", same effect as chooseSubject below but fired
// automatically on mount instead of by a tap.
export function Flashcards({
  certPrepClass,
  initialSubject,
  onBack,
}: {
  certPrepClass: PkClass | null;
  initialSubject?: string;
  onBack: () => void;
}) {
  const [step, setStep] = useState<Step>(initialSubject ? "topic" : "certification");

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);

  const [selectedSubject, setSelectedSubject] = useState<string | null>(initialSubject ?? null);
  const [allCards, setAllCards] = useState<Flashcard[] | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);

  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [deck, setDeck] = useState<Flashcard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!certPrepClass) {
      setSubjects([]);
      return;
    }
    getClassSubjects(certPrepClass.id)
      .then(setSubjects)
      .catch((err) => setSubjectsError(err instanceof Error ? err.message : "Failed to load certifications"));
  }, [certPrepClass]);

  // Loads the pre-chosen certification's cards on mount, same fetch
  // chooseSubject below fires from a tap - only runs once, since
  // initialSubject never changes after this screen is entered.
  useEffect(() => {
    if (!initialSubject) return;
    getFlashcards(initialSubject)
      .then((rows) => setAllCards(rows))
      .catch((err) => setCardsError(err instanceof Error ? err.message : "Failed to load flashcards"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseSubject(subjectName: string) {
    setSelectedSubject(subjectName);
    setSelectedTopic(null);
    setAllCards(null);
    setCardsError(null);
    setStep("topic");
    getFlashcards(subjectName)
      .then((rows) => setAllCards(rows))
      .catch((err) => setCardsError(err instanceof Error ? err.message : "Failed to load flashcards"));
  }

  // One tile per distinct topic, each carrying its own card count, plus
  // the overall total for the "All topics" tile - computed once per
  // certification rather than re-filtered on every render.
  const topicCounts = useMemo(() => {
    if (!allCards) return [];
    const counts = new Map<string, number>();
    for (const c of allCards) if (c.topic) counts.set(c.topic, (counts.get(c.topic) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => a.topic.localeCompare(b.topic));
  }, [allCards]);

  function chooseTopic(topic: string | null) {
    if (!allCards) return;
    setSelectedTopic(topic);
    setDeck(topic ? allCards.filter((c) => c.topic === topic) : allCards);
    setIndex(0);
    setFlipped(false);
    setStep("cards");
  }

  function goBack() {
    if (step === "cards") setStep("topic");
    else if (step === "topic") {
      // initialSubject means there was never a real "certification" step
      // here - it was chosen upstream on CertPrepHub - so backing out of
      // "topic" leaves Flashcards entirely instead of re-showing a
      // one-item certification list.
      if (initialSubject) {
        onBack();
      } else {
        setStep("certification");
        setSelectedSubject(null);
        setAllCards(null);
      }
    } else onBack();
  }

  const card = deck && deck.length > 0 ? deck[index % deck.length] : null;

  function next() {
    setFlipped(false);
    setIndex((i) => (deck && deck.length > 0 ? (i + 1) % deck.length : 0));
  }

  function prev() {
    setFlipped(false);
    setIndex((i) => (deck && deck.length > 0 ? (i - 1 + deck.length) % deck.length : 0));
  }

  function shuffleDeck() {
    if (!deck) return;
    setDeck(shuffle(deck));
    setIndex(0);
    setFlipped(false);
  }

  // Arrow keys / space bar while actually studying a deck - a cheap,
  // non-intrusive addition alongside the on-screen buttons.
  useEffect(() => {
    if (step !== "cards") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, deck]);

  const progress = deck && deck.length > 0 ? ((index + 1) / deck.length) * 100 : 0;

  // The eyebrow names what you're picking (or studying); the big title is
  // the certification once one's chosen - so the two lines never just
  // repeat the same string back at each other.
  const eyebrow = step === "certification" ? "Flashcards" : step === "topic" ? "Choose a topic" : selectedTopic ?? "All topics";
  const title = step === "certification" ? "Choose a certification" : (selectedSubject ?? "Flashcards");

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={goBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">{eyebrow}</p>
            <h1 className="text-3xl">{title}</h1>
          </div>
        </header>

        {step === "certification" && (
          <section className="mt-8">
            {subjectsError && <p className="text-sm font-medium text-destructive">{subjectsError}</p>}
            {subjects === null && !subjectsError && <p className="text-muted-foreground">Loading certifications...</p>}
            {subjects !== null && subjects.length === 0 && !subjectsError && (
              <p className="text-muted-foreground">No certifications have been seeded into this study space yet.</p>
            )}
            <div className="flex flex-col gap-3">
              {subjects?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => chooseSubject(s.name)}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-slate-50">
                    <Layers className="size-5" />
                  </span>
                  <span className="flex-1 font-semibold">{s.name}</span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "topic" && (
          <section className="mt-8">
            {cardsError && <p className="text-sm font-medium text-destructive">{cardsError}</p>}
            {allCards === null && !cardsError && <p className="text-muted-foreground">Loading topics...</p>}
            {allCards !== null && allCards.length === 0 && !cardsError && (
              <p className="text-muted-foreground">No flashcards yet for this certification.</p>
            )}
            {allCards !== null && allCards.length > 0 && (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => chooseTopic(null)}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <SquareStack className="size-5" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">All topics</span>
                    <span className="block text-sm text-muted-foreground">{allCards.length} cards</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </button>
                {topicCounts.map(({ topic, count }) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => chooseTopic(topic)}
                    className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-slate-50">
                      <Layers className="size-5" />
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">{topic}</span>
                      <span className="block text-sm text-muted-foreground">
                        {count} card{count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {step === "cards" && card && deck && (
          <section className="mt-8">
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="shrink-0 text-xs font-medium text-muted-foreground">
                {index + 1} / {deck.length}
              </p>
            </div>

            <button
              key={`${selectedSubject}-${selectedTopic}-${index}`}
              type="button"
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Show term" : "Show answer"}
              className="animate-pop-in flip-card mt-6 block w-full"
            >
              <div className={`flip-card-inner min-h-72 ${flipped ? "is-flipped" : ""}`}>
                <div className="flip-card-face flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                  <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                    Term{card.topic ? ` · ${card.topic}` : ""}
                  </p>
                  <p className="text-xl font-medium">{card.front}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Tap to flip</p>
                </div>
                <div className="flip-card-face flip-card-face-back flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-primary/40 bg-accent p-8 text-center shadow-sm">
                  <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
                    Answer{card.topic ? ` · ${card.topic}` : ""}
                  </p>
                  <p className="text-xl font-medium">{card.back}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Tap to flip back</p>
                </div>
              </div>
            </button>

            <div className="mt-4 flex items-center justify-between gap-3">
              <Button variant="secondary" className="gap-2" onClick={prev} disabled={deck.length < 2}>
                <ArrowLeft className="size-4" />
                Previous
              </Button>
              <Button variant="ghost" className="gap-2" onClick={shuffleDeck} disabled={deck.length < 2}>
                <Shuffle className="size-4" />
                Shuffle
              </Button>
              <Button variant="secondary" className="gap-2" onClick={next} disabled={deck.length < 2}>
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Use ← → to move between cards, space to flip.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
