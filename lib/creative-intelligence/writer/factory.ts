// lib/creative-intelligence/writer/factory.ts
//
// Provider construction for the Narrative Writer Layer's provider-backed
// writer (RP-011C.8.6). Isolates *which* CreativeTextProvider
// implementation gets created from the code that decides *whether* to use
// one -- orchestration/writer-adapter.ts calls createCreativeTextProvider()
// and never imports createOpenAICreativeTextProvider() or any provider SDK
// directly. No creative rules, prompt logic, or writer behavior live here;
// this file only builds the object writer.ts already knows how to call.

import { createOpenAICreativeTextProvider } from "./provider";
import type { CreativeTextProvider, OpenAICreativeTextProviderOptions } from "./provider";

export type CreativeTextProviderFactoryOptions = OpenAICreativeTextProviderOptions;

// Single seam for provider construction. Today this always returns the
// OpenAI-backed implementation; a future pass can add a `backend` option
// here without touching any caller.
export function createCreativeTextProvider(
  options: CreativeTextProviderFactoryOptions = {}
): CreativeTextProvider {
  return createOpenAICreativeTextProvider(options);
}
