// lib/creative-intelligence/core/contracts.ts
//
// Module boundary interfaces for the Creative Intelligence Architecture
// layers described in RP-011C.7.14:
//
//   User Input
//     -> Creative Understanding Layer
//     -> Creative Knowledge Layer
//     -> Experience Planning Layer
//     -> Generation Guidance Layer
//     -> Creative Editing Layer
//     -> Quality Evaluation Layer
//     -> Final Output
//
// These are contracts only — no implementations exist yet, and nothing
// here is called by the active generation pipeline.

import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "./types";
import type { NarrativePrinciple } from "../knowledge/types";

// Unprocessed input from the user-facing prompt/generate flow, before it
// has been interpreted into a CreativeIntent.
export type RawCreativeInput = {
  prompt: string;
  presetHint?: string;
};

// Instructions handed to a (future) generation step: the concrete shape a
// draft should take, informed by the blueprint and applicable principles.
//
// This was a rough aggregate sketch only -- the real, per-scene contract is
// now implemented as `GenerationGuidance` in `guidance/types.ts`
// (RP-011C.7.25). Renamed to `GenerationGuidanceBundle` to avoid colliding
// with that name; nothing implements this interface yet.
export type GenerationGuidanceBundle = {
  blueprint: StoryBlueprint;
  scenes: SceneBlueprint[];
  guidingPrinciples: NarrativePrinciple[];
};

export type QualityEvaluationResult = {
  passed: boolean;
  notes: string[];
};

export interface CreativeUnderstandingLayer {
  understand(input: RawCreativeInput): Promise<CreativeIntent>;
}

export interface CreativeKnowledgeLayer {
  gatherApplicablePrinciples(intent: CreativeIntent): Promise<NarrativePrinciple[]>;
}

export interface ExperiencePlanningLayer {
  planBlueprint(
    intent: CreativeIntent,
    principles: NarrativePrinciple[]
  ): Promise<StoryBlueprint>;
}

export interface GenerationGuidanceLayer {
  buildGuidance(blueprint: StoryBlueprint): Promise<GenerationGuidanceBundle>;
}

export interface CreativeEditingLayer {
  edit(draft: string, guidance: GenerationGuidanceBundle): Promise<string>;
}

export interface QualityEvaluationLayer {
  evaluate(output: string, intent: CreativeIntent): Promise<QualityEvaluationResult>;
}
