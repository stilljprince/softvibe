// lib/narrative/outline-and-segments.ts
//
// Pass-B: real `buildStoryOutline(...)` implementation.
//
// The outline call is infrastructure for a later outline → segment path. It
// is NOT wired into production yet. The active long-form narrative path in
// `lib/script-builder-openai.ts` still uses the single-call generator via
// `buildNarrativeOpenAIPrompts`. Nothing here is invoked by an API route or
// the script-builder cascade. Verify with:
//   grep -rn "buildStoryOutline\|generateStorySegment" --include='*.ts'
//
// Philosophy: a StoryBible carries enough shared truth (who, where, what is
// at stake, what shape the story traces) to keep later segment calls
// coherent — without prescribing scene order or dramatic role. There are
// no chapters, no numbered beats, no fixed structural template, no named
// writing-method scaffolds. Trajectory and ending tone are emergent
// choices, not slots.

import OpenAI from "openai";
import type {
  StoryBible,
  SegmentState,
  NarrativeSegment,
  CharacterSketch,
  RelationshipSketch,
  TrajectoryShape,
  EndingTone,
  EndingApproach,
} from "./types";

// Allowed enum values, mirrored in `./types`. Exported so tests and future
// callers can validate without importing from the type module.
export const ALLOWED_TRAJECTORY_SHAPES: readonly TrajectoryShape[] = [
  "gradual-rise",
  "rise-and-fall",
  "spiral",
  "drift",
  "fracture-and-settle",
  "open",
] as const;

export const ALLOWED_ENDING_TONES: readonly EndingTone[] = [
  "warm",
  "bittersweet",
  "ambiguous",
  "quietly-tragic",
  "settled",
  "unresolved",
] as const;

// Pass C3A: a small pool of ending approaches. The model picks the one that
// best fits THIS story — they are inspirations, not rigid templates. They
// do NOT prescribe plot beats or scene order; they describe the SHAPE of
// closure the writer leans toward in the final stretch.
export const ALLOWED_ENDING_APPROACHES: readonly EndingApproach[] = [
  "resolved-mystery",
  "emotional-closure",
  "quiet-ending",
  "bittersweet-ending",
  "reflective-ending",
] as const;

export type BuildStoryOutlineInput = {
  userPrompt: string;
  outputLanguage: "English" | "German";
  targetDurationSec: number;
  // Optional planning hints. Caller may supply a precomputed wordTarget so
  // the outline scope matches what the eventual writer will produce.
  wordTarget?: number;
  // Optional caller-side genre. The outline call does NOT detect genre on
  // its own; if the caller already knows, it can pass it through so the
  // bible is shaped accordingly. Free-form string to stay decoupled from
  // the narrative-story genre enum.
  genre?: string;
  // Optional working title from the caller — the model may refine it.
  title?: string;
  // Optional model / timeout overrides for tests and tuning.
  model?: string;
  timeoutMs?: number;
};

export type GenerateStorySegmentInput = {
  bible: StoryBible;
  priorState: SegmentState;
  priorSummaries: string[];
  outputLanguage: "English" | "German";
  wordTarget: number;
  // Optional tail of the previous segment's prose. When provided the model
  // can pick up the same voice and rhythm without a hard seam.
  previousSegmentText?: string;
  // Pass C3A: signals that this is the closing stretch of the story. When
  // true, the segment prompt switches on the final-segment contract — the
  // story must reach a natural completion and the primary story question
  // must land. When false/undefined, the segment is treated as a
  // continuation that should NOT close out the whole story.
  isFinalSegment?: boolean;
  // Optional model / timeout overrides for tests and tuning.
  model?: string;
  timeoutMs?: number;
};

// -----------------------------------------------------------------------------
// Prompt assembly. Exported separately so the offline test script can scan
// the prompt text for forbidden beat-sheet vocabulary without an OpenAI call.
// -----------------------------------------------------------------------------

