// lib/creative-intelligence/scenes/templates.ts
//
// Deterministic per-preset scene structures consumed by planner.ts. Each
// entry describes a scene's narrative *task* (what it needs to accomplish,
// derived from the StoryBlueprint's own content) -- never a fixed
// screenplay slot ("the hook", "the midpoint twist"). Mirrors the pattern
// already used by planning/templates.ts: short structural fields, no prose,
// no dialogue, no LLM calls.
//
// Presets are not all treated as "story with scenes": narrative plans a
// story progression, sleep-story an arrival-to-rest experience, meditation
// a guided-practice structure, kids-story an age-safe adventure/discovery
// structure, and classic-asmr a sensory-comfort progression of rhythmic
// attention and gentle repetition-with-variation.

import type { MeditationExperienceType } from "../core/constants";
import type { StoryBlueprint, TurningPoint } from "../core/types";

// One planned step's narrative task. Every field is a function of the
// StoryBlueprint it is planning for, so purpose/conflict/change stay tied
// to the blueprint's actual content (protagonist, trajectory, emotional
// arc) instead of a generic position label.
export type SceneStepDefinition = {
  narrativeFunction: string;
  purpose: (blueprint: StoryBlueprint) => string;
  conflict: (blueprint: StoryBlueprint) => string;
  desiredChange: (blueprint: StoryBlueprint) => string;
  emotionalState: (blueprint: StoryBlueprint) => string;
  settingGuidance: (blueprint: StoryBlueprint) => string;
  relatedStoryProgression: (blueprint: StoryBlueprint) => string;
};

function turningPointSceneStep(tp: TurningPoint, precedingBeat: string): SceneStepDefinition {
  return {
    narrativeFunction: "Show turning point consequence",
    purpose: () => `Show the moment ${tp.description}`,
    conflict: () => tp.description,
    desiredChange: () => tp.consequence,
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => `A charged moment following "${precedingBeat}"`,
    relatedStoryProgression: () => tp.description,
  };
}

// Narrative: plot-driven presets plan story-progression scenes directly
// from the blueprint's own trajectory, so length and content vary with
// storyScale/turningPoints instead of a fixed count. Turning points are
// inserted as their own scenes right before the resolution beat, since
// they describe a distinct dramatic moment the progression label alone
// does not capture.
export function buildNarrativeSceneSteps(blueprint: StoryBlueprint): SceneStepDefinition[] {
  const { trajectory, protagonist, emotionalArc } = blueprint;
  const beats = trajectory.progression;

  const beatSteps: SceneStepDefinition[] = beats.map((beat, index) => {
    const isFirst = index === 0;
    const isLast = index === beats.length - 1;

    if (isFirst) {
      return {
        narrativeFunction: "Establish starting condition",
        purpose: () => `Show ${protagonist.role}'s ${protagonist.initialState}`,
        conflict: () => protagonist.internalConflict,
        desiredChange: () => "Audience understands what needs to change",
        emotionalState: () => emotionalArc.beginning,
        settingGuidance: () => `Consistent with the starting point: "${beat}"`,
        relatedStoryProgression: () => beat,
      };
    }

    if (isLast) {
      return {
        narrativeFunction: "Resolve toward the ending state",
        purpose: () => `Show ${protagonist.role} arriving at "${beat}"`,
        conflict: () => "Residual tension settles rather than escalates",
        desiredChange: () => `${protagonist.role} reaches the story's ending state`,
        emotionalState: () => emotionalArc.end,
        settingGuidance: () => `Consistent with the ending state: "${beat}"`,
        relatedStoryProgression: () => beat,
      };
    }

    return {
      narrativeFunction: "Show progress toward change",
      purpose: () => `Show ${protagonist.role} moving through "${beat}"`,
      conflict: () => `${protagonist.externalGoal} meets resistance`,
      desiredChange: () => "Audience sees measurable movement toward the ending state",
      emotionalState: () => emotionalArc.middle,
      settingGuidance: () => `Consistent with "${beat}"`,
      relatedStoryProgression: () => beat,
    };
  });

  // Insert one scene per turning point immediately before the final
  // (resolution) beat -- turning points only exist for plot-driven
  // presets/scales in the first place (see planning/blueprint-builder.ts).
  const precedingBeat = beats[Math.max(beats.length - 2, 0)];
  const turningPointSteps = trajectory.turningPoints.map((tp) => turningPointSceneStep(tp, precedingBeat));
  const insertAt = Math.max(beatSteps.length - 1, 0);
  beatSteps.splice(insertAt, 0, ...turningPointSteps);

  return beatSteps;
}

