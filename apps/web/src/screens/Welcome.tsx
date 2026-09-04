import { useState } from "react";
import { lookupProfile, setProfilePin, verifyProfilePin } from "../api";
import type { Profile, ProfileLookupResponse } from "../types";

type Title = "Prince" | "Princess";

// Which step of "entering the kingdom" is showing. `looked` holds what
// POST /profiles just told us about the typed name, so the right next
// step (choose a title + PIN for a new name, choose a PIN for an old name
// with none yet, or enter the existing PIN) can be picked without the
// name box itself ever listing anyone else's name.
type Step =
  | { kind: "name" }
  | { kind: "newTitle"; looked: ProfileLookupResponse }
  | { kind: "setPin"; looked: ProfileLookupResponse; title?: Title }
  | { kind: "verifyPin"; looked: ProfileLookupResponse };

function capitalize(value: string) {
  return value.trim().charAt(0).toUpperCase() + value.trim().slice(1);
}

function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      placeholder="••••"
      autoFocus={autoFocus}
      style={{ padding: "8px 12px", fontSize: 20, letterSpacing: 6, width: 100, textAlign: "center" }}
    />
  );
}

// Entering the kingdom: type your own name (no list of everyone else's to
// click through), then either set a 4-digit PIN (a brand-new name, or an
// older profile from before PINs existed) or enter your existing one -
// this is what makes a profile a real per-child login, not just a typed
// name. See apps/api/src/routes/profiles.ts for the matching server flow.
export function Welcome({ onEnter, onAdminLogin }: { onEnter: (profile: Profile) => void; onAdminLogin: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "name" });
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleNameSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const looked = await lookupProfile(capitalize(name));
      if (looked.created) {
        setStep({ kind: "newTitle", looked });
      } else if (!looked.hasPin) {
        setStep({ kind: "setPin", looked });
      } else {
        setStep({ kind: "verifyPin", looked });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetPin(looked: ProfileLookupResponse, title?: Title) {
    if (pin.length !== 4) {
      setError("PIN must be 4 digits");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { profile } = await setProfilePin(looked.id, { pin, title });
      onEnter(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set PIN");
      setSubmitting(false);
    }
  }

  async function handleVerifyPin(looked: ProfileLookupResponse) {
    if (pin.length !== 4) {
      setError("PIN must be 4 digits");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { profile } = await verifyProfilePin(looked.id, pin);
      onEnter(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect PIN");
      setPin("");
      setSubmitting(false);
    }
  }

  function resetToStart() {
    setStep({ kind: "name" });
    setName("");
    setPin("");
    setConfirmPin("");
    setError(null);
  }

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
        {step.kind === "name" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNameSubmit();
            }}
          >
            <p style={{ color: "#5a5148", marginBottom: 12 }}>What's your name?</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                style={{ padding: "8px 12px", fontSize: 16 }}
                autoFocus
              />
              <button type="submit" disabled={submitting} style={{ padding: "8px 20px", fontSize: 16, cursor: "pointer" }}>
                {submitting ? "..." : "Continue"}
              </button>
            </div>
          </form>
        )}

        {step.kind === "newTitle" && (
          <>
            <p style={{ color: "#5a5148", marginBottom: 12 }}>Hi {step.looked.name}! Are you a prince or a princess?</p>
            <div style={{ display: "flex", gap: 24, justifyContent: "center" }}>
              <button
                onClick={() => setStep({ kind: "setPin", looked: step.looked, title: "Prince" })}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16 }}
              >
                <img src="/prince.png" alt="Prince" style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 12 }} />
                <div style={{ marginTop: 8 }}>Prince</div>
              </button>
              <button
                onClick={() => setStep({ kind: "setPin", looked: step.looked, title: "Princess" })}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 16 }}
              >
                <img src="/princess.png" alt="Princess" style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 12 }} />
                <div style={{ marginTop: 8 }}>Princess</div>
              </button>
            </div>
          </>
        )}

        {step.kind === "setPin" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSetPin(step.looked, step.title);
            }}
          >
            <p style={{ color: "#5a5148", marginBottom: 4 }}>
              Choose a 4-digit PIN, {step.looked.name} - you'll use it every time you play.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16, marginBottom: 8 }}>
              <div>
                <div style={{ color: "#8a8177", fontSize: 12, marginBottom: 4 }}>PIN</div>
                <PinInput value={pin} onChange={setPin} autoFocus />
              </div>
              <div>
                <div style={{ color: "#8a8177", fontSize: 12, marginBottom: 4 }}>Confirm</div>
                <PinInput value={confirmPin} onChange={setConfirmPin} />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting || pin.length !== 4 || confirmPin.length !== 4}
              style={{ padding: "8px 20px", fontSize: 16, cursor: "pointer", marginTop: 12 }}
            >
              {submitting ? "Saving..." : "Save PIN & enter kingdom"}
            </button>
          </form>
        )}

        {step.kind === "verifyPin" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerifyPin(step.looked);
            }}
          >
            <p style={{ color: "#5a5148", marginBottom: 12 }}>Welcome back, {step.looked.name}! Enter your PIN.</p>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <PinInput value={pin} onChange={setPin} autoFocus />
            </div>
            <button
              type="submit"
              disabled={submitting || pin.length !== 4}
              style={{ padding: "8px 20px", fontSize: 16, cursor: "pointer" }}
            >
              {submitting ? "Entering..." : "Enter Kingdom"}
            </button>
          </form>
        )}

        {step.kind !== "name" && (
          <button
            type="button"
            onClick={resetToStart}
            style={{ background: "none", border: "none", color: "#8a4b12", cursor: "pointer", marginTop: 16, fontSize: 14, display: "block", marginLeft: "auto", marginRight: "auto" }}
          >
            &larr; Not you? Start over
          </button>
        )}

        {error && <p style={{ color: "#8a1f11", marginTop: 12 }}>{error}</p>}

        <button
          onClick={onAdminLogin}
          style={{ background: "none", border: "none", color: "#8a8177", cursor: "pointer", marginTop: 40, fontSize: 13, textDecoration: "underline" }}
        >
          Admin login
        </button>
      </div>
    </main>
  );
}
