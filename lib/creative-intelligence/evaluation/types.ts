// lib/creative-intelligence/evaluation/types.ts
//
// Types for the Narrative Evaluation Layer (RP-011C.7.27). This layer's
// only job is answering "does the generated content fulfill the planned
// creative goals and quality principles?" for content the (future) Writer
// Layer already produced. It evaluates story quality, principle
// fulfillment, structural fidelity, genre fit, and typical AI writing
// problems -- it does not rewrite, repair, or generate anything.
//
// This does not replace lib/story-supervisor.ts and is not wired into the
// active generation pipeline. It also intentionally defines its own
// EvaluationInput / EvaluationResult contracts, distinct from the
// placeholder QualityEvaluationResult / QualityEvaluationLayer sketched in
// core/contracts.ts -- same reasoning as guidance/types.ts vs.
// GenerationGuidanceBundle: that sketch was a rough aggregate guess made
// before the real per-layer shape existed.
//
// Deterministic only for this pass -- no LLM/provider calls, no large text
// analysis, only simple structural/keyword checks (see evaluator.ts). The
// contract is shaped so a future LLM-backed evaluator can implement the
// same shape without changing callers.

import type { Applicability } from "../knowledge/types";
import type { CreativeContext } from "../context/types";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import type { GenerationGuidance } from "../guidance/types";
import type { GeneratedScene } from "../writer/types";

export const EVALUATION_CRITERION_IDS = [
  "premise_fulfillment",
  "story_movement",
  "character_development",
  "scene_purpose",
  "trust_the_reader",
  "ai_writing_patterns",
  "ending_quality",
  "sensory_quality",
  "sleep_atmosphere_and_safety",
  "movement_without_urgency",
  "sleep_transition_arc",
  "peaceful_non_demanding_endings",
  "companions_as_warmth",
  "guided_clarity",
  "child_perspective",
  "emotional_safety",
  "gentle_wonder",
  "warmth_and_belonging",
  "age_appropriate_imagination",
  "guidance_clarity",
  "attention_progression",
  "non_judgmental_language",
  "embodiment_and_presence",
  "pacing_quality",
  "sensory_presence",
  "gentle_rhythm",
  "safe_personal_address",
  "sensory_detail_balance",
  "calming_repetition",
  "no_forced_response",
  "narrative_tension_fulfillment",
] as const;

export type EvaluationCriterionId = (typeof EVALUATION_CRITERION_IDS)[number];

// How seriously a failed criterion should be treated when composing an
// EvaluationResult. "violation" criteria are grounded in CRITICAL-priority
// knowledge principles (story_is_change, character_wants_needs,
// premise_fulfillment) or this project's own non-negotiable Kids Story
// safety rules (CLAUDE.md); "weakness" criteria are HIGH-priority or
// preset-specific quality dimensions that matter but are not safety- or
// premise-breaking on their own.
export type EvaluationSeverity = "violation" | "weakness";

// A structured evaluation question, independent of any specific generated
// content. Defined in criteria.ts as pure data; evaluator.ts is what
// actually checks content against it.
export type EvaluationCriterionDefinition = {
  id: EvaluationCriterionId;
  name: string;
  question: string;
  description: string;
  appliesTo: Applicability;
  severity: EvaluationSeverity;
  // The knowledge module (context.knowledge.modules) this criterion is
  // grounded in, if any -- resolved from CreativeContext, never queried
  // directly from creativeKnowledgeRegistry.
  relatedKnowledgeModuleId?: string;
  // A short, structural pointer to what quality dimension needs attention
  // if this criterion fails. Never a rewrite instruction or edited text --
  // the Evaluation Layer does not produce rewrites.
  suggestion: string;
};

export type CriteriaResult = {
  criterionId: EvaluationCriterionId;
  score: number;
  passed: boolean;
  explanation: string;
};

export type OverallAssessment = "strong" | "acceptable" | "needs-work" | "weak";

export type EvaluationResultMetadata = {
  createdAt: string;
  version: string;
  evaluatorMethod: "deterministic-structural";
};

// The Evaluation Layer's output: a read-only judgment of already-generated
// content. No rewritten text, no rewrite instructions, no repair actions --
// those belong to the future Repair / Rewrite Layer this result is meant
// to feed.
export type EvaluationResult = {
  overallAssessment: OverallAssessment;
  overallScore: number;
  criteriaResults: CriteriaResult[];
  strengths: string[];
  weaknesses: string[];
  violations: string[];
  suggestions: string[];
  metadata: EvaluationResultMetadata;
};

// Input to evaluateNarrative(): everything upstream of the Evaluation Layer
// plus the content it evaluates. The evaluator never mutates any of these.
export type EvaluationInput = {
  generatedContent: GeneratedScene[];
  storyBlueprint: StoryBlueprint;
  scenes: SceneBlueprint[];
  guidance: GenerationGuidance[];
  context: CreativeContext;
  intent: CreativeIntent;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
};

// Shape any narrative evaluator implementation must satisfy.
// evaluateNarrative() (evaluator.ts) is the deterministic-structural
// implementation of this for RP-011C.7.27; a future LLM-backed evaluator
// can implement the same shape without changing callers.
export type NarrativeEvaluator = (input: EvaluationInput) => EvaluationResult;