// Sleep Story: an external, in-world journey the listener follows through a
// peaceful place -- not a wind-down through the listener's own restlessness
// (that was this template's pre-calibration shape, and it borrowed
// meditation's/classic-asmr's inward-attention framing: "lingering wakeful
// tension", "residual restlessness", "intrusive thoughts"). As of
// RP-011C.8.10F this is recalibrated to match the identity established by
// the Sleep Story Knowledge Foundation (knowledge/sleep-story/*) and
// Planning Calibration (resolveSleepStoryProtagonist,
// SLEEP_STORY_PROGRESSION_BY_SCALE in planning/*): the protagonist is an
// in-world traveler the listener follows, movement comes from gentle
// curiosity rather than tension to resolve (movement_without_urgency), and
// the place/companions provide belonging rather than the listener
// overcoming an internal state (comfort_baseline_and_belonging,
// companions_as_warmth, rest_worthy_setting). "conflict" is read the same
// way classic-asmr's steps read it -- never antagonism, and never an
// internal obstacle the scene must resolve -- so every step below states
// what's absent rather than what must be overcome, exactly like
// CLASSIC_ASMR_SCENE_STEPS's "None -- ..." pattern. Five steps, not four:
// the prior four-step shape collapsed exploration/discovery into
// "immersion", leaving no room for the gentle wandering and small
// discoveries episodic_meandering_structure and movement_without_urgency
// both call for. Fixed structure regardless of storyScale, matching
// meditation's/classic-asmr's own fixed shapes -- a longer bedtime listen
// spends more time in the same unhurried rhythm, it doesn't add new
// movements (see SLEEP_STORY_PROGRESSION_BY_SCALE's own comment in
// planning/templates.ts for the same principle at the planning layer).
export const SLEEP_STORY_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Arrival",
    purpose: (b) => `Welcome ${b.protagonist.role} into a peaceful, familiar-feeling place`,
    conflict: () => "None -- an unhurried arrival with nothing pressing to attend to",
    desiredChange: () => "Attention settles onto the place, rather than staying on the day just left behind",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A safe, bounded, low-stimulation setting that reads as familiar rather than novel",
    relatedStoryProgression: () => "arrival",
  },
  {
    narrativeFunction: "Settling",
    purpose: (b) => `Welcome ${b.protagonist.role} with quiet kindness, so the place feels like somewhere to belong`,
    conflict: () => "None -- comfort accumulates through small, unhurried gestures of welcome",
    desiredChange: () => "The place and any companions in it feel welcoming, with nowhere else to be",
    emotionalState: () => "settling into belonging",
    settingGuidance: () => "The arrival setting, lingered on for its own sake -- a companion or gentle host may offer quiet welcome",
    relatedStoryProgression: () => "settling",
  },
  {
    narrativeFunction: "Gentle exploration",
    purpose: (b) => `Let ${b.protagonist.role} wander through the place, noticing small things because they're pleasant to notice`,
    conflict: () => "None -- gentle curiosity draws attention onward at its own unhurried pace",
    desiredChange: () => "Small, low-stakes discoveries deepen the sense of the place without introducing anything to solve",
    emotionalState: () => "quietly curious",
    settingGuidance: () => "The same bounded world, explored at a meandering pace -- new sensory detail introduced one or two senses at a time",
    relatedStoryProgression: () => "gentle exploration",
  },
  {
    narrativeFunction: "Deeper immersion",
    purpose: (b) => `Deepen ${b.protagonist.role}'s immersion in the place, with any companions present simply for warmth`,
    conflict: () => "None -- attention narrows toward the immediate, sensory present",
    desiredChange: () => "Awareness rests fully in the place, no longer drawn toward anything outside it",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "A fully established, unhurried environment -- sensory detail shifts from sight and sound toward warmth, weight, and stillness",
    relatedStoryProgression: () => "deeper immersion",
  },
  {
    narrativeFunction: "Gradual rest",
    purpose: (b) => `Let ${b.protagonist.role} settle toward rest, closing on a concrete, settled image or action`,
    conflict: () => "None remaining -- there is nothing left to resolve",
    desiredChange: () => "Listener drifts toward sleep as the scene reaches a quiet, complete close",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "Quiet, still, minimal sensory input, closing on a concrete, settled image or action -- a complete sentence with normal terminal punctuation, never a literal ellipsis or an unfinished sentence",
    relatedStoryProgression: () => "gradual rest",
  },
];

// Sleep Story, explicit-scenario variant (RP-011C.8.10P): selected instead
// of SLEEP_STORY_SCENE_STEPS above when intent.hasExplicitScenario is true
// -- i.e. the user supplied a concrete creativeDirection (a valley walk, a
// snowy-mountain train, a quiet coastline). SLEEP_STORY_SCENE_STEPS's first
// two steps hardcode "Arrival"/"Welcome ... into a peaceful, familiar-
// feeling place", which forces an arrival-and-welcome-ritual opening even
// when the user's scenario already implies a different opening shape
// (already walking, already resting, observing, discovering). This variant
// keeps the same five-phase shape and the same "conflict: None" pattern,
// but its wording never assumes arrival, a welcome, a host, or a companion
// -- those only appear if the scenario the user described calls for them.
// Same fixed structure regardless of storyScale, matching
// SLEEP_STORY_SCENE_STEPS's own rationale above.
export const SLEEP_STORY_EXPLICIT_SCENARIO_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Opening",
    purpose: () =>
      "Open within the scenario the user described, following whatever opening it already implies -- arriving, already present, walking, observing, or discovering -- without forcing an arrival or welcome ritual that doesn't fit",
    conflict: () => "None -- an unhurried opening with nothing pressing to attend to",
    desiredChange: () => "Attention settles into the scenario's world as the user described it",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () =>
      "The setting and situation the user's creative direction describes, established as-is -- no arrival or welcome ritual unless the scenario itself implies one",
    relatedStoryProgression: () => "opening",
  },
  {
    narrativeFunction: "Settling",
    purpose: (b) => `Let ${b.protagonist.role} settle further into the scenario, so it feels familiar and unhurried`,
    conflict: () => "None -- comfort accumulates through small, unhurried detail",
    desiredChange: () => "The scenario feels lived-in, with nowhere else to be",
    emotionalState: () => "settling into belonging",
    settingGuidance: () =>
      "The scenario already established, lingered on for its own sake -- a companion appears only if the scenario calls for one",
    relatedStoryProgression: () => "settling",
  },
  {
    narrativeFunction: "Gentle exploration",
    purpose: (b) => `Let ${b.protagonist.role} continue through the scenario, noticing small things because they're pleasant to notice`,
    conflict: () => "None -- gentle curiosity draws attention onward at its own unhurried pace",
    desiredChange: () => "Small, low-stakes discoveries deepen the scenario without introducing anything to solve",
    emotionalState: () => "quietly curious",
    settingGuidance: () => "The same scenario, continued at a meandering pace -- new sensory detail introduced one or two senses at a time",
    relatedStoryProgression: () => "gentle exploration",
  },
  {
    narrativeFunction: "Deeper immersion",
    purpose: (b) => `Deepen ${b.protagonist.role}'s immersion in the scenario`,
    conflict: () => "None -- attention narrows toward the immediate, sensory present",
    desiredChange: () => "Awareness rests fully in the scenario, no longer drawn toward anything outside it",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "The fully established scenario -- sensory detail shifts from sight and sound toward warmth, weight, and stillness",
    relatedStoryProgression: () => "deeper immersion",
  },
  {
    narrativeFunction: "Gradual rest",
    purpose: (b) => `Let ${b.protagonist.role} settle toward rest within the scenario, closing on a concrete, settled image or action`,
    conflict: () => "None remaining -- there is nothing left to resolve",
    desiredChange: () => "Listener drifts toward sleep as the scene reaches a quiet, complete close",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "Quiet, still, minimal sensory input, closing on a concrete, settled image or action -- a complete sentence with normal terminal punctuation, never a literal ellipsis or an unfinished sentence",
    relatedStoryProgression: () => "gradual rest",
  },
];

