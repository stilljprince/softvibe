// scripts/narrative-benchmark/cases/kids-story.ts
//
// RP-011C.8.8.1D — Benchmark cases for the Kids Story preset: age-safe,
// gently paced stories with a soft sleepy ending. Metadata only. No
// generation happens here.

import type { BenchmarkCase } from "../runners/types";

export const kidsStoryCases: BenchmarkCase[] = [
  {
    id: "kids-story-cozy-friendship",
    category: "kids-story",
    prompt:
      "Two young otters share one cozy blanket and a bowl of berries as rain patters on their den, quietly enjoying each other's company until it's time to sleep.",
    preset: "kids-story",
    durationMinutes: 8,
    expectedQualities: [
      "warmth between the two friends",
      "told from the child/young-animal's perspective",
      "simple language and short paragraphs",
      "soft, sleepy ending",
    ],
  },
  {
    id: "kids-story-small-adventure",
    category: "kids-story",
    prompt:
      "A curious little fox follows a trail of glowing mushrooms just past her garden fence and discovers a tiny, friendly clearing she's never seen before.",
    preset: "kids-story",
    durationMinutes: 10,
    expectedQualities: [
      "genuine curiosity driving the adventure",
      "gentle sense of discovery, not danger",
      "wonder that stays light and safe throughout",
      "calm resolution back at home",
    ],
  },
  {
    id: "kids-story-emotional-growth",
    category: "kids-story",
    prompt:
      "A young bear cub feels left out when his friends build a fort without him, and learns that saying how he feels helps them make room for him.",
    preset: "kids-story",
    durationMinutes: 9,
    expectedQualities: [
      "small stakes that still feel big to a child",
      "emotional safety — no shame or scolding",
      "gentle emotional learning moment",
      "positive resolution and calm ending",
    ],
  },
  {
    id: "kids-story-everyday-magic",
    category: "kids-story",
    prompt:
      "A little girl discovers that the old teapot on her windowsill hums a soft tune whenever the stars come out, turning her ordinary bedtime routine into something a little magical.",
    preset: "kids-story",
    durationMinutes: 8,
    expectedQualities: [
      "imagination woven into an everyday setting",
      "gentle sense of wonder rather than excitement",
      "soothing, atmospheric description",
      "ends in stillness suitable for sleep",
    ],
  },
  {
    id: "kids-story-belonging",
    category: "kids-story",
    prompt:
      "A shy new puppy at the forest school isn't sure where he fits in, until the other animals save him a spot at story time and he realizes he already belongs.",
    preset: "kids-story",
    durationMinutes: 9,
    expectedQualities: [
      "friendship extended to someone new",
      "acceptance without a test or trial to earn it",
      "emotional resolution that feels warm and settled",
      "calm, positive ending",
    ],
  },
];
