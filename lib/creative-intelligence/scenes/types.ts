// lib/creative-intelligence/scenes/types.ts
//
// Types for the Scene Planning Layer (RP-011C.7.24). This layer's only job
// is turning a CreativeIntent + CreativeContext + StoryBlueprint into
// SceneBlueprint[] (see core/types.ts) -- it does not define a parallel
// scene contract, and it does not produce prose, dialogue, or finished
// scene text. That belongs to a future Writer Layer.

import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import type { CreativeContext } from "../context/types";

export type BuildSceneBlueprintsParams = {
  blueprint: StoryBlueprint;
  context: CreativeContext;
  intent: CreativeIntent;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
};

// Shape any scene planner implementation must satisfy.
// buildSceneBlueprints() (planner.ts) is the deterministic-template
// implementation of this for RP-011C.7.24; a future model-based planner can
// implement the same shape without changing callers.
export type SceneBlueprintsPlanner = (params: BuildSceneBlueprintsParams) => SceneBlueprint[];