// Meditation: a guided-practice structure, not a story with characters or
// plot conflict. As of calibration RP-011C.8.8.2C this is six phases, not
// four: attention/awareness practice moves through distinct anchor,
// physical, and integration phases that a single "guided attention" ->
// "deepening practice" jump was collapsing together, understating the
// awareness progression a real practice moves through. Fixed structure
// regardless of storyScale, matching sleep-story/classic-asmr -- a longer
// meditation deepens each phase rather than adding more of them. "conflict"
// below is read as gentle tension to be eased (per StoryPremise), never
// antagonism; no characters, discoveries, or story events are introduced.
export const MEDITATION_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Arrival and settling",
    purpose: (b) => `Ease ${b.protagonist.role} into the practice, establishing presence and reducing outward attention`,
    conflict: () => "Lingering outward attention and mental noise from before the practice",
    desiredChange: () => "Attention shifts from the surrounding environment toward the practice",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, low-stimulation starting point that reduces external attention",
    relatedStoryProgression: () => "arrival and settling",
  },
  {
    narrativeFunction: "Breath and attention anchoring",
    purpose: (b) => `Anchor ${b.protagonist.role}'s attention on the breath or a chosen point of focus`,
    conflict: () => "Attention slips away from the breath or chosen anchor",
    desiredChange: () => "Attention stabilizes on the breath or chosen anchor",
    emotionalState: () => "anchoring attention",
    settingGuidance: () => "Continuation of the settled starting point, attention narrowing to the anchor",
    relatedStoryProgression: () => "breath and attention anchoring",
  },
  {
    narrativeFunction: "Body awareness and relaxation",
    purpose: (b) => `Guide ${b.protagonist.role}'s awareness through the body, releasing held tension`,
    conflict: () => "Physical tension held without notice",
    desiredChange: () => "Physical tension is noticed and allowed to release",
    emotionalState: () => "settling into the body",
    settingGuidance: () => "Minimal distraction, attention moving through the body",
    relatedStoryProgression: () => "body awareness and relaxation",
  },
  {
    narrativeFunction: "Practice deepening",
    purpose: (b) => `Deepen ${b.protagonist.role}'s awareness through continued attention or gentle visualization`,
    conflict: () => "Impatience or self-judgment about the pace of the practice",
    desiredChange: () => "Awareness deepens without strain",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Consistent, unhurried continuation of the practice",
    relatedStoryProgression: () => "practice deepening",
  },
  {
    narrativeFunction: "Integration",
    purpose: (b) => `Help ${b.protagonist.role} connect with and reflect on the experience`,
    conflict: () => "The felt experience fades before it can be absorbed",
    desiredChange: () => "The practice's calm becomes something felt and remembered, not just performed",
    emotionalState: () => "quietly integrating",
    settingGuidance: () => "A quiet space to let the practice's effects settle and register",
    relatedStoryProgression: () => "integration",
  },
  {
    narrativeFunction: "Gentle return",
    purpose: (b) => `Guide ${b.protagonist.role} back to ordinary awareness, carrying the calm forward`,
    conflict: () => "None remaining -- attention has settled and integrated",
    desiredChange: () => "Centered awareness carries forward into ordinary activity",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "A soft, unhurried close, returning attention outward",
    relatedStoryProgression: () => "gentle return",
  },
];

// Meditation experience-type-specific scene structures. MEDITATION_SCENE_STEPS
// above stays the fixed shape for "breath_presence" (the control case: a
// plain breath/attention meditation, and the pre-existing default for any
// meditation request with no more specific signal) -- these seven cover the
// other MeditationExperienceType values (intent/classifiers.ts
// classifyMeditationExperienceType), so different meditation intents plan
// through a structure that actually reflects what was asked for instead of
// the same arrival -> breath anchor -> body scan -> return shape every time.
// Each keeps the same "arrival, anchor/focus stage, ..., return" shape
// evaluation/evaluator.ts's attention_progression criterion already expects
// -- only what happens between arrival and return differs. guided_imagery's
// "imagined space" framing stays grounded in knowledge/meditation/
// gentle-visualization.ts's own limits (still, supportive, no plot or
// characters), never a story or fantasy world.
export const MEDITATION_SELF_COMPASSION_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Arrival and settling",
    purpose: (b) => `Ease ${b.protagonist.role} into the practice, settling attention inward with gentleness`,
    conflict: () => "Self-critical noise carried in from before the practice",
    desiredChange: () => "Attention shifts from self-judgment toward gentle self-awareness",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, unhurried starting point that invites gentleness toward oneself",
    relatedStoryProgression: () => "arrival and settling",
  },
  {
    narrativeFunction: "Self-kindness anchor",
    purpose: (b) => `Invite ${b.protagonist.role} to offer themselves the same warmth they would offer a friend`,
    conflict: () => "An inner critical voice resisting warmth turned inward",
    desiredChange: () => "Attention anchors on self-kindness as a felt, not just conceptual, practice",
    emotionalState: () => "softening toward oneself",
    settingGuidance: () => "Continuation of the settled starting point, attention narrowing to self-directed warmth",
    relatedStoryProgression: () => "self-kindness anchor",
  },
  {
    narrativeFunction: "Meeting difficulty with warmth",
    purpose: (b) =>
      `Guide ${b.protagonist.role} to notice a difficulty or discomfort and meet it with acceptance rather than resistance`,
    conflict: () => "Discomfort met with old habits of self-criticism",
    desiredChange: () => "Difficulty is held with warmth instead of judgment",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Minimal distraction, attention resting gently on whatever feels difficult",
    relatedStoryProgression: () => "meeting difficulty with warmth",
  },
  {
    narrativeFunction: "Compassionate acceptance",
    purpose: (b) => `Deepen ${b.protagonist.role}'s sense of being worthy of their own care and acceptance`,
    conflict: () => "Doubt about deserving this kindness",
    desiredChange: () => "Self-acceptance deepens without needing to fix or change anything",
    emotionalState: () => "quietly accepting",
    settingGuidance: () => "Consistent, unhurried continuation of the practice",
    relatedStoryProgression: () => "compassionate acceptance",
  },
  {
    narrativeFunction: "Integration",
    purpose: (b) => `Help ${b.protagonist.role} let this self-kindness settle in as something felt, not just practiced`,
    conflict: () => "The felt warmth fades before it can be absorbed",
    desiredChange: () => "Self-compassion becomes something felt and remembered",
    emotionalState: () => "quietly integrating",
    settingGuidance: () => "A quiet space to let this warmth settle and register",
    relatedStoryProgression: () => "integration",
  },
  {
    narrativeFunction: "Gentle return",
    purpose: (b) => `Guide ${b.protagonist.role} back to ordinary awareness, carrying this self-kindness forward`,
    conflict: () => "None remaining -- warmth has settled and integrated",
    desiredChange: () => "Self-compassion carries forward into ordinary activity",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "A soft, unhurried close, returning attention outward with the same gentleness",
    relatedStoryProgression: () => "gentle return",
  },
];

