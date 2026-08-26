// lib/creative-intelligence/writer/prompts.ts
//
// Prompt builder for the Narrative Writer Layer (RP-011C.8.5). Formats
// already-decided upstream data -- CreativeIntent, CreativeContext,
// StoryBlueprint, SceneBlueprint, GenerationGuidance -- into the
// system/user prompt pair a CreativeTextProvider consumes.
//
// This module adds no genre rules, narrative principles, safety rules,
// character rules, or story-structure rules of its own. All of that
// already came from CreativeContext / StoryBlueprint / GenerationGuidance
// upstream; this file only arranges it into prompt shape.

import type { CreativeContext } from "../context/types";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import type { GenerationGuidance } from "../guidance/types";
import { resolveWriterTemplate } from "./templates";
import type { CreativeTextProviderInput } from "./provider";

export type BuildWriterPromptParams = {
  scene: SceneBlueprint;
  guidance: GenerationGuidance;
  blueprint: StoryBlueprint;
  context: CreativeContext;
  intent: CreativeIntent;
  // RP-011C.8.10R2: earlier scenes' already-generated text, in order, so
  // this scene can stay consistent with a character/setting/focus one of
  // them already established. See WriteSceneWithProviderParams.
  previousScenesText?: string[];
};

function listOrNone(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}

// Grammatical person the user explicitly asked for (intent.perspective --
// see core/constants.ts CreativePerspective, intent/classifiers.ts
// classifyPerspective). Surfaced as a single line rather than a new prompt
// section: no preset's guidance template forces a specific person, so this
// only needs to state the explicit request and that it takes priority over
// this preset's usual address style if the two would otherwise conflict.
const PERSPECTIVE_LABEL: Record<NonNullable<CreativeIntent["perspective"]>, string> = {
  first: `first person ("I"/"me")`,
  second: `second person ("you")`,
  third: `third person ("he"/"she"/"they")`,
};

function describePerspective(intent: CreativeIntent): string | null {
  if (!intent.perspective) return null;
  return `Perspective: write in ${PERSPECTIVE_LABEL[intent.perspective]} -- the listener's explicit request, overriding this preset's usual address style if they conflict.`;
}

// RP-011C.7 targeted fix: intent.perspective alone only says which
// grammatical person to write in, not who the resulting "I" is. When the
// user explicitly made the listener themselves the first-person experiencer
// (intent.listenerIsExperiencer -- classifyListenerIsExperiencer), state
// that role claim directly at the top level of the prompt, not only inside
// preset-specific characterGuidance (guidance/builder.ts), so it can't be
// read as satisfied by grammar alone.
function describeListenerExperiencer(intent: CreativeIntent): string | null {
  if (!intent.listenerIsExperiencer) return null;
  return `Listener role: the listener explicitly asked to be the one experiencing this scene -- they are its first-person "I", not a separate narrator or persona addressing them as "you", unless the request also explicitly asks for a distinct roleplay persona.`;
}

function section(title: string, lines: Array<string | null>): string {
  const body = lines.filter((line): line is string => line !== null);
  return [`${title}:`, ...body].join("\n");
}

// Mirrors the legacy script builder's outputLanguage label ("English" |
// "German") -- same two production locales, same mapping.
const OUTPUT_LANGUAGE_LABEL: Record<NonNullable<CreativeIntent["language"]>, string> = {
  en: "English",
  de: "German",
};

function describeOutputLanguage(intent: CreativeIntent): string | null {
  if (!intent.language) return null;
  return `Output language: ${OUTPUT_LANGUAGE_LABEL[intent.language]}. Every word you write must be in this language, regardless of the language used in the instructions above.`;
}