export function buildStoryOutlinePrompts(input: BuildStoryOutlineInput): {
  system: string;
  user: string;
} {
  const userPrompt = (input.userPrompt ?? "").trim();
  const outputLanguage = input.outputLanguage;
  const targetDurationSec =
    Number.isFinite(input.targetDurationSec) && input.targetDurationSec > 0
      ? Math.round(input.targetDurationSec)
      : 600;
  const wordTarget =
    typeof input.wordTarget === "number" && Number.isFinite(input.wordTarget)
      ? Math.max(150, Math.round(input.wordTarget))
      : Math.round(targetDurationSec * 1.95);

  const genreLine = input.genre && input.genre.trim()
    ? `Caller-supplied genre context: "${input.genre.trim()}". Honor it; do not substitute.`
    : `No genre prescribed. If one fits the brief, commit to it; otherwise let the brief speak for itself.`;

  const titleLine = input.title && input.title.trim()
    ? `Working title from caller (may be refined): "${input.title.trim()}".`
    : `No working title given. Propose one only if a natural title emerges from the brief; otherwise return null.`;

  const system = [
    `You are a story architect planning a long-form audio story before it is written. You produce a compact "story bible" — enough shared truth (characters, setting, pressure, ending intent) to keep later writing coherent.`,
    ``,
    `You are NOT writing the story. Do not produce scenes, dialogue, prose passages, or numbered outlines. Keep every summary field to 1–3 sentences. Plain language. Concrete nouns.`,
    ``,
    `CRITICAL — STORY SHAPE IS EMERGENT, NOT ASSIGNED:`,
    `- Choose a trajectory that genuinely fits THIS story. Do not default.`,
    `- Do NOT impose a standardized template, named writing method, or fixed beat structure.`,
    `- Do NOT pre-assign dramatic roles to early, middle, or late portions of the story.`,
    `- Do NOT force a twist, reveal, peak, or pivot at any fixed position.`,
    `- Pressure may build steadily, oscillate, settle, fragment, drift, or stay unresolved — choose what suits THIS brief.`,
    `- Preserve genre variety: a quiet character study, a slow-burn investigation, a fractured trauma narrative, and a forward-moving adventure should NOT all collapse into the same shape.`,
    ``,
    `CRITICAL — THIS STORY IS A SELF-CONTAINED EXPERIENCE:`,
    `- This is one whole story, not the first installment of a longer novel. The listener should finish it feeling that they have lived through a complete story — not that the real story begins afterwards.`,
    `- Plan a SINGLE primary story question or central tension that drives the story end-to-end. It should be specific enough to be answered, settled, transformed, or to land emotionally by the close — not so abstract that nothing could ever satisfy it.`,
    `- Plan an ending APPROACH the story is genuinely moving toward — an inspiration, not a rigid template. The approach is the SHAPE of closure (mystery answered, emotional shift, quiet settling, bittersweet acceptance, reflective understanding) — not a plot formula, and never a fixed positional beat.`,
    `- Secondary questions may remain open. Bittersweet, ambiguous, or quiet endings are welcome. Not every detail needs explaining. But the close should not feel like a cliffhanger or a setup for the next story.`,
    `- Do NOT plan endings that introduce new central mysteries near the close, reveal a larger problem after the original pressure has been addressed, or telegraph that the real story begins after the runtime ends.`,
    ``,
    `CRITICAL — REVELATION FLOW AND CAST DESIGN:`,
    `- Prefer a clear and easy-to-follow flow of revelations. Avoid introducing too many separate information carriers or explanation-heavy characters in a short span of time.`,
    `- When possible, let important discoveries flow through a smaller number of people, while supporting characters contribute through emotion, companionship, conflict, atmosphere, or everyday life rather than additional exposition.`,
    `- Preserve realism and variety: some stories naturally require several perspectives, but the listener should rarely feel that every new character arrives mainly to deliver another piece of information.`,
    `- This is architectural guidance for cast and revelation flow — not a cap on ensemble stories, village settings, or family dramas. Do not assign rigid roles or fixed cast templates; shape the information flow so the listener can follow it without strain.`,
    ``,
    `WHAT TO PRODUCE (story bible — abstract, literary, flexible):`,
    `- title: a real title if one emerges, otherwise null. No placeholder titles.`,
    `- protagonistSummary: a person, not an archetype. Who they are, what they want or fear, what they stand to lose.`,
    `- supportingCharacterSummary: 0–4 sketches of named supporting figures. Each grounded — a name when natural, a role/relationship to the protagonist, a 1-sentence summary. Use null for name or role when not yet decided.`,
    `- settingSummary: a specific place, era, and atmosphere — the setting should put pressure on the characters, not be wallpaper.`,
    `- pressureSources: 2–4 specific forces pressing on the protagonist — relational, internal, external, environmental, social. Not abstract themes ("loss", "love"); concrete pressure ("the sister who hasn't called back", "the rent due Friday").`,
    `- importantRelationships: relevant character pairs and the texture of the bond — affection, debt, suspicion, rivalry, complicity. Use the same names from protagonist/supporting fields.`,
    `- unresolvedQuestions: 0–4 questions the listener might carry into the story. These need NOT all be answered. They give the writer room to maneuver.`,
    `- primaryStoryQuestion: ONE concrete central question/tension that the whole story is fundamentally about. The final stretch should answer it, settle it, transform it, or let it land emotionally. Specific, not abstract. Examples of shape: "Will Mara return her brother's call before she leaves the city?" "What does the lighthouse keeper do with the letter she can no longer read?" — not "Will she find herself?"`,
    `- endingTone: one of the allowed values, chosen because it fits this story — not as a structural slot.`,
    `- trajectoryShape: one of the allowed shapes, chosen because it matches how pressure naturally moves in THIS story.`,
    `- endingApproach: one of the allowed approaches, chosen because it fits the kind of closure THIS story is aiming for. This is an inspiration the writer leans into in the final stretch, not a fixed plot formula.`,
    ``,
    `Be concrete. Real names, real places, real pressure sources. Avoid vague abstractions like "a journey", "a conflict", "growth".`,
    ``,
    `Output: return ONLY valid JSON matching the requested schema. No prose preamble, no commentary, no field labels outside the JSON.`,
  ].join("\n");

  const user = [
    `Plan a story bible for the brief below.`,
    ``,
    `Output language for the eventual story: ${outputLanguage}.`,
    `The brief may be written in any language — interpret it faithfully, but write every field value in ${outputLanguage}.`,
    ``,
    `Approximate spoken length when later written: ~${targetDurationSec}s (~${wordTarget} words). Shape scope to fit — neither over-stuffed nor under-stuffed.`,
    ``,
    genreLine,
    titleLine,
    ``,
    `Brief (binding — do not echo verbatim, do not replace):`,
    `---`,
    userPrompt || "(no brief provided — choose a fitting scenario)",
    `---`,
    ``,
    `Trajectory choices (pick the one that BEST fits — not a default):`,
    `- gradual-rise: pressure climbs steadily across the runtime`,
    `- rise-and-fall: pressure builds and then releases`,
    `- spiral: pressure circles back on itself, tightening`,
    `- drift: pressure stays low; movement is subtle and atmospheric`,
    `- fracture-and-settle: pressure breaks, then a new equilibrium emerges`,
    `- open: pressure refuses to resolve neatly`,
    ``,
    `Ending tone choices (pick what fits THIS story):`,
    `- warm, bittersweet, ambiguous, quietly-tragic, settled, unresolved`,
    ``,
    `Ending approach choices (pick the closure SHAPE that fits THIS story — inspirations, not rigid templates):`,
    `- resolved-mystery: the central uncertainty becomes clear by the close`,
    `- emotional-closure: completion arrives through an emotional or relational shift`,
    `- quiet-ending: completion arrives through atmosphere settling and life continuing`,
    `- bittersweet-ending: completion arrives through acceptance of a complex truth`,
    `- reflective-ending: completion arrives through understanding reaching the protagonist`,
    ``,
    `Return ONLY the JSON object — no commentary.`,
  ].join("\n");

  return { system, user };
}

// -----------------------------------------------------------------------------
// JSON schema for the OpenAI structured-output call. Strict mode requires
// every property to appear in `required` and every object to have
// `additionalProperties: false`. Optional values are represented via empty
// strings (post-validated and dropped) rather than null, to match the
// existing project pattern in script-builder-openai.ts.
// -----------------------------------------------------------------------------

export const STORY_BIBLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"] },
    protagonistSummary: { type: "string" },
    supportingCharacterSummary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: ["string", "null"] },
          role: { type: ["string", "null"] },
          summary: { type: "string" },
        },
        required: ["name", "role", "summary"],
      },
    },
    settingSummary: { type: "string" },
    pressureSources: {
      type: "array",
      items: { type: "string" },
    },
    importantRelationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          between: {
            type: "array",
            items: { type: "string" },
          },
          nature: { type: "string" },
        },
        required: ["between", "nature"],
      },
    },
    unresolvedQuestions: {
      type: "array",
      items: { type: "string" },
    },
    primaryStoryQuestion: { type: "string" },
    endingTone: {
      type: "string",
      enum: [...ALLOWED_ENDING_TONES],
    },
    trajectoryShape: {
      type: "string",
      enum: [...ALLOWED_TRAJECTORY_SHAPES],
    },
    endingApproach: {
      type: "string",
      enum: [...ALLOWED_ENDING_APPROACHES],
    },
  },
  required: [
    "title",
    "protagonistSummary",
    "supportingCharacterSummary",
    "settingSummary",
    "pressureSources",
    "importantRelationships",
    "unresolvedQuestions",
    "primaryStoryQuestion",
    "endingTone",
    "trajectoryShape",
    "endingApproach",
  ],
} as const;

