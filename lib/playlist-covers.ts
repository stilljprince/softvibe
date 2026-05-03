// lib/playlist-covers.ts
// Predefined playlist cover presets for Phase 1.
// Each cover is a pure-CSS gradient — no external images required.
// To add more packs later, append entries or split by category.

export type PlaylistCover = {
  key: string;
  label: string;
  /** CSS gradient string used directly as `background` */
  gradient: string;
  /** Derived accent color — use for borders, rings, and soft tints in related UI */
  accent: string;
};

export const PLAYLIST_COVERS: PlaylistCover[] = [
  { key: "night",    label: "Nacht",      gradient: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",              accent: "#818cf8" },
  { key: "cosmos",   label: "Kosmos",     gradient: "linear-gradient(135deg, #020617 0%, #312e81 100%)",              accent: "#6366f1" },
  { key: "ocean",    label: "Ozean",      gradient: "linear-gradient(135deg, #0c4a6e 0%, #0284c7 100%)",              accent: "#38bdf8" },
  { key: "forest",   label: "Wald",       gradient: "linear-gradient(135deg, #052e16 0%, #15803d 100%)",              accent: "#4ade80" },
  { key: "lavender", label: "Lavendel",   gradient: "linear-gradient(135deg, #3b0764 0%, #7c3aed 100%)",              accent: "#c084fc" },
  { key: "dusk",     label: "Dämmerung",  gradient: "linear-gradient(135deg, #3b0764 0%, #9d174d 50%, #c2410c 100%)", accent: "#f472b6" },
  { key: "ember",    label: "Glut",       gradient: "linear-gradient(135deg, #450a0a 0%, #b91c1c 60%, #d97706 100%)", accent: "#fb923c" },
  { key: "mist",     label: "Nebel",      gradient: "linear-gradient(135deg, #0f172a 0%, #334155 100%)",              accent: "#94a3b8" },
  { key: "rain",     label: "Regen",      gradient: "linear-gradient(135deg, #172554 0%, #1d4ed8 100%)",              accent: "#60a5fa" },
  { key: "rose",     label: "Rose",       gradient: "linear-gradient(135deg, #4c0519 0%, #be123c 60%, #9f1239 100%)", accent: "#fb7185" },
  { key: "sand",     label: "Sand",       gradient: "linear-gradient(135deg, #451a03 0%, #b45309 60%, #ca8a04 100%)", accent: "#fbbf24" },
  { key: "stone",    label: "Stein",      gradient: "linear-gradient(135deg, #1c1917 0%, #44403c 100%)",              accent: "#a8a29e" },
];

export function getPlaylistCover(key: string | null | undefined): PlaylistCover | null {
  if (!key) return null;
  return PLAYLIST_COVERS.find((c) => c.key === key) ?? null;
}
