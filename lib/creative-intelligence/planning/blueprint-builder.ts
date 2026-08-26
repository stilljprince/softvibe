// lib/creative-intelligence/planning/blueprint-builder.ts
//
// Story Blueprint / Narrative Planning Layer (RP-011C.7.23). Turns an
// already-extracted CreativeIntent + CreativeContext into a StoryBlueprint:
// a structured description of how an experience should be *designed*, not
// how any scene should be *written*. That belongs to future Scene Planning
// / Generation Guidance layers.
//
// Deterministic only -- no LLM calls, no prose, no scenes/dialogue. This
// layer does not query CreativeKnowledgeRegistry directly: knowledge
// retrieval stays owned by context/builder.ts, and this module only reads
// the already-resolved CreativeContext it's given.

import type { StoryScale } from "../core/constants";
import type {
  CreativeIntent,
  EmotionalArc,
  ProtagonistFoundation,
  StoryBlueprint,
  StoryPremise,
  StoryTrajectory,
  StructureGuidance,
  TurningPoint,
} from "../core/types";
import type { CreativeContext } from "../context/types";
import {
  CENTRAL_QUESTION_END_STATE_BY_PRESET,
  CLASSIC_ASMR_PROGRESSION_BY_SCALE,
  CLASSIC_ASMR_STORY_PROGRESSION_BY_SCALE,
  CLASSIC_ASMR_TENSION_STORY_PROGRESSION_BY_SCALE,
  CORE_CONFLICT_BY_PRESET,
  EMOTIONAL_ARC_BY_PRESET,
  KIDS_STORY_PROGRESSION,
  MEDITATION_PROGRESSION_BY_SCALE,
  PLOT_DRIVEN_PRESETS,
  PLOT_DRIVEN_SCALES,
  PROGRESSION_BY_SCALE,
  PROTAGONIST_ROLE_BY_PRESET,
  SLEEP_STORY_PROGRESSION_BY_SCALE,
} from "./templates";
import type { BuildStoryBlueprintParams, StoryBlueprintBuilder } from "./types";

export const BLUEPRINT_BUILDER_VERSION = "1.0.0";

function isPlotDriven(preset: CreativeIntent["preset"]): boolean {
  return PLOT_DRIVEN_PRESETS.includes(preset);
}

function resolveProgression(intent: CreativeIntent): string[] {
  if (intent.preset === "kids-story") return KIDS_STORY_PROGRESSION;
  const scale: StoryScale = intent.storyScale ?? "gentle_journey";
  if (intent.preset === "sleep-story") return SLEEP_STORY_PROGRESSION_BY_SCALE[scale];
  if (intent.preset === "meditation") return MEDITATION_PROGRESSION_BY_SCALE[scale];
  if (intent.preset === "classic-asmr") {
    if (intent.asmrMode !== "story") return CLASSIC_ASMR_PROGRESSION_BY_SCALE[scale];
    return intent.asmrNarrativeTension
      ? CLASSIC_ASMR_TENSION_STORY_PROGRESSION_BY_SCALE[scale]
      : CLASSIC_ASMR_STORY_PROGRESSION_BY_SCALE[scale];
  }
  return PROGRESSION_BY_SCALE[scale];
}

// Kids Story turning points use the same gentle, relationship-driven
// vocabulary as its scene templates -- discovery and connection, never
// "resistance" or a "limitation" that "can no longer hold" (that reads as
// dramatic escalation, which the preset must avoid; see
// knowledge/kids-story/gentle-wonder.ts and small-stakes-big-feelings.ts).
function resolveKidsStoryTurningPoints(scale: StoryScale): TurningPoint[] {
  const points: TurningPoint[] = [
    {
      description: "a new discovery or friend changes what feels possible",
      consequence: "the protagonist tries a small, gentle new approach",
    },
  ];
  if (scale === "transformation") {
    points.push({
      description: "working through the challenge together brings understanding",
      consequence: "the protagonist feels more confident and connected than before",
    });
  }
  return points;
}

