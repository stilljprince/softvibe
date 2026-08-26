// lib/creative-intelligence/planning/templates.ts
//
// Deterministic per-preset / per-scale planning defaults consumed by
// blueprint-builder.ts. These are structural labels (beats, roles, short
// phrases), not prose, dialogue, or scenes -- mirroring the pattern already
// used by intent/classifiers.ts.

import type { CreativePreset, StoryScale } from "../core/constants";

export const PROTAGONIST_ROLE_BY_PRESET: Record<CreativePreset, string> = {
  "classic-asmr": "the listener",
  "sleep-story": "a gentle traveler the listener follows",
  meditation: "the listener",
  "kids-story": "a child protagonist",
  narrative: "the protagonist",
};

// Presets whose blueprint is plot/character driven. Everything else plans
// for an emotional/sensory journey rather than external conflict.
export const PLOT_DRIVEN_PRESETS: CreativePreset[] = ["narrative", "kids-story"];

export const CORE_CONFLICT_BY_PRESET: Record<CreativePreset, string> = {
  "classic-asmr": "restlessness versus settled stillness",
  "sleep-story": "wakeful tension versus safe, restful sleep",
  meditation: "scattered attention versus grounded awareness",
  "kids-story": "a small worry versus growing confidence",
  narrative: "the protagonist's internal conflict versus external circumstance",
};

export const CENTRAL_QUESTION_END_STATE_BY_PRESET: Record<CreativePreset, string> = {
  "classic-asmr": "settled calm",
  "sleep-story": "restful sleep",
  meditation: "centered awareness",
  "kids-story": "a changed, more confident state",
  narrative: "a changed state",
};

// Rough shape/size (see core/constants.ts STORY_SCALES) mapped to a
// sequence of structural beats. Used for every preset except kids-story and
// meditation, which follow their own fixed/preset-specific progressions
// below (both are non-plot-driven experiences whose structure isn't a
// generic story arc -- see PLOT_DRIVEN_PRESETS).
export const PROGRESSION_BY_SCALE: Record<StoryScale, string[]> = {
  vignette: ["arriving", "sensory immersion", "settled stillness"],
  gentle_journey: ["settling in", "gentle movement", "deepening calm", "safe arrival"],
  arc: ["starting point", "discovery", "turning point", "resolution"],
  transformation: ["starting limitation", "attempted change", "obstacles", "new equilibrium"],
};

// The SoftVibe Kids Story preset has a fixed, age-safe beat structure
// (see project CLAUDE.md "Kids Story Preset - Core Rules") that takes
// priority over the generic scale progression above.
export const KIDS_STORY_PROGRESSION: string[] = [
  "gentle introduction",
  "safe environment",
  "light adventure",
  "small challenge",
  "emotional learning moment",
  "calm resolution",
  "soft sleepy ending",
];

// Classic ASMR is planned around sensory attention, not a narrative or a
// meditation practice (see RP-011C.8.8.3B): no goals, obstacles, turning
// points, or character arcs -- just comfort, rhythm, and gradual, gentle
// deepening of sensory attention. This preset gets its own scale-keyed
// progression (like meditation's) instead of the generic
// PROGRESSION_BY_SCALE above, whose arc/transformation entries ("turning
// point", "obstacles", "new equilibrium") are plot-shaped and wrong for
// ASMR. Longer scales get more time inside the same rhythm via
// "continued rhythmic immersion", never new stakes or escalation --
// matching calming_repetition's "soothing because it repeats" principle
// (knowledge/classic-asmr/calming-repetition.ts).
export const CLASSIC_ASMR_PROGRESSION_BY_SCALE: Record<StoryScale, string[]> = {
  vignette: ["comfort establishment", "sensory introduction", "gentle continuation"],
  gentle_journey: [
    "comfort establishment",
    "sensory introduction",
    "rhythmic immersion",
    "gentle continuation",
  ],
  arc: [
    "comfort establishment",
    "sensory introduction",
    "rhythmic immersion",
    "sensory deepening",
    "gentle continuation",
  ],
  transformation: [
    "comfort establishment",
    "sensory introduction",
    "rhythmic immersion",
    "sensory deepening",
    "continued rhythmic immersion",
    "gentle continuation",
  ],
};

// Classic ASMR + story mode (RP-011C.8.8.3K) keeps the same comfort/
// sensory shape as CLASSIC_ASMR_PROGRESSION_BY_SCALE above -- same beat
// count per scale, same "more time in the same rhythm, never new stakes"
// principle -- but each beat is reframed around a persona/scene the
// listener is guided through, so Planning can surface narrative movement
// without turning classic-asmr into a plot-driven preset (it stays out of
// PLOT_DRIVEN_PRESETS/PLOT_DRIVEN_SCALES below, so it never gets turning
// points, obstacles, or a resolution). See knowledge/classic-asmr/
// sensory-presence.ts, which explicitly excludes itself from asmrMode
// "story" for this reason.
export const CLASSIC_ASMR_STORY_PROGRESSION_BY_SCALE: Record<StoryScale, string[]> = {
  vignette: ["comfort establishment", "scene and persona introduction", "gentle scene continuation"],
  gentle_journey: [
    "comfort establishment",
    "scene and persona introduction",
    "narrative sensory movement",
    "gentle scene continuation",
  ],
  arc: [
    "comfort establishment",
    "scene and persona introduction",
    "narrative sensory movement",
    "sensory deepening within the scene",
    "gentle scene continuation",
  ],
  transformation: [
    "comfort establishment",
    "scene and persona introduction",
    "narrative sensory movement",
    "sensory deepening within the scene",
    "continued narrative sensory movement",
    "gentle scene continuation",
  ],
};