export function buildWriterSystemPrompt(intent: CreativeIntent): string {
  const template = resolveWriterTemplate(intent);
  return [
    `You are the Writer Layer of the SoftVibe Creative Intelligence pipeline.`,
    `You write the ${template.unitLabel} text for a "${intent.preset}" experience.`,
    `Preset emphasis: ${listOrNone(template.emphasis)}.`,
    `Every instruction in the user message already encodes the applicable structure, guidance, and constraints -- follow it exactly.`,
    `Write only the ${template.unitLabel} text itself: no title, no meta-commentary, no explanation of your choices.`,
    describeOutputLanguage(intent),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildWriterUserPrompt(params: BuildWriterPromptParams): string {
  const { scene, guidance, blueprint, context, intent, previousScenesText } = params;
  const template = resolveWriterTemplate(intent);
  const unitLabel = template.unitLabel;

  return [
    section("EXPERIENCE", [
      `Experience: ${intent.experience}`,
      `Audience: ${intent.audience}`,
      intent.tone ? `Tone: ${intent.tone}` : null,
      intent.themes && intent.themes.length > 0 ? `Themes: ${listOrNone(intent.themes)}` : null,
      intent.constraints.length > 0 ? `Constraints (must be honored): ${listOrNone(intent.constraints)}` : null,
      describePerspective(intent),
      describeListenerExperiencer(intent),
    ]),
    ``,
    ...(intent.creativeDirection
      ? [
          section("USER CREATIVE DIRECTION", [
            `Explicit creative direction from the user:`,
            intent.creativeDirection,
            `Respect this direction faithfully -- do not ignore, generalize away, or override the user's explicit creative choices.`,
            intent.preset === "sleep-story" && intent.hasExplicitScenario
              ? `Priority: this creative direction overrides the optional Sleep Story defaults below in WRITING GUIDANCE.`
              : null,
            intent.preset === "sleep-story" && intent.hasExplicitScenario
              ? `Do not introduce a traveler, companion, host, welcome ritual, or setting (e.g. a cottage, fireplace, tea) unless it supports what the user asked for.`
              : null,
            // RP-011C.8.10R1: the line above stops unwanted *additions*
            // (traveler/companion/host/ritual), but review found the Writer
            // still sometimes replaced a figure the user DID name (a train
            // conductor, a lighthouse keeper) with a generic invented one.
            // This line addresses substitution, not addition: if the
            // direction above already names or clearly implies a central
            // character or figure, keep that one -- don't swap it for
            // something new. Deliberately not a parsed/extracted role: the
            // Writer reads the creative direction itself and decides.
            intent.preset === "sleep-story" && intent.hasExplicitScenario
              ? `If the creative direction names a central character or figure, keep them as the protagonist -- do not replace them with an invented generic figure such as "the traveler."`
              : null,
            // RP-011C.8.10V: R1 stopped substitution, but the final
            // rebenchmark (docs/sleep-story-end-to-end-quality-final-
            // rebenchmark-report.md) found a second failure mode -- the
            // Writer, trying not to force an unwanted default figure,
            // instead dissolved an established one into agentless passive
            // prose ("A cup was taken from the shelf") or bodyless
            // description ("the hands", "the walking") with no one there to
            // take the cup or do the walking. This line addresses removal,
            // not substitution: once a figure is established, keep it
            // present as the subject of the prose, referred to consistently
            // (a name, or a role plus ordinary pronouns), for the rest of
            // the story -- not sometimes named, sometimes erased.
            intent.preset === "sleep-story" && intent.hasExplicitScenario
              ? `If the creative direction establishes a person, role, or meaningful figure (a name, an occupation, "someone," "a person"), keep that figure present throughout every scene -- do not remove them.`
              : null,
            intent.preset === "sleep-story" && intent.hasExplicitScenario
              ? `Do not abstract that figure into passive constructions with no one performing the action, such as "the cup was taken from the shelf."`
              : null,
            intent.preset === "sleep-story" && intent.hasExplicitScenario
              ? `Do not reduce that figure to disembodied description such as "the hands" or "the walking" -- refer to them consistently, with ordinary pronouns or their role.`
              : null,
            // RP-011C.8.11 Kids Story continuity: the reported failure mode
            // was each scene reading as an independent mini-story (a new
            // premise, new characters, a new place) instead of one story
            // told across scenes. Kids-story now receives creativeDirection
            // like every other included preset above; this single line
            // reinforces the same "stay consistent" instruction the STORY
            // SO FAR section below already gives, at the point where the
            // premise/characters are first established.
            intent.preset === "kids-story"
              ? `Keep the same named character(s), setting, and premise consistent across every scene -- do not introduce different characters, a different place, or an unrelated new premise partway through.`
              : null,
          ]),
          ``,
        ]
      : []),
    ...(previousScenesText && previousScenesText.length > 0
      ? [
          section(`STORY SO FAR (${template.unitLabel}s already written, in order)`, [
            `Continue naturally from this -- do not repeat it:`,
            ...previousScenesText,
            `Keep every character, setting, and central focus already established above exactly as they are.`,
            `Do not replace them with a different or generic figure/setting, and do not introduce a new unrelated character, place, or element.`,
          ]),
          ``,
        ]
      : []),
    section(template.designSectionTitle, [
      `Central question: ${blueprint.premise.centralQuestion}`,
      `Core tension: ${blueprint.premise.coreConflict}`,
      `${template.promiseLabel}: ${blueprint.premise.storyPromise}`,
      `Emotional arc: ${blueprint.emotionalArc.beginning} -> ${blueprint.emotionalArc.middle} -> ${blueprint.emotionalArc.end}`,
    ]),
    ``,
    section(`THIS ${unitLabel.toUpperCase()}`, [
      `Purpose: ${scene.purpose}`,
      `${template.functionLabel}: ${scene.narrativeFunction}`,
      template.charactersLabel ? `${template.charactersLabel}: ${listOrNone(scene.charactersInvolved)}` : null,
      `Emotional state: ${scene.emotionalState}`,
      `Conflict/tension: ${scene.conflict}`,
      `Desired change by the end: ${scene.desiredChange}`,
      `Setting guidance: ${scene.settingGuidance}`,
      scene.requiredElements.length > 0 ? `Required elements: ${listOrNone(scene.requiredElements)}` : null,
    ]),
    ``,
    section("WRITING GUIDANCE", [
      `Writing focus: ${guidance.writingFocus}`,
      `Narrative intent: ${guidance.narrativeIntent}`,
      `Emotional approach: ${guidance.emotionalApproach}`,
      `Character guidance: ${guidance.characterGuidance}`,
      `Dialogue guidance: ${guidance.dialogueGuidance}`,
      `Pacing guidance: ${guidance.pacingGuidance}`,
      `Description guidance: ${guidance.descriptionGuidance}`,
      `Style guidance: ${guidance.styleGuidance}`,
      guidance.allowedElements.length > 0 ? `Allowed, ordinary elements: ${listOrNone(guidance.allowedElements)}` : null,
      guidance.targetWordCount !== undefined
        ? `Length target for this scene: approximately ${guidance.targetWordCount} words (guidance, not a hard limit).`
        : null,
    ]),
    ``,
    section("AVOID", [listOrNone([...scene.avoidPatterns, ...guidance.avoidPatterns])]),
    ``,
    section("ADDITIONAL GENERATION-STAGE KNOWLEDGE", [listOrNone(context.guidance.generation)]),
    // RP-011C.7D.1 production cutover: appended verbatim, last, exactly like
    // the legacy script builder's preferenceContextBlock append. Bypassed
    // for kids-story there too -- children's safety guidance stays
    // authoritative and is never softened by preference styling.
    ...(intent.preset !== "kids-story" && (intent.preferenceContext ?? "").trim().length > 0
      ? [``, intent.preferenceContext!.trim()]
      : []),
  ].join("\n");
}

export function buildWriterPrompt(params: BuildWriterPromptParams): CreativeTextProviderInput {
  return {
    systemPrompt: buildWriterSystemPrompt(params.intent),
    userPrompt: buildWriterUserPrompt(params),
  };
}
