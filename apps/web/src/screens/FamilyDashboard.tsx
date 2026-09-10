import { useEffect, useState } from "react";
import { LogOut, Plus, Users } from "lucide-react";
import { addFamilyProfile, bootstrapChildPin, getFamilyProfiles, logout, verifyProfilePin } from "../api";
import type { FamilyOwner, Profile } from "../types";
import type { Title } from "../avatars";
import { avatarFile } from "../avatars";
import { Button } from "../components/ui/button";
import { AvatarPicker } from "../components/AvatarPicker";
import { StarPinDots, PinKeypad } from "../components/PinPad";

// Track 7: what a logged-in family owner sees - only their own kids
// (GET /families/me/profiles, never another family's), a way to add
// another child, and a way to enter one child's own PIN to actually play
// as them (the same per-profile session as Welcome.tsx's private flow -
// a family owner logging in doesn't bypass a child's own PIN, it just
// narrows which names are ever shown).
type Step =
  | { kind: "list" }
  | { kind: "addChildInfo" }
  | { kind: "addChildAvatar"; nickname: string; yearGroup: string }
  // Brand-new child, hasPin always false - reuses the existing
  // setProfilePin bootstrap, same as Welcome.tsx's newTitle -> setPin step.
  | { kind: "addChildPin"; profile: Profile }
  | { kind: "enterPin"; profile: Profile };

