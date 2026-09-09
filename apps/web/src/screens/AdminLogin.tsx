import { useState } from "react";
import { ArrowLeft, ShieldHalf, Users } from "lucide-react";
import { adminLogin } from "../api";
import type { AdminUser } from "../types";
import { Button } from "../components/ui/button";

// Grown-up surfaces (admin, and eventually a parent dashboard) get the
// warm ".parchment" scope instead of the child-facing night-sky/gold
// system - see src/styles.css and plan/Lovable-Design-Migration-Plan.md.
export function AdminLogin({
  intent = "admin",
  onBack,
  onLoggedIn,
}: {
  // Same one admin account either way - this only changes the copy and
  // icon, not what credentials are checked. See App.tsx's Screen type
  // for why there is no separate "parent" role.
  intent?: "admin" | "parent";
  onBack: () => void;
  onLoggedIn: (admin: AdminUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await adminLogin({ username: username.trim(), password });
      onLoggedIn(res.admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
        <Button variant="ghost" size="icon" className="absolute top-6 left-6 rounded-full" onClick={onBack} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>

        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              {intent === "parent" ? <Users className="size-5" /> : <ShieldHalf className="size-5" />}
            </span>
            <div>
              <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Puzzle Kingdom</p>
              <h1 className="text-2xl">{intent === "parent" ? "Parent login" : "Admin login"}</h1>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-6">
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <label className="mb-6 block">
              <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Logging in..." : "Log in"}
            </Button>
          </form>
          {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