export const MEDITATION_MORNING_PRESENCE_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Waking arrival",
    purpose: (b) => `Ease ${b.protagonist.role} into wakeful presence, meeting the start of the day without rushing into it`,
    conflict: () => "Grogginess or the pull to rush straight into the day's demands",
    desiredChange: () => "Attention settles into the present moment before the day takes over",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, unhurried starting point at the beginning of the day",
    relatedStoryProgression: () => "waking arrival",
  },
  {
    narrativeFunction: "Body waking anchor",
    purpose: (b) => `Anchor ${b.protagonist.role}'s attention on the body as it wakes, noticing breath and sensation without effort`,
    conflict: () => "Attention pulled toward the day's tasks instead of the waking body",
    desiredChange: () => "Attention stabilizes on the body's own waking rhythm",
    emotionalState: () => "anchoring attention",
    settingGuidance: () => "Continuation of the settled starting point, attention narrowing to the waking body",
    relatedStoryProgression: () => "body waking anchor",
  },
  {
    narrativeFunction: "Setting an intention for the day",
    purpose: (b) => `Invite ${b.protagonist.role} to notice how they want to meet the day ahead, without planning or performance`,
    conflict: () => "Pressure to plan or perform rather than simply notice",
    desiredChange: () => "A quiet intention forms without needing to be decided or forced",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Unhurried continuation, attention turning gently toward the day ahead",
    relatedStoryProgression: () => "setting an intention for the day",
  },
  {
    narrativeFunction: "Gentle activation",
    purpose: (b) => `Guide ${b.protagonist.role} toward a light, grounded sense of readiness for the day`,
    conflict: () => "Urgency to become alert quickly instead of gradually",
    desiredChange: () => "Alertness rises gently, without strain or rush",
    emotionalState: () => "gently activating",
    settingGuidance: () => "A gradual shift from stillness toward readiness",
    relatedStoryProgression: () => "gentle activation",
  },
  {
    narrativeFunction: "Gentle return",
    purpose: (b) => `Guide ${b.protagonist.role} back into the day, carrying this settled presence forward`,
    conflict: () => "None remaining -- presence has settled and is ready to carry forward",
    desiredChange: () => "Centered presence carries forward into the day ahead",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "A soft, unhurried close, returning attention outward into the day",
    relatedStoryProgression: () => "gentle return",
  },
];

export const MEDITATION_EVENING_WIND_DOWN_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Settling arrival",
    purpose: (b) => `Ease ${b.protagonist.role} into the evening, letting the day's momentum begin to settle`,
    conflict: () => "Leftover momentum and mental noise from the day",
    desiredChange: () => "Attention shifts from the day's activity toward evening stillness",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, low-stimulation starting point at the close of the day",
    relatedStoryProgression: () => "settling arrival",
  },
  {
    narrativeFunction: "Releasing the day anchor",
    purpose: (b) => `Anchor ${b.protagonist.role}'s attention on letting go of what the day carried`,
    conflict: () => "Thoughts or tension from the day still held onto",
    desiredChange: () => "Attention stabilizes on releasing rather than replaying the day",
    emotionalState: () => "anchoring attention",
    settingGuidance: () => "Continuation of the settled starting point, attention narrowing to release",
    relatedStoryProgression: () => "releasing the day anchor",
  },
  {
    narrativeFunction: "Letting go of tension",
    purpose: (b) => `Guide ${b.protagonist.role} through noticing and releasing tension gathered over the day`,
    conflict: () => "Tension held without notice",
    desiredChange: () => "Tension is noticed and allowed to soften",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Minimal distraction, attention easing through the body",
    relatedStoryProgression: () => "letting go of tension",
  },
  {
    narrativeFunction: "Easing toward rest",
    purpose: (b) => `Deepen ${b.protagonist.role}'s ease as attention slows toward rest`,
    conflict: () => "Impatience with how slowly the mind settles",
    desiredChange: () => "Ease deepens without needing to be hurried",
    emotionalState: () => "settling toward rest",
    settingGuidance: () => "Consistent, unhurried continuation toward stillness",
    relatedStoryProgression: () => "easing toward rest",
  },
  {
    narrativeFunction: "Gentle return",
    purpose: (b) => `Guide ${b.protagonist.role} toward a quiet close, ready for rest or sleep`,
    conflict: () => "None remaining -- the day has been released",
    desiredChange: () => "The day's weight has eased, leaving quiet readiness for rest",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "A soft, quiet close, unhurried and settled",
    relatedStoryProgression: () => "gentle return",
  },
];

export const MEDITATION_STRESS_RELEASE_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Arrival and settling",
    purpose: (b) => `Ease ${b.protagonist.role} into the practice, acknowledging the stress or tension carried in`,
    conflict: () => "Stress and mental noise carried in from before the practice",
    desiredChange: () => "Attention shifts from outward stress toward the present moment",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, low-stimulation starting point that reduces outward pressure",
    relatedStoryProgression: () => "arrival and settling",
  },
  {
    narrativeFunction: "Naming tension anchor",
    purpose: (b) =>
      `Anchor ${b.protagonist.role}'s attention on noticing where stress or tension is held, without needing to fix it`,
    conflict: () => "Tension held without being noticed",
    desiredChange: () => "Attention stabilizes on noticing tension directly",
    emotionalState: () => "anchoring attention",
    settingGuidance: () => "Continuation of the settled starting point, attention narrowing to where tension is held",
    relatedStoryProgression: () => "naming tension anchor",
  },
  {
    narrativeFunction: "Releasing physical and mental tension",
    purpose: (b) => `Guide ${b.protagonist.role} through releasing physical tension and quieting an overactive mind`,
    conflict: () => "Physical tension and racing thoughts held without release",
    desiredChange: () => "Physical tension and mental overactivation are noticed and allowed to ease",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Minimal distraction, attention moving through tension and mental noise",
    relatedStoryProgression: () => "releasing physical and mental tension",
  },
  {
    narrativeFunction: "Settling the nervous system",
    purpose: (b) => `Deepen ${b.protagonist.role}'s sense of safety as the nervous system settles`,
    conflict: () => "Lingering alertness resisting settling",
    desiredChange: () => "A felt sense of calm and safety deepens",
    emotionalState: () => "settling",
    settingGuidance: () => "Consistent, unhurried continuation of the settling practice",
    relatedStoryProgression: () => "settling the nervous system",
  },
  {
    narrativeFunction: "Integration",
    purpose: (b) => `Help ${b.protagonist.role} connect with the calm now available, letting it register`,
    conflict: () => "The felt relief fades before it can be absorbed",
    desiredChange: () => "The stress relief becomes something felt and remembered",
    emotionalState: () => "quietly integrating",
    settingGuidance: () => "A quiet space to let the released tension settle and register",
    relatedStoryProgression: () => "integration",
  },
  {
    narrativeFunction: "Calm return",
    purpose: (b) => `Guide ${b.protagonist.role} back to ordinary awareness, carrying this calm forward`,
    conflict: () => "None remaining -- tension has eased and settled",
    desiredChange: () => "A calmer, steadier state carries forward into ordinary activity",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "A soft, unhurried close, returning attention outward",
    relatedStoryProgression: () => "calm return",
  },
];