// -----------------------------------------------------------------------------
// Defensive validator. Strict-mode JSON schema already enforces shape at the
// model boundary, but the runtime check guards against partial responses,
// future schema drift, and tests that feed in handcrafted objects.
// -----------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function maybeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export function validateStoryBible(raw: unknown): StoryBible {
  if (!isPlainObject(raw)) {
    throw new Error("StoryBible validation failed: not a JSON object");
  }

  const protagonistSummary = raw.protagonistSummary;
  if (!nonEmptyString(protagonistSummary)) {
    throw new Error("StoryBible validation failed: protagonistSummary missing or empty");
  }

  const settingSummary = raw.settingSummary;
  if (!nonEmptyString(settingSummary)) {
    throw new Error("StoryBible validation failed: settingSummary missing or empty");
  }

  const endingToneRaw = raw.endingTone;
  if (typeof endingToneRaw !== "string" || !(ALLOWED_ENDING_TONES as readonly string[]).includes(endingToneRaw)) {
    throw new Error(
      `StoryBible validation failed: endingTone "${String(endingToneRaw)}" is not one of ${ALLOWED_ENDING_TONES.join(", ")}`,
    );
  }
  const endingTone = endingToneRaw as EndingTone;

  const trajectoryShapeRaw = raw.trajectoryShape;
  if (
    typeof trajectoryShapeRaw !== "string" ||
    !(ALLOWED_TRAJECTORY_SHAPES as readonly string[]).includes(trajectoryShapeRaw)
  ) {
    throw new Error(
      `StoryBible validation failed: trajectoryShape "${String(trajectoryShapeRaw)}" is not one of ${ALLOWED_TRAJECTORY_SHAPES.join(", ")}`,
    );
  }
  const trajectoryShape = trajectoryShapeRaw as TrajectoryShape;

  const endingApproachRaw = raw.endingApproach;
  if (
    typeof endingApproachRaw !== "string" ||
    !(ALLOWED_ENDING_APPROACHES as readonly string[]).includes(endingApproachRaw)
  ) {
    throw new Error(
      `StoryBible validation failed: endingApproach "${String(endingApproachRaw)}" is not one of ${ALLOWED_ENDING_APPROACHES.join(", ")}`,
    );
  }
  const endingApproach = endingApproachRaw as EndingApproach;

  const primaryStoryQuestion = raw.primaryStoryQuestion;
  if (!nonEmptyString(primaryStoryQuestion)) {
    throw new Error(
      "StoryBible validation failed: primaryStoryQuestion missing or empty",
    );
  }

  if (!Array.isArray(raw.pressureSources)) {
    throw new Error("StoryBible validation failed: pressureSources is not an array");
  }
  const pressureSources = (raw.pressureSources as unknown[])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (pressureSources.length === 0) {
    throw new Error("StoryBible validation failed: pressureSources is empty");
  }

  if (!Array.isArray(raw.unresolvedQuestions)) {
    throw new Error("StoryBible validation failed: unresolvedQuestions is not an array");
  }
  const unresolvedQuestions = (raw.unresolvedQuestions as unknown[])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);

  if (!Array.isArray(raw.supportingCharacterSummary)) {
    throw new Error("StoryBible validation failed: supportingCharacterSummary is not an array");
  }
  const supportingCharacterSummary: CharacterSketch[] = [];
  for (const item of raw.supportingCharacterSummary as unknown[]) {
    if (!isPlainObject(item)) continue;
    const summary = item.summary;
    if (!nonEmptyString(summary)) continue;
    const sketch: CharacterSketch = { summary: summary.trim() };
    const name = maybeString(item.name);
    if (name) sketch.name = name;
    const role = maybeString(item.role);
    if (role) sketch.role = role;
    supportingCharacterSummary.push(sketch);
  }

  if (!Array.isArray(raw.importantRelationships)) {
    throw new Error("StoryBible validation failed: importantRelationships is not an array");
  }
  const importantRelationships: RelationshipSketch[] = [];
  for (const item of raw.importantRelationships as unknown[]) {
    if (!isPlainObject(item)) continue;
    if (!Array.isArray(item.between)) continue;
    if (item.between.length !== 2) continue;
    const a = typeof item.between[0] === "string" ? item.between[0].trim() : "";
    const b = typeof item.between[1] === "string" ? item.between[1].trim() : "";
    if (!a || !b) continue;
    const nature = item.nature;
    if (!nonEmptyString(nature)) continue;
    importantRelationships.push({ between: [a, b], nature: nature.trim() });
  }

  const bible: StoryBible = {
    protagonistSummary: protagonistSummary.trim(),
    supportingCharacterSummary,
    settingSummary: settingSummary.trim(),
    pressureSources,
    importantRelationships,
    unresolvedQuestions,
    primaryStoryQuestion: primaryStoryQuestion.trim(),
    endingTone,
    trajectoryShape,
    endingApproach,
  };

  const title = maybeString(raw.title);
  if (title) bible.title = title;

  return bible;
}

// -----------------------------------------------------------------------------
// Real implementation. Lazy OpenAI client construction per CLAUDE.md.
// -----------------------------------------------------------------------------

