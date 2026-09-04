import { useEffect, useState } from "react";
import { createOrGetProfile, getProfiles } from "../api";
import type { Profile } from "../types";

type Title = "Prince" | "Princess";

function capitalize(value: string) {
  return value.trim().charAt(0).toUpperCase() + value.trim().slice(1);
}

// "Who's playing" - a lightweight profile picker, like a game console.
// With existing profiles, shows them as cards to pick from; either way,
// "+ Add new player" (or, with zero profiles yet, straight away) reveals
// the original prince/princess-then-name flow, which now saves a real
// profile via createOrGetProfile instead of just holding local state.
export function Welcome({ onEnter }: { onEnter: (profile: Profile) => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [showNewPlayerForm, setShowNewPlayerForm] = useState(false);
  const [title, setTitle] = useState<Title | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfiles()
      .then((p) => {
        setProfiles(p);
        // First-run experience: with no existing players, go straight to
        // the create-a-player form instead of showing an empty list.
        if (p.length === 0) setShowNewPlayerForm(true);
      })
      .catch(() => {
        // If the profile list can't be loaded, fall back to the create
        // flow so the app is still usable.
        setProfiles([]);
        setShowNewPlayerForm(true);
      });
  }, []);

  async function handleCreate(enteredName: string, enteredTitle: Title) {
    setSubmitting(true);
    setError(null);
    try {
      const profile = await createOrGetProfile({ name: capitalize(enteredName), title: enteredTitle });
      onEnter(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
      setSubmitting(false);
    }
  }

  const showPicker = profiles !== null && profiles.length > 0 && !showNewPlayerForm;

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
        {profiles === null && <p style={{ color: "#5a5148" }}>Loading...</p>}

        {showPicker && (
          <>
            <p style={{ color: "#5a5148", marginBottom: 16 }}>Who's playing?</p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
              {profiles!.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onEnter(p)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16 }}
                >
                  <img
                    src={p.title === "Princess" ? "/princess.png" : "/prince.png"}
                    alt={p.title ?? "Player"}
                    style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 12 }}
                  />
                  <div style={{ marginTop: 8, fontWeight: 600 }}>{p.name}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowNewPlayerForm(true)}
              style={{ background: "none", border: "1px solid #c3c2b7", borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}
            >
              + Add new player
            </button>
          </>
        )}

        {showNewPlayerForm && title === null && (
          <>
            <p style={{ color: "#5a5148", marginBottom: 12 }}>Are you a prince or a princess?</p>
            <div style={{ display: "flex", gap: 24, justifyContent: "center" }}>
              <button
                onClick={() => setTitle("Prince")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16 }}
              >
                <img src="/prince.png" alt="Prince" style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 12 }} />
                <div style={{ marginTop: 8 }}>Prince</div>
              </button>
              <button
                onClick={() => setTitle("Princess")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16 }}
              >
                <img src="/princess.png" alt="Princess" style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 12 }} />
                <div style={{ marginTop: 8 }}>Princess</div>
              </button>
            </div>
            {profiles && profiles.length > 0 && (
              <button
                onClick={() => setShowNewPlayerForm(false)}
                style={{ background: "none", border: "none", color: "#8a4b12", cursor: "pointer", marginTop: 16, fontSize: 14 }}
              >
                &larr; Back to player list
              </button>
            )}
          </>
        )}

        {showNewPlayerForm && title !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) handleCreate(name, title);
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
              <button type="submit" disabled={submitting} style={{ padding: "8px 20px", fontSize: 16, cursor: "pointer" }}>
                {submitting ? "Entering..." : "Enter Kingdom"}
              </button>
            </div>
          </form>
        )}

        {error && <p style={{ color: "#8a1f11", marginTop: 12 }}>{error}</p>}
      </div>
    </main>
  );
}