// Turning points describe *that* something changes and *what it means*,
// never the scene it happens in -- only plot-driven presets at arc/
// transformation scale get them at all (Trust The Reader: don't force
// plot machinery onto sensory/comfort experiences that don't need it).
function resolveTurningPoints(intent: CreativeIntent): TurningPoint[] {
  const scale: StoryScale = intent.storyScale ?? "gentle_journey";
  if (!isPlotDriven(intent.preset) || !PLOT_DRIVEN_SCALES.includes(scale)) return [];

  if (intent.preset === "kids-story") return resolveKidsStoryTurningPoints(scale);

  const points: TurningPoint[] = [
    {
      description: "the starting limitation can no longer hold as-is",
      consequence: "the protagonist must respond differently than before",
    },
  ];
  if (scale === "transformation") {
    points.push({
      description: "the attempted change meets real resistance",
      consequence: "the protagonist's circumstances or understanding shift for good",
    });
  }
  return points;
}

// RP-011C.8.10V: this used to always read PROTAGONIST_ROLE_BY_PRESET
// directly, so a sleep-story request with an explicit scenario (a train
// conductor, a lighthouse keeper) still got a centralQuestion asking "Can a
// gentle traveler the listener follows move from the starting state to
// restful sleep?" -- reaching the Writer prompt's STORY DESIGN section and
// contradicting the "do not invent a generic traveler" instructions
// elsewhere in the same prompt. Mirrors resolveSleepStoryProtagonist's
// neutral pointer for the same case, below.
function resolvePremiseRole(intent: CreativeIntent): string {
  if (intent.preset === "sleep-story" && intent.hasExplicitScenario) {
    return "the story's own central figure or focus, exactly as the user's creative direction describes it";
  }
  return PROTAGONIST_ROLE_BY_PRESET[intent.preset];
}

function resolvePremise(intent: CreativeIntent): StoryPremise {
  const role = resolvePremiseRole(intent);
  const endState = CENTRAL_QUESTION_END_STATE_BY_PRESET[intent.preset];
  return {
    centralQuestion: `Can ${role} move from the starting state to ${endState}?`,
    coreConflict: CORE_CONFLICT_BY_PRESET[intent.preset],
    // The user-facing promise the blueprint must not undersell (Premise
    // Fulfillment: resolution scale must match this promise).
    storyPromise: intent.experience,
  };
}

// Kids Story is plot-driven but is not a smaller adult narrative: its
// protagonist foundation is relationship- and discovery-driven (curiosity,
// friendship, gentle challenge, understanding) rather than the
// internal-conflict-versus-external-circumstance framing used for
// narrative. See planning direction in knowledge/kids-story/*.
function resolveKidsStoryProtagonist(role: string): ProtagonistFoundation {
  return {
    role,
    initialState: "curious about the world, safe and supported",
    desire: "to explore, discover, and connect with a friend",
    need: "warmth, belonging, and reassurance, not a win",
    internalConflict: "curiosity meeting a small, gentle worry",
    externalGoal: "share a small discovery with a friend and feel understood",
  };
}

// Sleep Story's protagonist foundation is an in-world figure the listener
// follows through a peaceful place, not the listener's own internal
// arousal/attention state (that's meditation's and classic-asmr's model --
// resolveMeditationProtagonist / resolveClassicAsmrProtagonist below). The
// Sleep Story identity doc (docs/sleep-story-principle-library-v1.md) is
// explicit that attention rests on an external world and its inhabitants,
// not on the self: "the listener is a witness/companion to the story, not
// its subject." desire/need/externalGoal describe this in-world figure
// settling into the story's place, never the listener's own restlessness
// or an internal shift -- matching companions_as_warmth/rest_worthy_setting,
// which both assume an in-world figure to be accompanied and welcomed.
// When the user supplied an explicit creativeDirection (intent.
// hasExplicitScenario -- RP-011C.8.10P), the fixed "traveler" role and
// "companions" need are dropped: the user's own request may center a
// different kind of focus (a place, an object, an activity) or no
// character at all, and forcing this shape onto it is exactly the
// unconditional default docs/sleep-story-default-bias-calibration-review.md
// flagged. The role becomes a neutral pointer to that request instead of a
// fixed identity, letting the Writer (which sees creativeDirection verbatim
// with priority -- writer/prompts.ts) decide who or what the focus is.
//
// RP-011C.8.10R1: the pointer text used to read "...a character, place, or
// atmosphere" -- enumerating "a character" as one of several options turned
// out to still read as an invitation to invent one (e.g. a generic "the
// traveler") even when the user's own request already named a concrete
// figure (a train conductor, a lighthouse keeper) or named none at all (a
// valley walk). Dropping that enumeration in favor of "exactly as the
// user's creative direction describes it" keeps this a plain pointer, not a
// menu of fallback shapes -- still no parsing of who or what the figure is,
// that stays the Writer's job (reinforced directly in writer/prompts.ts).
function resolveSleepStoryProtagonist(role: string, intent: CreativeIntent): ProtagonistFoundation {
  if (intent.hasExplicitScenario) {
    return {
      role: "the story's own central figure or focus, exactly as the user's creative direction describes it",
      initialState: "already present within the world the user described, unhurried and open to what it holds",
      desire: "to move through that world at its own gentle, unhurried pace",
      need: "a peaceful world to rest inside, with nothing to solve",
      internalConflict: "quiet alertness easing, at its own pace, into the comfort of the scene",
      externalGoal: "settle into the story's own rhythm until sleep comes naturally",
    };
  }
  return {
    role,
    initialState: "arriving in a peaceful place, unhurried and open to what it holds",
    desire: "to wander gently through the place and rest inside its comfort",
    need: "a warm, welcoming world and companions, with nothing to solve",
    internalConflict: "quiet alertness easing, at its own pace, into the comfort of the place",
    externalGoal: "settle into the place's rhythm until sleep comes naturally",
  };
}

