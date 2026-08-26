// lib/creative-intelligence/guidance/types.ts
//
// Types for the Generation Guidance Layer (RP-011C.7.25). This layer's
// only job is turning SceneBlueprint[] + StoryBlueprint + CreativeContext +
// CreativeIntent into GenerationGuidance[] -- structured writing
// instructions for a future Writer Layer. It writes no prose, no dialogue,
// and makes no story-structure decisions; those already happened in
// planning/ and scenes/.
//
// This intentionally defines its own GenerationGuidance contract, distinct
// from the placeholder GenerationGuidanceBundle sketched in
// core/contracts.ts -- see that file for why.

import type { CreativeContext } from "../context/types";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";

export type GenerationGuidanceMetadata = {
  createdAt: string;
  version: string;
  builderMethod: "deterministic-template" | "model-based";
};

// Structured writing guidance for one scene. Every field is a short
// instruction or label (a phrase or one-to-two short sentences) -- never
// finished prose, a line of dialogue, or a paragraph. A future Writer Layer
// turns this into actual text; this layer only says what the scene should
// achieve and how to approach it, not what to write.
export type GenerationGuidance = {
  // Points back to the SceneBlueprint this guidance was built for.
  sceneId: string;
  // The single most important thing this scene needs to accomplish while
  // being written (e.g. "Show hesitation through decisions and behavior").
  writingFocus: string;
  // What the scene should achieve narratively, derived from the scene's
  // desiredChange -- not a plot label.
  narrativeIntent: string;
  // How to approach the scene's emotional content -- show vs. state.
  emotionalApproach: string;
  // How characters (or the listener, for non-character presets) should be
  // portrayed in this scene.
  characterGuidance: string;
  // How dialogue should be used, or whether it should be used at all.
  dialogueGuidance: string;
  // How to pace the scene, preset-appropriate.
  pacingGuidance: string;
  // How to approach descriptive/sensory detail in this scene.
  descriptionGuidance: string;
  // Explicit room for ordinary, unremarkable content -- prevents a Writer
  // Layer from overloading every scene with symbolism or significance.
  allowedElements: string[];
  // Known failure patterns to avoid, sourced from applicable knowledge
  // modules' antiPatterns (the same set already attached to the
  // SceneBlueprint this guidance was built for).
  avoidPatterns: string[];
  // Preset-level tone/voice guidance.
  styleGuidance: string;
  // Approximate word count this scene should aim for, derived from
  // CreativeIntent.durationMinutes split evenly across the scene count (see
  // duration-budget.ts). Guidance for the Writer Layer, not a hard limit --
  // undefined when the intent carries no requested duration.
  targetWordCount?: number;
  metadata: GenerationGuidanceMetadata;
};

export type BuildGenerationGuidanceParams = {
  scenes: SceneBlueprint[];
  blueprint: StoryBlueprint;
  context: CreativeContext;
  intent: CreativeIntent;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
};

// Shape any generation guidance builder implementation must satisfy.
// buildGenerationGuidance() (builder.ts) is the deterministic-template
// implementation of this for RP-011C.7.25; a future model-based builder can
// implement the same shape without changing callers.
export type GenerationGuidanceBuilder = (params: BuildGenerationGuidanceParams) => GenerationGuidance[];
