// The fixed list of avatar choices shown on Welcome.tsx's "pick your
// avatar" step and looked up by Leaderboard.tsx to render each player's
// chosen picture. Single source of truth for both, since the two used to
// duplicate this list (and drift - see git history) and the images now
// come from a few different sources/formats (hand-picked Multiavatar
// character PNGs, downloaded JPEG/WEBP illustrations) rather than one
// consistent naming scheme, so `file` is spelled out explicitly per
// avatar rather than templated from `id`.
//
// `id` is what's actually saved as profiles.avatarId (free text, no
// enum - see apps/api/drizzle/0012_add_profile_avatar.sql). `file` is
// the exact filename in apps/web/public/, served by Vite at that path.
//
// How this set was chosen (visual review of everything the user dropped
// into public/, since none of it was AI-generated to spec - see
// plan/Puzzle-Kingdom-Master-Roadmap.md's avatar update history for the
// full reasoning): the first batch (12 Multiavatar-*.png character
// portraits) skewed adult/male, so only its 2 clearly girl-presenting
// images (Aranya, priyank) are kept. A second batch of downloaded
// illustrations was much more kid-appropriate and supplied the rest -
// 5 of its 7 boy-leaning images for Prince (dropping 2: one with no
// crown/royal styling at all, one redundant flat-vector duplicate), and
// its 3 girl-presenting images to round Princess out to 5.
export type Title = "Prince" | "Princess";

export type AvatarChoice = { id: string; title: Title; file: string };

export const PRINCE_AVATARS: AvatarChoice[] = [
  { id: "prince-ember", title: "Prince", file: "/royal-prince-ember.jpeg" },
  { id: "prince-halo", title: "Prince", file: "/royal-prince-halo.jpeg" },
  { id: "prince-castle", title: "Prince", file: "/royal-prince-castle.jpeg" },
  { id: "prince-classic", title: "Prince", file: "/royal-prince-classic.jpeg" },
  { id: "prince-modern", title: "Prince", file: "/royal-prince-modern.webp" },
];

export const PRINCESS_AVATARS: AvatarChoice[] = [
  { id: "princess-aranya", title: "Princess", file: "/Multiavatar-Aranya.png" },
  { id: "princess-priyank", title: "Princess", file: "/Multiavatar-priyank.png" },
  { id: "princess-bow", title: "Princess", file: "/royal-princess-bow.jpeg" },
  { id: "princess-aurora", title: "Princess", file: "/royal-princess-aurora.jpeg" },
  { id: "princess-blossom", title: "Princess", file: "/royal-princess-blossom.jpeg" },
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
