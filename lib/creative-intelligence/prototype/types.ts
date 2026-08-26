// lib/creative-intelligence/prototype/types.ts
//
// Types for the Creative Intelligence End-to-End Prototype Layer
// (RP-011C.7.28). This is an isolated architecture-validation coordinator
// that connects the seven already-implemented Creative Intelligence stages
// (Intent -> Context -> Blueprint -> Scenes -> Guidance -> Writer ->
// Evaluation) into one executable path. It defines no new planning,
// writing, or evaluation logic of its own -- only the input/output shape
// of the coordinator that orchestrates the existing layers.
//
// Not wired into the active generation pipeline.

import type { CreativeKnowledgeRegistry } from "../knowledge/registry";
import type { CreativePreset } from "../core/constants";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import type { CreativeContext } from "../context/types";
import type { GenerationGuidance } from "../guidance/types";
import type { GeneratedScene } from "../writer/types";
import type { EvaluationResult } from "../evaluation/types";

// Unprocessed input to the prototype, before it is threaded through the
// existing extractCreativeIntent() -> RawCreativeInput contract
// (core/contracts.ts). `preset` maps onto that contract's `presetHint`;
// `durationMinutes` is not produced by extractCreativeIntent() today, so
// the coordinator folds it onto the extracted CreativeIntent (a data
// pass-through, not a new classification rule).
export type CreativeIntelligencePrototypeInput = {
  prompt: string;
  preset?: CreativePreset;
  durationMinutes?: number;
};

export type RunCreativeIntelligencePrototypeOptions = {
  // Defaults to a fresh, isolated registry initialized with
  // initializeCreativeKnowledge() so repeated prototype runs never collide
  // with each other or with the shared creativeKnowledgeRegistry instance.
  registry?: CreativeKnowledgeRegistry;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
};

export type CreativeIntelligencePrototypeMetadata = {
  createdAt: string;
  version: string;
};

// The complete, isolated prototype result: every intermediate artifact the
// seven stages produced, in the order they were produced.
export type CreativeIntelligencePrototypeResult = {
  input: CreativeIntelligencePrototypeInput;
  intent: CreativeIntent;
  context: CreativeContext;
  storyBlueprint: StoryBlueprint;
  scenes: SceneBlueprint[];
  guidance: GenerationGuidance[];
  generatedOutput: GeneratedScene[];
  evaluation: EvaluationResult;
  metadata: CreativeIntelligencePrototypeMetadata;
};
