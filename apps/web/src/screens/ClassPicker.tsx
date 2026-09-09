import { useEffect, useState } from "react";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { getClasses } from "../api";
import type { PkClass } from "../types";
import { Button } from "../components/ui/button";

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
    <main className="night-sky relative min-h-screen overflow-hidden">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <h1 className="text-center text-2xl sm:text-3xl">Who's taking the quiz?</h1>
          <span className="size-9" />
        </header>

        <section className="mx-auto mt-10 flex w-full max-w-sm flex-1 flex-col gap-3">
          {classes === null && !error && <p className="text-center text-muted-foreground">Loading...</p>}
          {classes && classes.length === 0 && (
            <p className="text-center text-muted-foreground">No classes yet — add some content first.</p>
          )}

          {classes?.map((c, i) => (
            <button
              key={c.id}
              onClick={() => onClassSelected(c)}
              style={{ animationDelay: `${i * 70}ms` }}
              className="animate-pop-in group flex items-center gap-4 rounded-2xl border border-border/70 bg-card/80 p-5 text-left backdrop-blur transition-transform hover:-translate-y-0.5 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                <GraduationCap className="size-6" />
              </span>
              <span className="text-lg font-display font-semibold">{c.name}</span>
            </button>
          ))}

          {error && <p className="text-center text-sm font-medium text-destructive">{error}</p>}
        </section>
      </div>
    </main>
  );
}
