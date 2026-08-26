// lib/creative-intelligence/intent/types.ts
//
// Types for the Creative Intent Extraction Layer (RP-011C.7.22). This
// layer's only job is turning a RawCreativeInput into a CreativeIntent
// (see core/types.ts) -- it does not define a parallel intent contract.

import type { RawCreativeInput } from "../core/contracts";
import type { CreativeIntent } from "../core/types";

// The raw prompt lowercased once and shared across classifiers so each one
// doesn't re-normalize the input.
export type ExtractionSignals = {
  raw: RawCreativeInput;
  promptLower: string;
};

// Shape any extractor implementation must satisfy. extractCreativeIntent()
// (extractor.ts) is the deterministic-heuristic implementation of this for
// RP-011C.7.22; a future model-based extractor can implement the same
// shape without changing callers.
export type CreativeIntentExtractor = (input: RawCreativeInput) => CreativeIntent;
