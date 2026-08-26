// lib/creative-intelligence/guidance/builder.ts
//
// Generation Guidance Layer (RP-011C.7.25). Turns SceneBlueprint[] +
// StoryBlueprint + CreativeContext + CreativeIntent into
// GenerationGuidance[]: structured writing instructions for a future
// Writer Layer. Writes no prose, no dialogue, and makes no story-structure
// decisions -- those already happened in planning/ and scenes/.
//
// Deterministic only -- no LLM calls. This layer does not query
// CreativeKnowledgeRegistry directly: it only reads the modules the
// Context Builder already resolved as applicable (context.knowledge.modules),
// the same pattern used by planning/blueprint-builder.ts and
// scenes/planner.ts.

import type { CreativeContext } from "../context/types";
import type { KnowledgeModule } from "../knowledge/types";
import type { CreativeIntent, SceneBlueprint, StoryBlueprint } from "../core/types";
import {
  CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE,
  CLASSIC_ASMR_TENSION_STORY_GUIDANCE_TEMPLATE,
  GUIDANCE_TEMPLATE_BY_PRESET,
  MEDITATION_GUIDED_IMAGERY_GUIDANCE_TEMPLATE,
} from "./templates";
import type { PresetGuidanceTemplate } from "./templates";
import { resolveWordBudget } from "./duration-budget";
import type { BuildGenerationGuidanceParams, GenerationGuidance, GenerationGuidanceBuilder } from "./types";

export const GUIDANCE_BUILDER_VERSION = "1.0.0";

function findModule(context: CreativeContext, id: string): KnowledgeModule | undefined {
  return context.knowledge.modules.find((module) => module.id === id);
}

// RP-011C.8.8.3M: classic-asmr's two asmrModes get distinct templates
// (dialogue/pacing/description/style/allowedElements), selected here rather
// than by extending GUIDANCE_TEMPLATE_BY_PRESET's Record<CreativePreset, ...>
// shape, which only has room for one entry per preset. Every other preset
// keeps its single preset-keyed template.
function resolveTemplate(intent: CreativeIntent): PresetGuidanceTemplate {
  if (intent.preset === "classic-asmr" && intent.asmrMode === "story") {
    return intent.asmrNarrativeTension
      ? CLASSIC_ASMR_TENSION_STORY_GUIDANCE_TEMPLATE
      : CLASSIC_ASMR_STORY_GUIDANCE_TEMPLATE;
  }
  if (intent.preset === "meditation" && intent.meditationExperienceType === "guided_imagery") {
    return MEDITATION_GUIDED_IMAGERY_GUIDANCE_TEMPLATE;
  }
  return GUIDANCE_TEMPLATE_BY_PRESET[intent.preset];
}

