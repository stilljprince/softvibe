import soundbedsRaw from "@/lib/audio/manifest/soundbeds.json";
import sfxRaw from "@/lib/audio/manifest/sfx.json";

export type Intensity = "soft" | "medium" | "strong";

export type SoundbedItem = {
  id: string;
  label: string;
  file: string;        // public URL path
  loop: true;
  tags: string[];
  intensity: Intensity;
  lufs?: number;
  license?: string;
  source?: string;
};

export type SfxItem = {
  id: string;
  label: string;
  file: string;        // public URL path
  loop: false;
  tags: string[];
  gainDb?: number;
  license?: string;
  source?: string;
};

export const SOUND_BEDS = soundbedsRaw as SoundbedItem[];
export const SFX = sfxRaw as SfxItem[];

export function getSoundbedById(id: string) {
  return SOUND_BEDS.find((x) => x.id === id) ?? null;
}