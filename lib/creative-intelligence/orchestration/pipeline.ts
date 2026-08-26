// lib/creative-intelligence/orchestration/pipeline.ts
//
// Creative Intelligence Orchestration Layer (RP-011C.8.4, extended in
// RP-011C.8.6 with opt-in provider-backed writing). Connects the seven
// already-implemented Creative Intelligence stages into one executable,
// production-oriented pipeline:
//
//   CreativePipelineRequest
//     -> extractCreativeIntent()        (intent/)
//     -> buildCreativeContext()         (context/)
//     -> buildStoryBlueprint()          (planning/)
//     -> buildSceneBlueprints()         (scenes/)
//     -> buildGenerationGuidance()      (guidance/)
//     -> writeStoryForPipeline()        (writer-adapter.ts -> writer/)
//     -> evaluateNarrative()            (evaluation/)
//     -> CreativePipelineResult
//
// This is the migration foundation for RP-011C.8.4: it creates no new
// principles, planning logic, writing rules, or evaluation criteria -- it
// only coordinates the existing layers and carries their outputs forward
// unchanged. It is not called from the active generation pipeline
// (app/api/jobs/*, app/generate/*, lib/script-builder*, lib/narrative/*,
// lib/story-supervisor.ts, lib/tts/*), and makes no OpenAI/ElevenLabs/
// database calls of its own -- writeStoryForPipeline() only calls a
// provider when the caller explicitly opts into writerMode: "provider".
//
// runCreativePipeline() is async so a future migration can swap any
// deterministic-template layer (Writer, Evaluation) for a provider-backed
// implementation behind the same contract without changing callers -- the
// stages themselves stay synchronous for this pass.

import { CreativeKnowledgeRegistry } from "../knowledge/registry";
import { initializeCreativeKnowledge } from "../knowledge/init";
import { extractCreativeIntent } from "../intent";
import { buildCreativeContext } from "../context";
import { buildStoryBlueprint } from "../planning";
import { buildSceneBlueprints } from "../scenes";
import { buildGenerationGuidance } from "../guidance";
import { evaluateNarrative } from "../evaluation";
import { writeStoryForPipeline } from "./writer-adapter";
import type { RawCreativeInput } from "../core/contracts";
import type { CreativeIntent } from "../core/types";
import type {
  CreativePipelineRequest,
  CreativePipelineResult,
  RunCreativePipelineOptions,
} from "./types";

export const ORCHESTRATION_PIPELINE_VERSION = "1.0.0";

function resolveRegistry(registry?: CreativeKnowledgeRegistry): CreativeKnowledgeRegistry {
  if (registry) return registry;
  const isolated = new CreativeKnowledgeRegistry();
  initializeCreativeKnowledge(isolated);
  return isolated;
}

// extractCreativeIntent() does not populate CreativeIntent.durationMinutes
// (it only reads the prompt/presetHint) -- this carries the request's
// explicit duration onto the extracted intent without touching the
// extractor itself, and without mutating the extractor's return value.
function applyRequestedDuration(intent: CreativeIntent, durationMinutes?: number): CreativeIntent {
  if (durationMinutes === undefined) return intent;
  return { ...intent, durationMinutes };
}

// Same pass-through approach as applyRequestedDuration() above: neither field
// is produced by extractCreativeIntent() (RP-011C.7D.1 production cutover --
// see CreativePipelineRequest.language / .preferenceContext).
function applyRequestExtras(
  intent: CreativeIntent,
  request: Pick<CreativePipelineRequest, "language" | "preferenceContext">
): CreativeIntent {
  if (request.language === undefined && request.preferenceContext === undefined) return intent;
  return {
    ...intent,
    ...(request.language !== undefined ? { language: request.language } : {}),
    ...(request.preferenceContext !== undefined ? { preferenceContext: request.preferenceContext } : {}),
  };
}

export async function runCreativePipeline(
  request: CreativePipelineRequest,
  options: RunCreativePipelineOptions = {}
): Promise<CreativePipelineResult> {
  const { registry, createdAt, writerMode, provider } = options;
  const resolvedRegistry = resolveRegistry(registry);

  const rawInput: RawCreativeInput = { prompt: request.prompt, presetHint: request.preset };

  const extractedIntent = extractCreativeIntent(rawInput);
  const withDuration = applyRequestedDuration(extractedIntent, request.durationMinutes);
  const intent = applyRequestExtras(withDuration, request);

  const context = buildCreativeContext({ rawInput, intent, registry: resolvedRegistry, createdAt });
  const storyBlueprint = buildStoryBlueprint({ intent, context, createdAt });
  const scenes = buildSceneBlueprints({ intent, context, blueprint: storyBlueprint, createdAt });
  const guidance = buildGenerationGuidance({ scenes, blueprint: storyBlueprint, context, intent, createdAt });
  const generatedScenes = await writeStoryForPipeline({
    scenes,
    guidance,
    blueprint: storyBlueprint,
    context,
    intent,
    createdAt,
    writerMode,
    provider,
  });
  const evaluation = evaluateNarrative({
    generatedContent: generatedScenes,
    storyBlueprint,
    scenes,
    guidance,
    context,
    intent,
    createdAt,
  });

  return {
    request,
    intent,
    context,
    storyBlueprint,
    scenes,
    guidance,
    generatedScenes,
    evaluation,
    metadata: {
      createdAt: createdAt ?? new Date().toISOString(),
      version: ORCHESTRATION_PIPELINE_VERSION,
    },
  };
}
