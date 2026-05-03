// lib/avatars.ts
// Predefined avatar presets for Phase 1.
// Each avatar is a filled SVG path on a 24×24 viewBox.
// To add more packs later, append entries or split into multiple arrays by pack name.

export type AvatarPreset = {
  key: string;
  label: string;
  /** One or more SVG <path d="..."> values. viewBox is always "0 0 24 24". */
  paths: string[];
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    key: "moon",
    label: "Mond",
    paths: ["M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"],
  },
  {
    key: "star",
    label: "Stern",
    paths: ["M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"],
  },
  {
    key: "droplet",
    label: "Tropfen",
    paths: ["M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"],
  },
  {
    key: "cloud",
    label: "Wolke",
    paths: ["M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"],
  },
  {
    key: "mountain",
    label: "Berg",
    paths: ["M2 20L8 8l4 6 4-6 6 12H2z"],
  },
  {
    key: "leaf",
    label: "Blatt",
    paths: ["M17 8C8 10 5.9 16.17 3.82 22c3.95-2.1 7.7-4 10.18-8.43C15 12 16.5 14 17 22c0-2.5.5-5-1-9s1-5 1-5z"],
  },
  {
    key: "flame",
    label: "Flamme",
    paths: ["M12 2C8 6.5 7 10.5 8 14c.5 2 1.5 3.5 4 3.5s3.5-1.5 4-3.5c1-3.5-.5-7.5-4-12z"],
  },
  {
    key: "diamond",
    label: "Diamant",
    paths: ["M12 2L20 12 12 22 4 12z"],
  },
  {
    key: "bolt",
    label: "Energie",
    paths: ["M11 2v7H4l9 13v-7h7z"],
  },
];

export const DEFAULT_AVATAR_KEY = "moon";

export function getAvatarPreset(key: string | null | undefined): AvatarPreset | null {
  if (!key) return null;
  return AVATAR_PRESETS.find((p) => p.key === key) ?? null;
}