export async function buildStoryOutline(input: BuildStoryOutlineInput): Promise<StoryBible> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("buildStoryOutline: missing OPENAI_API_KEY");
  }

  const userPromptPreview = (input.userPrompt ?? "")
    .slice(0, 120)
    .replace(/\s+/g, " ")
    .trim();

  const model =
    input.model ??
    process.env.OPENAI_OUTLINE_MODEL ??
    process.env.OPENAI_SCRIPT_MODEL ??
    "gpt-5.4-mini";
  const timeoutMs =
    typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
      ? input.timeoutMs
      : parseInt(process.env.OPENAI_OUTLINE_TIMEOUT_MS ?? "60000", 10);

  console.log(
    "[NARRATIVE-OUTLINE]",
    "phase=start",
    `model=${model}`,
    `lang=${input.outputLanguage}`,
    `durationSec=${input.targetDurationSec}`,
    `wordTarget=${input.wordTarget ?? "—"}`,
    `genre=${input.genre ?? "—"}`,
    `titleHint=${input.title ? "yes" : "no"}`,
    `promptPreview="${userPromptPreview}"`,
  );

  const { system, user } = buildStoryOutlinePrompts(input);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const openaiT0 = Date.now();
  console.log("[NARRATIVE-OUTLINE]", "phase=openai.start", `model=${model}`, `timeoutMs=${timeoutMs}`);

  let resp;
  try {
    resp = await openai.responses.create(
      {
        model,
        max_output_tokens: 4000,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "SoftVibeStoryBible",
            strict: true,
            // Casted: the strict-mode SDK type is narrow; our schema uses
            // type-union ("string"|"null") for optional fields, which the
            // API accepts but the TS types do not yet model.
            schema: STORY_BIBLE_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      "[NARRATIVE-OUTLINE]",
      "phase=error",
      `stage=openai`,
      `durationMs=${Date.now() - openaiT0}`,
      `error="${msg.slice(0, 200)}"`,
    );
    throw err;
  }

  const openaiDurationMs = Date.now() - openaiT0;
  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  console.log(
    "[NARRATIVE-OUTLINE]",
    "phase=openai.end",
    `durationMs=${openaiDurationMs}`,
    `status=${respStatus}`,
    `length=${rawText.length}`,
  );

  if (respStatus === "incomplete") {
    console.error("[NARRATIVE-OUTLINE]", "phase=error", "stage=truncated", `length=${rawText.length}`);
    throw new Error(
      `buildStoryOutline: response truncated (status=incomplete, length=${rawText.length})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const preview = rawText.slice(0, 200) || "(empty)";
    console.error(
      "[NARRATIVE-OUTLINE]",
      "phase=error",
      "stage=json-parse",
      `status=${respStatus}`,
      `length=${rawText.length}`,
    );
    throw new Error(
      `buildStoryOutline: invalid JSON from OpenAI (status=${respStatus}, length=${rawText.length}). Preview: ${preview}`,
    );
  }

  let bible: StoryBible;
  try {
    bible = validateStoryBible(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NARRATIVE-OUTLINE]", "phase=error", "stage=validate", `error="${msg.slice(0, 200)}"`);
    throw err;
  }

  console.log(
    "[NARRATIVE-OUTLINE]",
    "phase=parse.end",
    `trajectory=${bible.trajectoryShape}`,
    `endingTone=${bible.endingTone}`,
    `endingApproach=${bible.endingApproach}`,
    `support=${bible.supportingCharacterSummary.length}`,
    `pressure=${bible.pressureSources.length}`,
    `relationships=${bible.importantRelationships.length}`,
    `questions=${bible.unresolvedQuestions.length}`,
    `hasTitle=${bible.title ? "yes" : "no"}`,
    `primaryQ="${bible.primaryStoryQuestion.slice(0, 80).replace(/\s+/g, " ")}"`,
  );

  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=outline.done",
    `trajectoryShape=${bible.trajectoryShape}`,
    `endingTone=${bible.endingTone}`,
    `endingApproach=${bible.endingApproach}`,
    `pressureSources=${bible.pressureSources.length}`,
    `unresolvedQuestions=${bible.unresolvedQuestions.length}`,
  );

  return bible;
}

// -----------------------------------------------------------------------------
// Pass-C1: segment generation.
//
// Philosophy:
//   The model is asked to "continue the same novel", not to "write chapter N"
//   or "deliver the midpoint". Segment purpose is emergent. Natural boundaries
//   come from time changes, place changes, emotional shifts, new information,
//   relationship movement, or consequences settling — never from a fixed beat
//   sheet, act position, or chapter slot. SegmentState evolves to keep the
//   next call coherent, but it never carries dramatic-role flags.
//
// This module is isolated infrastructure. Nothing in production imports
// `generateStorySegment` or `mergeNarrativeSegments`. Verify with:
//   grep -rn "generateStorySegment\|mergeNarrativeSegments" --include='*.ts' --include='*.tsx'
// -----------------------------------------------------------------------------

const SEGMENT_PROMPT_FORBIDDEN_NOTE = [
  `FORBIDDEN — DO NOT USE OR REASON IN TERMS OF:`,
  `- Save The Cat, Hero's Journey, beat sheet, three-act structure, act structure`,
  `- "midpoint", "climax", "false lead", "rising action", "denouement"`,
  `- "chapter 1", "chapter 2", numbered chapters, named chapter roles`,
  `- Any standardized writing-method scaffold (e.g. inciting incident, pinch point)`,
  `- Pre-assigning dramatic roles to early, middle, or late segments`,
  `Continue the same novel. Do not announce structure. Do not signal position.`,
].join("\n");

// Pass C3C: principle-based guidance to rebalance stories so progress comes
// primarily from people DOING things, rather than from observation, atmosphere,
// introspection or static conversations. Deliberately principle-only — no
// percentages, act structures, segment formulas, or mandatory beats. Inner
// thoughts, atmosphere, and symbolism remain welcome; they should SUPPORT the
// journey, not replace it.
const NARRATIVE_MOMENTUM_NOTE = [
  `NARRATIVE MOMENTUM (apply throughout — a principle, not a structural requirement):`,
  `- Stories generally progress because people DO things. Lean on actions, decisions, discoveries, movement, encounters, consequences, changing situations, physical events, investigations, travel, and new information caused by previous actions to carry the story forward.`,
  `- Story progress should emerge from: action → consequence → new situation. Do not rely mainly on thought → thought → thought, conversation → conversation → conversation, or observation → observation → observation as the engine of the story.`,
  `- Vary the situations the listener moves through. The same room, same table, same conversation, same emotional state should not dominate long stretches. New locations, new encounters, fresh discoveries, practical tasks, and shifts in environment are welcome — without requiring any specific structure.`,
  `- Inner thoughts, atmosphere, and symbolism remain welcome — let them SUPPORT the journey, deepening what happens. They should not become the primary engine that replaces the journey.`,
  `- Do not insert events for their own sake. Let the story feel lived and unfolding, not merely contemplated.`,
].join("\n");

// Pass C3D: principle-based guidance to keep the factual chain of events
// understandable at the center of the story while preserving ambiguity at the
// edges. Deliberately principle-only — no act structures, no percentages, no
// mandatory reveals, no beat-sheet language, no formulaic role assignments.
// Emotional complexity, partial uncertainty, and unresolved secondary
// mysteries remain welcome. The point is only to prevent stories whose
// emotional meaning is clear while the actual events remain too vague.
const CLARITY_AT_THE_CENTER_NOTE = [
  `CRITICAL — CLARITY AT THE CENTER (Pass C3D — apply throughout; a principle, not a formula):`,
  `- Emotional meaning matters, but emotional meaning should not replace factual understanding.`,
  `- By the close, readers should generally be able to explain what actually happened, who made the important decisions, and why those decisions mattered.`,
  `- Mystery answers do not need to explain every detail, but the core chain of events should become understandable.`,
  `- Let consequences emerge from human choices — fear, shame, love, pride, loyalty, mistakes, necessity, or other believable motives.`,
  `- Readers should leave with greater clarity, not merely greater atmosphere.`,
  `- Secondary uncertainty may remain. Ambiguity at the edges is welcome. Confusion at the center is not.`,
  `- Allowed: imperfect memories, emotional complexity, partial uncertainty, unresolved secondary mysteries, multiple perspectives.`,
  `- Avoid: replacing explanation with symbolism, solving emotions while leaving events unclear, endings where readers understand feelings but cannot explain what happened, treating mystery itself as the answer.`,
].join("\n");

// Gentle stylistic guidance on subtext and implication. Deliberately
// principle-only — no word limits, percentages, counters, or mandatory
// behaviors. Pacing and plot progression are preserved; this only nudges the
// prose toward implication over explanation when emotions are already visible
// in the scene.
const SUBTEXT_NOTE = [
  `WRITING PHILOSOPHY (gentle stylistic guidance — a sensibility, not a rule):`,
  `- Trust the reader's intelligence. Resist the urge to explain emotions, themes, or meanings that are already visible through the scene. Favor implication over explanation. Emotions should often emerge through behavior, pauses, sensory details, and dialogue rather than explicit interpretation.`,
  `- Characters do not always answer directly. They may avoid, deflect, answer partially, change the subject, or remain silent. Allow subtext and omission to carry meaning.`,
].join("\n");

// Gentle word-budget discipline. Principle-only: no counters, no hard caps,
// no aggressive shortening language. The aim is cleaner scene selection when
// the segment wants to overrun its target, while preserving slow, literary,
// atmospheric pacing.
const WORD_TARGET_DISCIPLINE_NOTE = [
  `WORD TARGET DISCIPLINE (gentle pacing guidance — preserve literary quality):`,
  `- Treat the segment wordTarget as a real budget, not a loose suggestion. Lean toward landing AT OR JUST UNDER the target; do not aim for the upper band. Modest overage is acceptable only when a natural scene genuinely requires it.`,
  `- Do not expand beyond target through extra beats, repeated atmospheric variations, additional sensory passes over the same setting, or further reflective layers once the meaningful movement has been shown.`,
  `- If the segment wants to grow too large, do not summarize or rush. Instead, choose fewer, stronger scene beats and let each one carry more implication. Prefer one well-shaped interaction, object, gesture, or setting turn over several similar ones.`,
  `- Preserve the calm, literary, atmospheric voice. This is not a request for faster pacing or thinner prose; it is a request for cleaner scene selection.`,
].join("\n");

// Continuity guidance for non-opening segments. Aimed at reducing the
// re-establishing behavior the supervisor sees in mid- and late-segment drafts
// (re-introducing the room, the atmosphere, the relationship state, or the
// emotional baseline at the top of each segment). Principle-only — no
// percentages, no act structures, no role assignments.
const CONTINUITY_NOTE = [
  `CONTINUITY (apply to continuation segments — a principle, not a structural rule):`,
  `- Assume the listener remembers what has already been established. Do not re-introduce the setting, atmosphere, characters, relationships, or current emotional state at the opening of this segment.`,
  `- Continue the story already in motion. The previous segment's voice, rhythm, location, and emotional register are still in the room — pick them up directly and move forward.`,
  `- Do not reset the protagonist's emotional baseline. Whatever was already felt is still felt; let the next movement build from it rather than restart from a neutral position.`,
  `- Do not restate the bible, the central question, prior pressures, or the texture of existing relationships. Prior context is shared truth; trust it.`,
  `- Avoid opening this segment with a fresh atmospheric pass over the same room, the same weather, the same harbor, the same kitchen — vary the situation or move forward in story-time instead.`,
  `- Later segments should continue the story, not re-introduce it.`,
].join("\n");

// Closing-stretch contraction guidance. The ending should land where the
// prose naturally rests, not extend with afterglow scenes once the central
// question has been addressed. Principle-only — no word counts, no
// percentages, no mandatory beats.
const FINAL_SEGMENT_CONTRACTION_NOTE = [
  `NATURAL CONTRACTION OF THE CLOSE (apply in the closing stretch — a sensibility, not a counter):`,
  `- The ending should naturally contract, not expand. Lean toward landing at or just under the segment target — let the close arrive when the prose naturally rests, even if that comes slightly early.`,
  `- Once the central question has been answered, settled, transformed, or has landed emotionally, do not add new atmosphere, new locations, new ambient passages, or further reflective passes.`,
  `- Avoid afterglow scenes that linger past the natural close — extended reflections, additional emotional summaries, repeated arrivals of meaning, or further variations on the same final image.`,
  `- Do not extend with further small movements just to fill space. End where the story naturally ends.`,
].join("\n");

// Final-segment contraction factor. The closing stretch should land naturally
// rather than expanding into afterglow scenes; pulling the effective target
// slightly under the per-segment baseline gives the writer permission to end
// at the natural rest. Duration-parametric (multiplier, not minute count).
const FINAL_SEGMENT_TARGET_FACTOR = 0.92;

function computeEffectiveSegmentWordTarget(
  rawTarget: number | undefined,
  isFinalSegment: boolean,
): number {
  const base =
    typeof rawTarget === "number" && Number.isFinite(rawTarget)
      ? Math.max(120, Math.round(rawTarget))
      : 600;
  if (!isFinalSegment) return base;
  return Math.max(120, Math.round(base * FINAL_SEGMENT_TARGET_FACTOR));
}

function buildBibleBlock(bible: StoryBible): string {
  const lines: string[] = [];
  if (bible.title) lines.push(`Title: ${bible.title}`);
  lines.push(`Protagonist: ${bible.protagonistSummary}`);
  if (bible.supportingCharacterSummary.length > 0) {
    lines.push(`Supporting characters:`);
    for (const c of bible.supportingCharacterSummary) {
      const head = [c.name, c.role].filter(Boolean).join(" — ");
      lines.push(`  • ${head ? head + ": " : ""}${c.summary}`);
    }
  }
  lines.push(`Setting: ${bible.settingSummary}`);
  if (bible.pressureSources.length > 0) {
    lines.push(`Pressure on the protagonist:`);
    for (const p of bible.pressureSources) lines.push(`  • ${p}`);
  }
  if (bible.importantRelationships.length > 0) {
    lines.push(`Important relationships:`);
    for (const r of bible.importantRelationships) {
      lines.push(`  • ${r.between[0]} & ${r.between[1]}: ${r.nature}`);
    }
  }
  if (bible.unresolvedQuestions.length > 0) {
    lines.push(`Open questions in the air:`);
    for (const q of bible.unresolvedQuestions) lines.push(`  • ${q}`);
  }
  lines.push(
    `Central question this story is fundamentally about (must land by the close): ${bible.primaryStoryQuestion}`,
  );
  lines.push(`Trajectory shape (emergent, not a template): ${bible.trajectoryShape}`);
  lines.push(`Ending tone the story is moving toward: ${bible.endingTone}`);
  lines.push(`Ending approach (a gravitational pull for the close, not a template): ${bible.endingApproach}`);
  return lines.join("\n");
}

function buildStateBlock(state: SegmentState): string {
  const lines: string[] = [];
  lines.push(`Emotional state right now: ${state.emotionalState || "(unspecified)"}`);
  lines.push(`Elapsed time so far: ${state.elapsedTime || "(unspecified)"}`);
  if (state.relationshipChanges.length > 0) {
    lines.push(`Relationship movement so far:`);
    for (const r of state.relationshipChanges) lines.push(`  • ${r}`);
  }
  if (state.settingChanges.length > 0) {
    lines.push(`Setting changes so far:`);
    for (const s of state.settingChanges) lines.push(`  • ${s}`);
  }
  if (state.unresolvedQuestions.length > 0) {
    lines.push(`Still unresolved:`);
    for (const q of state.unresolvedQuestions) lines.push(`  • ${q}`);
  }
  return lines.join("\n");
}

export function buildStorySegmentPrompts(input: GenerateStorySegmentInput): {
  system: string;
  user: string;
} {
  const priorSummaries = (input.priorSummaries ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  );
  const isFirstSegment = priorSummaries.length === 0;
  const isFinalSegment = !!input.isFinalSegment;
  const previousSegmentText = (input.previousSegmentText ?? "").trim();

  const wordTarget = computeEffectiveSegmentWordTarget(input.wordTarget, isFinalSegment);
  // Tighter upper band (~1.05x) reduces upstream overshoot before the
  // compression stage sees the merged draft. The final segment also receives
  // a slightly looser lower band so it can land naturally short rather than
  // expanding into afterglow scenes.
  const lowerBand = isFinalSegment
    ? Math.max(80, Math.round(wordTarget * 0.75))
    : Math.max(80, Math.round(wordTarget * 0.80));
  const upperBand = Math.round(wordTarget * 1.05);

  const closingGuidanceLine = isFinalSegment
    ? `- THIS IS THE FINAL STRETCH. Bring the story to a natural close — see the FINAL-SEGMENT CONTRACT below.`
    : `- Do NOT close the whole story — this is a continuation, not yet the ending. Avoid sequel-energy: do not telegraph that the real story begins afterwards.`;

  const systemLines: string[] = [
    `You are continuing the writing of a long-form audio story — a single, unbroken novel-quality prose flow read aloud to a listener. This is a self-contained story, not the first installment of a larger novel.`,
    ``,
    `You are NOT outlining, plotting, or labelling structure. You are writing the next stretch of the same novel — picking up exactly where the previous stretch left off, and ending where a natural rhetorical boundary occurs.`,
    ``,
    `A natural rhetorical boundary may arise from:`,
    `- a change of time (a beat passes, a night ends, a long pause settles)`,
    `- a change of place (a character moves, the scene relocates)`,
    `- an emotional transition (a feeling crests, releases, or hardens)`,
    `- a piece of information arriving or being withheld`,
    `- a relationship shifting in texture (warmth, distance, suspicion)`,
    `- a consequence beginning to settle`,
    `It is NEVER assigned by position, chapter number, or named beat.`,
    ``,
    SEGMENT_PROMPT_FORBIDDEN_NOTE,
    ``,
    `WRITING STYLE:`,
    `- Plain literary prose. Concrete nouns. Real names already established in the bible.`,
    `- No chapter headings. No section labels. No numbered parts. No bold/italics. No bullet points. No markdown of any kind.`,
    `- No horizontal-rule dividers ("—", "***", "---", or similar).`,
    `- Do NOT recap. Do NOT restate the bible to the reader. Trust the listener to remember.`,
    closingGuidanceLine,
    `- Honor the trajectory shape, ending tone, and ending approach in the bible as gravitational pulls, not slots to land on.`,
    ``,
    NARRATIVE_MOMENTUM_NOTE,
    ``,
    CLARITY_AT_THE_CENTER_NOTE,
    ``,
    SUBTEXT_NOTE,
    ``,
    WORD_TARGET_DISCIPLINE_NOTE,
    ``,
  ];

  if (!isFirstSegment) {
    systemLines.push(CONTINUITY_NOTE, ``);
  }

  if (isFinalSegment) {
    systemLines.push(
      FINAL_SEGMENT_CONTRACTION_NOTE,
      ``,
      `FINAL-SEGMENT CONTRACT (Pass C3A):`,
      `- This is the close of THIS story, not the close of "book one". The listener should finish feeling that they have lived through a complete story — not that the real story begins afterwards.`,
      `- The PRIMARY story question stated in the bible should be answered, settled, transformed, or allowed to land emotionally during this segment. The protagonist's central pressure should land or release in some form — even if quietly, even if bittersweet.`,
      `- Lean toward the bible's ending approach as the SHAPE of closure (mystery answered, emotional shift, quiet settling, bittersweet acceptance, reflective understanding). The approach is an inspiration, not a formula.`,
      ``,
      `CRITICAL — DO NOT REPLACE THIS STORY NEAR THE END (Pass C3B):`,
      `- As the story approaches its close, do not introduce a new central mystery, and do not suddenly reveal a much larger hidden conflict — authorities, conspiracies, old cover-ups, larger systems, secondary mysteries — that overshadows the story already being told.`,
      `- Do not replace the original story with a bigger one. The emotional weight should stay with the people and the journey the listener has been following all along, not shift onto completely different people, systems, conspiracies, or conflicts.`,
      `- Late revelations are welcome WHEN they deepen the journey already being told. They are not welcome when they redirect attention onto a story the listener has not been living through.`,
      `- Secondary questions may remain open. Side characters may keep secrets. Not every historical detail needs an answer. Ambiguity in the periphery is fine; what must remain stable is the emotional center.`,
      `- A satisfying ending feels like the natural consequence of the existing journey, not the beginning of a larger book. The listener should feel they are finishing the SAME story they have been following.`,
      ``,
      `CRITICAL — DO NOT EXPLAIN THE STORY (Pass C3C):`,
      `- Once the emotional movement has already been shown through action, dialogue, an object, an atmosphere, or a small gesture, do not explain its meaning again. The scene has already done the work. Trust it. Trust the listener.`,
      `- Let the story finish inside ordinary life. The final beats should remain concrete and scene-based — a hand resting on something, a kettle, a window, footsteps, weather, breath, a small line of dialogue, an everyday action continuing. Closure arrives through what is happening, not through what it means.`,
      `- Do NOT step back into a narrator's voice that summarizes the journey, names the theme, or tells the listener what the story was about. No essay-mode paragraphs at the ending. No interpretive coda.`,
      `- Strongly avoid abstract summary lines, thematic explanations, and moral conclusions. Avoid sentences whose job is to tell the listener what changed inside the character, what the silence meant, what the truth was, what was carried, what was released, what was beginning again. Avoid "Now everything had a name." / "She understood, finally, that …" / "It was enough." / "Not X anymore, but Y." constructions — they are the shape of essay endings.`,
      `- Avoid pronouncements on healing, truth, closure, fear, silence, grief, the past, forgiveness, or "beginning again." If the story has touched these, the scene has already conveyed them; do not name them.`,
      `- Prefer endings carried by: gestures, objects, sensory detail, atmosphere, weather, a small line of dialogue, an everyday action quietly continuing. The last image should feel lived, not interpreted.`,
      `- This is NOT a request for abruptness, ambiguity for its own sake, or shallower emotion. Bittersweet, tender, and quietly devastating endings remain welcome — but they must land in scene, not in commentary. Keep the same tone and pacing; only remove the explanatory voice that arrives after the moment has already happened.`,
      ``,
      `Allowed:`,
      `- Bittersweet, ambiguous, or quietly tragic endings.`,
      `- Secondary threads left open. Not every detail needs explaining.`,
      `- A small final image, a settled silence, an unresolved emotional residue — closure does not require resolution of every thread.`,
      `- Late discoveries that DEEPEN the existing journey — adding weight or texture to the people and pressures the listener has already been following.`,
      `Avoid:`,
      `- Introducing new main suspects, new central mysteries, or a larger unseen problem in this segment.`,
      `- Revealing an even larger pressure after the original primary question has been addressed.`,
      `- Shifting the emotional center onto different people, systems, conspiracies, or conflicts the listener has not been following. The story already has its people; let them carry the close.`,
      `- Telegraphing that the real story begins afterwards. No final-line cliffhangers. No "to be continued" energy. No setup-for-a-sequel last beats.`,
      `- A rushed wrap-up. Pacing stays slow and literary; the story closes in its own rhythm.`,
      ``,
    );
  }

  systemLines.push(
    `STRUCTURED OUTPUT:`,
    `Return ONLY valid JSON with three fields:`,
    `  - "text": the prose for this segment. Plain text. No headings, no markdown, no separators.`,
    `  - "summary": a compact recap (100–180 words) of THIS segment only — important events, emotional changes, relationship shifts, new questions, new information. Keep it lean: it will be threaded into later segment calls and should not invite re-establishing of setting, atmosphere, or emotional baseline. No beat labels. No chapter labels.`,
    `  - "stateAfter": the post-segment state with EXACTLY these fields and nothing else:`,
    `      • emotionalState (string)`,
    `      • relationshipChanges (array of short strings — cumulative or new, your judgment)`,
    `      • unresolvedQuestions (array of short strings — what is still open at the end of this segment)`,
    `      • settingChanges (array of short strings — places/atmospheres entered or left)`,
    `      • elapsedTime (string — how much story-time has accumulated, expressed naturally)`,
    `Do NOT introduce fields like currentBeat, midpointReached, climaxPending, actNumber, chapterRole, phase, or any other structural marker.`,
  );

  const system = systemLines.join("\n");

  const bibleBlock = buildBibleBlock(input.bible);
  const stateBlock = buildStateBlock(input.priorState);

  const userLines: string[] = [];
  userLines.push(`Output language: ${input.outputLanguage}. Write the segment text and the summary in ${input.outputLanguage}.`);
  userLines.push(``);
  userLines.push(`Approximate length for THIS segment: ~${wordTarget} words (acceptable band ~${lowerBand}–${upperBand}). Lean toward landing AT OR JUST UNDER the target rather than at the upper edge of the band. End where the prose naturally pauses — do not pad to reach the band, and do not amputate.`);
  userLines.push(``);
  userLines.push(`=== STORY BIBLE (shared truth, do not restate to the listener) ===`);
  userLines.push(bibleBlock);
  userLines.push(``);

  if (priorSummaries.length > 0) {
    userLines.push(`=== STORY SO FAR (recap of prior segments — do not echo verbatim) ===`);
    priorSummaries.forEach((s, i) => {
      userLines.push(`Segment ${i + 1} recap:`);
      userLines.push(s.trim());
      userLines.push(``);
    });
  }

  userLines.push(`=== CURRENT STATE entering this segment ===`);
  userLines.push(stateBlock);
  userLines.push(``);

  if (previousSegmentText) {
    const tailWords = previousSegmentText.split(/\s+/).filter(Boolean);
    const tail = tailWords.slice(-160).join(" ");
    userLines.push(`=== LAST PROSE FROM THE PREVIOUS SEGMENT (continue directly, do not repeat) ===`);
    userLines.push(tail);
    userLines.push(``);
  }

  if (isFinalSegment) {
    if (isFirstSegment) {
      userLines.push(
        `Open the story with a natural beginning, and within this single stretch bring it to a complete close. Honor the FINAL-SEGMENT CONTRACT above: the PRIMARY story question stated in the bible should be answered, settled, transformed, or allowed to land emotionally by the end. Do not announce structure. Do not telegraph that this is the close. End the story where the prose naturally rests — not on a cliffhanger, not on a sequel-hook. Let the close land in scene — a gesture, an object, a sensory detail, an everyday action continuing — not in narrator commentary that explains what the story meant.`,
      );
    } else {
      userLines.push(
        `Continue naturally from where the previous segment ended, and bring the story to a complete close within this stretch. Honor the FINAL-SEGMENT CONTRACT above: the PRIMARY story question stated in the bible should be answered, settled, transformed, or allowed to land emotionally by the end. Do not introduce new main suspects, new central mysteries, or larger unseen problems. End the story where the prose naturally rests — not on a cliffhanger, not on a sequel-hook. Let the close land in scene — a gesture, an object, a sensory detail, an everyday action continuing — not in narrator commentary that explains what the story meant.`,
      );
    }
  } else if (isFirstSegment) {
    userLines.push(
      `Open the story with a natural beginning. Do not announce that this is the start. Begin in scene, in voice, in motion. Do not close the whole story — this is the opening stretch, not the ending.`,
    );
  } else {
    userLines.push(
      `Continue naturally from where the previous segment ended. Pick up the same voice, the same rhythm, the same emotional register, and let the next meaningful movement unfold. End where a natural rhetorical boundary occurs. Do not close the whole story — this is a continuation, not yet the ending.`,
    );
  }
  userLines.push(``);
  userLines.push(`Return ONLY the JSON object — no commentary, no field labels outside the JSON, no markdown fences.`);

  return { system, user: userLines.join("\n") };
}

// -----------------------------------------------------------------------------
// JSON schema for the segment call. Strict mode: every property required,
// additionalProperties false. No beat-sheet fields are present, and validation
// later checks the parsed object for the same.
// -----------------------------------------------------------------------------

export const NARRATIVE_SEGMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    summary: { type: "string" },
    stateAfter: {
      type: "object",
      additionalProperties: false,
      properties: {
        emotionalState: { type: "string" },
        relationshipChanges: { type: "array", items: { type: "string" } },
        unresolvedQuestions: { type: "array", items: { type: "string" } },
        settingChanges: { type: "array", items: { type: "string" } },
        elapsedTime: { type: "string" },
      },
      required: [
        "emotionalState",
        "relationshipChanges",
        "unresolvedQuestions",
        "settingChanges",
        "elapsedTime",
      ],
    },
  },
  required: ["text", "summary", "stateAfter"],
} as const;

