// The fixed list of avatar choices shown on Welcome.tsx's "pick your
// avatar" step and looked up by Leaderboard.tsx to render each player's
// chosen picture. Single source of truth for both, since the two used to
// duplicate this list (and drift - see git history), so `file` is
// spelled out explicitly per avatar rather than templated from `id`.
//
// `id` is what's actually saved as profiles.avatarId (free text, no
// enum - see apps/api/drizzle/0012_add_profile_avatar.sql). `file` is
// the exact filename in apps/web/public/, served by Vite at that path.
//
// 19 September 2026 - the original "royal-prince-*"/"royal-princess-*"
// images were downloaded illustrations of unknown/undocumented license
// (filenames matched stock-photo and Google-Images-download naming
// patterns) and were replaced with original hand-authored SVG portraits
// ahead of production deploy - see
// plan/Legal-and-Copyright-Production-Audit.md. The 2 Multiavatar
// portraits (open-source, commercial-use-friendly by design) were kept
// as-is.
export type Title = "Prince" | "Princess";

export type AvatarChoice = { id: string; title: Title; file: string };

export const PRINCE_AVATARS: AvatarChoice[] = [
  { id: "prince-ember", title: "Prince", file: "/royal-prince-ember.svg" },
  { id: "prince-halo", title: "Prince", file: "/royal-prince-halo.svg" },
  { id: "prince-castle", title: "Prince", file: "/royal-prince-castle.svg" },
  { id: "prince-classic", title: "Prince", file: "/royal-prince-classic.svg" },
  { id: "prince-modern", title: "Prince", file: "/royal-prince-modern.svg" },
];

export const PRINCESS_AVATARS: AvatarChoice[] = [
  { id: "princess-aranya", title: "Princess", file: "/Multiavatar-Aranya.png" },
  { id: "princess-priyank", title: "Princess", file: "/Multiavatar-priyank.png" },
  { id: "princess-bow", title: "Princess", file: "/royal-princess-bow.svg" },
  { id: "princess-aurora", title: "Princess", file: "/royal-princess-aurora.svg" },
  { id: "princess-blossom", title: "Princess", file: "/royal-princess-blossom.svg" },
];

const BY_ID = new Map<string, AvatarChoice>(
  [...PRINCE_AVATARS, ...PRINCESS_AVATARS].map((a) => [a.id, a])
);

// Looks up the picked avatar's image file by id. Returns null when
// there's no match - either avatarId is null (an older profile from
// before avatar choice existed) or, in principle, a since-retired id -
// callers fall back to the old single generic image per title.
export function avatarFile(avatarId: string | null): string | null {
  return avatarId ? (BY_ID.get(avatarId)?.file ?? null) : null;
}
