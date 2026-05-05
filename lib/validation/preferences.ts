// lib/validation/preferences.ts
import { z } from "zod";

export const PRIMARY_GOALS = [
  "sleep",
  "stress_relief",
  "focus",
  "relaxation",
  "comfort",
  "other",
] as const;

export const PREFERRED_TONES = ["very_soft", "calm", "neutral", "immersive"] as const;
export const PACING_VALUES = ["very_slow", "slow", "medium"] as const;
export const VOICE_PREFERENCES = ["female", "male", "no_preference"] as const;
export const DIRECT_ADDRESS_PREFERENCES = ["yes", "no", "subtle"] as const;
export const PREFERRED_FORMATS = [
  "sleep-story",
  "meditation",
  "classic-asmr",
  "kids-story",
] as const;

const STRING_LIST_MAX = 16;
const FREE_TEXT_MAX = 1000;
const TAG_MAX = 60;

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable().optional();

const cleanedStringList = z
  .array(z.string().trim().min(1).max(TAG_MAX))
  .max(STRING_LIST_MAX)
  .optional();

const optionalFreeText = z
  .string()
  .trim()
  .max(FREE_TEXT_MAX)
  .nullable()
  .optional()
  .transform((v) => (v === "" ? null : v));

export const PreferencesUpsertSchema = z.object({
  primaryGoal: optionalEnum(PRIMARY_GOALS),
  preferredTone: optionalEnum(PREFERRED_TONES),
  pacing: optionalEnum(PACING_VALUES),
  preferredFormats: z.array(z.enum(PREFERRED_FORMATS)).max(8).optional(),
  likedThemes: cleanedStringList,
  dislikedThemes: cleanedStringList,
  voicePreference: optionalEnum(VOICE_PREFERENCES),
  directAddressPreference: optionalEnum(DIRECT_ADDRESS_PREFERENCES),
  contentBoundaries: cleanedStringList,
  emotionalContext: optionalFreeText,
  desiredOutcome: optionalFreeText,
});

export type PreferencesUpsertInput = z.infer<typeof PreferencesUpsertSchema>;

export const OnboardingSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  // Optional structured fields the client already mapped. Server may also
  // re-derive these from `answers` if missing.
  derived: PreferencesUpsertSchema.optional(),
});

export type OnboardingInput = z.infer<typeof OnboardingSchema>;
