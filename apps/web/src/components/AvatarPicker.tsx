import { PRINCE_AVATARS, PRINCESS_AVATARS, type Title } from "../avatars";

// Extracted from Welcome.tsx's "newTitle" step (10 September 2026) so
// FamilyDashboard.tsx's "add a child" flow can reuse the identical
// prince/princess avatar grid instead of a second copy. Pure extraction -
// Welcome.tsx's own rendering is unchanged, just now calls this.
export function AvatarPicker({ onPick }: { onPick: (title: Title, avatarId: string) => void }) {
  return (
    <div className="space-y-6 text-left">
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
                onClick={() => onPick(a.title, a.id)}
                aria-label={`${a.title} avatar ${a.id}`}
                className="group flex items-center justify-center rounded-2xl p-1 transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <img
                  src={a.file}
                  alt=""
                  className="size-12 rounded-full border-2 border-border bg-secondary object-cover shadow-inner transition-colors group-hover:border-primary/60 sm:size-14"
                />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