export const MEDITATION_BODY_RELAXATION_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Arrival and settling",
    purpose: (b) => `Ease ${b.protagonist.role} into the practice, settling attention into the body`,
    conflict: () => "Outward attention and mental noise from before the practice",
    desiredChange: () => "Attention shifts from the surrounding environment toward the body",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, low-stimulation starting point that reduces outward attention",
    relatedStoryProgression: () => "arrival and settling",
  },
  {
    narrativeFunction: "Body scan anchor",
    purpose: (b) => `Anchor ${b.protagonist.role}'s attention on a slow, gentle scan through the body`,
    conflict: () => "Attention slips away from the body scan",
    desiredChange: () => "Attention stabilizes on moving gently through the body",
    emotionalState: () => "anchoring attention",
    settingGuidance: () => "Continuation of the settled starting point, attention narrowing to the body scan",
    relatedStoryProgression: () => "body scan anchor",
  },
  {
    narrativeFunction: "Progressive body relaxation",
    purpose: (b) => `Guide ${b.protagonist.role} through releasing tension area by area, moving gradually through the body`,
    conflict: () => "Physical tension held without notice",
    desiredChange: () => "Tension is noticed and released area by area",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Minimal distraction, attention moving gradually through the body",
    relatedStoryProgression: () => "progressive body relaxation",
  },
  {
    narrativeFunction: "Full-body release",
    purpose: (b) => `Deepen ${b.protagonist.role}'s sense of the whole body settling and releasing together`,
    conflict: () => "Some areas still holding tension after the scan",
    desiredChange: () => "The whole body settles into a deeper, fuller release",
    emotionalState: () => "deepening release",
    settingGuidance: () => "Consistent, unhurried continuation, attention resting on the whole body",
    relatedStoryProgression: () => "full-body release",
  },
  {
    narrativeFunction: "Integration",
    purpose: (b) => `Help ${b.protagonist.role} connect with the felt sense of a relaxed body`,
    conflict: () => "The felt relaxation fades before it can be absorbed",
    desiredChange: () => "The body's relaxation becomes something felt and remembered",
    emotionalState: () => "quietly integrating",
    settingGuidance: () => "A quiet space to let the body's relaxation settle and register",
    relatedStoryProgression: () => "integration",
  },
  {
    narrativeFunction: "Gentle return",
    purpose: (b) => `Guide ${b.protagonist.role} back to ordinary awareness, carrying this bodily ease forward`,
    conflict: () => "None remaining -- the body has settled and released",
    desiredChange: () => "A relaxed body carries forward into ordinary activity",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "A soft, unhurried close, returning attention outward",
    relatedStoryProgression: () => "gentle return",
  },
];

export const MEDITATION_SLEEP_ORIENTED_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Settling arrival",
    purpose: (b) => `Ease ${b.protagonist.role} into the practice, letting outward attention give way to stillness`,
    conflict: () => "Wakeful alertness and mental noise from the day",
    desiredChange: () => "Attention shifts from outward alertness toward stillness",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, low-stimulation starting point, dimming outward attention",
    relatedStoryProgression: () => "settling arrival",
  },
  {
    narrativeFunction: "Body anchor",
    purpose: (b) => `Anchor ${b.protagonist.role}'s attention on the body's heaviness and stillness`,
    conflict: () => "Attention slips back toward wakeful thoughts",
    desiredChange: () => "Attention stabilizes on the body's growing heaviness and stillness",
    emotionalState: () => "anchoring attention",
    settingGuidance: () => "Continuation of the settled starting point, attention narrowing to the body's stillness",
    relatedStoryProgression: () => "body anchor",
  },
  {
    narrativeFunction: "Releasing wakeful attention",
    purpose: (b) => `Guide ${b.protagonist.role} through releasing the last threads of wakeful, active attention`,
    conflict: () => "Wakeful attention resisting the pull toward rest",
    desiredChange: () => "Wakeful attention loosens and fades",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Minimal distraction, attention softening toward sleep",
    relatedStoryProgression: () => "releasing wakeful attention",
  },
  {
    narrativeFunction: "Deepening toward sleep",
    purpose: (b) => `Deepen ${b.protagonist.role}'s stillness as attention grows heavier and slower`,
    conflict: () => "Occasional resurfacing of alertness",
    desiredChange: () => "Stillness deepens, unresisted, toward sleep",
    emotionalState: () => "deepening toward sleep",
    settingGuidance: () => "Consistent, unhurried continuation, attention growing heavier",
    relatedStoryProgression: () => "deepening toward sleep",
  },
  {
    narrativeFunction: "Drifting return",
    purpose: (b) => `Let ${b.protagonist.role} drift toward sleep, with nothing left to do or notice`,
    conflict: () => "None remaining -- there is nothing left to hold onto",
    desiredChange: () => "Attention drifts naturally toward sleep",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () =>
      "Quiet, still, minimal sensory input, closing on a soft, unfinished sense of drifting rather than a firm ending",
    relatedStoryProgression: () => "drifting return",
  },
];