// Kids Story is plot-driven but must not read as a smaller adult
// narrative: writing focus centers on the child's curiosity and
// connection to a friend, not on choices/behavior driving a plot forward
// (see planning/blueprint-builder.ts resolveKidsStoryProtagonist).
//
// Meditation (RP-011C.8.8.2D) gets its own branch, distinct from the
// generic non-plot-driven text shared by sleep-story/classic-asmr: it must
// read as an invitation to notice, not sensory/behavioral scene-realization
// -- meditation has no scene to realize, only attention to guide.
//
// Classic ASMR (RP-011C.8.8.3D) also gets its own branch, distinct from
// sleep-story's shared generic text: it must read as immediate sensory
// attention, not calm heading toward rest/sleep -- ASMR has no destination
// the listener is being carried toward. RP-011C.8.8.3M further splits this
// branch on intent.asmrMode: story mode still centers sensory attention,
// but through the scene's persona/setting rather than "right now" with no
// scene at all -- it must not collapse into presence's phrasing, nor read
// as a story/destination the listener is being carried toward.
//
// Sleep Story (RP-011C.8.10G) also gets its own branch, replacing the
// generic non-plot fallback it fell through to below (the same fallback
// meditation and classic-asmr used before they grew explicit branches).
// That fallback's "concrete sensory and behavioral detail" phrasing reads
// as centered on the listener directly, the way meditation/ASMR's
// listener-address framing does -- it doesn't communicate that Sleep
// Story follows an in-world protagonist through gentle, external movement
// (SLEEP_STORY_SCENE_STEPS, resolveSleepStoryProtagonist), which is what
// distinguishes it from both.
//
// RP-011C.8.10P: when intent.hasExplicitScenario is true, the sleep-story
// branch drops the fixed protagonist-role reference in favor of "the story
// world's focus" -- the user's creativeDirection (surfaced with priority in
// writer/prompts.ts) may center a place, an object, or no character at all,
// not necessarily the generic traveler role.
//
// RP-011C.8.10R1: "the story world's focus" alone still left the Writer
// free to invent a generic figure (e.g. "the traveler") when the request
// didn't hand it one pre-named. The added clause tells it to resolve that
// focus from whatever the user's own creativeDirection already establishes
// (a named role, a place, an atmosphere) rather than substituting something
// new -- reinforcing, not replacing, the equivalent instruction in
// writer/prompts.ts.
//
// RP-011C.8.10V: R1's "never inventing a substitute" stopped substitution,
// but the final rebenchmark found the Writer overcorrecting the other way --
// dissolving a figure the request DID establish (a lighthouse keeper, a
// train conductor) into agentless passive prose once it decided not to
// force an unwanted default. The added clause addresses that removal
// directly, reinforcing the equivalent instruction in writer/prompts.ts.
function resolveWritingFocus(
  scene: SceneBlueprint,
  blueprint: StoryBlueprint,
  intent: CreativeIntent,
  template: PresetGuidanceTemplate
): string {
  if (intent.preset === "kids-story") {
    return `Show "${scene.narrativeFunction.toLowerCase()}" through ${blueprint.protagonist.role}'s curiosity and connection with a friend, carried by dialogue and shared action rather than narration.`;
  }
  if (intent.preset === "meditation") {
    return `Invite the listener into "${scene.narrativeFunction.toLowerCase()}" as something to notice and gently explore, not a task to complete or a story to follow.`;
  }
  if (intent.preset === "classic-asmr") {
    if (intent.asmrMode !== "story") {
      return `Hold attention on "${scene.narrativeFunction.toLowerCase()}" as a sensory detail to notice right now, not a story to follow or a path toward rest.`;
    }
    // RP-011C.7 targeted fix: story mode's default phrasing below ("not to
    // advance a story or reach a destination") is exactly backwards for a
    // request that explicitly asked for narrative tension -- it's the
    // instruction that produced the confirmed live-regression failure
    // (mystery atmosphere with no actual clue, development, or reveal).
    return intent.asmrNarrativeTension
      ? `Move through "${scene.narrativeFunction.toLowerCase()}" as a genuine step in the mystery's unfolding -- a real clue, complication, escalation, or reveal belongs here -- while keeping delivery voice-first, intimate, and controlled, never rushed or frantic.`
      : `Move through "${scene.narrativeFunction.toLowerCase()}" within the scene's persona and setting, using it to carry sensory attention -- not to advance a story or reach a destination.`;
  }
  if (intent.preset === "sleep-story") {
    return intent.hasExplicitScenario
      ? `Follow the story world's focus through "${scene.narrativeFunction.toLowerCase()}", staying faithful to whatever central figure, place, or focus the user's own creative direction already establishes -- never inventing a substitute (such as a generic traveler), and never dissolving an established figure into passive or bodyless description once it exists -- via gentle movement and peaceful curiosity in the external world, not internal relaxation instruction or narrative tension.`
      : `Follow ${blueprint.protagonist.role} through "${scene.narrativeFunction.toLowerCase()}" via gentle movement and peaceful curiosity in the external world, not internal relaxation instruction or narrative tension.`;
  }
  return template.plotDriven
    ? `Show "${scene.narrativeFunction.toLowerCase()}" through ${blueprint.protagonist.role}'s choices and behavior, not narration.`
    : `Realize "${scene.narrativeFunction.toLowerCase()}" through concrete sensory and behavioral detail, not narration.`;
}

