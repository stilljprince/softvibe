// lib/creative-intelligence/context/types.ts
//
// Data contract for the Creative Context Builder (RP-011C.7.21). A
// CreativeContext is the prepared intelligence handed from Creative Intent
// + Knowledge retrieval to future planning/generation/evaluation layers.
// It is a data shape only — nothing here produces prose or calls a
// provider.

import type { CreativePreset, UsageStage } from "../core/constants";
import type { CreativeIntent } from "../core/types";
import type { KnowledgeModule, NarrativePrinciple } from "../knowledge/types";

// The original, unprocessed request alongside the resolved preset it will
// be built against. `preset` is authoritative (it comes from the already
// -extracted CreativeIntent), while `prompt` preserves the user's raw text.
export type CreativeContextInput = {
  prompt: string;
  preset: CreativePreset;
  durationSeconds?: number;
};

export type CreativeContextKnowledge = {
  // Every KnowledgeModule applicable to this intent's preset, across all
  // usage stages, deduplicated and ordered CRITICAL -> HIGH -> MEDIUM ->
  // LOW (registry order, id as tiebreak).
  modules: KnowledgeModule[];
  // The same modules projected into the fine-grained NarrativePrinciple
  // shape (see core/contracts.ts) for consumers that want individual
  // statements rather than whole modules.
  principles: NarrativePrinciple[];
  // Usage stages that have at least one applicable module for this intent.
  stages: UsageStage[];
};

// Knowledge statements grouped by the pipeline stage they guide. Sourced
// from applicable modules' `knowledge` statements for that stage.
export type CreativeContextGuidance = {
  planning: string[];
  generation: string[];
  evaluation: string[];
};

export type CreativeContextMetadata = {
  createdAt: string;
  version: string;
};

export type CreativeContext = {
  input: CreativeContextInput;
  intent: CreativeIntent;
  knowledge: CreativeContextKnowledge;
  guidance: CreativeContextGuidance;
  metadata: CreativeContextMetadata;
};
