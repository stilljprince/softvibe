// lib/creative-intelligence/core/types.ts
//
// Foundation data contracts for the Creative Intelligence Architecture.
// These are planning/description models, not generation output. Nothing in
// this file is wired into the active generation pipeline.

import type {
  ClassicAsmrMode,
  CreativeAudience,
  CreativePerspective,
  CreativePreset,
  MeditationExperienceType,
  StoryScale,
} from "./constants";

// Free-form provenance about how a CreativeIntent was produced (which
// extractor, deterministic vs. model-based). Optional and ignored by
// consumers that don't need it -- see intent/extractor.ts.
export type CreativeIntentMetadata = {
  extractorVersion?: string;
  method?: "deterministic-heuristic" | "model-based";
  [key: string]: unknown;
};

// What the user wants to create, distilled from raw input. This is the
// output of the (future) Creative Understanding Layer and the input to
// every layer after it.
export type CreativeIntent = {
  preset: CreativePreset;
  genre?: string;
  // Short description of the experience the listener should come away
  // with, e.g. "a gentle bedtime wind-down" or "a slow-burn mystery".
  experience: string;
  audience: CreativeAudience;
  // Target duration in minutes.
  durationMinutes?: number;
  // Hard constraints the output must respect (explicit user instructions,
  // safety requirements, etc). These are never optimized away.
  constraints: string[];
  tone?: string;
  // Rough shape/size of the experience -- see STORY_SCALES in constants.ts.
  storyScale?: StoryScale;
  // Secondary intent axis for preset === "classic-asmr" only -- see
  // CLASSIC_ASMR_MODES in constants.ts. Unset for all other presets.
  asmrMode?: ClassicAsmrMode;
  // Secondary intent axis for preset === "meditation" only -- see
  // MEDITATION_EXPERIENCE_TYPES in constants.ts. Unset for all other
  // presets. Always set to a definite value (defaulting to
  // "breath_presence") once preset === "meditation", the same pattern
  // classifyAsmrMode uses for asmrMode.
  meditationExperienceType?: MeditationExperienceType;
  // Grammatical person the user explicitly asked for (first/second/third).
  // Preset-independent -- see CREATIVE_PERSPECTIVES in constants.ts.
  // Unset when the user expressed no explicit preference, in which case
  // each preset's usual address style applies.
  perspective?: CreativePerspective;
  // Thematic content present in the request (e.g. "independence", "growth").
  themes?: string[];
  // The emotional register the experience should land in, ordered by
  // prominence (e.g. ["calm", "safe"]).
  emotionalDirection?: string[];
  // What the experience centers on, derived from storyScale (e.g.
  // "personal_change", "sensory_atmosphere"). Not a plot beat.
  narrativeFocus?: string;
  // Structural elements a future Planning layer should account for (e.g.
  // "progression", "safe_resolution"). Not scenes, not prose.
  requiredElements?: string[];
  // Verbatim preservation of the user's explicit creative request when the
  // deterministic preset/theme/mode fields above would otherwise lose it
  // (e.g. a specific roleplay scenario, persona, or activity). Generic and
  // preset-independent -- this is a preservation mechanism, not a parsed
  // scenario/persona model. Downstream layers (e.g. the Writer Layer)
  // should surface it as-is and treat it as something to respect, not
  // reinterpret.
  creativeDirection?: string;
  // Lightweight signal, sleep-story only: true when the user supplied a
  // creativeDirection that should take priority over Sleep Story's generic
  // traveler/companion/arrival defaults (see intent/classifiers.ts
  // classifyHasExplicitScenario). This does not parse or understand the
  // scenario -- it only tells Planning/Scenes/Guidance/Writer whether to
  // let creativeDirection define focus, environment, and characters
  // instead of forcing the generic defaults. Unset for every other preset.
  hasExplicitScenario?: boolean;
  // Secondary intent axis, asmrMode === "story" only (RP-011C.7 targeted
  // fix): true when the user explicitly asked for real narrative tension
  // (mystery/thriller/suspense/investigation) inside the ASMR story, as
  // opposed to an ordinary companion/roleplay/reading scenario. Selects a
  // distinct scene/planning/guidance template that allows a genuine clue,
  // complication, escalation, and reveal -- CLASSIC_ASMR_STORY_SCENE_STEPS's
  // no-complication shape stays the default for every other classic-asmr
  // story request. Unset for every other preset/mode.
  asmrNarrativeTension?: boolean;
  // Preset-independent (RP-011C.7 targeted fix): true when the user
  // explicitly makes the LISTENER themselves the first-person experiencer
  // of the scene ("from my perspective", "I am the one discovering..."),
  // as distinct from a generic first-person writing-style instruction. Only
  // classic-asmr's guidance currently acts on this (its story-mode
  // characterGuidance is the only place a separate narrator persona
  // addressing the listener as "you" would otherwise contradict it) --
  // every other preset either has no such persona/listener split or
  // already lets intent.perspective apply without needing this
  // disambiguation. Unset when the user made no such explicit role claim.
  listenerIsExperiencer?: boolean;
  // RP-011C.7D.1 production cutover: the output language the Writer Layer
  // must write in. Not derived from the prompt -- passed through verbatim
  // from CreativePipelineRequest.language (see orchestration/pipeline.ts),
  // the same production-caller-supplied value the legacy buildScriptOpenAI()
  // path already receives. Unset when the caller does not specify one.
  language?: "de" | "en";
  // RP-011C.7D.1 production cutover: the pre-built, pre-sanitized secondary
  // style-guidance block from lib/preferences.ts buildPreferenceContextBlock()
  // -- passed through verbatim from CreativePipelineRequest.preferenceContext,
  // the same block the legacy buildScriptOpenAI() path already appends to its
  // system prompt. Never overrides the user's explicit request. Unset when
  // the caller has no preference profile to pass.
  preferenceContext?: string;
  metadata?: CreativeIntentMetadata;
};

