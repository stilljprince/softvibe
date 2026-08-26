// lib/creative-intelligence/orchestration/types.ts
//
// Types for the Creative Intelligence Orchestration Layer (RP-011C.8.4,
// extended in RP-011C.8.6 with writer mode selection). This is the first
// production-oriented coordinator for the Creative Intelligence stages
// (Intent -> Context -> Blueprint -> Scenes -> Guidance -> Writer ->
// Evaluation). It defines no new planning, writing, or evaluation logic of
// its own -- only the input/output shape of the pipeline that orchestrates
// the existing layers.
//
// Not wired into the active generation pipeline.

import type { CreativeKnowledgeRegistry } from "../knowledge/registry";
import type { CreativePreset } from "../core/constants";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import type { CreativeContext } from "../context/types";
import type { GenerationGuidance } from "../guidance/types";
import type { GeneratedScene } from "../writer/types";
import type { CreativeTextProvider } from "../writer/provider";
import type { EvaluationResult } from "../evaluation/types";

// "mock" runs the existing deterministic writer (writeStory()); "provider"
// runs the provider-backed writer (writeStoryWithProvider()) via
// writer-adapter.ts. Selection only -- no writing behavior lives here.
export type WriterMode = "mock" | "provider";

// Unprocessed input to the pipeline, before it is threaded through the
// existing extractCreativeIntent() -> RawCreativeInput contract
// (core/contracts.ts). `preset` maps onto that contract's `presetHint`;
// `durationMinutes` is not produced by extractCreativeIntent() today, so
// the pipeline folds it onto the extracted CreativeIntent (a data
// pass-through, not a new classification rule) -- same approach as
// prototype/coordinator.ts.
export type CreativePipelineRequest = {
  prompt: string;
  preset?: CreativePreset;
  durationMinutes?: number;
  // RP-011C.7D.1 production cutover: folded onto the extracted CreativeIntent
  // exactly like durationMinutes above (extractCreativeIntent() does not
  // produce either field) -- see applyRequestExtras() in pipeline.ts.
  language?: "de" | "en";
  preferenceContext?: string;
};

export type RunCreativePipelineOptions = {
  // Defaults to a fresh, isolated registry initialized with
  // initializeCreativeKnowledge() so repeated pipeline runs never collide
  // with each other or with the shared creativeKnowledgeRegistry instance.
  registry?: CreativeKnowledgeRegistry;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
  // Selects the Writer stage's implementation. Defaults to "mock" so every
  // existing caller/test keeps its current deterministic behavior --
  // provider mode is strictly opt-in.
  writerMode?: WriterMode;
  // Only consulted when writerMode is "provider". Overridable so tests can
  // inject a mocked CreativeTextProvider instead of the real
  // OpenAI-backed one writer-adapter.ts otherwise constructs via
  // writer/factory.ts.
  provider?: CreativeTextProvider;
};

export type CreativePipelineResultMetadata = {
  createdAt: string;
  version: string;
};

// The complete, structured pipeline result: every intermediate artifact
// each stage produced, in the order it was produced.
export type CreativePipelineResult = {
  request: CreativePipelineRequest;
  intent: CreativeIntent;
  context: CreativeContext;
  storyBlueprint: StoryBlueprint;
  scenes: SceneBlueprint[];
  guidance: GenerationGuidance[];
  generatedScenes: GeneratedScene[];
  evaluation: EvaluationResult;
  metadata: CreativePipelineResultMetadata;
};