// Meditation's characterGuidance (RP-011C.8.8.2D) deliberately does not
// share sleep-story/classic-asmr's generic "center the listener's
// experience" text: it must explicitly rule out fictional characters and
// narrated persona, since the listener is a direct participant in their
// own experience, not a protagonist having one.
//
// Classic ASMR's characterGuidance (RP-011C.8.8.3D) also rules out
// fictional characters explicitly, distinct from sleep-story's generic
// text: the listener is the only presence being addressed, not a
// protagonist whose experience is being narrated. RP-011C.8.8.3M adds a
// story-mode variant: story mode's persona IS allowed (scenes/planner.ts
// already builds "Persona framing" scenes for it), but the persona exists
// only to hold sensory closeness -- it must not read as a character with
// its own arc, conflict, or plot the way Narrative's protagonist does.
//
// Sleep Story's characterGuidance (RP-011C.8.10G) also gets its own
// branch, replacing the generic non-plot fallback's "center the
// listener's experience directly" text: that phrasing collapses Sleep
// Story into the same listener-address shape as meditation/ASMR, when
// Sleep Story actually follows an in-world protagonist and companions
// (companions_as_warmth) who provide warmth and quiet kindness, not
// dependency, achievement, conflict, or a character arc.
//
// RP-011C.8.10P: when intent.hasExplicitScenario is true, "any companions"
// becomes explicitly optional ("mandatory to optional" per the Default Bias
// Calibration Review) -- the user's scenario may not involve a companion or
// even a character at all, so this branch stops asserting one exists.
//
// RP-011C.8.10R1: same "resolve from what the user already wrote, don't
// invent a substitute" clause as resolveWritingFocus above -- see that
// comment for why "the story world's focus" needed this reinforcement.
//
// RP-011C.8.10V: same removal/abstraction reinforcement as
// resolveWritingFocus above -- see that comment for the failure mode
// (agentless passive prose replacing an established figure) this addresses.
// RP-011C.7 targeted fix: classic-asmr story mode's default characterGuidance
// hardcodes a separate in-scene persona-I addressing the listener as "you" --
// correct for a persona-roleplay request ("you are a librarian speaking to
// me"), but exactly backwards when the user explicitly made the listener
// themselves the first-person experiencer ("from my perspective", "I am the
// one uncovering the secret"). The confirmed live-regression failure was the
// Writer following the grammatical "write in first person" instruction while
// this line still told it a separate persona addresses the listener as
// "you" -- this override replaces that instruction, rather than merely
// appending to it, whenever intent.listenerIsExperiencer is set.
function applyListenerExperiencerOverride(personaGuidance: string, intent: CreativeIntent): string {
  if (!intent.listenerIsExperiencer) return personaGuidance;
  return `The listener writes and experiences the scene as themselves, in first person -- they are the "I" living it directly ("I notice...", "I reach for..."), not a separate persona addressing them as "you"; do not introduce a distinct persona-I unless the request also explicitly asks for a separate roleplay character.`;
}