export function FamilyDashboard({
  owner,
  onLogOut,
  onEnter,
}: {
  owner: FamilyOwner;
  onLogOut: () => void;
  // Same signature as Welcome.tsx's onEnter - hands off into the normal
  // Home/quiz flow once a child's own PIN is verified.
  onEnter: (profile: Profile) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [nickname, setNickname] = useState("");
  const [yearGroup, setYearGroup] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinField, setPinField] = useState<"pin" | "confirm">("pin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshProfiles() {
    getFamilyProfiles()
      .then(setProfiles)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your children"));
  }

  function resetForm() {
    setStep({ kind: "list" });
    setNickname("");
    setYearGroup("");
    setPin("");
    setConfirmPin("");
    setPinField("pin");
    setError(null);
  }

  async function handleAddChildPin(profile: Profile) {
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
      // bootstrapChildPin, not setProfilePin - the family owner's own
      // token must stay active (see that function's own comment).
      await bootstrapChildPin(profile.id, { pin });
      refreshProfiles();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set PIN");
      setSubmitting(false);
    }
  }

  async function handleEnterPin(profile: Profile) {
    if (pin.length !== 4) {
      setError("PIN must be 4 digits");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { profile: entered } = await verifyProfilePin(profile.id, pin);
      onEnter(entered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect PIN");
      setPin("");
      setSubmitting(false);
    }
  }

  async function handleCreateProfile(title: Title, avatarId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const created = await addFamilyProfile({ nickname, yearGroup: yearGroup.trim() || undefined, title, avatarId });
      setStep({ kind: "addChildPin", profile: created });
      setPin("");
      setConfirmPin("");
      setPinField("pin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add child");
    } finally {
      setSubmitting(false);
    }
  }

  // Shared by both PIN steps - addChildPin needs two 4-digit fields
  // (PIN + Confirm) sharing one keypad, same auto-advance pattern as
  // Welcome.tsx's pressSetPinDigit; enterPin just needs one.
  function pressPinDigit(d: string, isSetPin: boolean) {
    if (isSetPin) {
      if (pinField === "pin") {
        if (pin.length < 4) {
          const next = pin + d;
          setPin(next);
          if (next.length === 4) setPinField("confirm");
        }
      } else if (confirmPin.length < 4) {
        setConfirmPin(confirmPin + d);
      }
    } else {
      setPin((p) => (p.length < 4 ? p + d : p));
    }
  }

  function backspacePin(isSetPin: boolean) {
    if (isSetPin) {
      if (pinField === "confirm") {
        if (confirmPin.length > 0) setConfirmPin(confirmPin.slice(0, -1));
        else setPinField("pin");
      } else {
        setPin(pin.slice(0, -1));
      }
    } else {
      setPin((p) => p.slice(0, -1));
    }
  }

  return (
    <div className="parchment min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              <Users className="size-5" />
            </span>
            <div>
              <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">Puzzle Kingdom</p>
              <h1 className="text-2xl">Your family</h1>
              <p className="text-sm text-muted-foreground">{owner.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              logout();
              onLogOut();
            }}
            className="gap-2"
          >
            <LogOut className="size-4" />
            Log out
          </Button>
        </header>

        {error && step.kind === "list" && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}

        {step.kind === "list" && (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {profiles === null && <p className="text-sm text-muted-foreground">Loading...</p>}
            {profiles?.map((p) => {
              const file = avatarFile(p.avatarId);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setStep({ kind: "enterPin", profile: p });
                    setPin("");
                    setError(null);
                  }}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60"
                >
                  {file ? (
                    <img src={file} alt="" className="size-14 shrink-0 rounded-full border-2 border-border object-cover" />
                  ) : (
                    <span className="grid size-14 shrink-0 place-items-center rounded-full bg-secondary text-lg font-semibold text-primary">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[p.title, p.yearGroup].filter(Boolean).join(" · ") || "Tap to play"}
                    </p>
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setStep({ kind: "addChildInfo" });
                setNickname("");
                setYearGroup("");
                setError(null);
              }}
              className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
            >
              <Plus className="size-4" />
              Add a child
            </button>
          </div>
        )}

        {step.kind === "addChildInfo" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Add a child</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use a nickname, not their real name - keeps things private.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!nickname.trim()) return;
                setStep({ kind: "addChildAvatar", nickname: nickname.trim(), yearGroup: yearGroup.trim() });
              }}
              className="mt-6 text-left"
            >
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Nickname</span>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <label className="mb-6 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">Year group (optional)</span>
                <input
                  value={yearGroup}
                  onChange={(e) => setYearGroup(e.target.value)}
                  placeholder="Year 3"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <Button type="submit" className="w-full" disabled={!nickname.trim()}>
                Continue
              </Button>
            </form>
            <button
              type="button"
              onClick={resetForm}
              className="mx-auto mt-5 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
            >
              &larr; Back
            </button>
          </div>
        )}

        {step.kind === "addChildAvatar" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Hi {step.nickname}! Pick an avatar.</h2>
            <div className="mt-6">
              <AvatarPicker onPick={(title, avatarId) => handleCreateProfile(title, avatarId)} />
            </div>
            {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
            <button
              type="button"
              onClick={resetForm}
              className="mx-auto mt-5 block text-sm font-medium text-muted-foreground/80 transition-colors hover:text-primary"
            >
              &larr; Back
            </button>
          </div>
        )}

        {step.kind === "addChildPin" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Choose a 4-digit PIN for {step.profile.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">They'll use it every time they play.</p>
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
            <PinKeypad onDigit={(d) => pressPinDigit(d, true)} onBackspace={() => backspacePin(true)} onBack={resetForm} />
            <Button
              onClick={() => handleAddChildPin(step.profile)}
              disabled={submitting || pin.length !== 4 || confirmPin.length !== 4}
              size="lg"
              className="mt-6 h-14 w-full rounded-2xl text-lg"
            >
              {submitting ? "Saving..." : "Save PIN"}
            </Button>
            {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
          </div>
        )}

        {step.kind === "enterPin" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Enter {step.profile.name}'s PIN</h2>
            <div className="mt-6">
              <StarPinDots value={pin} />
            </div>
            <PinKeypad onDigit={(d) => pressPinDigit(d, false)} onBackspace={() => backspacePin(false)} onBack={resetForm} />
            <Button
              onClick={() => handleEnterPin(step.profile)}
              disabled={submitting || pin.length !== 4}
              size="lg"
              className="mt-6 h-14 w-full rounded-2xl text-lg"
            >
              {submitting ? "Entering..." : "Play"}
            </Button>
            {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
