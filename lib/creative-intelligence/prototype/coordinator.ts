// lib/creative-intelligence/prototype/coordinator.ts
//
// Creative Intelligence End-to-End Prototype Layer (RP-011C.7.28). Connects
// the seven already-implemented Creative Intelligence stages into one
// executable, isolated prototype path:
//
//   RawCreativeInput
//     -> extractCreativeIntent()      (intent/)
//     -> buildCreativeContext()       (context/)
//     -> buildStoryBlueprint()        (planning/)
//     -> buildSceneBlueprints()       (scenes/)
//     -> buildGenerationGuidance()    (guidance/)
//     -> writeStory()                 (writer/)
//     -> evaluateNarrative()          (evaluation/)
//
// This coordinator creates no new principles, planning logic, writing
// rules, or evaluation criteria -- it only orchestrates the existing layers
// and carries their outputs forward unchanged. It is not called from the
// active generation pipeline (app/api/jobs/*, app/generate/*,
// lib/script-builder*, lib/narrative/*, lib/story-supervisor.ts,
// lib/tts/*), and makes no OpenAI/ElevenLabs/database calls.

import { CreativeKnowledgeRegistry } from "../knowledge/registry";
import { initializeCreativeKnowledge } from "../knowledge/init";
import { extractCreativeIntent } from "../intent";
import { buildCreativeContext } from "../context";
import { buildStoryBlueprint } from "../planning";
import { buildSceneBlueprints } from "../scenes";
import { buildGenerationGuidance } from "../guidance";
import { writeStory } from "../writer";
import { evaluateNarrative } from "../evaluation";
import type { RawCreativeInput } from "../core/contracts";
import type { CreativeIntent } from "../core/types";
import type {
  CreativeIntelligencePrototypeInput,
  CreativeIntelligencePrototypeResult,
  RunCreativeIntelligencePrototypeOptions,
} from "./types";

export const PROTOTYPE_COORDINATOR_VERSION = "1.0.0";

function resolveRegistry(registry?: CreativeKnowledgeRegistry): CreativeKnowledgeRegistry {
  if (registry) return registry;
  const isolated = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(isolated);
  return isolated;
}

// extractCreativeIntent() does not populate CreativeIntent.durationMinutes
// (it only reads the prompt/presetHint) -- this carries the prototype
// input's explicit duration onto the extracted intent without touching the
// extractor itself, and without mutating the extractor's return value.
function applyRequestedDuration(intent: CreativeIntent, durationMinutes?: number): CreativeIntent {
  if (durationMinutes === undefined) return intent;
  return { ...intent, durationMinutes };
}

export function runCreativeIntelligencePrototype(
  input: CreativeIntelligencePrototypeInput,
  options: RunCreativeIntelligencePrototypeOptions = {}
): CreativeIntelligencePrototypeResult {
  const { registry, createdAt } = options;
  const resolvedRegistry = resolveRegistry(registry);

  const rawInput: RawCreativeInput = { prompt: input.prompt, presetHint: input.preset };

  const extractedIntent = extractCreativeIntent(rawInput);
  const intent = applyRequestedDuration(extractedIntent, input.durationMinutes);

  const context = buildCreativeContext({ rawInput, intent, registry: resolvedRegistry, createdAt });
  const storyBlueprint = buildStoryBlueprint({ intent, context, createdAt });
  const scenes = buildSceneBlueprints({ intent, context, blueprint: storyBlueprint, createdAt });
  const guidance = buildGenerationGuidance({ scenes, blueprint: storyBlueprint, context, intent, createdAt });
  const generatedOutput = writeStory({ scenes, guidance, blueprint: storyBlueprint, context, intent, createdAt });
  const evaluation = evaluateNarrative({
    generatedContent: generatedOutput,
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent,
    createdAt,
  });

  return {
    input,
    intent,
    context,
    storyBlueprint,
    scenes,
    guidance,
    generatedOutput,
    evaluation,
    metadata: {
      createdAt: createdAt ?? new Date().toISOString(),
      version: PROTOTYPE_COORDINATOR_VERSION,
    },
  };
}
