import { useEffect, useState } from "react";
import { Bird, ChartColumn, Play, Trophy } from "lucide-react";
import { getFeatures } from "../api";
import { Button } from "../components/ui/button";

// The quest hub: same night-sky/gold chrome as Welcome (see
// plan/Lovable-Design-Migration-Plan.md's Phase 1) so the app doesn't
// snap back to the old plain look the moment you're past login. There's
// no direct Lovable reference page for this one specifically (the
// reference's nav bar just links straight out to /games, /ask, etc. with
// no separate hub screen) - built from the same tokens/components
// instead of ported from a specific page.
export function Home({
  name,
  onPlay,
  onViewReports,
  onViewLeaderboard,
  onOpenStudyBuddy,
}: {
  name: string | null;
  onPlay: () => void;
  onViewReports: () => void;
  onViewLeaderboard: () => void;
  onOpenStudyBuddy: () => void;
}) {
  // Flag-based feature management (migration 0023) - fetched fresh on
  // every visit to the hub rather than threaded down from App.tsx, same
  // "each screen fetches what it needs" convention SubjectPicker/Arcade
  // already use for their own data. Defaults to true (fail open) while
  // loading and on a fetch error - never hide a button because of a
  // network hiccup, same philosophy as the backend's own DEFAULT_SETTINGS.
  const [studyBuddyEnabled, setStudyBuddyEnabled] = useState(true);
  useEffect(() => {
    getFeatures()
      .then((f) => setStudyBuddyEnabled(f.studyBuddyEnabled))
      .catch(() => {});
  }, []);

  return (
    <main className="night-sky relative min-h-screen overflow-hidden">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-background to-transparent" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-10">
        <header className="text-center">
          <p className="text-sm font-semibold tracking-[0.3em] text-primary/80 uppercase">
            Your quest hub
          </p>
          <h1 className="text-gold-shimmer mt-3 text-4xl sm:text-5xl">
            {name ? `Welcome back, ${name}!` : "Puzzle Kingdom"}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground">
            What would you like to do?
          </p>
        </header>

        <section className="animate-pop-in mx-auto mt-10 w-full max-w-sm">
          <Button size="lg" className="h-16 w-full rounded-2xl text-lg font-display" onClick={onPlay}>
            <Play className="size-5 fill-current" />
            Take a quiz
          </Button>

          <div className="mt-4 flex flex-col gap-3">
            {studyBuddyEnabled && (
              <button
                onClick={onOpenStudyBuddy}
                className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-card/80 p-4 text-left backdrop-blur transition-transform hover:-translate-y-0.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                  <Bird className="size-5" />
                </span>
                <span className="font-display font-semibold">Ask your Study Buddy</span>
              </button>
            )}

            <button
              onClick={onViewLeaderboard}
              className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-card/80 p-4 text-left backdrop-blur transition-transform hover:-translate-y-0.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                <Trophy className="size-5" />
              </span>
              <span className="font-display font-semibold">Leaderboard</span>
            </button>

            <button
              onClick={onViewReports}
              className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-card/80 p-4 text-left backdrop-blur transition-transform hover:-translate-y-0.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                <ChartColumn className="size-5" />
              </span>
              <span className="font-display font-semibold">My progress reports</span>
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
