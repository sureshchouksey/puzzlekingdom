import { useEffect, useRef, useState } from "react";
import Parallax from "parallax-js";
import { motion, useReducedMotion } from "motion/react";
import { User, ArrowRight } from "lucide-react";
import { lookupProfile, setProfilePin, verifyProfilePin } from "../api";
import type { Profile, ProfileLookupResponse } from "../types";
import "./Welcome.css";

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
      className="pin-input"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      placeholder="••••"
      autoFocus={autoFocus}
    />
  );
}

// Five background layers, back to front. Depth controls how far parallax-js
// shifts each one on mouse/gyro movement - keep sky nearly still and the
// front castle the most responsive so the scene reads as having real depth.
// Swap these src paths for your own assets; filenames are just placeholders.
const LAYERS: { src: string; depth: number; alt: string }[] = [
  { src: "/parallax/sky.png", depth: 0.0, alt: "" },
  { src: "/parallax/mountains.png", depth: 0.1, alt: "" },
  { src: "/parallax/castle-back.png", depth: 0.2, alt: "" },
  { src: "/parallax/castle-left.png", depth: 0.35, alt: "" },
  { src: "/parallax/castle-right.png", depth: 0.5, alt: "" },
];

function KingdomScene() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!sceneRef.current || prefersReducedMotion) return;
    const instance = new Parallax(sceneRef.current, {
      relativeInput: true,
      hoverOnly: false,
    });
    return () => instance.destroy();
  }, [prefersReducedMotion]);

  return (
    <motion.div
      className="scene-wrapper"
      initial={{ y: prefersReducedMotion ? 0 : "12vh", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="scene" ref={sceneRef}>
        {LAYERS.map((layer) => (
          <div className="layer" data-depth={layer.depth} key={layer.src}>
            <img src={layer.src} alt={layer.alt} draggable={false} />
          </div>
        ))}
      </div>
    </motion.div>
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
  const prefersReducedMotion = useReducedMotion();

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
    <main className="kingdom-page">
      <KingdomScene />

      <motion.div
        className="kingdom-card"
        initial={{ y: prefersReducedMotion ? 0 : 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="kingdom-eyebrow">Welcome to</h1>
        <h2 className="kingdom-title">Puzzle Kingdom</h2>
        <p className="kingdom-subtitle">Upload course content, get an AI-generated quiz, see how you did.</p>

        {step.kind === "name" && (
          <form
            className="kingdom-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleNameSubmit();
            }}
          >
            <p className="kingdom-prompt">What's your name?</p>
            <div className="kingdom-row">
              <div className="name-input-wrap">
                <User className="name-input-icon" size={18} />
                <input
                  className="name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "..." : (
                  <>
                    Continue
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {step.kind === "newTitle" && (
          <>
            <p className="kingdom-prompt">Hi {step.looked.name}! Are you a prince or a princess?</p>
            <div className="title-choice-row">
              <button className="title-choice" onClick={() => setStep({ kind: "setPin", looked: step.looked, title: "Prince" })}>
                <img src="/prince.png" alt="Prince" />
                <div>Prince</div>
              </button>
              <button className="title-choice" onClick={() => setStep({ kind: "setPin", looked: step.looked, title: "Princess" })}>
                <img src="/princess.png" alt="Princess" />
                <div>Princess</div>
              </button>
            </div>
          </>
        )}

        {step.kind === "setPin" && (
          <form
            className="kingdom-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSetPin(step.looked, step.title);
            }}
          >
            <p className="kingdom-prompt">Choose a 4-digit PIN, {step.looked.name} - you'll use it every time you play.</p>
            <div className="pin-row">
              <div className="pin-field">
                <div className="pin-label">PIN</div>
                <PinInput value={pin} onChange={setPin} autoFocus />
              </div>
              <div className="pin-field">
                <div className="pin-label">Confirm</div>
                <PinInput value={confirmPin} onChange={setConfirmPin} />
              </div>
            </div>
            <button type="submit" className="btn-primary btn-block" disabled={submitting || pin.length !== 4 || confirmPin.length !== 4}>
              {submitting ? "Saving..." : "Save PIN & enter kingdom"}
            </button>
          </form>
        )}

        {step.kind === "verifyPin" && (
          <form
            className="kingdom-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleVerifyPin(step.looked);
            }}
          >
            <p className="kingdom-prompt">Welcome back, {step.looked.name}! Enter your PIN.</p>
            <div className="pin-row pin-row-center">
              <PinInput value={pin} onChange={setPin} autoFocus />
            </div>
            <button type="submit" className="btn-primary btn-block" disabled={submitting || pin.length !== 4}>
              {submitting ? "Entering..." : "Enter Kingdom"}
            </button>
          </form>
        )}

        {step.kind !== "name" && (
          <button type="button" className="link-reset" onClick={resetToStart}>
            &larr; Not you? Start over
          </button>
        )}

        {error && <p className="kingdom-error">{error}</p>}

        <button className="link-admin" onClick={onAdminLogin}>
          Admin login
        </button>
      </motion.div>
    </main>
  );
}