export const MEDITATION_GUIDED_IMAGERY_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Arrival",
    purpose: (b) => `Ease ${b.protagonist.role} into stillness before entering the imagined space`,
    conflict: () => "Outward attention and mental noise from before the practice",
    desiredChange: () => "Attention settles enough to be ready to imagine",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A still, low-stimulation starting point before the imagined space begins",
    relatedStoryProgression: () => "arrival",
  },
  {
    narrativeFunction: "Entering the imagined space anchor",
    purpose: (b) => `Anchor ${b.protagonist.role}'s attention by gently inviting them into a simple, calm imagined space`,
    conflict: () => "Attention slips away from the imagined space back to outward concerns",
    desiredChange: () => "Attention settles into the simple, calm imagined space",
    emotionalState: () => "anchoring attention",
    settingGuidance: () =>
      "A simple, still, supportive imagined space -- a shore, a quiet room -- with no plot, characters, or events",
    relatedStoryProgression: () => "entering the imagined space anchor",
  },
  {
    narrativeFunction: "Sensory immersion in the space",
    purpose: (b) => `Guide ${b.protagonist.role} through noticing simple sensory detail within the imagined space`,
    conflict: () => "The imagined space could tip into an eventful story instead of staying still",
    desiredChange: () => "Sensory detail deepens the sense of being within the space, without narrative or characters",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "Continued stillness within the imagined space, sensory and spacious, never eventful",
    relatedStoryProgression: () => "sensory immersion in the space",
  },
  {
    narrativeFunction: "Resting within the space",
    purpose: (b) => `Deepen ${b.protagonist.role}'s sense of resting fully within the imagined space`,
    conflict: () => "Restlessness pulling attention away from the space",
    desiredChange: () => "A settled sense of resting within the space deepens",
    emotionalState: () => "resting",
    settingGuidance: () => "Consistent, unhurried continuation, resting within the same still space",
    relatedStoryProgression: () => "resting within the space",
  },
  {
    narrativeFunction: "Gentle return",
    purpose: (b) => `Guide ${b.protagonist.role} gently out of the imagined space and back to ordinary awareness`,
    conflict: () => "None remaining -- the space has offered its calm",
    desiredChange: () => "Calm from the imagined space carries forward into ordinary awareness",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "A soft, unhurried close, leaving the imagined space behind gently",
    relatedStoryProgression: () => "gentle return",
  },
];

// Selects the meditation scene structure for a given MeditationExperienceType
// (intent/classifiers.ts classifyMeditationExperienceType). "breath_presence"
// and any type without its own entry fall back to MEDITATION_SCENE_STEPS --
// the pre-existing, unchanged control-case shape.
export const MEDITATION_SCENE_STEPS_BY_TYPE: Partial<Record<MeditationExperienceType, SceneStepDefinition[]>> = {
  self_compassion: MEDITATION_SELF_COMPASSION_SCENE_STEPS,
  morning_presence: MEDITATION_MORNING_PRESENCE_SCENE_STEPS,
  evening_wind_down: MEDITATION_EVENING_WIND_DOWN_SCENE_STEPS,
  stress_release: MEDITATION_STRESS_RELEASE_SCENE_STEPS,
  body_relaxation: MEDITATION_BODY_RELAXATION_SCENE_STEPS,
  sleep_oriented: MEDITATION_SLEEP_ORIENTED_SCENE_STEPS,
  guided_imagery: MEDITATION_GUIDED_IMAGERY_SCENE_STEPS,
};

// Kids Story: an adventure/discovery structure built on the fixed,
// age-safe 7-beat progression from this project's Kids Story preset rules
// (see planning/templates.ts KIDS_STORY_PROGRESSION). The progression stays
// 7 beats, but as of calibration RP-011C.8.8.1E those beats are realized as
// 5 written scenes, not 7: benchmark review found kids-story output ran
// significantly longer than other presets and leaned toward general
// children's-literature narration rather than SoftVibe bedtime storytelling,
// because each low-conflict beat got its own fully-written scene. The two
// establishing beats (gentle introduction, safe environment) share no
// conflict and were reading as duplicated scene-setting, so they're merged
// into one scene; the challenge and its emotional-learning beat are merged
// so the learning is enacted through the same shared moment of friend
// support instead of a separate, narrator-explained "lesson" scene. This
// trades structural events for more character-interaction budget per scene
// -- it does not drop any of the 7 beats, drop any knowledge module, or
// change classic-asmr/sleep-story/meditation/narrative, which keep their
// own scene structures untouched below.
export const KIDS_STORY_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Establish a safe, warm starting point",
    purpose: (b) => `Introduce ${b.protagonist.role} already at ease in a warm, familiar routine, with the people and place around them`,
    conflict: () => "None yet -- the world is calm, familiar, and known",
    desiredChange: () => "Listener feels grounded and safe in a familiar world before anything new happens",
    emotionalState: () => "curious",
    settingGuidance: () => "A gentle, familiar routine that shows the setting is safe through what the character does, not a separate scene stating it",
    relatedStoryProgression: () => "gentle introduction and safe environment",
  },
  {
    narrativeFunction: "Discover and connect",
    purpose: (b) => `Invite ${b.protagonist.role} into a light adventure, discovering something new through conversation and shared noticing with a new friend`,
    conflict: () => "Curiosity versus the comfort of routine",
    desiredChange: () => "Listener senses gentle forward motion and a new connection, carried by what the characters say to each other",
    emotionalState: () => "curious",
    settingGuidance: () => "A light adventure that introduces a friendly character through dialogue and playful back-and-forth, kept low-stakes",
    relatedStoryProgression: () => "light adventure",
  },
  {
    narrativeFunction: "Face a small challenge together and understand something new",
    purpose: (b) => `Show ${b.protagonist.role} and a friend meeting a small, age-appropriate worry together, with understanding growing out of how they help each other`,
    conflict: () => "A small worry versus growing confidence, eased in the moment by a friend's support",
    desiredChange: () => "Listener sees the challenge resolved through cooperation, with the learning made visible through what the characters do and say, not a stated moral",
    emotionalState: () => "briefly unsure",
    settingGuidance: () => "The challenge and its resolution unfold in the same shared scene, kept small and non-threatening, carried by dialogue and action between friends",
    relatedStoryProgression: () => "small challenge and emotional learning moment",
  },
  {
    narrativeFunction: "Resolve the challenge calmly",
    purpose: (b) => `Show ${b.protagonist.role}'s small challenge fully settled, with the friendship feeling stronger for it`,
    conflict: () => "None remaining -- the challenge has passed",
    desiredChange: () => "Listener feels the situation is fully safe again and the friendship has deepened",
    emotionalState: () => "reassured",
    settingGuidance: () => "A calm resolution, no lingering tension, shown through comfort and companionship rather than explanation",
    relatedStoryProgression: () => "calm resolution",
  },
  {
    narrativeFunction: "Settle toward sleep",
    purpose: (b) => `Bring ${b.protagonist.role} to a soft, sleepy close with their friend nearby`,
    conflict: () => "None -- fully settled",
    desiredChange: () => "Listener is soothed toward sleep, feeling accompanied and secure",
    emotionalState: () => "sleepy",
    settingGuidance: () => "A soft, quiet, sleepy ending that shows belonging rather than stating it",
    relatedStoryProgression: () => "soft sleepy ending",
  },
];

