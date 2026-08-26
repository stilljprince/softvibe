// lib/creative-intelligence/planning/types.ts
//
// Types for the Story Blueprint / Narrative Planning Layer (RP-011C.7.23).
// This layer's only job is turning a CreativeIntent + CreativeContext into
// a StoryBlueprint (see core/types.ts) -- it does not define a parallel
// blueprint contract.

import type { CreativeIntent, StoryBlueprint } from "../core/types";
import type { CreativeContext } from "../context/types";

export type BuildStoryBlueprintParams = {
  intent: CreativeIntent;
  context: CreativeContext;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
};

// Shape any blueprint builder implementation must satisfy.
// buildStoryBlueprint() (blueprint-builder.ts) is the deterministic-template
// implementation of this for RP-011C.7.23; a future model-based planner can
// implement the same shape without changing callers.
export type StoryBlueprintBuilder = (params: BuildStoryBlueprintParams) => StoryBlueprint;
