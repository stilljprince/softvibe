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
    `WHAT TO PRODUCE (story bible — abstract, literary, flexible):`,
    `- title: a real title if one emerges, otherwise null. No placeholder titles.`,
    `- protagonistSummary: a person, not an archetype. Who they are, what they want or fear, what they stand to lose.`,
    `- supportingCharacterSummary: 0–4 sketches of named supporting figures. Each grounded — a name when natural, a role/relationship to the protagonist, a 1-sentence summary. Use null for name or role when not yet decided.`,
    `- settingSummary: a specific place, era, and atmosphere — the setting should put pressure on the characters, not be wallpaper.`,
    `- pressureSources: 2–4 specific forces pressing on the protagonist — relational, internal, external, environmental, social. Not abstract themes ("loss", "love"); concrete pressure ("the sister who hasn't called back", "the rent due Friday").`,
    `- importantRelationships: relevant character pairs and the texture of the bond — affection, debt, suspicion, rivalry, complicity. Use the same names from protagonist/supporting fields.`,
    `- unresolvedQuestions: 0–4 questions the listener might carry into the story. These need NOT all be answered. They give the writer room to maneuver.`,
    `- endingTone: one of the allowed values, chosen because it fits this story — not as a structural slot.`,
    `- trajectoryShape: one of the allowed shapes, chosen because it matches how pressure naturally moves in THIS story.`,
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
    endingTone: {
      type: "string",
      enum: [...ALLOWED_ENDING_TONES],
    },
    trajectoryShape: {
      type: "string",
      enum: [...ALLOWED_TRAJECTORY_SHAPES],
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
    "endingTone",
    "trajectoryShape",
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
    endingTone,
    trajectoryShape,
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
    `support=${bible.supportingCharacterSummary.length}`,
    `pressure=${bible.pressureSources.length}`,
    `relationships=${bible.importantRelationships.length}`,
    `questions=${bible.unresolvedQuestions.length}`,
    `hasTitle=${bible.title ? "yes" : "no"}`,
  );

  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=outline.done",
    `trajectoryShape=${bible.trajectoryShape}`,
    `endingTone=${bible.endingTone}`,
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
  lines.push(`Trajectory shape (emergent, not a template): ${bible.trajectoryShape}`);
  lines.push(`Ending tone the story is moving toward: ${bible.endingTone}`);
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
  const wordTarget =
    typeof input.wordTarget === "number" && Number.isFinite(input.wordTarget)
      ? Math.max(120, Math.round(input.wordTarget))
      : 600;
  const lowerBand = Math.max(80, Math.round(wordTarget * 0.7));
  const upperBand = Math.round(wordTarget * 1.25);

  const priorSummaries = (input.priorSummaries ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  );
  const isFirstSegment = priorSummaries.length === 0;
  const previousSegmentText = (input.previousSegmentText ?? "").trim();

  const system = [
    `You are continuing the writing of a long-form audio story — a single, unbroken novel-quality prose flow read aloud to a listener.`,
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
    `- Do NOT close the whole story unless the story has genuinely run its course — this is a continuation, not necessarily an ending.`,
    `- Honor the trajectory shape and ending tone in the bible as gravitational pulls, not slots to land on.`,
    ``,
    `STRUCTURED OUTPUT:`,
    `Return ONLY valid JSON with three fields:`,
    `  - "text": the prose for this segment. Plain text. No headings, no markdown, no separators.`,
    `  - "summary": a compact recap (150–300 words) of THIS segment only — important events, emotional changes, relationship shifts, new questions, new information. No beat labels. No chapter labels.`,
    `  - "stateAfter": the post-segment state with EXACTLY these fields and nothing else:`,
    `      • emotionalState (string)`,
    `      • relationshipChanges (array of short strings — cumulative or new, your judgment)`,
    `      • unresolvedQuestions (array of short strings — what is still open at the end of this segment)`,
    `      • settingChanges (array of short strings — places/atmospheres entered or left)`,
    `      • elapsedTime (string — how much story-time has accumulated, expressed naturally)`,
    `Do NOT introduce fields like currentBeat, midpointReached, climaxPending, actNumber, chapterRole, phase, or any other structural marker.`,
  ].join("\n");

  const bibleBlock = buildBibleBlock(input.bible);
  const stateBlock = buildStateBlock(input.priorState);

  const userLines: string[] = [];
  userLines.push(`Output language: ${input.outputLanguage}. Write the segment text and the summary in ${input.outputLanguage}.`);
  userLines.push(``);
  userLines.push(`Approximate length for THIS segment: ~${wordTarget} words (acceptable band ~${lowerBand}–${upperBand}). End where the prose naturally pauses, even if you land slightly short or slightly long — do not pad and do not amputate.`);
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

  if (isFirstSegment) {
    userLines.push(
      `Open the story with a natural beginning. Do not announce that this is the start. Begin in scene, in voice, in motion.`,
    );
  } else {
    userLines.push(
      `Continue naturally from where the previous segment ended. Pick up the same voice, the same rhythm, the same emotional register, and let the next meaningful movement unfold. End where a natural rhetorical boundary occurs.`,
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

  const wordTarget =
    typeof input.wordTarget === "number" && Number.isFinite(input.wordTarget)
      ? Math.max(120, Math.round(input.wordTarget))
      : 600;
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
    `trajectory=${input.bible.trajectoryShape}`,
    `endingTone=${input.bible.endingTone}`,
  );

  console.log(
    "[NARRATIVE-SEGMENT]",
    "phase=segment.start",
    `index=${segmentIndex}`,
    `wordTarget=${wordTarget}`,
    `priorSummaryCount=${segmentIndex - 1}`,
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
