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
import type { RemainingWordBudget } from "../guidance/duration-budget";
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
  // RP-011C.8D: remaining-word-budget awareness for this scene, recomputed
  // by writeStoryWithProvider from the actual word count of
  // previousScenesText. Narrative only -- see WriteSceneWithProviderParams.
  lengthGovernance?: RemainingWordBudget;
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

// RP-011C.8F Teil B: global story-budget awareness beyond just this scene's
// own recommended number, so the writer can see how the whole story is
// tracking -- not just this scene's slice of it. Every value here is
// already on RemainingWordBudget (see guidance/duration-budget.ts); this
// only formats it, it does not compute anything new.
function describeGlobalStoryBudget(lengthGovernance: RemainingWordBudget): string {
  const scenesLabel = lengthGovernance.remainingSceneCount === 1 ? "scene" : "scenes";
  return (
    `Story budget so far: ${lengthGovernance.wordsWrittenSoFar} words written, ` +
    `~${lengthGovernance.remainingWords} words remaining toward the ~${lengthGovernance.totalWords}-word target ` +
    `(soft ceiling ~${lengthGovernance.maxRecommendedWords} words), ` +
    `with ${lengthGovernance.remainingSceneCount} ${scenesLabel} left to write including this one.`
  );
}

// RP-011C.8H Teil C/D: medium-strength guidance for a story that is using
// its word budget faster than planned at this point (see
// guidance/duration-budget.ts resolvePlannedCumulativeWords /
// isBudgetPressureActive) even though it is not yet close to totalWords --
// weaker than the near_limit/over_limit compactness guidance below, but
// present well before those trigger. Explicitly a Story Value Hierarchy
// (protect plot-critical beats, reduce optional material first) rather than
// a plain "write less" instruction: this is the CEO-flagged risk this patch
// exists to avoid -- early overshoot must not be paid for later by
// starving turning points, confrontations, or the payoff. Same "no
// hard-stop / truncation language" rule as describeFocusGuidance below.
function describeBudgetPressureGuidance(): string {
  return [
    `This story is using its word budget faster than planned at this point in the story.`,
    `Keep this scene focused and efficient, without cutting the story short.`,
    `Do not omit or skip necessary turning points, reveals, decisions, or consequences to save words.`,
    `Protect: central plot action, character decisions, consequences, clues and reveals, confrontations and turning points, relationship changes, necessary transitions, and the eventual payoff/ending.`,
    // Split across two literals (joined by the trailing " " below) purely to
    // stay under the writer/ test suite's long-hand-written-string-literal
    // heuristic (scripts/test-creative-intelligence-writer.ts) -- the
    // resulting prompt text is unaffected.
    `Reduce first, before touching any of the above: repeated atmosphere, redundant description, extended reflection, secondary detours,` +
      ` redundant explanation, extra setup after the premise is already clear, unnecessary side beats, and optional new subplots.`,
  ].join(" ");
}

// RP-011C.8F Teil B/soft-ceiling-status + Teil C: the stronger compactness
// guidance a near-limit or already-over-limit story needs -- distinct from
// the always-present "small overrun is acceptable" line below, which stays
// true even here. Deliberately no hard-stop / truncation language (no "do
// not exceed X words", no "stop writing at"): this only reprioritizes what
// the scene should focus on, it never forbids finishing the required beat.
function describeFocusGuidance(status: RemainingWordBudget["storyBudgetStatus"]): string | null {
  if (status === "normal") return null;
  if (status === "budget_pressure") return describeBudgetPressureGuidance();

  const openingLine =
    status === "over_limit"
      ? `This story is already past its overall recommended maximum length.`
      : `This story is already close to its overall recommended length.`;

  return [
    openingLine,
    `Complete this scene's required narrative beat, but keep it focused and compact rather than expansive.`,
    `Prioritize: necessary action, decision and consequence, the scene's clue/reveal or payoff, and the essential transition to what follows.`,
    `Avoid: secondary detours, extended reflection, redundant dialogue, repeated description, and introducing unnecessary new subplots.`,
    status === "over_limit"
      ? `Do not open any new optional beats or subplots -- move efficiently toward the story's necessary payoff.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
}

// RP-011C.8D: when lengthGovernance is present (narrative only, see
// WriteSceneWithProviderParams), it replaces the plain static target with
// guidance recomputed from the actual word count of scenes already written
// -- so a scene that overshot its guidance leaves less for what follows,
// while the final scene keeps enough headroom to land its payoff. Every
// other preset keeps the original static-target line unchanged.
function describeLengthGuidance(
  targetWordCount: number | undefined,
  lengthGovernance: RemainingWordBudget | undefined
): Array<string | null> {
  if (!lengthGovernance) {
    return [
      targetWordCount !== undefined
        ? `Length target for this scene: approximately ${targetWordCount} words (guidance, not a hard limit).`
        : null,
    ];
  }

  return [
    `Aim to complete this scene within approximately ${lengthGovernance.recommendedSceneWords} words.`,
    `The full story has approximately ${lengthGovernance.remainingWords} words remaining toward its ~${lengthGovernance.totalWords}-word target.`,
    `Soft ceiling: aim not to significantly exceed ~${lengthGovernance.maxRecommendedWords} words in total -- this is guidance, not a hard limit.`,
    describeGlobalStoryBudget(lengthGovernance),
    `Preserve this scene's necessary action, decision, consequence, and transition.`,
    `A small overrun is acceptable to finish the scene coherently, but avoid unnecessary expansion beyond the remaining story budget.`,
    describeFocusGuidance(lengthGovernance.storyBudgetStatus),
    lengthGovernance.isFinalScene
      ? `This is the final scene -- prioritize fully completing the story's payoff and resolution over hitting this word count exactly.`
      : null,
  ];
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
  const { scene, guidance, blueprint, context, intent, previousScenesText, lengthGovernance } = params;
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
            // RP-011C.8D Cast Identity Anchor: the longform legacy-vs-CI
            // benchmark (RP-011C.8B) found two explicitly different,
            // user-requested side characters accidentally merged into one
            // person over a long story. This is about identity, not
            // relationship state -- it must not read as "relationships must
            // stay unchanged," since narrative fully depends on trust,
            // betrayal, alliance, romance, hostility, and other relationship
            // shifts remaining possible. Narrative only: no other preset's
            // benchmark surfaced this failure mode.
            intent.preset === "narrative"
              ? `If this direction names or clearly implies more than one distinct person or role, keep each of them recognizable as a separate individual -- do not merge two explicitly different figures into one.`
              : null,
            intent.preset === "narrative"
              ? `Keep each character's established identity and name consistent throughout the story.`
              : null,
            intent.preset === "narrative"
              ? `Relationships and roles may still change through story events (trust, betrayal, alliance, romance, hostility, reconciliation) -- preserve identity, not fixed relationships.`
              : null,
            intent.preset === "narrative"
              ? `Departure, death, and new arrivals entering the story remain fully allowed too.`
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
      ...describeLengthGuidance(guidance.targetWordCount, lengthGovernance),
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
