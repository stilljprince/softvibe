// lib/script-builder-narrative.ts
//
// Narrative preset router.
//
// The `narrative` preset has two submodes that share nothing structurally:
//   - "story"            → fiction (crime, fantasy, sci-fi, romance, mystery,
//                          adventure, slice-of-life, historical). Owned by
//                          Agent B in `./script-builder-narrative-story`.
//   - "quiet-knowledge"  → calm, atmospheric, factually-grounded sessions.
//                          Owned by Agent C in
//                          `./script-builder-narrative-quiet-knowledge`.
//
// `buildScriptV3()` in `script-builder.ts` calls `buildNarrative_v3(prompt)`
// with the already-normalized prompt string and expects a string back. The
// `narrativeMode` field on `ScriptInput` carries the submode; because the
// caller passes only the cleaned prompt, this router also accepts the mode
// as an optional second argument and defaults to "story" when missing or
// unknown. Once `narrativeMode` is plumbed through the call site upstream,
// the dispatch becomes the obvious one-liner.
//
// Signature note: matches the other v3 builders (e.g. `buildSleepStory_v3`).
// The caller applies rhythm and duration fitting on top of the returned text.
import {
  buildNarrativeStory_v3,
  buildNarrativeStoryOpenAIPrompts,
  type NarrativeStoryPromptOpts,
} from "./script-builder-narrative-story";
import {
  buildNarrativeQuietKnowledge_v3,
  buildNarrativeQuietKnowledgeOpenAIPrompts,
  type NarrativeQuietKnowledgePromptOpts,
} from "./script-builder-narrative-quiet-knowledge";

export type NarrativeMode = "story" | "quiet-knowledge";

export function buildNarrative_v3(prompt: string, mode?: NarrativeMode | null): string {
  const resolved: NarrativeMode = mode === "quiet-knowledge" ? "quiet-knowledge" : "story";
  if (resolved === "quiet-knowledge") {
    return buildNarrativeQuietKnowledge_v3(prompt);
  }
  return buildNarrativeStory_v3(prompt);
}

// Production OpenAI prompts router. Mirrors `buildNarrative_v3` but returns
// the { system, user } pair the script-builder-openai pipeline feeds into
// responses.create(). Defaults to "story" when mode is missing or unknown.
export type NarrativeOpenAIPromptOpts =
  | NarrativeStoryPromptOpts
  | NarrativeQuietKnowledgePromptOpts;

export function buildNarrativeOpenAIPrompts(
  opts: NarrativeOpenAIPromptOpts,
  mode?: NarrativeMode | null,
): { system: string; user: string; resolvedMode: NarrativeMode } {
  const resolvedMode: NarrativeMode = mode === "quiet-knowledge" ? "quiet-knowledge" : "story";
  if (resolvedMode === "quiet-knowledge") {
    const { system, user } = buildNarrativeQuietKnowledgeOpenAIPrompts(opts);
    return { system, user, resolvedMode };
  }
  const { system, user } = buildNarrativeStoryOpenAIPrompts(opts);
  return { system, user, resolvedMode };
}
