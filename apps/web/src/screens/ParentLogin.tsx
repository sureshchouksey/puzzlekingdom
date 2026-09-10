import { useState } from "react";
import { ArrowLeft, ShieldHalf } from "lucide-react";
import { adminLogin, familyLogin, familySignup } from "../api";
import type { AdminUser, FamilyOwner } from "../types";
import { Button } from "../components/ui/button";
import { StarPinDots, PinKeypad } from "../components/PinPad";

// The single "grown-up" entry point (10 September 2026 rework): Welcome.tsx
// used to have two separate footer links - "Family login" (email+password,
// FamilyAuth.tsx) and "Parent dashboard" (the shared platform-admin
// account, AdminLogin.tsx with intent="parent"). Per the user's own
// decision those are now one screen, and a family owner's credential is a
// 4-digit PIN instead of a password - same keypad weight as a child
// profile's own login, not a full password. Which path a typed identifier
// takes is decided client-side with no new lookup endpoint: an "@" means a
// family owner's email (PIN), anything else means the one platform admin
// username (password) - avoids adding an account-enumeration-prone
// "does this email exist" endpoint just to pick a UI.
type Step =
  | { kind: "identify" }
  | { kind: "familyPin"; email: string }
  | { kind: "familySignup"; email: string }
  | { kind: "adminPassword"; username: string };

export function ParentLogin({
  onBack,
  onFamilyLoggedIn,
  onAdminLoggedIn,
}: {
  onBack: () => void;
  onFamilyLoggedIn: (owner: FamilyOwner) => void;
  onAdminLoggedIn: (admin: AdminUser) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "identify" });
  const [identifier, setIdentifier] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinField, setPinField] = useState<"pin" | "confirm">("pin");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetToIdentify() {
    setStep({ kind: "identify" });
    setPin("");
    setConfirmPin("");
    setPinField("pin");
    setPassword("");
    setError(null);
  }

  function handleIdentifySubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = identifier.trim();
    if (!value) return;
    setError(null);
    if (value.includes("@")) {
      setStep({ kind: "familyPin", email: value });
    } else {
      setStep({ kind: "adminPassword", username: value });
    }
  }

  async function handleFamilyPinSubmit(email: string) {
    if (pin.length !== 4) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await familyLogin({ email, pin });
      onFamilyLoggedIn(res.owner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPin("");
      setSubmitting(false);
    }
  }

  async function handleFamilySignupSubmit(email: string) {
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
      const res = await familySignup({ email, pin, familyName: familyName.trim() || undefined });
      onFamilyLoggedIn(res.owner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
      setSubmitting(false);
    }
  }

  async function handleAdminSubmit(username: string) {
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await adminLogin({ username, password });
      onAdminLoggedIn(res.admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSubmitting(false);
    }
  }

  // Same "type into PIN, then auto-advance to Confirm" pattern as
  // Welcome.tsx's setPin step - one keypad, two 4-digit fields.
  function pressSignupDigit(d: string) {
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

  function backspaceSignupDigit() {
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
    <div className="parchment min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-6 left-6 rounded-full"
          onClick={() => (step.kind === "identify" ? onBack() : resetToIdentify())}
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </Button>

        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              <ShieldHalf className="size-5" />
            </span>
            <div>
              <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Puzzle Kingdom</p>
              <h1 className="text-2xl">
                {step.kind === "identify" && "Parent dashboard"}
                {step.kind === "familyPin" && "Enter your PIN"}
                {step.kind === "familySignup" && "Create your family"}
                {step.kind === "adminPassword" && "Admin login"}
              </h1>
            </div>
          </div>

          {step.kind === "identify" && (
            <form onSubmit={handleIdentifySubmit} className="mt-6">
              <label className="mb-2 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Email or admin username</span>
                <input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <p className="mb-4 text-xs text-muted-foreground">
                A family owner's email logs in with a PIN, like your kids do.
              </p>
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </form>
          )}

          {step.kind === "familyPin" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleFamilyPinSubmit(step.email);
              }}
              className="mt-6 text-center"
            >
              <p className="text-sm text-muted-foreground">{step.email}</p>
              <div className="mt-5">
                <StarPinDots value={pin} />
              </div>
              <PinKeypad
                onDigit={(d) => setPin((p) => (p.length < 4 ? p + d : p))}
                onBackspace={() => setPin((p) => p.slice(0, -1))}
                onBack={resetToIdentify}
              />
              <Button type="submit" disabled={submitting || pin.length !== 4} className="mt-6 w-full">
                {submitting ? "Logging in..." : "Log in"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep({ kind: "familySignup", email: step.email });
                  setPin("");
                  setConfirmPin("");
                  setPinField("pin");
                  setError(null);
                }}
                className="mx-auto mt-5 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
              >
                New family? Create an account
              </button>
            </form>
          )}

          {step.kind === "familySignup" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleFamilySignupSubmit(step.email);
              }}
              className="mt-6 text-center"
            >
              <p className="text-sm text-muted-foreground">{step.email}</p>
              <label className="mt-4 block text-left">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Family name (optional)</span>
                <input
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  placeholder="The Smith Family"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>

              <div className="mt-5">
                <p className={`mb-2 text-xs font-semibold tracking-wide uppercase ${pinField === "pin" ? "text-primary" : "text-muted-foreground"}`}>
                  Choose a 4-digit PIN
                </p>
                <StarPinDots value={pin} />
              </div>
              <div className="mt-4">
                <p className={`mb-2 text-xs font-semibold tracking-wide uppercase ${pinField === "confirm" ? "text-primary" : "text-muted-foreground"}`}>
                  Confirm
                </p>
                <StarPinDots value={confirmPin} />
              </div>

              <PinKeypad onDigit={pressSignupDigit} onBackspace={backspaceSignupDigit} onBack={resetToIdentify} />

              <Button
                type="submit"
                disabled={submitting || pin.length !== 4 || confirmPin.length !== 4}
                className="mt-6 w-full"
              >
                {submitting ? "Creating..." : "Create family"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep({ kind: "familyPin", email: step.email });
                  setPin("");
                  setConfirmPin("");
                  setPinField("pin");
                  setError(null);
                }}
                className="mx-auto mt-5 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
              >
                Already have a family account? Log in
              </button>
            </form>
          )}

          {step.kind === "adminPassword" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAdminSubmit(step.username);
              }}
              className="mt-6"
            >
              <p className="mb-4 text-sm text-muted-foreground">{step.username}</p>
              <label className="mb-6 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Logging in..." : "Log in"}
              </Button>
            </form>
          )}

          {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