// Meditation's protagonist foundation is an attention/awareness practice,
// not a sleep/comfort wind-down (that's sleep-story/classic-asmr) and not a
// story goal: desire and need describe the desired inner state and the
// purpose of the practice, never an external outcome. "need" avoids
// judgment of a wandering mind, matching the non_judgmental_language
// knowledge module (RP-011C.8.8.2A).
function resolveMeditationProtagonist(role: string, intent: CreativeIntent): ProtagonistFoundation {
  const settleTarget = intent.emotionalDirection?.[0] ?? "calm, centered awareness";
  return {
    role,
    initialState: "attention scattered outward, not yet settled in the present moment",
    desire: `to settle into ${settleTarget}`,
    need: "space to notice attention wander and return gently, without judgment",
    internalConflict: "scattered attention meeting the intention to stay present",
    externalGoal: "complete the practice with quieter, more settled attention",
  };
}

// Classic ASMR's protagonist foundation is a sensory-attention experience,
// not sleep-story's wind-down-toward-rest framing (that shares this file's
// generic non-plot branch below) and not meditation's awareness practice:
// desire/need/internalConflict describe settling into sensory attention
// itself, never a wind-down goal, a practice, or a character arc --
// matching no_forced_response (no promised outcome) and sensory_presence
// (attention anchored in the immediate moment) from
// knowledge/classic-asmr/*.
function resolveClassicAsmrProtagonist(role: string): ProtagonistFoundation {
  return {
    role,
    initialState: "mildly alert, attention not yet settled on any one sensory detail",
    desire: "to rest attention gently on the voice, its rhythm, and closeness",
    need: "an unhurried invitation to notice, with no particular response expected",
    internalConflict: "outward alertness settling into close sensory attention",
    externalGoal: "stay comfortably present with the sensory detail for as long as feels good",
  };
}

// Classic ASMR + story mode (RP-011C.8.8.3K) adds role/persona framing --
// the listener is guided through a gentle in-scene persona and setting --
// without turning into a narrative preset: there is still no external goal
// beyond staying present, matching no_forced_response (no promised outcome)
// and the voice-first/no-external-trigger identity that applies to both
// asmrModes (see knowledge/classic-asmr/voice-first-identity.ts).
function resolveClassicAsmrStoryProtagonist(role: string): ProtagonistFoundation {
  return {
    role: `${role}, guided through a gentle in-scene persona and setting`,
    initialState: "mildly alert, attention not yet settled into the scene or its persona",
    desire: "to be guided gently through the scene, staying anchored in sensory closeness",
    need: "an unhurried scene that moves without ever demanding a reaction",
    internalConflict: "outward alertness settling into the sensory world the scene offers",
    externalGoal: "stay comfortably present with the unfolding scene for as long as feels good",
  };
}

