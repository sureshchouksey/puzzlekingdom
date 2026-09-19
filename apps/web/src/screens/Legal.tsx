import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { PrivacyPolicyContent, TermsOfServiceContent } from "../components/LegalContent";

// Privacy Policy + Terms of Service, reachable from Welcome.tsx's footer
// (post-passcode) and mirrored standalone inside Gate.tsx (pre-passcode -
// see Gate.tsx's own "legalTab" state) so both are readable before a
// visitor ever enters any data. Added 19 September 2026 as part of the
// pre-production legal audit - see
// plan/Legal-and-Copyright-Production-Audit.md.
export function Legal({ initialTab = "privacy", onBack }: { initialTab?: "privacy" | "terms"; onBack: () => void }) {
  const [tab, setTab] = useState<"privacy" | "terms">(initialTab);

  return (
    <main className="night-sky relative min-h-screen overflow-hidden pb-16">
      <div className="starfield animate-twinkle pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onBack} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
          <h1 className="text-gold-shimmer text-2xl sm:text-3xl">Privacy &amp; Terms</h1>
          <span className="size-9" />
        </header>

        <div className="mx-auto mt-8 flex gap-2 rounded-full border border-border/70 bg-card/60 p-1">
          <button
            type="button"
            onClick={() => setTab("privacy")}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === "privacy" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => setTab("terms")}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === "terms" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Terms of Service
          </button>
        </div>

        <section className="mx-auto mt-8 w-full rounded-3xl border border-border/70 bg-card/85 p-6 backdrop-blur shadow-quest sm:p-8">
          {tab === "privacy" ? <PrivacyPolicyContent /> : <TermsOfServiceContent />}
        </section>
      </div>
    </main>
  );
}
