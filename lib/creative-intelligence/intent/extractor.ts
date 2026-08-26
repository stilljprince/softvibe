// lib/creative-intelligence/intent/extractor.ts
//
// Creative Intent Extraction Layer (RP-011C.7.22). Turns a RawCreativeInput
// into a CreativeIntent using deterministic heuristics only -- no LLM
// calls, no knowledge-registry lookups (that's the Context Builder's job,
// see context/builder.ts), no scenes/prose. See classifiers.ts for the
// individual heuristics this composes.
//
// This answers "what is the user trying to create?" only. How it should be
// written belongs to future Planning/Generation layers.

import type { CreativeUnderstandingLayer, RawCreativeInput } from "../core/contracts";
import type { CreativeIntent, CreativeIntentMetadata } from "../core/types";
import {
  classifyAsmrMode,
  classifyAsmrNarrativeTension,
  classifyAudience,
  classifyConstraints,
  classifyCreativeDirection,
  classifyEmotionalDirection,
  classifyExperience,
  classifyGenre,
  classifyHasExplicitScenario,
  classifyListenerIsExperiencer,
  classifyMeditationExperienceType,
  classifyNarrativeFocus,
  classifyPerspective,
  classifyPreset,
  classifyRequiredElements,
  classifyStoryScale,
  classifyThemes,
  classifyTone,
} from "./classifiers";
import type { CreativeIntentExtractor, ExtractionSignals } from "./types";

export const INTENT_EXTRACTOR_VERSION = "1.0.0";

function buildSignals(input: RawCreativeInput): ExtractionSignals {
  return { raw: input, promptLower: input.prompt.toLowerCase() };
}

export const extractCreativeIntent: CreativeIntentExtractor = (input) => {
  const signals = buildSignals(input);

  const preset = classifyPreset(signals);
  const themes = classifyThemes(signals);
  const storyScale = classifyStoryScale(signals, preset);
  const emotionalDirection = classifyEmotionalDirection(signals, preset, themes);
  const asmrMode = classifyAsmrMode(signals, preset);
  const asmrNarrativeTension = classifyAsmrNarrativeTension(signals, asmrMode);
  const meditationExperienceType = classifyMeditationExperienceType(signals, preset);
  const perspective = classifyPerspective(signals);
  const listenerIsExperiencer = classifyListenerIsExperiencer(signals);
  const creativeDirection = classifyCreativeDirection(signals, preset, asmrMode);

  const metadata: CreativeIntentMetadata = {
    extractorVersion: INTENT_EXTRACTOR_VERSION,
    method: "deterministic-heuristic",
  };

  const intent: CreativeIntent = {
    preset,
    genre: classifyGenre(signals, preset),
    experience: classifyExperience(preset, themes),
    audience: classifyAudience(signals, preset),
    constraints: classifyConstraints(signals, preset),
    tone: classifyTone(preset),
    storyScale,
    asmrMode,
    asmrNarrativeTension,
    meditationExperienceType,
    perspective,
    listenerIsExperiencer,
    themes,
    emotionalDirection,
    narrativeFocus: classifyNarrativeFocus(storyScale),
    requiredElements: classifyRequiredElements(storyScale, preset),
    creativeDirection,
    hasExplicitScenario: classifyHasExplicitScenario(preset, creativeDirection),
    metadata,
  };

  return intent;
};

// Wraps the deterministic extractor in the CreativeUnderstandingLayer
// contract (core/contracts.ts) so future layers can depend on the
// interface rather than this function directly. Swapping in a model-based
// implementation later means providing a different
// CreativeUnderstandingLayer -- no downstream changes required.
export const deterministicCreativeUnderstandingLayer: CreativeUnderstandingLayer = {
  understand: async (input: RawCreativeInput) => extractCreativeIntent(input),
};