// Classic ASMR + story mode + narrative tension (RP-011C.7 targeted fix):
// desire/internalConflict/externalGoal now describe genuinely following a
// mystery through to its reveal, not just staying present within a scene --
// the no_forced_response identity still applies (no promised physical/
// emotional outcome like tingles or guaranteed relaxation), but reaching the
// mystery's reveal is a real, planned destination the way it never was for
// resolveClassicAsmrStoryProtagonist above.
function resolveClassicAsmrTensionStoryProtagonist(role: string): ProtagonistFoundation {
  return {
    role: `${role}, guided through a mystery unfolding via a gentle in-scene persona and setting`,
    initialState: "curious but uncertain, drawn in by the first hint of something unresolved",
    desire: "to follow the mystery through to its reveal, while staying anchored in sensory closeness",
    need: "a controlled, voice-first unfolding of the mystery that never rushes, startles, or shouts",
    internalConflict: "curiosity about the unfolding mystery meeting the wish to stay calm and unhurried",
    externalGoal: "reach the mystery's reveal and settle into quiet resolution, staying comfortably present throughout",
  };
}

function resolveProtagonist(intent: CreativeIntent): ProtagonistFoundation {
  const role = PROTAGONIST_ROLE_BY_PRESET[intent.preset];
  if (intent.preset === "kids-story") return resolveKidsStoryProtagonist(role);
  if (intent.preset === "sleep-story") return resolveSleepStoryProtagonist(role, intent);
  if (intent.preset === "meditation") return resolveMeditationProtagonist(role, intent);
  if (intent.preset === "classic-asmr") {
    if (intent.asmrMode !== "story") return resolveClassicAsmrProtagonist(role);
    return intent.asmrNarrativeTension
      ? resolveClassicAsmrTensionStoryProtagonist(role)
      : resolveClassicAsmrStoryProtagonist(role);
  }

  const plotDriven = isPlotDriven(intent.preset);
  const themesLabel = intent.themes && intent.themes.length > 0 ? intent.themes.join(", ") : "the request's core experience";
  const settleTarget = intent.emotionalDirection?.[0] ?? "calm";

  return {
    role,
    initialState: plotDriven
      ? `held back by the story's starting limitation, in relation to ${themesLabel}`
      : "arriving with unresolved tension the experience will ease",
    desire: plotDriven ? `to move through ${themesLabel}` : `to settle into ${settleTarget}`,
    need: plotDriven ? "an internal shift, not just an external win" : "permission to slow down",
    internalConflict: plotDriven
      ? "wanting the change while resisting what it requires"
      : "restlessness competing with the wish to rest",
    externalGoal: plotDriven ? "reach the story's ending state" : "complete the experience calmly",
  };
}

function resolveTrajectory(intent: CreativeIntent, progression: string[]): StoryTrajectory {
  return {
    startingPoint: progression[0],
    progression,
    turningPoints: resolveTurningPoints(intent),
    endingState: progression[progression.length - 1],
  };
}

function resolveEmotionalArc(intent: CreativeIntent): EmotionalArc {
  return EMOTIONAL_ARC_BY_PRESET[intent.preset];
}

// requiredMovements come from the already-classified intent + the resolved
// progression; avoidPatterns come from the antiPatterns of whatever
// knowledge modules the Context Builder already resolved as applicable --
// this layer never queries the registry itself.
function resolveStructureGuidance(
  intent: CreativeIntent,
  context: CreativeContext,
  progression: string[]
): StructureGuidance {
  const requiredMovements = Array.from(new Set([...(intent.requiredElements ?? []), ...progression]));
  const avoidPatterns = Array.from(
    new Set(context.knowledge.modules.flatMap((module) => module.antiPatterns ?? []))
  );
  return { requiredMovements, avoidPatterns };
}

export const buildStoryBlueprint: StoryBlueprintBuilder = (params: BuildStoryBlueprintParams) => {
  const { intent, context, createdAt } = params;
  const progression = resolveProgression(intent);

  const blueprint: StoryBlueprint = {
    intent,
    premise: resolvePremise(intent),
    protagonist: resolveProtagonist(intent),
    trajectory: resolveTrajectory(intent, progression),
    themes: intent.themes ?? [],
    emotionalArc: resolveEmotionalArc(intent),
    structureGuidance: resolveStructureGuidance(intent, context, progression),
    metadata: {
      createdAt: createdAt ?? new Date().toISOString(),
      version: BLUEPRINT_BUILDER_VERSION,
      builderMethod: "deterministic-template",
    },
  };

  return blueprint;
};
