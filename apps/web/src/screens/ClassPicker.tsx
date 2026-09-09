import { useEffect, useState } from "react";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { getClasses } from "../api";
import type { PkClass } from "../types";
import { Button } from "../components/ui/button";

// Classes have no inherent color/subject of their own, so we cycle through
// the design system's jewel tones purely for visual variety across cards -
// same palette the subject and topic cards use, just not meaning-bound here.
const JEWELS = ["emerald", "sapphire", "ruby", "amethyst", "gold"] as const;
type Jewel = (typeof JEWELS)[number];

const JEWEL_TEXT: Record<Jewel, string> = {
  emerald: "text-emerald",
  sapphire: "text-sapphire",
  ruby: "text-ruby",
  amethyst: "text-amethyst",
  gold: "text-primary",
};

export function ClassPicker({
  onBack,
  onClassSelected,
}: {
  onBack: () => void;
  onClassSelected: (pkClass: PkClass) => void;
}) {
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClasses()
      .then(setClasses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load classes"));
  }, []);

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-16">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className="text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">Choose your class</p>
            <h1 className="text-gold-shimmer text-3xl sm:text-4xl">Who's taking the quiz?</h1>
          </div>
          <span className="size-9" />
        </header>

        <section className="mx-auto mt-10 w-full max-w-2xl flex-1">
          {classes === null && !error && (
            <p className="mt-8 text-center text-muted-foreground">Loading classes...</p>
          )}
          {classes && classes.length === 0 && (
            <p className="mt-8 text-center text-muted-foreground">No classes yet — add some content first.</p>
          )}

          {classes && classes.length > 0 && (
            <div className="grid gap-5 sm:grid-cols-2">
              {classes.map((c, i) => {
                const jewel = JEWELS[i % JEWELS.length];
                return (
                  <button
                    key={c.id}
                    onClick={() => onClassSelected(c)}
                    style={{ animationDelay: `${i * 90}ms` }}
                    className="animate-pop-in shadow-quest group flex flex-col items-center rounded-3xl border border-border/70 bg-card/85 p-7 text-center backdrop-blur transition-transform hover:-translate-y-1.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span
                      className={`animate-float grid size-20 place-items-center rounded-full bg-secondary shadow-inner ${JEWEL_TEXT[jewel]}`}
                    >
                      <GraduationCap className="size-10" />
                    </span>
                    <span className="mt-4 text-2xl font-display font-bold">{c.name}</span>
                    <span className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-display font-bold text-primary-foreground">
                      Enter class
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <p className="mt-6 text-center text-sm font-medium text-destructive">{error}</p>}
        </section>
      </div>
    </main>
  );
}
