import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { checkPasscode, PASSCODE_STORAGE_KEY } from "../api";
import { styles } from "./Layout";

// Gates the whole app behind one shared family passcode, for the public
// deployment. Purely a "keep random internet visitors out" measure, not
// real per-user authentication - profiles still have no passwords of
// their own. When the deployed API has no APP_PASSCODE configured (local
// dev, LAN-only access), /auth/check always succeeds with no header at
// all, so this never prompts and the app behaves exactly as before.
export function Gate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "locked" | "unlocked">("checking");
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

  if (status === "checking") {
    return (
      <main style={{ maxWidth: 360, margin: "120px auto", padding: 24, textAlign: "center" }}>
        <p style={styles.muted}>Loading...</p>
      </main>
    );
  }

  if (status === "unlocked") {
    return <>{children}</>;
  }

  return (
    <main style={{ maxWidth: 360, margin: "100px auto", padding: 24, textAlign: "center" }}>
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>Puzzle Kingdom</h1>
      <p style={{ ...styles.muted, marginBottom: 24 }}>Enter the family passcode to continue.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Passcode"
          autoFocus
          style={{
            padding: "10px 14px",
            fontSize: 16,
            width: "100%",
            marginBottom: 12,
            boxSizing: "border-box",
            borderRadius: 8,
            border: "1px solid #c3c2b7",
          }}
        />
        <button type="submit" style={{ ...styles.primaryButton, width: "100%" }} disabled={submitting || !input.trim()}>
          {submitting ? "Checking..." : "Enter"}
        </button>
      </form>
      {error && <p style={styles.error}>{error}</p>}
    </main>
  );
}
