import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Blocks, CheckCircle2, Ear, Flame, Link2, PenLine, SpellCheck, Star, X } from "lucide-react";
import { getAvailableGames, getGameRound, recordGameAttempt } from "../api";
import type { GameKey, GameQuestion, PkClass, Profile } from "../types";
import { Button } from "../components/ui/button";

// The Arcade: informal, repeatable practice games built on the same
// question-type data model as the graded quiz - see "Practice games (the
// Arcade)" in plan/Question-Types-and-Content-Authoring-Plan.md and
// GAME_DEFINITIONS in apps/api/src/routes/games.ts, which this mirrors.
// Reached from SubjectPicker as a third mode alongside Quest Journey and
// Topic Practice, so it's always scoped to an already-picked class+
// subject.
const GAME_META: Record<GameKey, { title: string; blurb: string; icon: typeof PenLine; accent: string }> = {
  spelling_sprint: {
    title: "Spelling Sprint",
    blurb: "Type the missing letters before you lose your streak.",
    icon: SpellCheck,
    accent: "emerald",
  },
  missing_letters: {
    title: "Missing Letters",
    blurb: "Same idea, tricky words - fill in what's missing.",
    icon: PenLine,
    accent: "sapphire",
  },
  word_meaning_match: {
    title: "Word Meaning Match",
    blurb: "Match each word to what it means.",
    icon: Link2,
    accent: "amethyst",
  },
  homophone_hunter: {
    title: "Homophone Hunter",
    blurb: "Pick the right sound-alike word for the sentence.",
    icon: Ear,
    accent: "ruby",
  },
  prefix_suffix_builder: {
    title: "Prefix/Suffix Builder",
    blurb: "Build a new word by adding a word part.",
    icon: Blocks,
    accent: "gold",
  },
};

const ACCENT_TEXT: Record<string, string> = {
  emerald: "text-emerald",
  sapphire: "text-sapphire",
  ruby: "text-ruby",
  amethyst: "text-amethyst",
  gold: "text-primary",
};
const ACCENT_BG: Record<string, string> = {
  emerald: "bg-emerald",
  sapphire: "bg-sapphire",
  ruby: "bg-ruby",
  amethyst: "bg-amethyst",
  gold: "bg-primary",
};

// One quick-fire question, normalized to a single tap-or-type decision -
// this is what lets one shared round engine (below) drive all 5 games
// instead of five bespoke ones. A match_column question (several pairs)
// expands into several prompts, one per pair, since "match every pair at
// once" doesn't fit the rapid-fire single-decision mechanic the other
// games use - it's presented as "which one matches?" one pair at a time
// instead.
type Prompt =
  | { kind: "choice"; promptText: string; choices: { id: string; text: string }[]; correctId: string }
  | { kind: "text"; promptText: string; accepted: string[]; caseSensitive: boolean };

