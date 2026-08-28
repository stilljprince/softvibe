// lib/creative-intelligence/writer/types.ts
//
// Types for the Narrative Writer Layer. This layer's only job is turning a
// SceneBlueprint + its GenerationGuidance (plus the StoryBlueprint /
// CreativeContext / CreativeIntent they were built from) into a
// GeneratedScene -- the first layer in the Creative Intelligence
// Architecture that actually produces scene text. It does not decide story
// structure, invent scenes, plan dramaturgy, interpret the Knowledge Layer,
// or define its own quality rules -- all of that already happened in
// planning/, scenes/, and guidance/. It only executes what those layers
// already decided.
//
// writeScene() / writeStory() (RP-011C.7.26) are deterministic -- no
// LLM/provider calls -- and unchanged by RP-011C.8.5 so every existing
// caller keeps working exactly as before. writeSceneWithProvider() /
// writeStoryWithProvider() (RP-011C.8.5, writer.ts) are the first real
// LLM-backed implementation of the same input shape: prompt-builder
// (prompts.ts) -> CreativeTextProvider (provider.ts) -> GeneratedScene.

import type { CreativeContext } from "../context/types";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import type { GenerationGuidance } from "../guidance/types";
import type { RemainingWordBudget } from "../guidance/duration-budget";
import type { CreativeTextProvider } from "./provider";

export type GeneratedSceneMetadata = {
  createdAt: string;
  version: string;
  writerMethod: "deterministic-template" | "model-based";
};

// The Writer Layer's output for one scene: scene text, pointed back at the
// SceneBlueprint it was written from. For this pass `text` is a
// deterministic structural placeholder (see writer.ts), not finished prose
// -- the contract itself does not care how `text` was produced.
export type GeneratedScene = {
  sceneId: string;
  text: string;
  metadata: GeneratedSceneMetadata;
};

// Input to writeScene(): everything upstream of the Writer Layer for one
// scene. Structure + guidance in, prose out -- the writer does not
// re-derive or reinterpret any of these, only executes them.
export type WriteSceneParams = {
  scene: SceneBlueprint;
  guidance: GenerationGuidance;
  blueprint: StoryBlueprint;
  context: CreativeContext;
  intent: CreativeIntent;
  // Overridable for deterministic tests; defaults to the current time.
  createdAt?: string;
};

export type WriteStoryParams = {
  scenes: SceneBlueprint[];
  guidance: GenerationGuidance[];
  blueprint: StoryBlueprint;
  context: CreativeContext;
  intent: CreativeIntent;
  createdAt?: string;
};

// Shape any single-scene writer implementation must satisfy. writeScene()
// (writer.ts) is the deterministic-template implementation of this for
// RP-011C.7.26; a future LLM-backed writer (prompt builder -> provider)
// can implement the same shape without changing callers.
export type SceneWriter = (params: WriteSceneParams) => GeneratedScene;

// Shape any multi-scene writer implementation must satisfy.
export type StoryWriter = (params: WriteStoryParams) => GeneratedScene[];

// Input to writeSceneWithProvider() (RP-011C.8.5): everything WriteSceneParams
// carries, plus the CreativeTextProvider to call. A required field, not a
// default constructed inside writer.ts -- the caller decides which provider
// (real or mocked) to inject.
export type WriteSceneWithProviderParams = WriteSceneParams & {
  provider: CreativeTextProvider;
  // RP-011C.8.10R2: the already-generated text of every earlier scene in
  // this same story, in order. Continuity context only -- raw text, no
  // extraction or parsing -- so a character, setting, or focus introduced
  // in an earlier scene has something concrete to stay consistent with,
  // the same way the Writer already reads intent.creativeDirection verbatim
  // instead of a parsed-out field. Undefined/empty for the first scene.
  previousScenesText?: string[];
  // RP-011C.8D: remaining-word-budget awareness, recomputed by
  // writeStoryWithProvider from the actual word count of previousScenesText
  // (see guidance/duration-budget.ts resolveRemainingWordBudget). Narrative
  // only today -- undefined for every other preset and for narrative when
  // the intent carries no requested duration.
  lengthGovernance?: RemainingWordBudget;
};

export type WriteStoryWithProviderParams = WriteStoryParams & {
  provider: CreativeTextProvider;
};

// Shape of the provider-backed single-scene writer. Async because it awaits
// a CreativeTextProvider call -- the one intentional interface difference
// from SceneWriter, since a real generation call cannot be synchronous.
export type ProviderBackedSceneWriter = (params: WriteSceneWithProviderParams) => Promise<GeneratedScene>;

export type ProviderBackedStoryWriter = (params: WriteStoryWithProviderParams) => Promise<GeneratedScene[]>;