// Classic ASMR: a sensory-comfort progression, not a story or a meditation
// practice. ASMR is one of four equal presets, not the primary focus -- this
// stays as simple as sleep-story's/meditation's fixed structures, not more
// elaborate, and does not scale scene count with storyScale (see those
// presets' comments above for why: a longer session deepens the same
// experience rather than adding more of it).
//
// As of calibration RP-011C.8.8.3C this replaced an earlier 4-phase
// "settle / introduce / sustain / settle" shape that was, in effect,
// sleep-story's arrival -> relaxation -> immersion -> settling structure
// relabeled: same phase count, same wind-down-to-rest shape, and a "Sustain
// immersion" step whose settingGuidance ("Consistent, unchanging sensory
// detail") actively forbade the small variation calming_repetition calls
// for ("a repeated element should still leave room for small, gentle
// variation" -- knowledge/classic-asmr/calming-repetition.ts). Classic ASMR
// is a sensory-attention experience built on rhythm, personal/safe
// attention, and repetition-with-variation, not a relaxation wind-down, so
// it needs its own shape rather than sleep-story's borrowed one. The five
// steps below map directly onto this preset's knowledge modules (see
// knowledge/classic-asmr/*): sensory_presence (introduction), intimate_safe_
// address (interaction), gentle_rhythm (repetition), calming_repetition's
// variation clause (variation), and no_forced_response (continued comfort
// as an open-ended invitation, never a promised payoff).
export const CLASSIC_ASMR_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Sensory introduction",
    purpose: (b) => `Introduce ${b.protagonist.role} to a single, clear sensory focus`,
    conflict: () => "Attention still slightly divided",
    desiredChange: () => "Attention narrows onto one sensory detail",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A calm, focused voice offering one clear point of vocal attention -- no environment or setting to establish",
    relatedStoryProgression: () => "sensory introduction",
  },
  {
    narrativeFunction: "Gentle interaction",
    purpose: (b) => `Offer ${b.protagonist.role} close, personal attention with no expectation of a response`,
    conflict: () => "None -- an invitation, not a demand",
    desiredChange: () => "Attention feels personally held, without pressure to respond",
    emotionalState: () => "settling into close attention",
    settingGuidance: () => "Warm, unhurried, personal address, gentle rather than intense",
    relatedStoryProgression: () => "gentle interaction",
  },
  {
    narrativeFunction: "Rhythmic repetition",
    purpose: (b) => `Establish a slow, repeating pattern for ${b.protagonist.role} to settle into`,
    conflict: () => "None remaining -- repetition is soothing, not escalating",
    desiredChange: () => "A predictable rhythm becomes the anchor for attention",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "The same vocal rhythm or spoken phrase, repeated in a slow, predictable pattern",
    relatedStoryProgression: () => "rhythmic repetition",
  },
  {
    narrativeFunction: "Sensory variation",
    purpose: (b) => `Introduce a small, gentle variation on the established rhythm for ${b.protagonist.role}`,
    conflict: () => "None -- variation stays gentle, never escalating",
    desiredChange: () => "The rhythm stays soothing rather than turning monotonous",
    emotionalState: () => "comfortably immersed",
    settingGuidance: () => "The same vocal rhythm, with one small spoken variation layered gently in",
    relatedStoryProgression: () => "sensory variation",
  },
  {
    narrativeFunction: "Continued comfort",
    purpose: (b) => `Let ${b.protagonist.role} rest in the experience for as long as feels comfortable`,
    conflict: () => "None -- fully settled",
    desiredChange: () => "Listener rests in settled comfort, free to stay as long as they like",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "Familiar and settled, quietly comfortable",
    relatedStoryProgression: () => "continued comfort",
  },
];

// Classic ASMR + story mode (RP-011C.8.8.3L): the same sensory-comfort
// progression as CLASSIC_ASMR_SCENE_STEPS above, not a second narrative
// engine. Planning already gives classic-asmr + story its own progression/
// protagonist shape (CLASSIC_ASMR_STORY_PROGRESSION_BY_SCALE,
// resolveClassicAsmrStoryProtagonist in planning/blueprint-builder.ts) built
// around a gentle in-scene persona; this mirrors that at the scene level so
// Scene Planning stops silently discarding asmrMode "story" and collapsing
// it onto the wordless presence shape. Same five-step count and fixed
// structure as presence (classic-asmr never scales scene count with
// storyScale, per the comment above), same "no forced response" open-ended
// close -- the only difference is that attention is framed through a
// scenario and persona rather than pure sensory presence, and one middle
// step carries gentle sensory movement through that scene instead of a
// static rhythm. Still no conflict, no obstacle, no turning point, and no
// resolution beat: classic-asmr stays out of PLOT_DRIVEN_PRESETS in story
// mode too (see planning/templates.ts), so "narrative" here means gentle
// scene movement, never plot.
export const CLASSIC_ASMR_STORY_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Scenario introduction",
    purpose: (b) => `Introduce ${b.protagonist.role} to a gently sketched scene and persona`,
    conflict: () => "Attention still settling into the scene",
    desiredChange: () => "Attention settles into the scene's persona and setting",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () => "A gently sketched scene and persona, established through calm, close vocal address -- not elaborate world-building",
    relatedStoryProgression: () => "scenario introduction",
  },
  {
    narrativeFunction: "Persona framing",
    purpose: (b) => `Let ${b.protagonist.role} settle into the guiding persona's close, personal attention`,
    conflict: () => "None -- an invitation into the persona's care, not a demand",
    desiredChange: () => "The persona's attention feels familiar and safe",
    emotionalState: () => "settling into the persona's presence",
    settingGuidance: () => "Warm, personal address from within the persona, gentle rather than intense",
    relatedStoryProgression: () => "persona framing",
  },
  {
    narrativeFunction: "Gentle interaction",
    purpose: (b) => `Guide ${b.protagonist.role} through a small, gentle interaction with the persona inside the scene`,
    conflict: () => "None -- interaction stays soothing, never escalating",
    desiredChange: () => "Attention moves with the scene, without any pressure to respond",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () => "A small, low-stakes interaction inside the established scene, paced slowly",
    relatedStoryProgression: () => "gentle interaction",
  },
  {
    narrativeFunction: "Narrative sensory movement",
    purpose: (b) => `Move ${b.protagonist.role} gently through the scene, layering in new sensory detail as it unfolds`,
    conflict: () => "None -- movement is sensory, not dramatic, with nothing to overcome",
    desiredChange: () => "The scene deepens through added sensory detail, never through new events or stakes",
    emotionalState: () => "comfortably immersed in the unfolding scene",
    settingGuidance: () => "The same scene and persona, continuing forward with new sensory detail, never a new complication",
    relatedStoryProgression: () => "narrative sensory movement",
  },
  {
    narrativeFunction: "Continued comfort",
    purpose: (b) => `Let ${b.protagonist.role} rest within the scene for as long as feels comfortable`,
    conflict: () => "None -- fully settled",
    desiredChange: () => "Listener rests in the scene's comfort, free to stay as long as they like",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () => "The scene settles into a quiet, familiar close, without narrative resolution or payoff",
    relatedStoryProgression: () => "continued comfort",
  },
];

