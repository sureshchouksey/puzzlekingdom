import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { checkPasscode, getStoredPasscode, PASSCODE_STORAGE_KEY } from "../api";
import { Button } from "../components/ui/button";

// Gates the whole app behind one shared family passcode, for the public
// deployment. Purely a "keep random internet visitors out" measure, not
// real per-user authentication - profiles still have no passwords of
// their own. When the deployed API has no APP_PASSCODE configured (local
// dev, LAN-only access), /auth/check always succeeds with no header at
// all, so this never prompts and the app behaves exactly as before.
export function Gate({ children }: { children: ReactNode }) {
  // Render immediately from what's already known locally, rather than
  // blocking on a network round-trip before painting anything - a real
  // problem found in production, not a hypothetical one: this used to
  // default to "checking" and show nothing but a bare "Loading..." until
  // GET /auth/check resolved, which on the API's Render free-tier
  // deployment can mean 30-60+ seconds of a blank screen every time the
  // instance has gone idle (it sleeps after ~15 minutes of no traffic).
  // A stored passcode is trusted optimistically here (shows the real app
  // right away); no stored passcode shows the entry form right away -
  // either way, the first paint no longer waits on the API at all. The
  // background check below still runs and corrects either direction: a
  // stale/wrong stored passcode gets kicked back to locked, and "no
  // passcode configured at all" (local/LAN dev, where APP_PASSCODE is
  // unset and /auth/check always succeeds) auto-unlocks even with
  // nothing stored - it just no longer holds up the first thing a
  // visitor sees.
  const [status, setStatus] = useState<"locked" | "unlocked">(() => (getStoredPasscode() ? "unlocked" : "locked"));
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkPasscode()
      .then((ok) => setStatus(ok ? "unlocked" : "locked"))
      .catch(() => setStatus("locked"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      localStorage.setItem(PASSCODE_STORAGE_KEY, input.trim());
    } catch {
      // Storage unavailable (private browsing, etc.) - the passcode just
      // won't be remembered between visits, but this attempt still works.
    }
    const ok = await checkPasscode();
    if (ok) {
      setStatus("unlocked");
    } else {
      setError("That passcode isn't right - try again.");
      try {
        localStorage.removeItem(PASSCODE_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    setSubmitting(false);
  }

  if (status === "unlocked") {
    return <>{children}</>;
  }

  return (
    <main className="night-sky relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="animate-pop-in relative w-full max-w-sm rounded-3xl border border-border/70 bg-card/85 p-8 text-center backdrop-blur shadow-quest">
        <h1 className="text-gold-shimmer text-3xl">Puzzle Kingdom</h1>
        <p className="mt-2 mb-6 text-muted-foreground">Enter the family passcode to continue.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Passcode"
            autoFocus
            className="mb-3 w-full rounded-2xl border border-input bg-input/40 px-4 py-3 text-center text-lg text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button type="submit" size="lg" className="h-14 w-full rounded-2xl text-lg font-display" disabled={submitting || !input.trim()}>
            {submitting ? "Checking..." : "Enter"}
          </Button>
        </form>
        {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
      </div>
    </main>
  );
}
