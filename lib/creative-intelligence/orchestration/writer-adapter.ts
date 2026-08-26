// lib/creative-intelligence/orchestration/writer-adapter.ts
//
// Writer-stage selection for the Creative Intelligence Orchestration Layer
// (RP-011C.8.6). pipeline.ts calls writeStoryForPipeline() and knows
// nothing else about the Writer Layer -- not writeStory() vs.
// writeStoryWithProvider(), not CreativeTextProvider, not how a provider
// gets constructed. This file only routes between the two writer
// implementations writer.ts already owns; it defines no prompt logic,
// creative rules, or writing behavior of its own.

import { writeStory, writeStoryWithProvider } from "../writer";
import type { GeneratedScene, WriteStoryParams } from "../writer";
import { createCreativeTextProvider } from "../writer/factory";
import type { CreativeTextProvider } from "../writer/provider";
import type { WriterMode } from "./types";

export type WriteStoryForPipelineParams = WriteStoryParams & {
  // Defaults to "mock" -- same default as RunCreativePipelineOptions.
  writerMode?: WriterMode;
  // Only consulted when writerMode is "provider". Overridable so tests can
  // inject a mocked CreativeTextProvider instead of the real one
  // writer/factory.ts constructs by default.
  provider?: CreativeTextProvider;
};

export async function writeStoryForPipeline(
  params: WriteStoryForPipelineParams
): Promise<GeneratedScene[]> {
  const { writerMode = "mock", provider, ...storyParams } = params;

  if (writerMode === "mock") {
    return writeStory(storyParams);
  }

  const resolvedProvider = provider ?? createCreativeTextProvider();
  return writeStoryWithProvider({ ...storyParams, provider: resolvedProvider });
}
