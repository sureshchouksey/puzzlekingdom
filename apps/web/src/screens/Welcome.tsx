import { useState } from "react";
import { Crown, Delete, Rocket, Shield, ShieldHalf, Swords, Users, Wand2 } from "lucide-react";
import { lookupProfile, setProfilePin, verifyProfilePin } from "../api";
import type { Profile, ProfileLookupResponse } from "../types";
import { Button } from "../components/ui/button";

type Title = "Prince" | "Princess";

const JEWELS = ["gold", "sapphire", "ruby", "emerald", "amethyst"] as const;
type Jewel = (typeof JEWELS)[number];
const JEWEL_TEXT: Record<Jewel, string> = {
  gold: "text-primary",
  sapphire: "text-sapphire",
  ruby: "text-ruby",
  emerald: "text-emerald",
  amethyst: "text-amethyst",
};

type AvatarOption = { id: string; title: Title; icon: typeof Crown; jewel: Jewel };

// 5 avatars per title (10 total) - the same icon/color set under each
// heading, so choosing is about which one looks fun rather than a
// gendered symbol. `id` (e.g. "prince-3") is what actually gets saved;
// see profiles.avatarId on the backend.
const AVATAR_ICONS = [Crown, Shield, Swords, Rocket, Wand2] as const;
function buildAvatars(title: Title): AvatarOption[] {
  return AVATAR_ICONS.map((icon, i) => ({ id: `${title.toLowerCase()}-${i + 1}`, title, icon, jewel: JEWELS[i] }));
}
const PRINCE_AVATARS = buildAvatars("Prince");
const PRINCESS_AVATARS = buildAvatars("Princess");

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

// The Lovable reference's 4-star PIN display + numeric keypad
// (pixel-perfect-replica/src/routes/index.tsx), generalized to drive an
// arbitrary 4-digit field via onChange rather than one hardcoded piece of
// state - setPin needs two of these (PIN + Confirm) sharing one keypad.
function StarPinDots({ value }: { value: string }) {
  return (
    <div className="flex justify-center gap-3">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`size-12 rounded-2xl border-2 text-2xl leading-[2.6rem] font-bold ${
            value.length > i
              ? "border-primary bg-primary/15 text-primary"
              : "border-border bg-secondary/60"
          }`}
        >
          {value.length > i ? "★" : ""}
        </span>
      ))}
    </div>
  );
}

function PinKeypad({ onDigit, onBackspace, onBack }: { onDigit: (d: string) => void; onBackspace: () => void; onBack: () => void }) {
  return (
    <div className="mt-7 grid grid-cols-3 gap-3">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <Button key={d} type="button" variant="secondary" size="lg" className="h-14 text-xl" onClick={() => onDigit(d)}>
          {d}
        </Button>
      ))}
      <Button type="button" variant="ghost" size="lg" className="h-14" onClick={onBack}>
        Back
      </Button>
      <Button type="button" variant="secondary" size="lg" className="h-14 text-xl" onClick={() => onDigit("0")}>
        0
      </Button>
      <Button type="button" variant="ghost" size="lg" className="h-14" onClick={onBackspace}>
        <Delete className="size-5" />
      </Button>
    </div>
  );
}

// Entering the kingdom: type your own name (no list of everyone else's to
// click through), then either set a 4-digit PIN (a brand-new name, or an
// older profile from before PINs existed) or enter your existing one -
// this is what makes a profile a real per-child login, not just a typed
// name.
export function Welcome({
  onEnter,
  onAdminLogin,
  onParentDashboard,
}: {
  onEnter: (profile: Profile) => void;
  onAdminLogin: () => void;
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
              <div className="mt-6 space-y-6 text-left">
                {(
                  [
                    { title: "Prince" as const, avatars: PRINCE_AVATARS },
                    { title: "Princess" as const, avatars: PRINCESS_AVATARS },
                  ]
                ).map((group) => (
                  <div key={group.title}>
                    <p className="mb-3 text-center text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                      {group.title}
                    </p>
                    <div className="grid grid-cols-5 gap-2">
                      {group.avatars.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setStep({ kind: "setPin", looked: step.looked, title: a.title, avatarId: a.id })}
                          aria-label={`${a.title} avatar ${a.id.split("-")[1]}`}
                          className="group flex items-center justify-center rounded-2xl p-1 transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span
                            className={`grid size-12 place-items-center rounded-full border-2 border-border bg-secondary shadow-inner transition-colors group-hover:border-primary/60 sm:size-14 ${JEWEL_TEXT[a.jewel]}`}
                          >
                            <a.icon className="size-6" />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
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
            <Users className="size-3.5" />
            Parent dashboard
          </button>
          <button
            onClick={onAdminLogin}
            className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground/70 transition-colors hover:text-primary"
          >
            <ShieldHalf className="size-3.5" />
            Admin login
          </button>
        </footer>
      </div>
    </main>
  );
}