function normalizeText(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function flattenToPrompts(questions: GameQuestion[]): Prompt[] {
  const prompts: Prompt[] = [];
  for (const q of questions) {
    if (q.questionType === "mcq" || q.questionType === "true_false") {
      if (!q.correctOptionId) continue;
      prompts.push({
        kind: "choice",
        promptText: q.questionText,
        choices: q.options.map((o) => ({ id: o.id, text: o.text })),
        correctId: q.correctOptionId,
      });
    } else if (q.questionType === "fill_blank" || q.questionType === "missing_number" || q.questionType === "missing_spelling") {
      const accepted = q.answerPayload?.acceptedAnswers ?? [];
      if (accepted.length === 0) continue;
      prompts.push({
        kind: "text",
        promptText: q.questionText,
        accepted,
        caseSensitive: q.questionType === "missing_spelling",
      });
    } else if (q.questionType === "match_column") {
      const left = q.answerPayload?.left ?? [];
      const right = q.answerPayload?.right ?? [];
      const correctPairs = q.answerPayload?.correctPairs ?? [];
      left.forEach((leftText, i) => {
        const pair = correctPairs.find((p) => p[0] === i);
        if (!pair || right.length === 0) return;
        prompts.push({
          kind: "choice",
          promptText: `Match: "${leftText}"`,
          choices: right.map((r, idx) => ({ id: String(idx), text: r })),
          correctId: String(pair[1]),
        });
      });
    }
    // short_answer/long_answer never appear in a game's questionTypes
    // (see GAME_DEFINITIONS) - nothing to flatten for them.
  }
  return prompts;
}

function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function Arcade({
  pkClass,
  subjectId,
  subjectName,
  profile,
  onExit,
}: {
  pkClass: PkClass;
  subjectId: string;
  subjectName: string;
  profile: Profile;
  onExit: () => void;
}) {
  const [gameKey, setGameKey] = useState<GameKey | null>(null);
  // Which games actually have content for this class+subject - fetched
  // fresh whenever the subject changes, same "derive from what's real"
  // pattern SubjectPicker already uses for topics. Null while loading, []
  // once loaded but nothing's available yet - both are handled by
  // GameMenu below rather than showing every game unconditionally
  // (previously Spelling Sprint/Missing Letters showed up even for
  // subjects with zero missing_spelling content).
  const [availableGames, setAvailableGames] = useState<GameKey[] | null>(null);
  const [availableError, setAvailableError] = useState<string | null>(null);

  useEffect(() => {
    setAvailableGames(null);
    setAvailableError(null);
    getAvailableGames({ classId: pkClass.id, subjectName })
      .then(setAvailableGames)
      .catch((err) => setAvailableError(err instanceof Error ? err.message : "Failed to check which games are ready"));
  }, [pkClass.id, subjectName]);

  if (gameKey === null) {
    return <GameMenu availableGames={availableGames} error={availableError} onPick={setGameKey} onExit={onExit} />;
  }

  return (
    <ArcadeRound
      key={gameKey}
      game={gameKey}
      pkClass={pkClass}
      subjectId={subjectId}
      subjectName={subjectName}
      profile={profile}
      onExit={() => setGameKey(null)}
    />
  );
}

function GameMenu({
  availableGames,
  error,
  onPick,
  onExit,
}: {
  availableGames: GameKey[] | null;
  error: string | null;
  onPick: (key: GameKey) => void;
  onExit: () => void;
}) {
  if (error) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center">
        <p className="text-muted-foreground">{error}</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onExit}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
      </section>
    );
  }

  if (availableGames === null) {
    return <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center text-muted-foreground">Loading the Arcade...</section>;
  }

  if (availableGames.length === 0) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center">
        <p className="text-muted-foreground">No Arcade games are ready for this subject yet - ask an adult to add some content in the admin dashboard.</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onExit}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-10 w-full max-w-2xl flex-1">
      <div className="grid gap-5 sm:grid-cols-2">
        {availableGames.map((key, i) => {
          const meta = GAME_META[key];
          const Icon = meta.icon;
          return (
            <button
              key={key}
              onClick={() => onPick(key)}
              style={{ animationDelay: `${i * 60}ms` }}
              className="animate-pop-in shadow-quest flex flex-col items-center rounded-3xl border border-border/70 bg-card/85 p-6 text-center backdrop-blur transition-transform hover:-translate-y-1.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className={`animate-float grid size-16 place-items-center rounded-full bg-secondary ${ACCENT_TEXT[meta.accent]}`}>
                <Icon className="size-8" />
              </span>
              <span className="mt-4 text-xl font-display font-bold">{meta.title}</span>
              <span className="mt-1 text-sm text-muted-foreground">{meta.blurb}</span>
              <span className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-display font-bold text-primary-foreground">
                Play
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Stars from games count toward your kingdom total, same as quests.
      </p>
      <div className="mt-4 flex justify-center">
        <Button variant="ghost" onClick={onExit}>
          Back
        </Button>
      </div>
    </section>
  );
}

const ROUND_SIZE = 10;
const PROMPT_SECONDS = 20;

function ArcadeRound({
  game,
  pkClass,
  subjectId,
  subjectName,
  profile,
  onExit,
}: {
  game: GameKey;
  pkClass: PkClass;
  subjectId: string;
  subjectName: string;
  profile: Profile;
  onExit: () => void;
}) {
  const meta = GAME_META[game];
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [textAnswer, setTextAnswer] = useState("");
  const [flash, setFlash] = useState<"right" | "wrong" | null>(null);
  const [pickedChoiceId, setPickedChoiceId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PROMPT_SECONDS);
  const [finished, setFinished] = useState(false);
  const [starsEarned, setStarsEarned] = useState<number | null>(null);
  const [savingResult, setSavingResult] = useState(false);

  useEffect(() => {
    getGameRound({ game, classId: pkClass.id, subjectName, count: ROUND_SIZE })
      .then((res) => {
        const built = shuffled(flattenToPrompts(res.questions));
        if (built.length === 0) {
          setError(`No ${meta.title} questions are ready for ${subjectName} yet - ask an adult to add some in the admin dashboard.`);
          return;
        }
        setPrompts(built);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this game"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, pkClass.id, subjectName]);

  const current = prompts?.[index] ?? null;

  // A gentle per-prompt countdown, purely for arcade pressure/feel - it
  // never fails the whole round, just auto-marks the current prompt wrong
  // and moves on, so a child who needs longer isn't punished beyond that
  // one prompt.
  useEffect(() => {
    if (!current || flash !== null || finished) return;
    setSecondsLeft(PROMPT_SECONDS);
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          answer(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current, finished]);

  function answer(isCorrect: boolean) {
    setFlash(isCorrect ? "right" : "wrong");
    if (isCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => {
        const next = s + 1;
        setBestStreak((b) => Math.max(b, next));
        return next;
      });
    } else {
      setStreak(0);
    }
    setTimeout(() => {
      setFlash(null);
      setPickedChoiceId(null);
      setTextAnswer("");
      setIndex((i) => i + 1);
    }, 700);
  }

  function pickChoice(choiceId: string) {
    if (flash !== null || current?.kind !== "choice") return;
    setPickedChoiceId(choiceId);
    answer(choiceId === current.correctId);
  }

  function submitText() {
    if (flash !== null || current?.kind !== "text") return;
    const normalized = normalizeText(textAnswer, current.caseSensitive);
    const isCorrect = normalized.length > 0 && current.accepted.some((a) => normalizeText(a, current.caseSensitive) === normalized);
    answer(isCorrect);
  }

  // Round over - record it once, the moment the last prompt is answered.
  useEffect(() => {
    if (!prompts || finished) return;
    if (index < prompts.length) return;
    setFinished(true);
    setSavingResult(true);
    recordGameAttempt({
      profileId: profile.id,
      classId: pkClass.id,
      subjectId,
      gameKey: game,
      correctCount,
      totalCount: prompts.length,
    })
      .then((res) => setStarsEarned(res.starsEarned))
      .catch(() => setStarsEarned(0))
      .finally(() => setSavingResult(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, prompts, finished]);

  if (error) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center">
        <p className="text-muted-foreground">{error}</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onExit}>
            <ArrowLeft className="size-4" /> Back to the Arcade
          </Button>
        </div>
      </section>
    );
  }

  if (!prompts) {
    return (
      <section className="mx-auto mt-10 w-full max-w-xl flex-1 text-center text-muted-foreground">
        Loading {meta.title}...
      </section>
    );
  }

  if (finished) {
    const total = prompts.length;
    const percent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <section className="animate-pop-in mx-auto mt-10 w-full max-w-md flex-1 text-center">
        <span className={`mx-auto grid size-20 place-items-center rounded-full bg-secondary ${ACCENT_TEXT[meta.accent]}`}>
          <meta.icon className="size-10" />
        </span>
        <h2 className="mt-4 text-2xl font-display font-bold">{meta.title} complete!</h2>
        <p className="mt-2 text-muted-foreground">
          {correctCount} of {total} correct ({percent}%) - best streak {bestStreak}
        </p>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-lg font-display font-bold text-primary">
          {savingResult ? (
            "Saving..."
          ) : (
            <>
              <Star className="size-5 fill-current" /> +{starsEarned ?? 0} stars
            </>
          )}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => {
              setPrompts(null);
              setIndex(0);
              setCorrectCount(0);
              setStreak(0);
              setBestStreak(0);
              setFinished(false);
              setStarsEarned(null);
              getGameRound({ game, classId: pkClass.id, subjectName, count: ROUND_SIZE })
                .then((res) => {
                  const built = shuffled(flattenToPrompts(res.questions));
                  if (built.length === 0) {
                    setError(`No ${meta.title} questions are ready for ${subjectName} yet.`);
                    return;
                  }
                  setPrompts(built);
                })
                .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this game"));
            }}
          >
            Play again
          </Button>
          <Button variant="secondary" onClick={onExit}>
            Back to the Arcade
          </Button>
        </div>
      </section>
    );
  }

  if (!current) return null;

  return (
    <section className="mx-auto mt-6 w-full max-w-xl flex-1">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onExit} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex items-center gap-4 text-sm font-display font-bold">
          <span className="flex items-center gap-1 text-muted-foreground">
            {index + 1} / {prompts.length}
          </span>
          <span className={`flex items-center gap-1 ${streak > 0 ? "text-primary" : "text-muted-foreground"}`}>
            <Flame className={`size-4 ${streak > 0 ? "fill-current" : ""}`} /> {streak}
          </span>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary/70">
        <div
          className={`h-full ${ACCENT_BG[meta.accent]} transition-[width] duration-1000 ease-linear`}
          style={{ width: `${(secondsLeft / PROMPT_SECONDS) * 100}%` }}
        />
      </div>

      <div
        className={`animate-pop-in shadow-quest mt-6 rounded-3xl border-2 bg-card/85 p-7 text-center backdrop-blur transition-colors ${
          flash === "right" ? "border-emerald" : flash === "wrong" ? "border-ruby" : "border-border/70"
        }`}
      >
        <h2 className="text-xl leading-snug font-semibold">{current.promptText}</h2>

        {current.kind === "choice" && (
          <div className="mt-6 grid gap-3">
            {current.choices.map((choice) => {
              const isPicked = pickedChoiceId === choice.id;
              const showRight = flash !== null && choice.id === current.correctId;
              const showWrong = flash !== null && isPicked && choice.id !== current.correctId;
              return (
                <button
                  key={choice.id}
                  onClick={() => pickChoice(choice.id)}
                  disabled={flash !== null}
                  className={`flex items-center justify-between rounded-2xl border-2 px-5 py-3.5 text-left font-semibold transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:hover:translate-y-0 ${
                    showRight
                      ? "border-emerald bg-emerald/15 text-emerald"
                      : showWrong
                        ? "border-ruby bg-ruby/15 text-ruby"
                        : "border-border bg-secondary/60"
                  }`}
                >
                  {choice.text}
                  {showRight && <CheckCircle2 className="size-5 shrink-0" />}
                  {showWrong && <X className="size-5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {current.kind === "text" && (
          <div className="mt-6">
            <input
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitText()}
              autoFocus
              disabled={flash !== null}
              placeholder="Type your answer"
              autoCapitalize={current.caseSensitive ? "none" : undefined}
              className="w-full rounded-2xl border-2 border-border bg-secondary/60 px-5 py-3.5 text-center text-lg font-semibold outline-none focus-visible:border-primary"
            />
            <Button className="mt-4" onClick={submitText} disabled={flash !== null || textAnswer.trim().length === 0}>
              Check
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
