import { useState } from "react";

type Title = "Prince" | "Princess";

function capitalize(value: string) {
  return value.trim().charAt(0).toUpperCase() + value.trim().slice(1);
}

export function Welcome({ onEnter }: { onEnter: (name: string, title: Title) => void }) {
  const [title, setTitle] = useState<Title | null>(null);
  const [name, setName] = useState("");

  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Welcome to Puzzle Kingdom</h1>
      <p style={{ color: "#5a5148" }}>Upload course content, get an AI-generated quiz, see how you did.</p>
      <img
        src="/kingdom-castle.jpg"
        alt="A castle behind a sweeping green lawn"
        style={{ width: "100%", borderRadius: 12, marginTop: 48, display: "block" }}
      />

      <div style={{ marginTop: 32, textAlign: "center" }}>
        {title === null ? (
          <>
            <p style={{ color: "#5a5148", marginBottom: 12 }}>Are you a prince or a princess?</p>
            <div style={{ display: "flex", gap: 24, justifyContent: "center" }}>
              <button
                onClick={() => setTitle("Prince")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16 }}
              >
                <img
                  src="/prince.png"
                  alt="Prince"
                  style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 12 }}
                />
                <div style={{ marginTop: 8 }}>Prince</div>
              </button>
              <button
                onClick={() => setTitle("Princess")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16 }}
              >
                <img
                  src="/princess.png"
                  alt="Princess"
                  style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 12 }}
                />
                <div style={{ marginTop: 8 }}>Princess</div>
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) onEnter(capitalize(name), title);
            }}
          >
            <p style={{ color: "#5a5148", marginBottom: 12 }}>What's your name, {title.toLowerCase()}?</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                style={{ padding: "8px 12px", fontSize: 16 }}
                autoFocus
              />
              <button type="submit" style={{ padding: "8px 20px", fontSize: 16, cursor: "pointer" }}>
                Enter Kingdom
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
