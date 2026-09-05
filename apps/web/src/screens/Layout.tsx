import type { ReactNode } from "react";

export function Layout({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 24px" }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "#8a4b12",
            cursor: "pointer",
            padding: 0,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          &larr; Back
        </button>
      )}
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>{title}</h1>
      {children}
    </main>
  );
}

export const styles = {
  primaryButton: {
    padding: "10px 20px",
    fontSize: 15,
    fontWeight: 600 as const,
    cursor: "pointer",
    background: "#1a3c6e",
    color: "#fff",
    border: "none",
    borderRadius: 8,
  },
  secondaryButton: {
    padding: "10px 20px",
    fontSize: 15,
    cursor: "pointer",
    background: "#f6f1e6",
    color: "#241d1a",
    border: "1px solid #c3c2b7",
    borderRadius: 8,
  },
  card: {
    padding: 16,
    borderRadius: 10,
    border: "1px solid #e3ddd0",
    marginBottom: 12,
  },
  // A small, unobtrusive text-style action inside a card - used for
  // "Explain this to me" on a wrong answer, where a full button would
  // visually compete with the primary "continue"/"play again" action.
  linkButton: {
    padding: "6px 0",
    fontSize: 13,
    fontWeight: 600 as const,
    cursor: "pointer",
    background: "none",
    color: "#1a3c6e",
    border: "none",
    textDecoration: "underline",
    marginTop: 4,
    display: "block" as const,
  },
  muted: { color: "#8a8177", fontSize: 14 },
  error: {
    color: "#8a1f11",
    background: "#fbecea",
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    marginTop: 12,
  },
};
