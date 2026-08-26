// lib/creative-intelligence/scenes/planner.ts
//
// Scene Planning Layer (RP-011C.7.24). Turns a CreativeIntent +
// CreativeContext + StoryBlueprint into SceneBlueprint[]: which scenes an
// experience needs so the blueprint is fulfilled, and what narrative task
// each one performs. It writes no prose, no dialogue, no finished scene
// text -- that belongs to a future Writer Layer.
//
// Deterministic only -- no LLM calls. This layer does not query
// CreativeKnowledgeRegistry directly: it only reads the antiPatterns of
// modules the Context Builder already resolved as applicable, the same
// way planning/blueprint-builder.ts reads structureGuidance.avoidPatterns.

import type { CreativeContext } from "../context/types";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import {
  buildNarrativeSceneSteps,
  CLASSIC_ASMR_SCENE_STEPS,
  CLASSIC_ASMR_STORY_SCENE_STEPS,
  CLASSIC_ASMR_TENSION_STORY_SCENE_STEPS,
  KIDS_STORY_SCENE_STEPS,
  MEDITATION_SCENE_STEPS,
  MEDITATION_SCENE_STEPS_BY_TYPE,
  SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS,
  SLEEP_STORY_SCENE_STEPS,
} from "./templates";
import type { SceneStepDefinition } from "./templates";
import type { BuildSceneBlueprintsParams, SceneBlueprintsPlanner } from "./types";

export const SCENE_PLANNER_VERSION = "1.0.0";

function resolveSceneSteps(intent: CreativeIntent, blueprint: StoryBlueprint): SceneStepDefinition[] {
  switch (intent.preset) {
    case "narrative":
      return buildNarrativeSceneSteps(blueprint);
    case "kids-story":
      return KIDS_STORY_SCENE_STEPS;
    case "sleep-story":
      return intent.hasExplicitScenario ? SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS : SLEEP_STORY_SCENE_STEPS;
    case "meditation":
      return (intent.meditationExperienceType && MEDITATION_SCENE_STEPS_BY_TYPE[intent.meditationExperienceType]) ||
        MEDITATION_SCENE_STEPS;
    case "classic-asmr":
      if (intent.asmrMode !== "story") return CLASSIC_ASMR_SCENE_STEPS;
      return intent.asmrNarrativeTension ? CLASSIC_ASMR_TENSION_STORY_SCENE_STEPS : CLASSIC_ASMR_STORY_SCENE_STEPS;
  }
}

// Anti-patterns come from whatever knowledge modules the Context Builder
// already resolved as applicable (global principles like
// avoid_ai_writing_patterns / scene_has_purpose / story_is_change /
// trust_the_reader, plus preset-scoped ones like premise_fulfillment) --
// this layer never queries the registry itself.
function resolveAvoidPatterns(context: CreativeContext): string[] {
  return Array.from(new Set(context.knowledge.modules.flatMap((module) => module.antiPatterns ?? [])));
}

// Every scene carries the beat it realizes plus any hard constraints from
// the intent (e.g. kids-story's age-safety requirements), so a scene can be
// checked in isolation without re-threading the whole blueprint.
function resolveRequiredElements(intent: CreativeIntent, relatedStoryProgression: string): string[] {
  return Array.from(new Set([relatedStoryProgression, ...(intent.requiredElements ?? [])]));
}

export const buildSceneBlueprints: SceneBlueprintsPlanner = (params: BuildSceneBlueprintsParams) => {
  const { intent, blueprint, context, createdAt } = params;
  const steps = resolveSceneSteps(intent, blueprint);
  const avoidPatterns = resolveAvoidPatterns(context);
  const timestamp = createdAt ?? new Date().toISOString();

  return steps.map((step, index): SceneBlueprint => {
    const relatedStoryProgression = step.relatedStoryProgression(blueprint);
    return {
      id: `scene-${index + 1}`,
      order: index + 1,
      purpose: step.purpose(blueprint),
      narrativeFunction: step.narrativeFunction,
      relatedStoryProgression,
      charactersInvolved: [blueprint.protagonist.role],
      emotionalState: step.emotionalState(blueprint),
      conflict: step.conflict(blueprint),
      desiredChange: step.desiredChange(blueprint),
      settingGuidance: step.settingGuidance(blueprint),
      requiredElements: resolveRequiredElements(intent, relatedStoryProgression),
      avoidPatterns,
      metadata: {
        createdAt: timestamp,
        version: SCENE_PLANNER_VERSION,
        plannerMethod: "deterministic-template",
      },
    };
  });
};