// Fields explicitly forbidden on SegmentState. If a model ever returns these,
// reject — they would re-introduce beat-sheet thinking by the back door.
export const FORBIDDEN_SEGMENT_STATE_FIELDS: readonly string[] = [
  "currentBeat",
  "midpointReached",
  "climaxPending",
  "actNumber",
  "chapterRole",
  "phase",
  "beat",
  "act",
  "chapter",
];

function stripMarkdownArtifacts(s: string): string {
  let out = s.replace(/^﻿/, "");
  out = out.replace(/^```[a-zA-Z]*\s*\n?/, "");
  out = out.replace(/\n?```\s*$/, "");
  out = out.replace(/^(?:#+\s*)?(chapter|part|section)\s+[ivxlcdm\d]+[:.\s].*$/gim, "");
  out = out.replace(/^\s*[-*]{3,}\s*$/gm, "");
  out = out.replace(/^\s*[#*_]{1,6}\s*/gm, "");
  return out.trim();
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
}

export function validateNarrativeSegment(raw: unknown, id: string): NarrativeSegment {
  if (!isPlainObject(raw)) {
    throw new Error("NarrativeSegment validation failed: not a JSON object");
  }

  const text = raw.text;
  if (!nonEmptyString(text)) {
    throw new Error("NarrativeSegment validation failed: text missing or empty");
  }

  const summary = raw.summary;
  if (!nonEmptyString(summary)) {
    throw new Error("NarrativeSegment validation failed: summary missing or empty");
  }

  if ("role" in (raw as Record<string, unknown>)) {
    throw new Error(
      "NarrativeSegment validation failed: forbidden field 'role' present (segments are not labelled with dramatic roles)",
    );
  }

  const stateRaw = raw.stateAfter;
  if (!isPlainObject(stateRaw)) {
    throw new Error("NarrativeSegment validation failed: stateAfter missing or not an object");
  }

  for (const f of FORBIDDEN_SEGMENT_STATE_FIELDS) {
    if (f in stateRaw) {
      throw new Error(
        `NarrativeSegment validation failed: stateAfter contains forbidden beat-sheet field "${f}"`,
      );
    }
  }

  const emotionalState = typeof stateRaw.emotionalState === "string" ? stateRaw.emotionalState.trim() : "";
  const elapsedTime = typeof stateRaw.elapsedTime === "string" ? stateRaw.elapsedTime.trim() : "";

  const stateAfter: SegmentState = {
    emotionalState,
    relationshipChanges: asStringArray(stateRaw.relationshipChanges),
    unresolvedQuestions: asStringArray(stateRaw.unresolvedQuestions),
    settingChanges: asStringArray(stateRaw.settingChanges),
    elapsedTime,
  };

  return {
    id,
    text: stripMarkdownArtifacts(text),
    summary: summary.trim(),
    stateAfter,
  };
}

// -----------------------------------------------------------------------------
// Real implementation. Lazy OpenAI client per CLAUDE.md.
// -----------------------------------------------------------------------------

export async function generateStorySegment(
  input: GenerateStorySegmentInput,
): Promise<NarrativeSegment> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("generateStorySegment: missing OPENAI_API_KEY");
  }

  const segmentIndex = (input.priorSummaries ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  ).length + 1;
  const id = `seg-${segmentIndex}`;

  const model =
    input.model ??
    process.env.OPENAI_SEGMENT_MODEL ??
    process.env.OPENAI_SCRIPT_MODEL ??
    "gpt-5.4-mini";
  const timeoutMs =
    typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
      ? input.timeoutMs
      : parseInt(process.env.OPENAI_SEGMENT_TIMEOUT_MS ?? "120000", 10);

  const wordTarget = computeEffectiveSegmentWordTarget(
    input.wordTarget,
    !!input.isFinalSegment,
  );
  const maxTokens = Math.min(8000, wordTarget * 3 + 512);

  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=start",
    `id=${id}`,
    `model=${model}`,
    `lang=${input.outputLanguage}`,
    `wordTarget=${wordTarget}`,
    `priorSummaries=${(input.priorSummaries ?? []).length}`,
    `hasPrevText=${input.previousSegmentText ? "yes" : "no"}`,
    `isFinalSegment=${input.isFinalSegment ? "yes" : "no"}`,
    `trajectory=${input.bible.trajectoryShape}`,
    `endingTone=${input.bible.endingTone}`,
    `endingApproach=${input.bible.endingApproach}`,
  );

  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=segment.start",
    `index=${segmentIndex}`,
    `wordTarget=${wordTarget}`,
    `priorSummaryCount=${segmentIndex - 1}`,
    `isFinalSegment=${input.isFinalSegment ? "yes" : "no"}`,
  );

  const { system, user } = buildStorySegmentPrompts(input);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const openaiT0 = Date.now();
  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=openai.start",
    `id=${id}`,
    `model=${model}`,
    `timeoutMs=${timeoutMs}`,
    `maxTokens=${maxTokens}`,
  );

  let resp;
  try {
    resp = await openai.responses.create(
      {
        model,
        max_output_tokens: maxTokens,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "SoftVibeNarrativeSegment",
            strict: true,
            schema: NARRATIVE_SEGMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      "[NARRATIVE-SEGMENT]",
      "phase=error",
      `id=${id}`,
      `stage=openai`,
      `durationMs=${Date.now() - openaiT0}`,
      `error="${msg.slice(0, 200)}"`,
    );
    throw err;
  }

  const openaiDurationMs = Date.now() - openaiT0;
  const rawText = resp.output_text ?? "";
  const respStatus = resp.status ?? "unknown";

  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=openai.end",
    `id=${id}`,
    `durationMs=${openaiDurationMs}`,
    `status=${respStatus}`,
    `length=${rawText.length}`,
  );

  if (respStatus === "incomplete") {
    console.error(
      "[NARRATIVE-SEGMENT]",
      "phase=error",
      `id=${id}`,
      "stage=truncated",
      `length=${rawText.length}`,
    );
    throw new Error(
      `generateStorySegment: response truncated (status=incomplete, length=${rawText.length})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const preview = rawText.slice(0, 120) || "(empty)";
    console.error(
      "[NARRATIVE-SEGMENT]",
      "phase=error",
      `id=${id}`,
      "stage=json-parse",
      `status=${respStatus}`,
      `length=${rawText.length}`,
    );
    throw new Error(
      `generateStorySegment: invalid JSON from OpenAI (status=${respStatus}, length=${rawText.length}). Preview: ${preview}`,
    );
  }

  let segment: NarrativeSegment;
  try {
    segment = validateNarrativeSegment(parsed, id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      "[NARRATIVE-SEGMENT]",
      "phase=error",
      `id=${id}`,
      "stage=validate",
      `error="${msg.slice(0, 200)}"`,
    );
    throw err;
  }

  const wordCount = segment.text.split(/\s+/).filter(Boolean).length;
  const summaryWords = segment.summary.split(/\s+/).filter(Boolean).length;
  const textPreview = segment.text.slice(0, 120).replace(/\s+/g, " ");

  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=parse.end",
    `id=${id}`,
    `words=${wordCount}`,
    `summaryWords=${summaryWords}`,
    `emotion="${segment.stateAfter.emotionalState.slice(0, 40)}"`,
    `relChanges=${segment.stateAfter.relationshipChanges.length}`,
    `openQs=${segment.stateAfter.unresolvedQuestions.length}`,
    `settingChanges=${segment.stateAfter.settingChanges.length}`,
    `preview="${textPreview}"`,
  );

  const elapsedTimeForLog = segment.stateAfter.elapsedTime
    .slice(0, 60)
    .replace(/\s+/g, " ");
  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=segment.end",
    `index=${segmentIndex}`,
    `actualWords=${wordCount}`,
    `summaryWords=${summaryWords}`,
    `elapsedTime="${elapsedTimeForLog}"`,
    `unresolvedQuestions=${segment.stateAfter.unresolvedQuestions.length}`,
  );

  return segment;
}

// -----------------------------------------------------------------------------
// Merge: stitch the ordered segments into one continuous prose flow. No
// headings, no separators, no markdown. The caller-facing contract is that
// the output reads like a single uninterrupted novel.
// -----------------------------------------------------------------------------

export function mergeNarrativeSegments(segments: NarrativeSegment[]): string {
  if (!Array.isArray(segments) || segments.length === 0) return "";
  const cleaned: string[] = [];
  for (const seg of segments) {
    if (!seg || typeof seg.text !== "string") continue;
    const trimmed = stripMarkdownArtifacts(seg.text);
    if (trimmed.length === 0) continue;
    cleaned.push(trimmed);
  }
  const merged = cleaned.join("\n\n");

  const mergedWords = merged.split(/\s+/).filter(Boolean).length;
  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=merge.done",
    `segmentCount=${segments.length}`,
    `mergedWords=${mergedWords}`,
    `mergedChars=${merged.length}`,
  );

  return merged;
}

// Words-per-second the planning side of this module assumes (mirrors the
// `targetDurationSec * 1.95` rule used in buildStoryOutlinePrompts).
export const NARRATIVE_WORDS_PER_SECOND = 1.95;

// Inverse of the planning estimator: given finished prose, return the
// expected spoken duration in seconds. Used for post-merge calibration logs.
export function estimateNarrativeDurationSec(text: string): number {
  const words = (typeof text === "string" ? text : "")
    .split(/\s+/)
    .filter(Boolean).length;
  if (words === 0) return 0;
  return Math.round(words / NARRATIVE_WORDS_PER_SECOND);
}
