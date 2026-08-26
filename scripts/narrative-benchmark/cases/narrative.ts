// scripts/narrative-benchmark/cases/narrative.ts
//
// RP-011C.8.7.2 — Calibrated benchmark cases for the first Narrative
// Intelligence quality comparison (old pipeline vs. Creative Intelligence).
// All cases target the "narrative" preset specifically, since that is the
// preset both pipelines under comparison are being evaluated against.
// Metadata only. No generation happens here.

import type { BenchmarkCase } from "../runners/types";

export const narrativeCases: BenchmarkCase[] = [
  {
    id: "narrative-transformation-life-change",
    category: "transformation",
    prompt:
      "A burnt-out nurse who has spent years caring for everyone else finally lets a quiet weekend alone teach her how to care for herself, and returns home lighter.",
    preset: "narrative",
    durationMinutes: 25,
    expectedQualities: [
      "clear internal before/after arc",
      "gradual, non-abrupt emotional shift",
      "grounded, sensory scene-setting",
      "ends in quiet acceptance rather than a dramatic revelation",
    ],
  },
  {
    id: "narrative-thriller-heist",
    category: "thriller",
    prompt:
      "A retired safecracker is talked into one last job at a quiet countryside museum, and discovers the real prize was proving to herself she could walk away clean.",
    preset: "narrative",
    durationMinutes: 30,
    expectedQualities: [
      "heist mechanics conveyed through careful, unhurried planning rather than danger",
      "tension built through pacing and detail, not violence or threat",
      "no weapons, harm, or law-enforcement confrontation",
      "calm, safe resolution with no lingering suspense",
    ],
  },
  {
    id: "narrative-fantasy-awakening",
    category: "fantasy",
    prompt:
      "A young apprentice in a sleepy mountain village discovers a dormant gift for calming storms, and learns to trust it during one gentle night of practice.",
    preset: "narrative",
    durationMinutes: 20,
    expectedQualities: [
      "wonder and discovery framed as gentle, not urgent",
      "magic introduced through calm demonstration rather than conflict",
      "supportive mentor presence",
      "soft, settled ending that favors rest over triumph",
    ],
  },
  {
    id: "narrative-mystery-disappearance",
    category: "mystery",
    prompt:
      "A lighthouse keeper's assistant vanishes for a single night, and the keeper's search through the quiet coastal town reveals a harmless, heartwarming reason why.",
    preset: "narrative",
    durationMinutes: 25,
    expectedQualities: [
      "mystery framing without danger, crime, or dread",
      "steady, curious pacing rather than alarm",
      "warm, reassuring reveal",
      "resolution that restores calm rather than shock",
    ],
  },
  {
    id: "narrative-family-reconciliation",
    category: "family",
    prompt:
      "Two estranged siblings spend one evening cleaning out their late mother's house, and a box of old letters slowly brings them back together.",
    preset: "narrative",
    durationMinutes: 20,
    expectedQualities: [
      "emotional repair paced slowly across the evening",
      "grief handled gently, without dwelling on loss itself",
      "naturalistic, low-key narration",
      "warm, connected ending rather than unresolved tension",
    ],
  },
];