// Classic ASMR + story mode + narrative tension (RP-011C.7 targeted fix):
// selected instead of CLASSIC_ASMR_STORY_SCENE_STEPS above when
// intent.asmrNarrativeTension is true -- i.e. the user explicitly asked for
// a mystery/thriller/suspense story in an ASMR voice, not a companion/
// roleplay/reading scenario. CLASSIC_ASMR_STORY_SCENE_STEPS's "no new
// complication" / "without narrative resolution or payoff" shape is correct
// for that ordinary case, but directly contradicts a request for a real
// mystery: the live cutover-readiness regression found the Writer producing
// mystery vocabulary (candlelight, secrecy) with no actual clue,
// development, tension, or reveal, because the scene plan itself never gave
// it one to write.
//
// Same five-step count and fixed structure as CLASSIC_ASMR_STORY_SCENE_STEPS
// (classic-asmr never scales scene count with storyScale -- see that
// template's own rationale above), and classic-asmr still does not enter
// PLOT_DRIVEN_PRESETS (planning/templates.ts) -- no StoryBible, no
// SegmentState, no turning-point machinery is introduced. What changes is
// only the content of "conflict"/"desiredChange": this progression has a
// real clue, a deepening complication, a controlled escalation or
// discovery, and a reveal, instead of presence/story mode's "None -- ..."
// pattern. ASMR delivery stays the constant across every step: voice-first,
// intimate, controlled pacing -- tension is conveyed through what happens,
// never through hurried, frantic, or shouted delivery (see
// CLASSIC_ASMR_TENSION_STORY_GUIDANCE_TEMPLATE in guidance/templates.ts,
// which enforces this at the writing-guidance layer).
export const CLASSIC_ASMR_TENSION_STORY_SCENE_STEPS: SceneStepDefinition[] = [
  {
    narrativeFunction: "Scenario and mystery setup",
    purpose: (b) => `Settle ${b.protagonist.role} into the scene and persona, then introduce the mystery's premise`,
    conflict: () => "A first hint that something is unresolved or not fully known",
    desiredChange: () => "Attention settles into the scene while curiosity about the unresolved premise takes hold",
    emotionalState: (b) => b.emotionalArc.beginning,
    settingGuidance: () =>
      "A gently sketched scene and persona, close and voice-first, within which a genuine mystery premise is introduced -- calm delivery, real premise",
    relatedStoryProgression: () => "scenario and mystery setup",
  },
  {
    narrativeFunction: "First clue",
    purpose: (b) => `Reveal ${b.protagonist.role} a first, concrete clue or detail that deepens the mystery`,
    conflict: () => "A concrete clue raises a real question without yet answering it",
    desiredChange: () => "The mystery becomes specific rather than merely atmospheric",
    emotionalState: () => "quietly curious, drawn in by the first clue",
    settingGuidance: () => "The same close, voice-first delivery, now carrying one specific, perceivable clue or detail",
    relatedStoryProgression: () => "first clue",
  },
  {
    narrativeFunction: "Deepening complication",
    purpose: (b) => `Let ${b.protagonist.role} encounter a complication that makes the mystery harder to resolve`,
    conflict: () => "The clue connects to something larger or more uncertain than first assumed",
    desiredChange: () => "Understanding of the mystery deepens, even as its resolution still feels out of reach",
    emotionalState: (b) => b.emotionalArc.middle,
    settingGuidance: () =>
      "The same scene and persona, pacing still slow and controlled -- complication comes from what is revealed, never from rushed or frantic delivery",
    relatedStoryProgression: () => "deepening complication",
  },
  {
    narrativeFunction: "Controlled escalation or discovery",
    purpose: (b) => `Bring ${b.protagonist.role} to the mystery's point of closest, most revealing discovery`,
    conflict: () => "The mystery reaches its most uncertain or revealing point",
    desiredChange: () => "The pieces of the mystery come together into something almost understood",
    emotionalState: () => "quietly tense, close to understanding",
    settingGuidance: () =>
      "A controlled escalation carried by voice, closeness, and pacing -- never shouting, frantic pacing, or an external trigger event",
    relatedStoryProgression: () => "controlled escalation or discovery",
  },
  {
    narrativeFunction: "Reveal and quiet resolution",
    purpose: (b) => `Give ${b.protagonist.role} the mystery's reveal, then settle into quiet, comfortable resolution`,
    conflict: () => "None remaining -- the mystery resolves and settles rather than escalating further",
    desiredChange: () => "The mystery is genuinely resolved, and attention settles into calm, comfortable presence",
    emotionalState: (b) => b.emotionalArc.end,
    settingGuidance: () =>
      "The reveal lands through calm, close narration, then the scene settles into quiet comfort -- a real payoff, not a comfort-only close with no mystery resolved",
    relatedStoryProgression: () => "reveal and quiet resolution",
  },
];
