import { Delete } from "lucide-react";
import { Button } from "./ui/button";

// Extracted from Welcome.tsx (10 September 2026) so FamilyDashboard.tsx's
// "pick a child, enter their PIN" step can reuse the exact same 4-star
// dots + numeric keypad instead of a second copy drifting out of sync.
// Welcome.tsx itself was updated to import from here rather than define
// these locally - behavior is unchanged, this is a pure extraction.
export function StarPinDots({ value }: { value: string }) {
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

export function PinKeypad({ onDigit, onBackspace, onBack }: { onDigit: (d: string) => void; onBackspace: () => void; onBack: () => void }) {
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
