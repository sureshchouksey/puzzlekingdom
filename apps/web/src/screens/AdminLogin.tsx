import { useState } from "react";
import { adminLogin } from "../api";
import type { AdminUser } from "../types";
import { Layout, styles } from "./Layout";

export function AdminLogin({ onBack, onLoggedIn }: { onBack: () => void; onLoggedIn: (admin: AdminUser) => void }) {
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
    <Layout title="Admin login" onBack={onBack}>
      <form onSubmit={handleSubmit} style={{ maxWidth: 320 }}>
        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ padding: "8px 12px", fontSize: 15, width: "100%", boxSizing: "border-box" }}
            autoFocus
          />
        </label>
        <label style={{ display: "block", marginBottom: 20 }}>
          <span style={{ ...styles.muted, display: "block", marginBottom: 6 }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: "8px 12px", fontSize: 15, width: "100%", boxSizing: "border-box" }}
          />
        </label>
        <button type="submit" style={styles.primaryButton} disabled={submitting}>
          {submitting ? "Logging in..." : "Log in"}
        </button>
      </form>
      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