export type TurningPoint = {
  description: string;
  // What changes for the protagonist or the situation at this point.
  consequence: string;
};

// What the experience promises and the tension that makes it worth
// experiencing. For non-plot presets (sleep-story, meditation, classic-asmr)
// "conflict" is read as tension to be resolved (e.g. restlessness vs. calm),
// not antagonism.
export type StoryPremise = {
  centralQuestion: string;
  coreConflict: string;
  storyPromise: string;
};

// Foundation for who/what the experience centers on. Fields are deliberately
// structural (what the builder plans for), not character prose.
export type ProtagonistFoundation = {
  role: string;
  initialState: string;
  desire: string;
  need: string;
  internalConflict: string;
  externalGoal: string;
};

// The shape of change across the experience: where it starts, the labeled
// beats it moves through, and where it ends. `progression` and
// `turningPoints` are structural labels, not scenes or prose.
export type StoryTrajectory = {
  startingPoint: string;
  progression: string[];
  turningPoints: TurningPoint[];
  endingState: string;
};

export type EmotionalArc = {
  beginning: string;
  middle: string;
  end: string;
};

// Guardrails for the (future) Scene Planning / Generation Guidance layers:
// beats the plan requires, and known failure patterns to avoid.
export type StructureGuidance = {
  requiredMovements: string[];
  avoidPatterns: string[];
};

export type StoryBlueprintMetadata = {
  createdAt: string;
  version: string;
  builderMethod: "deterministic-template" | "model-based";
};

// A planned creative structure. NOT a generated story — this describes how
// an experience should be *designed* (shape, change, tension, ending
// direction) so a future Scene Planning / Generation Guidance layer can
// produce scenes/text consistent with it. Carries the CreativeIntent it was
// built from so downstream consumers don't need to re-thread it separately.
export type StoryBlueprint = {
  intent: CreativeIntent;
  premise: StoryPremise;
  protagonist: ProtagonistFoundation;
  trajectory: StoryTrajectory;
  themes: string[];
  emotionalArc: EmotionalArc;
  structureGuidance: StructureGuidance;
  metadata: StoryBlueprintMetadata;
};

export type SceneBlueprintMetadata = {
  createdAt: string;
  version: string;
  plannerMethod: "deterministic-template" | "model-based";
};

// A planned scene, subordinate to a StoryBlueprint. Structural guidance for
// a future Writer Layer only -- no prose, no dialogue, no finished scene
// text. Built by the Scene Planning Layer (lib/creative-intelligence/scenes/,
// RP-011C.7.24).
export type SceneBlueprint = {
  id: string;
  // 1-based position in the scene sequence.
  order: number;
  // The narrative task this scene performs, in plain language (e.g. "Show
  // protagonist's current isolation and routine") -- not a scene-number
  // label like "the hook" or "the midpoint".
  purpose: string;
  // The structural role this scene plays (e.g. "Establish starting
  // condition", "Show first attempt"). A description of the job, not a
  // fixed slot in a beat sheet.
  narrativeFunction: string;
  // Which StoryTrajectory.progression beat or turning point this scene
  // realizes -- a pointer back into the blueprint, not a new label.
  relatedStoryProgression: string;
  charactersInvolved: string[];
  emotionalState: string;
  conflict: string;
  // What the audience/protagonist understands or feels differently after
  // this scene.
  desiredChange: string;
  settingGuidance: string;
  requiredElements: string[];
  avoidPatterns: string[];
  metadata: SceneBlueprintMetadata;
};