function resolveCharacterGuidance(blueprint: StoryBlueprint, intent: CreativeIntent, template: PresetGuidanceTemplate): string {
  if (intent.preset === "kids-story") {
    return `${blueprint.protagonist.role} acts from ${blueprint.protagonist.desire}, seen through a child's eyes, not adult introspection.`;
  }
  if (intent.preset === "meditation") {
    return "The listener is a direct participant in their own present-moment experience, not a character in a story; no fictional characters or narrated persona.";
  }
  if (intent.preset === "classic-asmr") {
    if (intent.asmrMode !== "story") {
      return "The listener is the only presence in the scene, addressed directly; no fictional characters, dialogue partners, or narrated persona.";
    }
    const personaGuidance = intent.asmrNarrativeTension
      ? "The listener is guided by a gentle in-scene persona addressed directly to them as the mystery unfolds; the persona exists to hold sensory closeness while narrating a genuine clue, complication, escalation, and reveal -- it may carry real story movement, just never shouting or frantic pacing."
      : "The listener is guided by a gentle in-scene persona addressed directly to them; the persona exists to hold sensory closeness, not to carry a character arc, conflict, or plot.";
    return applyListenerExperiencerOverride(personaGuidance, intent);
  }
  if (intent.preset === "sleep-story") {
    return intent.hasExplicitScenario
      ? "Follow the story world's focus, staying faithful to whatever character, place, journey, or atmosphere the user's own creative direction already establishes -- never inventing a substitute, such as a generic traveler, to fill that role, and never removing or abstracting an established figure into passive description once it is introduced; any companion is optional -- if one is present it offers quiet, familiar presence, warmth without dependency, not a character arc, achievement, conflict, or resistance to overcome."
      : `${blueprint.protagonist.role} and any companions offer quiet, familiar presence -- warmth without dependency, not a character arc, achievement, conflict, or resistance to overcome.`;
  }
  return template.plotDriven
    ? `${blueprint.protagonist.role} acts from ${blueprint.protagonist.desire}, not plot convenience.`
    : `Center ${blueprint.protagonist.role}'s experience directly; no character arc is required.`;
}

// story_is_change / trust_the_reader / scene_has_purpose / avoid_ai_writing_patterns
// are the global principles this layer must consider (per the RP-011C.7.25
// brief); premise_fulfillment is the preset-scoped one (narrative only).
// All are read from context.knowledge.modules -- already resolved by the
// Context Builder for this intent's preset -- never re-queried from the
// registry. scene_has_purpose and avoid_ai_writing_patterns explicitly
// permit ordinary, unremarkable scenes, which is why they feed
// allowedElements rather than avoidPatterns.
function resolveAllowedElements(scene: SceneBlueprint, context: CreativeContext, template: PresetGuidanceTemplate): string[] {
  const permissiveKnowledge = [
    ...(findModule(context, "avoid_ai_writing_patterns")?.knowledge ?? []),
    ...(findModule(context, "scene_has_purpose")?.knowledge ?? []),
  ];
  return Array.from(new Set([...template.allowedElementsBase, ...scene.requiredElements, ...permissiveKnowledge]));
}

function resolveStyleGuidance(context: CreativeContext, template: PresetGuidanceTemplate): string {
  const premiseFulfillment = findModule(context, "premise_fulfillment");
  return premiseFulfillment
    ? `${template.styleGuidance} Keep this scene's resolution scale consistent with the story's promised scope.`
    : template.styleGuidance;
}

export const buildGenerationGuidance: GenerationGuidanceBuilder = (params: BuildGenerationGuidanceParams) => {
  const { scenes, blueprint, context, intent, createdAt } = params;
  const template = resolveTemplate(intent);
  const timestamp = createdAt ?? new Date().toISOString();
  const wordBudget = resolveWordBudget(intent, scenes.length);

  return scenes.map((scene): GenerationGuidance => ({
    sceneId: scene.id,
    writingFocus: resolveWritingFocus(scene, blueprint, intent, template),
    narrativeIntent: `Achieve: ${scene.desiredChange}`,
    // trust_the_reader (RP-011C.7.20): meaning should emerge through
    // action and detail, not be stated -- applied here per-scene via the
    // scene's own emotionalState rather than a generic instruction.
    emotionalApproach: `Convey "${scene.emotionalState}" through action and detail; do not state it directly.`,
    characterGuidance: resolveCharacterGuidance(blueprint, intent, template),
    dialogueGuidance: template.dialogueGuidance,
    pacingGuidance: template.pacingGuidance,
    descriptionGuidance: template.descriptionGuidance,
    allowedElements: resolveAllowedElements(scene, context, template),
    avoidPatterns: scene.avoidPatterns,
    styleGuidance: resolveStyleGuidance(context, template),
    targetWordCount: wordBudget?.wordsPerScene,
    metadata: {
      createdAt: timestamp,
      version: GUIDANCE_BUILDER_VERSION,
      builderMethod: "deterministic-template",
    },
  }));
};
