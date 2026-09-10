import { useState } from "react";
import { ShieldHalf } from "lucide-react";
import { lookupProfile, setProfilePin, verifyProfilePin } from "../api";
import type { Profile, ProfileLookupResponse } from "../types";
import { Button } from "../components/ui/button";
import { AvatarPicker } from "../components/AvatarPicker";
import { StarPinDots, PinKeypad } from "../components/PinPad";
import type { Title } from "../avatars";

// PRINCE_AVATARS/PRINCESS_AVATARS now live in ../avatars.ts - shared
// with Leaderboard.tsx so the two can't drift out of sync.

// Which step of "entering the kingdom" is showing. `looked` holds what
// POST /profiles just told us about the typed name, so the right next
// step (choose a title + PIN for a new name, choose a PIN for an old name
// with none yet, or enter the existing PIN) can be picked without the
// name box itself ever listing anyone else's name. This state machine is
// unchanged from the pre-reskin version - see apps/api/src/routes/
// profiles.ts for the matching server flow, and
// plan/Lovable-Design-Migration-Plan.md for why the Lovable reference's
// browsable "pick your adventurer" card grid is intentionally NOT ported
// here (it would list every other child's name, which conflicts with the
// existing privacy decision - only the visual chrome below is reskinned).
type Step =
  | { kind: "name" }
  | { kind: "newTitle"; looked: ProfileLookupResponse }
  | { kind: "setPin"; looked: ProfileLookupResponse; title?: Title; avatarId?: string }
  | { kind: "verifyPin"; looked: ProfileLookupResponse };

function capitalize(value: string) {
  return value.trim().charAt(0).toUpperCase() + value.trim().slice(1);
}

// Entering the kingdom: type your own name (no list of everyone else's to
// click through), then either set a 4-digit PIN (a brand-new name, or an
// older profile from before PINs existed) or enter your existing one -
// this is what makes a profile a real per-child login, not just a typed
// name.
export function Welcome({
  onEnter,
  onParentDashboard,
}: {
  onEnter: (profile: Profile) => void;
  // Single grown-up entry point (10 September 2026): family-owner login
  // and the platform-admin/parent login used to be two separate footer
  // links here - see ParentLogin.tsx for why they're now one screen. A
  // family owner logging in from there sees only their own kids' profiles
  // (routes/families.ts), separate from this screen's private "type any
  // name" flow, which still works unchanged for every profile not yet
  // claimed by a family.
  onParentDashboard: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "name" });
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinField, setPinField] = useState<"pin" | "confirm">("pin");
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

  async function handleSetPin(looked: ProfileLookupResponse, title?: Title, avatarId?: string) {
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
      const { profile } = await setProfilePin(looked.id, { pin, title, avatarId });
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
    setPinField("pin");
    setError(null);
  }

  // setPin's keypad types into PIN until it's full, then auto-advances to
  // Confirm - one keypad, two 4-digit fields, no separate "which box am I
  // typing into" tap required.
  function pressSetPinDigit(d: string) {
    if (pinField === "pin") {
      if (pin.length < 4) {
        const next = pin + d;
        setPin(next);
        if (next.length === 4) setPinField("confirm");
      }
    } else if (confirmPin.length < 4) {
      setConfirmPin(confirmPin + d);
    }
  }

  function backspaceSetPin() {
    if (pinField === "confirm") {
      if (confirmPin.length > 0) {
        setConfirmPin(confirmPin.slice(0, -1));
      } else {
        setPinField("pin");
      }
    } else {
      setPin(pin.slice(0, -1));
    }
  }

  return (
    <main className="night-sky relative min-h-screen overflow-hidden">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-background to-transparent" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-10">
        <header className="text-center">
          <p className="text-sm font-semibold tracking-[0.3em] text-primary/80 uppercase">
            Welcome back, adventurer
          </p>
          <h1 className="text-gold-shimmer mt-3 text-5xl sm:text-6xl">Puzzle Kingdom</h1>
          <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground">
            Type your name to continue the quest.
          </p>
        </header>

        <section className="animate-pop-in mx-auto mt-12 w-full max-w-sm rounded-3xl border border-border/70 bg-card/85 p-8 text-center backdrop-blur shadow-quest">
          {step.kind === "name" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleNameSubmit();
              }}
            >
              <p className="text-sm text-muted-foreground">What's your name?</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoFocus
                className="mt-4 w-full rounded-2xl border border-input bg-input/40 px-4 py-3 text-center text-lg text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button type="submit" disabled={submitting} size="lg" className="mt-6 h-14 w-full rounded-2xl text-lg font-display">
                {submitting ? "..." : "Continue"}
              </Button>
            </form>
          )}

          {step.kind === "newTitle" && (
            <>
              <p className="text-sm text-muted-foreground">Hi {step.looked.name}! Pick your avatar.</p>
              <div className="mt-6">
                <AvatarPicker
                  onPick={(title, avatarId) => setStep({ kind: "setPin", looked: step.looked, title, avatarId })}
                />
              </div>
            </>
          )}

          {step.kind === "setPin" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSetPin(step.looked, step.title, step.avatarId);
              }}
            >
              <p className="text-sm text-muted-foreground">
                Choose a 4-digit PIN, {step.looked.name} — you'll use it every time you play.
              </p>

              <div className="mt-6">
                <p className={`mb-2 text-xs font-semibold tracking-wide uppercase ${pinField === "pin" ? "text-primary" : "text-muted-foreground"}`}>
                  PIN
                </p>
                <StarPinDots value={pin} />
              </div>

              <div className="mt-5">
                <p className={`mb-2 text-xs font-semibold tracking-wide uppercase ${pinField === "confirm" ? "text-primary" : "text-muted-foreground"}`}>
                  Confirm
                </p>
                <StarPinDots value={confirmPin} />
              </div>

              <PinKeypad
                onDigit={pressSetPinDigit}
                onBackspace={backspaceSetPin}
                onBack={resetToStart}
              />

              <Button
                type="submit"
                disabled={submitting || pin.length !== 4 || confirmPin.length !== 4}
                size="lg"
                className="mt-6 h-14 w-full rounded-2xl text-lg font-display"
              >
                {submitting ? "Saving..." : "Save PIN & enter kingdom"}
              </Button>
            </form>
          )}

          {step.kind === "verifyPin" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerifyPin(step.looked);
              }}
            >
              <p className="text-sm text-muted-foreground">Welcome back, {step.looked.name}!</p>
              <p className="mt-1 text-xs text-muted-foreground">Tap your secret 4-digit code</p>

              <div className="mt-6">
                <StarPinDots value={pin} />
              </div>

              <PinKeypad
                onDigit={(d) => setPin((p) => (p.length < 4 ? p + d : p))}
                onBackspace={() => setPin((p) => p.slice(0, -1))}
                onBack={resetToStart}
              />

              <Button type="submit" disabled={submitting || pin.length !== 4} size="lg" className="mt-6 h-14 w-full rounded-2xl text-lg font-display">
                {submitting ? "Entering..." : "Enter the kingdom"}
              </Button>
            </form>
          )}

          {step.kind !== "name" && (
            <button
              type="button"
              onClick={resetToStart}
              className="mx-auto mt-5 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
            >
              &larr; Not you? Start over
            </button>
          )}

          {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-center gap-6 pt-12 text-center">
          <button
            onClick={onParentDashboard}
            className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground/70 transition-colors hover:text-primary"
          >
            <ShieldHalf className="size-3.5" />
            Parent dashboard
          </button>
        </footer>
      </div>
    </main>
  );
}
