import { useEffect, useState } from "react";
import { ArrowLeft, Crown, Trophy } from "lucide-react";
import { getClasses, getLeaderboard } from "../api";
import type { LeaderboardEntry, PkClass } from "../types";
import { Button } from "../components/ui/button";
import { avatarFile } from "../avatars";

const PODIUM_TINT = ["text-primary", "text-muted-foreground", "text-ruby"];

// Looks up the exact avatar image Welcome.tsx's picker saved (shared
// list in ../avatars.ts, so the two can't drift out of sync) so a
// leaderboard row shows the real picture a player picked rather than a
// generic one. Falls back to the old single generic image per title for
// older profiles (avatarId null) or a since-retired id.
function avatarSrc(avatarId: string | null, title: string | null): string {
  return avatarFile(avatarId) ?? (title === "Princess" ? "/princess.png" : "/prince.png");
}

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClasses()
      .then((cs) => {
        setClasses(cs);
        // Default to the first class, since the leaderboard is meant to
        // compare like-for-like - a Year 3 stage isn't the same as an 11+
        // stage, so "all classes combined" isn't a meaningful default.
        if (cs.length > 0) setSelectedClassId(cs[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load classes"));
  }, []);

  useEffect(() => {
    setEntries(null);
    getLeaderboard({ classId: selectedClassId ?? undefined })
      .then((rows) => setEntries(rows.filter((r) => r.quizzesPlayed > 0)))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load leaderboard"));
  }, [selectedClassId]);

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-16">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-2xl px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">
              <Trophy className="size-3.5" />
              Hall of fame
            </p>
            <h1 className="text-gold-shimmer text-2xl sm:text-3xl">Leaderboard</h1>
          </div>
          <span className="size-9" />
        </header>

        {classes && classes.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {classes.map((c) => (
              <Button
                key={c.id}
                variant={selectedClassId === c.id ? "default" : "secondary"}
                size="sm"
                className="rounded-full"
                onClick={() => setSelectedClassId(c.id)}
              >
                {c.name}
              </Button>
            ))}
          </div>
        )}

        {error && <p className="mt-6 text-center text-sm font-medium text-destructive">{error}</p>}
        {entries === null && !error && <p className="mt-10 text-center text-muted-foreground">Loading...</p>}
        {entries && entries.length === 0 && (
          <p className="mt-10 text-center text-muted-foreground">No quizzes played here yet — be the first!</p>
        )}

        {entries && entries.length > 0 && (
          <ol className="mt-8 space-y-3">
            {entries.map((e, i) => (
              <li
                key={e.profileId}
                className={`animate-pop-in flex items-center gap-4 rounded-3xl border px-5 py-4 backdrop-blur ${
                  i === 0 ? "border-primary/60 bg-card/90 shadow-glow" : "border-border/70 bg-card/80 shadow-quest"
                }`}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <span className="grid w-8 shrink-0 place-items-center text-xl font-display font-extrabold">
                  {i < 3 ? <Crown className={`size-6 ${PODIUM_TINT[i]}`} /> : i + 1}
                </span>
                <img
                  src={avatarSrc(e.avatarId, e.title)}
                  alt=""
                  className="size-11 shrink-0 rounded-xl border-2 border-border bg-secondary object-cover"
                />
                <div className="flex-1">
                  <p className="font-display font-bold">{e.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.quizzesPlayed} {e.quizzesPlayed === 1 ? "quiz" : "quizzes"} · {e.stagesCleared}{" "}
                    {e.stagesCleared === 1 ? "stage" : "stages"} cleared ·{" "}
                    {e.accuracy === null ? "—" : `${Math.round(e.accuracy * 100)}% accuracy`}
                  </p>
                </div>
                {/* The ranking metric itself (rows already arrive sorted
                    by this - see leaderboard.ts) - stars earned is what
                    should be prominent here, not stagesCleared, which
                    moved into the muted subtitle line above instead of
                    being dropped. */}
                <div className="text-right">
                  <p className="text-xl font-bold text-primary">⭐ {e.starsEarned}</p>
                  <p className="text-xs text-muted-foreground">stars earned</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
