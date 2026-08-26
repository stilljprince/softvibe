// lib/creative-intelligence/writer/writer.ts
//
// Narrative Writer Layer. writeScene() / writeStory() (RP-011C.7.26) turn a
// SceneBlueprint + its GenerationGuidance into a GeneratedScene
// deterministically -- no LLM/provider calls, no example story text baked
// in. They are unchanged by RP-011C.8.5, so every existing caller keeps
// working exactly as before.
//
// writeSceneWithProvider() / writeStoryWithProvider() (RP-011C.8.5) are the
// first real implementation of the same contract backed by an actual LLM
// call: build a prompt (prompts.ts) from the same inputs, call a
// CreativeTextProvider (provider.ts), and return the generated text as a
// GeneratedScene. They are separate exports rather than a behavior change
// to writeScene() / writeStory() because a real provider call is
// necessarily async, while writeScene() / writeStory() are called
// synchronously by existing callers (prototype/coordinator.ts,
// orchestration/pipeline.ts, and their tests) -- changing their return type
// would break those callers without any test-suite benefit.
//
// The Writer Layer does not decide story structure, invent scenes, plan
// dramaturgy, interpret the Knowledge Layer, or define its own quality
// rules -- all of that already happened in planning/, scenes/, and
// guidance/. It only executes what those layers already decided.

import { resolveWriterTemplate } from "./templates";
import { buildWriterPrompt } from "./prompts";
import type {
  GeneratedScene,
  ProviderBackedSceneWriter,
  ProviderBackedStoryWriter,
  SceneWriter,
  StoryWriter,
  WriteSceneParams,
  WriteSceneWithProviderParams,
  WriteStoryParams,
} from "./types";

export const WRITER_VERSION = "1.0.0";

// Deterministic structural placeholder -- not prose, not a worked example.
// It exists to prove (and let tests verify) that the Writer Layer actually
// consumed the scene's structure and its guidance, without inventing any
// story content of its own.
function composePlaceholderText(params: WriteSceneParams): string {
  const { scene, guidance, intent } = params;
  const template = resolveWriterTemplate(intent);

  return [
    `Scene generated from blueprint: ${scene.id}`,
    `Preset: ${intent.preset} (${template.unitLabel} ${scene.order})`,
    `Purpose: ${scene.purpose}`,
    `Narrative function: ${scene.narrativeFunction}`,
    `Characters: ${scene.charactersInvolved.length > 0 ? scene.charactersInvolved.join(", ") : "none"}`,
    `Writing focus: ${guidance.writingFocus}`,
    `Character guidance: ${guidance.characterGuidance}`,
    `Dialogue guidance: ${guidance.dialogueGuidance}`,
    `Pacing guidance: ${guidance.pacingGuidance}`,
    `Description guidance: ${guidance.descriptionGuidance}`,
    `Preset emphasis: ${template.emphasis.join(", ")}.`,
    `Avoid: ${scene.avoidPatterns.length > 0 ? scene.avoidPatterns.join("; ") : "none"}`,
  ].join("\n");
}

export const writeScene: SceneWriter = (params: WriteSceneParams): GeneratedScene => {
  const { scene, createdAt } = params;

  return {
    sceneId: scene.id,
    text: composePlaceholderText(params),
    metadata: {
      createdAt: createdAt ?? new Date().toISOString(),
      version: WRITER_VERSION,
      writerMethod: "deterministic-template",
    },
  };
};

export const writeStory: StoryWriter = (params: WriteStoryParams): GeneratedScene[] => {
  const { scenes, guidance, blueprint, context, intent, createdAt } = params;

  return scenes.map((scene) => {
    const sceneGuidance = guidance.find((g) => g.sceneId === scene.id);
    if (!sceneGuidance) {
      throw new Error(`writeStory: no GenerationGuidance found for scene ${scene.id}`);
    }
    return writeScene({ scene, guidance: sceneGuidance, blueprint, context, intent, createdAt });
  });
};

// ---------------------------------------------------------------------------
// Provider-backed Writer (RP-011C.8.5)
// ---------------------------------------------------------------------------

export const writeSceneWithProvider: ProviderBackedSceneWriter = async (
  params: WriteSceneWithProviderParams
): Promise<GeneratedScene> => {
  const { scene, provider, createdAt } = params;
  const prompt = buildWriterPrompt(params);
  const text = await provider.generateText(prompt);

  return {
    sceneId: scene.id,
    text,
    metadata: {
      createdAt: createdAt ?? new Date().toISOString(),
      version: WRITER_VERSION,
      writerMethod: "model-based",
    },
  };
};

export const writeStoryWithProvider: ProviderBackedStoryWriter = async (params) => {
  const { scenes, guidance, provider, blueprint, context, intent, createdAt } = params;

  const results: GeneratedScene[] = [];
  // RP-011C.8.10R2: earlier scenes' text, carried forward as continuity
  // context (see WriteSceneWithProviderParams.previousScenesText) so a
  // character/setting/focus established early on doesn't drift by the time
  // later scenes are written independently.
  const previousScenesText: string[] = [];
  for (const scene of scenes) {
    const sceneGuidance = guidance.find((g) => g.sceneId === scene.id);
    if (!sceneGuidance) {
      throw new Error(`writeStoryWithProvider: no GenerationGuidance found for scene ${scene.id}`);
    }
    // Sequential, not Promise.all -- keeps output order deterministic and
    // avoids firing concurrent provider calls per story. Sequential
    // execution is also what makes carrying previousScenesText forward
    // possible.
    const generated = await writeSceneWithProvider({
      scene,
      guidance: sceneGuidance,
      provider,
      blueprint,
      context,
      intent,
      createdAt,
      previousScenesText: previousScenesText.length > 0 ? [...previousScenesText] : undefined,
    });
    results.push(generated);
    previousScenesText.push(generated.text);
  }
  return results;
};