// Classic ASMR + story mode + narrative tension (RP-011C.7 targeted fix):
// selected instead of CLASSIC_ASMR_STORY_PROGRESSION_BY_SCALE above when
// intent.asmrNarrativeTension is true. Same beat count per scale and same
// "more time in the same rhythm, never new stakes" shape at longer scales --
// but each beat now names a real story movement (a clue, a complication, an
// escalation/discovery, a reveal) instead of scene/persona/sensory-only
// labels, matching scenes/templates.ts CLASSIC_ASMR_TENSION_STORY_SCENE_STEPS.
// classic-asmr still stays out of PLOT_DRIVEN_PRESETS/PLOT_DRIVEN_SCALES
// below in every mode, including this one -- no turning points, no
// StoryBible; the mystery's shape lives entirely in this fixed progression
// and the scene template, not in narrative's plot machinery.
export const CLASSIC_ASMR_TENSION_STORY_PROGRESSION_BY_SCALE: Record<StoryScale, string[]> = {
  vignette: ["scenario and mystery setup", "first clue", "reveal and quiet resolution"],
  gentle_journey: [
    "scenario and mystery setup",
    "first clue",
    "deepening complication",
    "reveal and quiet resolution",
  ],
  arc: [
    "scenario and mystery setup",
    "first clue",
    "deepening complication",
    "controlled escalation or discovery",
    "reveal and quiet resolution",
  ],
  transformation: [
    "scenario and mystery setup",
    "first clue",
    "deepening complication",
    "controlled escalation or discovery",
    "continued unfolding",
    "reveal and quiet resolution",
  ],
};

// Meditation is planned as attention/awareness/relaxation progression, not
// a story -- no conflict, no character change, no plot resolution (see
// RP-011C.8.8.2B). Scale still drives how deep the practice goes (short
// meditations stay a simple grounding progression; longer ones add
// deepening/integration phases) without hardcoding minute thresholds --
// StoryScale is the same duration-shape abstraction already used
// everywhere else in this layer (see classifyStoryScale).
export const MEDITATION_PROGRESSION_BY_SCALE: Record<StoryScale, string[]> = {
  vignette: ["arrival", "attention settling", "gentle return"],
  gentle_journey: ["arrival", "attention settling", "practice deepening", "gentle return"],
  arc: ["arrival", "attention settling", "practice deepening", "integration", "gentle return"],
  transformation: [
    "arrival",
    "attention settling",
    "practice deepening",
    "deepening awareness",
    "integration",
    "gentle return",
  ],
};

// Sleep Story is planned as an external, in-world journey the listener
// follows -- not a Narrative arc (see PLOT_DRIVEN_PRESETS/PLOT_DRIVEN_SCALES
// below, which sleep-story stays out of) and not a generic story shape:
// PROGRESSION_BY_SCALE's arc/transformation entries ("turning point",
// "obstacles", "starting limitation", "attempted change") are plot-shaped
// machinery that contradicts the Sleep Story identity doc (docs/
// sleep-story-principle-library-v1.md) and its movement_without_urgency /
// episodic_meandering_structure / comfort_baseline_and_belonging knowledge
// modules. This table only ever moves through gentle movement, sensory
// exploration, peaceful discovery, and settling -- longer scales get more
// time inside the same unhurried, decelerating rhythm (never new stakes or
// escalation), matching the "extend the rhythm, don't escalate" principle
// classic-asmr's transformation entry already encodes.
export const SLEEP_STORY_PROGRESSION_BY_SCALE: Record<StoryScale, string[]> = {
  vignette: ["settling in", "sensory exploration", "soft closure"],
  gentle_journey: ["settling in", "gentle movement", "deepening calm", "safe arrival"],
  arc: ["settling in", "gentle movement", "peaceful discovery", "gradual settling", "soft closure"],
  transformation: [
    "settling in",
    "gentle movement",
    "peaceful discovery",
    "continued gentle wandering",
    "gradual settling",
    "soft closure",
  ],
};

export const EMOTIONAL_ARC_BY_PRESET: Record<
  CreativePreset,
  { beginning: string; middle: string; end: string }
> = {
  "classic-asmr": {
    beginning: "mildly alert",
    middle: "sinking into sensory focus",
    end: "calm and settled",
  },
  "sleep-story": {
    beginning: "winding down",
    middle: "gently relaxing",
    end: "asleep or nearly asleep",
  },
  meditation: {
    beginning: "scattered",
    middle: "focusing inward",
    end: "centered and calm",
  },
  "kids-story": {
    beginning: "curious",
    middle: "briefly unsure",
    end: "reassured and sleepy",
  },
  narrative: {
    beginning: "unsettled",
    middle: "tested",
    end: "changed",
  },
};

// Only plot-driven presets at these scales surface turning points -- see
// the "trust the reader" / non-plot-focus handling in blueprint-builder.ts
// for sleep-story, meditation, and classic-asmr.
export const PLOT_DRIVEN_SCALES: StoryScale[] = ["arc", "transformation"];
