// scripts/test-creative-intelligence-guidance.ts
//
// RP-011C.7.25 — Isolated tests for the Generation Guidance Layer
// (lib/creative-intelligence/guidance/**). Nothing here touches the active
// generation pipeline, calls a provider, or hits the database.
//
// Run with:  npx tsx scripts/test-creative-intelligence-guidance.ts

import fs from "node:fs";
import path from "node:path";
import {
  CreativeKnowledgeRegistry,
  initializeCreativeKnowledge,
  buildCreativeContext,
  buildStoryBlueprint,
  buildSceneBlueprints,
  buildGenerationGuidance,
} from "../lib/creative-intelligence";
import type {
  CreativeContext,
  CreativeIntent,
  GenerationGuidance,
  SceneBlueprint,
  StoryBlueprint,
} from "../lib/creative-intelligence";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[FAIL] ${name}\n       expected=${JSON.stringify(expected)}\n       actual=  ${JSON.stringify(actual)}`
    );
    failed++;
  }
}

function checkTrue(name: string, condition: boolean): void {
  check(name, condition, true);
}

const registry = new CreativeKnowledgeRegistry();
initializeCreativeKnowledge(registry);

function contextFor(intent: CreativeIntent, prompt = "test"): CreativeContext {
  return buildCreativeContext({ rawInput: { prompt }, intent, registry, createdAt: "2026-01-01T00:00:00.000Z" });
}

function blueprintFor(intent: CreativeIntent, prompt = "test"): StoryBlueprint {
  return buildStoryBlueprint({ intent, context: contextFor(intent, prompt), createdAt: "2026-01-01T00:00:00.000Z" });
}

function scenesFor(intent: CreativeIntent, prompt = "test"): SceneBlueprint[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  return buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
}

function guidanceFor(intent: CreativeIntent, prompt = "test"): GenerationGuidance[] {
  const context = contextFor(intent, prompt);
  const blueprint = blueprintFor(intent, prompt);
  const scenes = buildSceneBlueprints({ intent, context, blueprint, createdAt: "2026-01-01T00:00:00.000Z" });
  return buildGenerationGuidance({ scenes, blueprint, context, intent, createdAt: "2026-01-01T00:00:00.000Z" });
}

const narrativeArcIntent: CreativeIntent = {
  preset: "narrative",
  experience: "an immersive narrative built around the listener's request",
  audience: "adult",
  durationMinutes: 20,
  constraints: [],
  storyScale: "arc",
  themes: ["courage"],
};

const transformationIntent: CreativeIntent = {
  preset: "narrative",
  experience: "a story about rebuilding a life through independence",
  audience: "adult",
  durationMinutes: 25,
  constraints: [],
  storyScale: "transformation",
  themes: ["independence"],
};

const sleepStoryIntent: CreativeIntent = {
  preset: "sleep-story",
  experience: "a relaxing bedtime story to help the listener fall asleep",
  audience: "adult",
  durationMinutes: 30,
  constraints: [],
  storyScale: "gentle_journey",
  emotionalDirection: ["calm", "safe"],
};

const meditationIntent: CreativeIntent = {
  preset: "meditation",
  experience: "a guided meditation for centering attention",
  audience: "adult",
  durationMinutes: 12,
  constraints: [],
};

const kidsStoryIntent: CreativeIntent = {
  preset: "kids-story",
  experience: "a gentle, age-safe bedtime story for children",
  audience: "child",
  durationMinutes: 8,
  constraints: ["age-safe: avoid violence, horror, and existential themes"],
  storyScale: "gentle_journey",
  themes: ["friendship"],
  requiredElements: ["gentle_pacing", "safe_resolution", "positive_resolution", "age_safe_language"],
};

const classicAsmrIntent: CreativeIntent = {
  preset: "classic-asmr",
  experience: "a slow, sensory-focused ASMR session",
  audience: "adult",
  durationMinutes: 15,
  constraints: [],
};

const classicAsmrPresenceIntent: CreativeIntent = {
  ...classicAsmrIntent,
  asmrMode: "presence",
};

const classicAsmrStoryIntent: CreativeIntent = {
  ...classicAsmrIntent,
  experience: "a gentle ASMR roleplay scene",
  asmrMode: "story",
};

const allIntents = [
  narrativeArcIntent,
  transformationIntent,
  sleepStoryIntent,
  meditationIntent,
  kidsStoryIntent,
  classicAsmrIntent,
];

// ─── 1. Generation Guidance can be created ─────────────────────────────

{
  const guidance = guidanceFor(narrativeArcIntent);

  checkTrue("guidanceFor returns a non-empty array", guidance.length > 0);
  checkTrue(
    "every guidance entry has the full GenerationGuidance shape",
    guidance.every(
      (g) =>
        typeof g.sceneId === "string" &&
        typeof g.writingFocus === "string" &&
        typeof g.narrativeIntent === "string" &&
        typeof g.emotionalApproach === "string" &&
        typeof g.characterGuidance === "string" &&
        typeof g.dialogueGuidance === "string" &&
        typeof g.pacingGuidance === "string" &&
        typeof g.descriptionGuidance === "string" &&
        Array.isArray(g.allowedElements) &&
        Array.isArray(g.avoidPatterns) &&
        typeof g.styleGuidance === "string" &&
        typeof g.metadata?.createdAt === "string"
    )
  );
  check("metadata.createdAt uses the provided override", guidance[0].metadata.createdAt, "2026-01-01T00:00:00.000Z");
  check("metadata.builderMethod is deterministic-template", guidance[0].metadata.builderMethod, "deterministic-template");
}

// ─── 2. Every scene gets guidance ──────────────────────────────────────

{
  for (const intent of allIntents) {
    const scenes = scenesFor(intent);
    const guidance = guidanceFor(intent);

    check(`${intent.preset}: one guidance entry per scene`, guidance.length, scenes.length);
    check(
      `${intent.preset}: guidance sceneIds match scenes, in order`,
      guidance.map((g) => g.sceneId),
      scenes.map((s) => s.id)
    );
  }
}

// ─── 3 & 4. No finished prose, no dialogue ─────────────────────────────

{
  const MAX_LABEL_LENGTH = 220;
  const offenders: string[] = [];

  function walk(value: unknown, keyPath: string): void {
    if (typeof value === "string") {
      if (value.length > MAX_LABEL_LENGTH) offenders.push(`${keyPath} (${value.length} chars, too long for structural guidance)`);
      if (value.includes('"') && /[.!?]"/.test(value)) offenders.push(`${keyPath} (looks like quoted dialogue)`);
      if (value.includes("\n")) offenders.push(`${keyPath} (multi-line -- reads as prose, not guidance)`);
      // A guidance field is an instruction/label, not written scene text.
      // More than two sentences starts to read as prose rather than
      // guidance.
      const sentenceEnders = value.match(/[.!?](\s|$)/g) ?? [];
      if (sentenceEnders.length > 2) offenders.push(`${keyPath} (${sentenceEnders.length} sentences, reads as prose)`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${keyPath}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  }

  for (const intent of allIntents) {
    for (const g of guidanceFor(intent)) walk(g, `${intent.preset}.${g.sceneId}`);
  }
  check("no guidance field reads as finished prose", offenders, []);

  const dialoguePattern = /\b(said|asked|replied|whispered|shouted)\b[:,]?\s*"/i;
  const dialogueOffenders: string[] = [];
  for (const intent of allIntents) {
    for (const g of guidanceFor(intent)) {
      const combined = [
        g.writingFocus,
        g.narrativeIntent,
        g.emotionalApproach,
        g.characterGuidance,
        g.dialogueGuidance,
        g.pacingGuidance,
        g.descriptionGuidance,
        g.styleGuidance,
        ...g.allowedElements,
      ].join(" ");
      if (dialoguePattern.test(combined)) dialogueOffenders.push(`${intent.preset}:${g.sceneId}`);
    }
  }
  check("no guidance entry contains generated dialogue", dialogueOffenders, []);
}

// ─── 5. Knowledge principles are considered ────────────────────────────

{
  const scenes = scenesFor(transformationIntent);
  const guidance = guidanceFor(transformationIntent);

  checkTrue(
    "avoidPatterns is carried over from the scene's already-resolved knowledge antiPatterns",
    guidance.every((g, i) => JSON.stringify([...g.avoidPatterns].sort()) === JSON.stringify([...scenes[i].avoidPatterns].sort()))
  );

  const avoidAiKnowledge = contextFor(transformationIntent).knowledge.modules.find(
    (m) => m.id === "avoid_ai_writing_patterns"
  )?.knowledge ?? [];
  checkTrue(
    "allowedElements folds in avoid_ai_writing_patterns' permissive knowledge statements",
    avoidAiKnowledge.length > 0 && guidance.every((g) => avoidAiKnowledge.every((k) => g.allowedElements.includes(k)))
  );

  const kidsGuidance = guidanceFor(kidsStoryIntent);
  checkTrue(
    "kids-story guidance carries the intent's hard requiredElements (age-safety) into allowedElements",
    kidsGuidance.every((g) => (kidsStoryIntent.requiredElements ?? []).every((el) => g.allowedElements.includes(el)))
  );
}

// ─── 6. Narrative differs structurally from Sleep Story ────────────────

{
  const narrativeGuidance = guidanceFor(narrativeArcIntent);
  const sleepGuidance = guidanceFor(sleepStoryIntent);

  checkTrue(
    "narrative and sleep-story use different dialogueGuidance",
    narrativeGuidance[0].dialogueGuidance !== sleepGuidance[0].dialogueGuidance
  );
  checkTrue(
    "narrative and sleep-story use different pacingGuidance",
    narrativeGuidance[0].pacingGuidance !== sleepGuidance[0].pacingGuidance
  );
  checkTrue(
    "narrative and sleep-story use different characterGuidance",
    narrativeGuidance[0].characterGuidance !== sleepGuidance[0].characterGuidance
  );
  checkTrue(
    "only narrative's styleGuidance reflects premise_fulfillment",
    narrativeGuidance[0].styleGuidance.includes("resolution scale") &&
      !sleepGuidance[0].styleGuidance.includes("resolution scale")
  );
}

// ─── 7. Kids Story gets appropriate guidance ───────────────────────────

{
  const kidsGuidance = guidanceFor(kidsStoryIntent);

  checkTrue(
    "kids-story dialogueGuidance is written for a child audience",
    kidsGuidance.every((g) => /child/i.test(g.dialogueGuidance))
  );
  checkTrue(
    "kids-story descriptionGuidance excludes frightening/existential imagery",
    kidsGuidance.every((g) => /age-safe/i.test(g.descriptionGuidance))
  );
  checkTrue(
    "kids-story is plot-driven (light adventure) but stays age-safe",
    kidsGuidance.every((g) => !/climax|unresolved conflict/i.test(g.pacingGuidance))
  );
}

// ─── 8. ASMR / Meditation get no classic plot-guidance ─────────────────

{
  const plotWords = /\bturning point\b|\bclimax\b|\bunresolved conflict\b|\bplot twist\b/i;
  const asmrGuidance = guidanceFor(classicAsmrIntent);
  const meditationGuidance = guidanceFor(meditationIntent);

  for (const [label, guidance] of [
    ["classic-asmr", asmrGuidance],
    ["meditation", meditationGuidance],
  ] as const) {
    checkTrue(
      `${label} guidance contains no classic plot-guidance language`,
      guidance.every(
        (g) =>
          !plotWords.test(g.writingFocus) &&
          !plotWords.test(g.narrativeIntent) &&
          !plotWords.test(g.characterGuidance) &&
          !plotWords.test(g.pacingGuidance) &&
          !plotWords.test(g.styleGuidance)
      )
    );
    checkTrue(
      `${label} characterGuidance centers the listener, not a character arc`,
      guidance.every((g) => /listener/i.test(g.characterGuidance))
    );
  }
}

// ─── 9. AI-writing anti-pattern rules are transferred ──────────────────

{
  const antiPatterns = contextFor(narrativeArcIntent).knowledge.modules.find(
    (m) => m.id === "avoid_ai_writing_patterns"
  )?.antiPatterns ?? [];
  checkTrue("avoid_ai_writing_patterns module defines antiPatterns", antiPatterns.length > 0);

  for (const intent of allIntents) {
    const guidance = guidanceFor(intent);
    checkTrue(
      `${intent.preset}: every guidance entry's avoidPatterns includes the AI-writing anti-patterns`,
      guidance.every((g) => antiPatterns.every((p) => g.avoidPatterns.includes(p)))
    );
  }
}

// ─── 10. No mutation, no pipeline wiring (regression safety) ───────────

{
  const context = contextFor(narrativeArcIntent);
  const blueprint = blueprintFor(narrativeArcIntent);
  const scenes = scenesFor(narrativeArcIntent);
  const contextSnapshot = JSON.stringify(context);
  const blueprintSnapshot = JSON.stringify(blueprint);
  const scenesSnapshot = JSON.stringify(scenes);

  buildGenerationGuidance({ scenes, blueprint, context, intent: narrativeArcIntent, createdAt: "2026-01-01T00:00:00.000Z" });

  check("buildGenerationGuidance does not mutate the CreativeContext it is given", JSON.stringify(context), contextSnapshot);
  check("buildGenerationGuidance does not mutate the StoryBlueprint it is given", JSON.stringify(blueprint), blueprintSnapshot);
  check("buildGenerationGuidance does not mutate the SceneBlueprint[] it is given", JSON.stringify(scenes), scenesSnapshot);

  const forbiddenPipelinePaths = [
    "app/api/jobs",
    "lib/narrative",
    "lib/story-supervisor.ts",
    "lib/script-builder.ts",
    "lib/script-builder-openai.ts",
    "lib/tts",
    "lib/audio",
    "app/generate",
  ];

  const guidanceDir = path.join(process.cwd(), "lib/creative-intelligence/guidance");
  const guidanceFiles = fs
    .readdirSync(guidanceDir)
    .filter((f) => /\.ts$/.test(f))
    .map((f) => path.join(guidanceDir, f));

  const offending: string[] = [];
  for (const file of guidanceFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const forbidden of forbiddenPipelinePaths) {
      if (content.includes(forbidden)) offending.push(`${path.relative(process.cwd(), file)} -> ${forbidden}`);
    }
    if (/from\s+["']openai["']/.test(content) || /from\s+["']elevenlabs["']/.test(content)) {
      offending.push(`${path.relative(process.cwd(), file)} -> provider import`);
    }
  }
  check("no guidance/ file references a pipeline path or provider SDK", offending, []);

  function collectFiles(target: string): string[] {
    const abs = path.join(process.cwd(), target);
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (stat.isFile()) return [abs];
    const results: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const entryPath = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(path.relative(process.cwd(), entryPath)));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        results.push(entryPath);
      }
    }
    return results;
  }

  const offendingPipelineFiles: string[] = [];
  for (const target of forbiddenPipelinePaths) {
    for (const file of collectFiles(target)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("creative-intelligence")) {
        offendingPipelineFiles.push(path.relative(process.cwd(), file));
      }
    }
  }
  check("no existing pipeline file imports lib/creative-intelligence", offendingPipelineFiles, []);
}

// ─── 11. RP-011C.8.8.2D — Meditation guidance calibration ──────────────
//
// Meditation guidance must read as invitation over command, awareness
// over performance, and presence over achievement -- distinct from the
// generic non-plot-driven text shared by sleep-story/classic-asmr, and
// free of narrative storytelling, character arcs, external journeys,
// dramatic emotional change, or fantasy-world description.

{
  const meditationGuidance = guidanceFor(meditationIntent);
  const sleepGuidance = guidanceFor(sleepStoryIntent);
  const asmrGuidance = guidanceFor(classicAsmrIntent);

  // 1. Writing focus: invitation to notice, not a task/story.
  checkTrue(
    "meditation writingFocus reads as invitation to notice, explicitly not a task or a story",
    meditationGuidance.every((g) => /invite/i.test(g.writingFocus) && /notice/i.test(g.writingFocus) && /not a task to complete or a story to follow/i.test(g.writingFocus))
  );
  checkTrue(
    "meditation writingFocus differs from sleep-story's generic non-plot writingFocus",
    meditationGuidance[0].writingFocus !== sleepGuidance[0].writingFocus
  );
  checkTrue(
    "meditation writingFocus differs from classic-asmr's generic non-plot writingFocus",
    meditationGuidance[0].writingFocus !== asmrGuidance[0].writingFocus
  );

  // 2. Character guidance: listener as direct participant, no fictional characters.
  checkTrue(
    "meditation characterGuidance rules out fictional characters and narrated persona",
    meditationGuidance.every((g) => /no fictional characters/i.test(g.characterGuidance))
  );
  checkTrue(
    "meditation characterGuidance differs from sleep-story's generic non-plot characterGuidance",
    meditationGuidance[0].characterGuidance !== sleepGuidance[0].characterGuidance
  );

  // 3. Dialogue guidance: invitation/options, not staged character dialogue.
  checkTrue(
    "meditation dialogueGuidance offers invitation/options rather than commands",
    meditationGuidance.every((g) => /invitation|option/i.test(g.dialogueGuidance) && /no staged dialogue/i.test(g.dialogueGuidance))
  );

  // 4. Pacing guidance: pauses and spaciousness, no rushed progression.
  checkTrue(
    "meditation pacingGuidance emphasizes pauses/spaciousness over rushed progression",
    meditationGuidance.every((g) => /pause/i.test(g.pacingGuidance) && /never a rush|unhurried/i.test(g.pacingGuidance))
  );

  // 5. Description guidance: present-moment sensory/body awareness, no fantasy imagery.
  checkTrue(
    "meditation descriptionGuidance targets present-moment sensation and rules out fantasy-world imagery",
    meditationGuidance.every((g) => /present-moment sensation/i.test(g.descriptionGuidance) && /fantasy-world imagery/i.test(g.descriptionGuidance))
  );

  // 6. Style guidance: acceptance/non-judgment/safety, no mystical language or guaranteed outcomes.
  checkTrue(
    "meditation styleGuidance reinforces acceptance, non-judgment, and safety",
    meditationGuidance.every((g) => /acceptance/i.test(g.styleGuidance) && /non-judgment/i.test(g.styleGuidance) && /safe/i.test(g.styleGuidance))
  );
  checkTrue(
    "meditation styleGuidance rules out guaranteed outcomes and mystical/poetic language",
    meditationGuidance.every((g) => /guaranteed outcome/i.test(g.styleGuidance) && /mystical/i.test(g.styleGuidance))
  );

  // No story/dialogue/conflict guidance leaks into meditation.
  const leakPattern = /\bplot\b|\bturning point\b|\bclimax\b|\bcharacter arc\b|\bconflict\b/i;
  checkTrue(
    "no story/plot/conflict vocabulary leaks into meditation guidance",
    meditationGuidance.every(
      (g) =>
        !leakPattern.test(g.writingFocus) &&
        !leakPattern.test(g.characterGuidance) &&
        !leakPattern.test(g.dialogueGuidance) &&
        !leakPattern.test(g.pacingGuidance) &&
        !leakPattern.test(g.descriptionGuidance) &&
        !leakPattern.test(g.styleGuidance)
    )
  );

  // Other presets are unaffected by the meditation-only branches added to builder.ts.
  const narrativeGuidance = guidanceFor(narrativeArcIntent);
  const kidsGuidance = guidanceFor(kidsStoryIntent);
  checkTrue(
    "narrative writingFocus/characterGuidance still use plot-driven phrasing (unchanged by meditation calibration)",
    narrativeGuidance.every((g) => /choices and behavior/i.test(g.writingFocus)) &&
      narrativeGuidance.every((g) => /not plot convenience/i.test(g.characterGuidance))
  );
  checkTrue(
    "kids-story writingFocus/characterGuidance unchanged by meditation calibration",
    kidsGuidance.every((g) => /curiosity and connection with a friend/i.test(g.writingFocus)) &&
      kidsGuidance.every((g) => /child's eyes/i.test(g.characterGuidance))
  );
  checkTrue(
    "sleep-story guidance unchanged by meditation calibration",
    sleepGuidance.every((g) => /gentle movement and peaceful curiosity in the external world/i.test(g.writingFocus))
  );
}

// ─── 12. RP-011C.8.8.3D — Classic ASMR guidance calibration ────────────
//
// Classic ASMR guidance must communicate sensory attention, safe personal
// address, gentle rhythm, calming repetition, and small sensory variation
// to the Writer Layer -- distinct from sleep-story's shared generic
// non-plot text, and free of narrative progression, fictional storytelling,
// meditation-style instruction, sleep-induction framing, emotional
// transformation, or guaranteed-relaxation claims.

{
  const asmrGuidance = guidanceFor(classicAsmrIntent);
  const sleepGuidance = guidanceFor(sleepStoryIntent);
  const meditationGuidance = guidanceFor(meditationIntent);
  const narrativeGuidance = guidanceFor(narrativeArcIntent);
  const kidsGuidance = guidanceFor(kidsStoryIntent);

  // 1. Writing focus: sensory attention right now, not a story or a path to rest.
  checkTrue(
    "classic-asmr writingFocus reads as sensory attention, explicitly not a story or a path toward rest",
    asmrGuidance.every((g) => /sensory detail to notice right now/i.test(g.writingFocus) && /not a story to follow or a path toward rest/i.test(g.writingFocus))
  );
  checkTrue(
    "classic-asmr writingFocus differs from sleep-story's generic non-plot writingFocus",
    asmrGuidance[0].writingFocus !== sleepGuidance[0].writingFocus
  );

  // 2. Character guidance: listener is the only presence, no fictional characters.
  checkTrue(
    "classic-asmr characterGuidance rules out fictional characters, dialogue partners, and narrated persona",
    asmrGuidance.every((g) => /no fictional characters/i.test(g.characterGuidance))
  );
  checkTrue(
    "classic-asmr characterGuidance differs from sleep-story's generic non-plot characterGuidance",
    asmrGuidance[0].characterGuidance !== sleepGuidance[0].characterGuidance
  );

  // 3. Dialogue guidance: calm, personal direct address, no character dialogue.
  checkTrue(
    "classic-asmr dialogueGuidance rules out character dialogue and supports calm personal address",
    asmrGuidance.every((g) => /dialogue between characters should not appear/i.test(g.dialogueGuidance) && /personal address/i.test(g.dialogueGuidance))
  );

  // 4. Pacing guidance: slow, repetitive, gradual variation; no step-by-step or meditation-style progression.
  checkTrue(
    "classic-asmr pacingGuidance supports slow, gently repetitive pacing with gradual variation",
    asmrGuidance.every((g) => /slow and gently repetitive/i.test(g.pacingGuidance) && /gradual variation/i.test(g.pacingGuidance))
  );
  checkTrue(
    "classic-asmr pacingGuidance rules out step-by-step sequencing and meditation-style progression",
    asmrGuidance.every((g) => /step-by-step sequence/i.test(g.pacingGuidance) && /meditation-style progression/i.test(g.pacingGuidance))
  );

  // 5. Description guidance: concrete, perceivable sensory detail; no fantasy scenery or decorative prose.
  checkTrue(
    "classic-asmr descriptionGuidance prioritizes concrete, perceivable sensory detail",
    asmrGuidance.every((g) => /concrete sensory detail/i.test(g.descriptionGuidance) && /actually perceive/i.test(g.descriptionGuidance))
  );
  checkTrue(
    "classic-asmr descriptionGuidance rules out decorative prose and fantasy scenery",
    asmrGuidance.every((g) => /decorative prose/i.test(g.descriptionGuidance) && /fantasy scenery/i.test(g.descriptionGuidance))
  );

  // 6. Style guidance: sensory presence carries the scene; no transformation/healing/guaranteed-outcome claims.
  checkTrue(
    "classic-asmr styleGuidance rules out transformation, healing arcs, and narrative development",
    asmrGuidance.every((g) => /not narrative development, transformation, or a healing arc/i.test(g.styleGuidance))
  );
  checkTrue(
    "classic-asmr styleGuidance rules out guaranteed relaxation/tingling/emotional-outcome claims",
    asmrGuidance.every((g) => /guaranteed relaxation, tingling, or emotional outcome/i.test(g.styleGuidance))
  );

  // Allowed elements surface small sensory variation and safe personal address.
  checkTrue(
    "classic-asmr allowedElements includes gently varied repetition and close personal address",
    asmrGuidance.every(
      (g) =>
        g.allowedElements.some((el) => /gently varied repetition/i.test(el)) &&
        g.allowedElements.some((el) => /close, personal address/i.test(el))
    )
  );

  // No narrative/meditation/sleep-induction vocabulary leaks into ASMR guidance.
  const leakPattern = /\bplot\b|\bturning point\b|\bclimax\b|\bcharacter arc\b|\bconflict\b|\bfall asleep\b|\bmeditate\b/i;
  checkTrue(
    "no narrative/plot/sleep-induction vocabulary leaks into classic-asmr guidance",
    asmrGuidance.every(
      (g) =>
        !leakPattern.test(g.writingFocus) &&
        !leakPattern.test(g.characterGuidance) &&
        !leakPattern.test(g.dialogueGuidance) &&
        !leakPattern.test(g.pacingGuidance) &&
        !leakPattern.test(g.descriptionGuidance) &&
        !leakPattern.test(g.styleGuidance)
    )
  );

  // Other presets are unaffected by the classic-asmr-only branches added to builder.ts.
  checkTrue(
    "meditation guidance unchanged by classic-asmr calibration",
    meditationGuidance.every((g) => /invite the listener into/i.test(g.writingFocus)) &&
      meditationGuidance.every((g) => /no fictional characters or narrated persona/i.test(g.characterGuidance))
  );
  checkTrue(
    "sleep-story guidance unchanged by classic-asmr calibration",
    sleepGuidance.every((g) => /gentle movement and peaceful curiosity in the external world/i.test(g.writingFocus)) &&
      sleepGuidance.every((g) => /warmth without dependency/i.test(g.characterGuidance))
  );
  checkTrue(
    "narrative guidance unchanged by classic-asmr calibration",
    narrativeGuidance.every((g) => /choices and behavior/i.test(g.writingFocus)) &&
      narrativeGuidance.every((g) => /not plot convenience/i.test(g.characterGuidance))
  );
  checkTrue(
    "kids-story guidance unchanged by classic-asmr calibration",
    kidsGuidance.every((g) => /curiosity and connection with a friend/i.test(g.writingFocus)) &&
      kidsGuidance.every((g) => /child's eyes/i.test(g.characterGuidance))
  );
}

// ─── 13. RP-011C.8.8.3M — Classic ASMR story mode guidance calibration ──
//
// Guidance must stay aware of intent.asmrMode for classic-asmr: presence
// keeps its existing sensory-only restrictions untouched, while story mode
// allows the scenario/persona/dialogue framing scenes/planner.ts already
// builds for it (CLASSIC_ASMR_STORY_SCENE_STEPS) without turning into
// Narrative preset guidance (no conflict, escalation, stakes, or
// turning-point pacing).

{
  const presenceGuidance = guidanceFor(classicAsmrIntent);
  const presenceGuidanceExplicit = guidanceFor(classicAsmrPresenceIntent);
  const storyGuidance = guidanceFor(classicAsmrStoryIntent);
  const narrativeGuidance = guidanceFor(narrativeArcIntent);

  // 1. classic-asmr + presence (default, and explicit) keeps existing guidance.
  check(
    "classic-asmr with no asmrMode matches explicit asmrMode: presence",
    presenceGuidance.map((g) => ({ ...g, metadata: undefined })),
    presenceGuidanceExplicit.map((g) => ({ ...g, metadata: undefined }))
  );
  checkTrue(
    "classic-asmr presence dialogueGuidance still rules out character dialogue",
    presenceGuidance.every((g) => /dialogue between characters should not appear/i.test(g.dialogueGuidance))
  );
  checkTrue(
    "classic-asmr presence characterGuidance still rules out fictional characters and persona",
    presenceGuidance.every((g) => /no fictional characters, dialogue partners, or narrated persona/i.test(g.characterGuidance))
  );
  checkTrue(
    "classic-asmr presence writingFocus still reads as sensory attention right now, not a story",
    presenceGuidance.every((g) => /not a story to follow or a path toward rest/i.test(g.writingFocus))
  );

  // 2. classic-asmr + story receives story-aware guidance, distinct from presence.
  checkTrue(
    "classic-asmr story writingFocus differs from presence's writingFocus",
    storyGuidance[0].writingFocus !== presenceGuidance[0].writingFocus
  );
  checkTrue(
    "classic-asmr story writingFocus reads as sensory attention carried through the scene's persona and setting",
    storyGuidance.every((g) => /persona and setting/i.test(g.writingFocus) && /not to advance a story or reach a destination/i.test(g.writingFocus))
  );
  checkTrue(
    "classic-asmr story characterGuidance allows a persona, unlike presence",
    storyGuidance.every((g) => /guided by a gentle in-scene persona/i.test(g.characterGuidance))
  );
  checkTrue(
    "classic-asmr story dialogueGuidance allows low-stakes dialogue with the persona, unlike presence",
    storyGuidance.every((g) => /dialogue between the listener and the scene's persona is allowed/i.test(g.dialogueGuidance))
  );
  checkTrue(
    "classic-asmr story allowedElements surfaces scenario/persona framing and persona dialogue",
    storyGuidance.every(
      (g) =>
        g.allowedElements.some((el) => /scenario and persona framing/i.test(el)) &&
        g.allowedElements.some((el) => /dialogue with the persona/i.test(el))
    )
  );

  // 3. Story mode still carries ASMR identity constraints (no character arc/
  // conflict/plot, no guaranteed outcome, voice-first anti-patterns).
  checkTrue(
    "classic-asmr story characterGuidance still rules out a character arc, conflict, or plot",
    storyGuidance.every((g) => /not to carry a character arc, conflict, or plot/i.test(g.characterGuidance))
  );
  checkTrue(
    "classic-asmr story styleGuidance still rules out guaranteed relaxation/tingling/emotional-outcome claims",
    storyGuidance.every((g) => /guaranteed relaxation, tingling, or emotional outcome/i.test(g.styleGuidance))
  );
  checkTrue(
    "classic-asmr story pacingGuidance still rules out turning points, climax, or resolution",
    storyGuidance.every((g) => /never building toward a turning point, climax, or resolution/i.test(g.pacingGuidance))
  );

  const voiceFirstAntiPatterns =
    contextFor(classicAsmrStoryIntent).knowledge.modules.find((m) => m.id === "voice_first_identity")?.antiPatterns ?? [];
  checkTrue(
    "voice_first_identity module applies to classic-asmr story mode",
    voiceFirstAntiPatterns.length > 0
  );
  checkTrue(
    "classic-asmr story avoidPatterns still carries voice-first (no external trigger) anti-patterns",
    storyGuidance.every((g) => voiceFirstAntiPatterns.every((p) => g.avoidPatterns.includes(p)))
  );
  const noForcedResponseAntiPatterns =
    contextFor(classicAsmrStoryIntent).knowledge.modules.find((m) => m.id === "no_forced_response")?.antiPatterns ?? [];
  checkTrue(
    "classic-asmr story avoidPatterns still carries no-forced-response anti-patterns",
    storyGuidance.every((g) => noForcedResponseAntiPatterns.every((p) => g.avoidPatterns.includes(p)))
  );

  // writingFocus/characterGuidance should never reference dramatic/thriller
  // structure at all -- unlike styleGuidance/pacingGuidance/
  // descriptionGuidance, which legitimately name and then negate these
  // concepts (e.g. "not narrative stakes or a story arc", "never building
  // toward a turning point, climax, or resolution", "avoid ... escalation")
  // -- covered by the explicit rules-out checks above.
  const narrativeLeakPattern = /\bturning point\b|\bclimax\b|\bstakes\b|\bthriller\b/i;
  checkTrue(
    "classic-asmr story writingFocus/characterGuidance never reference dramatic/thriller structure",
    storyGuidance.every((g) => !narrativeLeakPattern.test(g.writingFocus) && !narrativeLeakPattern.test(g.characterGuidance))
  );
  checkTrue(
    "classic-asmr story guidance is not plot-driven the way Narrative is",
    storyGuidance[0].writingFocus !== narrativeGuidance[0].writingFocus &&
      storyGuidance[0].characterGuidance !== narrativeGuidance[0].characterGuidance
  );

  // 4. Non-ASMR presets are unchanged by the asmrMode branching added here.
  const meditationGuidanceUnchanged = guidanceFor(meditationIntent);
  const sleepGuidanceUnchanged = guidanceFor(sleepStoryIntent);
  const kidsGuidanceUnchanged = guidanceFor(kidsStoryIntent);
  checkTrue(
    "meditation guidance unchanged by classic-asmr story-mode calibration",
    meditationGuidanceUnchanged.every((g) => /invite the listener into/i.test(g.writingFocus))
  );
  checkTrue(
    "sleep-story guidance unchanged by classic-asmr story-mode calibration",
    sleepGuidanceUnchanged.every((g) => /gentle movement and peaceful curiosity in the external world/i.test(g.writingFocus))
  );
  checkTrue(
    "kids-story guidance unchanged by classic-asmr story-mode calibration",
    kidsGuidanceUnchanged.every((g) => /curiosity and connection with a friend/i.test(g.writingFocus))
  );
  checkTrue(
    "narrative guidance unchanged by classic-asmr story-mode calibration",
    narrativeGuidance.every((g) => /choices and behavior/i.test(g.writingFocus))
  );
}

// ─── 14. RP-011C.8.10G — Sleep Story guidance calibration ──────────────
//
// Sleep Story guidance must read as an external, in-world journey the
// listener follows -- companions provide warmth, not conflict or
// dependency -- and must never leak Meditation's inward breath/body
// instruction or Classic ASMR's whisper/tingle trigger framing, distinct
// from the generic non-plot fallback it used to share with those two
// presets before this calibration.

{
  const sleepGuidance = guidanceFor(sleepStoryIntent);
  const meditationGuidance = guidanceFor(meditationIntent);
  const asmrGuidance = guidanceFor(classicAsmrIntent);
  const narrativeGuidance = guidanceFor(narrativeArcIntent);
  const kidsGuidance = guidanceFor(kidsStoryIntent);

  // 1. No longer uses the generic non-plot fallback text.
  checkTrue(
    "sleep-story writingFocus no longer uses the generic non-plot fallback ('Realize ... through concrete sensory and behavioral detail')",
    sleepGuidance.every((g) => !g.writingFocus.startsWith("Realize"))
  );
  checkTrue(
    "sleep-story characterGuidance no longer uses the generic non-plot fallback ('Center ... experience directly; no character arc is required')",
    sleepGuidance.every((g) => !/no character arc is required/i.test(g.characterGuidance))
  );

  // 2. External story-world framing.
  checkTrue(
    "sleep-story writingFocus reads as an external, in-world journey via gentle movement and curiosity",
    sleepGuidance.every(
      (g) =>
        /external world/i.test(g.writingFocus) &&
        /gentle movement/i.test(g.writingFocus) &&
        /peaceful curiosity/i.test(g.writingFocus)
    )
  );
  checkTrue(
    "sleep-story writingFocus explicitly rules out internal relaxation instruction and narrative tension",
    sleepGuidance.every((g) => /not internal relaxation instruction or narrative tension/i.test(g.writingFocus))
  );

  // 3. Character guidance allows companions without conflict.
  checkTrue(
    "sleep-story characterGuidance allows companions offering warmth without dependency, conflict, or resistance",
    sleepGuidance.every(
      (g) =>
        /companions/i.test(g.characterGuidance) &&
        /warmth without dependency/i.test(g.characterGuidance) &&
        /conflict/i.test(g.characterGuidance)
    )
  );

  // 4. No Meditation instruction leaks in.
  const meditationLeakPattern = /guide the listener|focus on your breath|notice your body/i;
  checkTrue(
    "sleep-story guidance contains no Meditation-style breath/body instruction",
    sleepGuidance.every(
      (g) =>
        !meditationLeakPattern.test(g.writingFocus) &&
        !meditationLeakPattern.test(g.characterGuidance) &&
        !meditationLeakPattern.test(g.dialogueGuidance) &&
        !meditationLeakPattern.test(g.pacingGuidance) &&
        !meditationLeakPattern.test(g.descriptionGuidance) &&
        !meditationLeakPattern.test(g.styleGuidance)
    )
  );
  checkTrue(
    "sleep-story styleGuidance explicitly rules out meditation-style breath/body instruction",
    sleepGuidance.every((g) => /never meditation-style breath\/body instruction/i.test(g.styleGuidance))
  );

  // 5. No ASMR trigger framing leaks in.
  const asmrLeakPattern = /\btingles?\b|whisper trigger|trigger-focused/i;
  checkTrue(
    "sleep-story guidance contains no ASMR trigger framing",
    sleepGuidance.every(
      (g) =>
        !asmrLeakPattern.test(g.writingFocus) &&
        !asmrLeakPattern.test(g.characterGuidance) &&
        !asmrLeakPattern.test(g.dialogueGuidance) &&
        !asmrLeakPattern.test(g.pacingGuidance) &&
        !asmrLeakPattern.test(g.descriptionGuidance) &&
        !asmrLeakPattern.test(g.styleGuidance)
    )
  );
  checkTrue(
    "sleep-story styleGuidance explicitly rules out ASMR whisper-trigger framing",
    sleepGuidance.every((g) => /never .* ASMR whisper-trigger framing/i.test(g.styleGuidance))
  );

  // Pacing/description guidance reflect the design goals (toward rest,
  // fewer new elements, cozy/familiar, never overstimulating or danger-coded).
  checkTrue(
    "sleep-story pacingGuidance eases toward rest with fewer new elements over time",
    sleepGuidance.every((g) => /fewer new elements/i.test(g.pacingGuidance) && /ease toward rest/i.test(g.pacingGuidance))
  );
  checkTrue(
    "sleep-story descriptionGuidance favors cozy, familiar detail and rules out danger-coded imagery",
    sleepGuidance.every((g) => /cozy, familiar sensory detail/i.test(g.descriptionGuidance) && /danger-coded/i.test(g.descriptionGuidance))
  );
  checkTrue(
    "sleep-story allowedElements surfaces warm companions and familiar, cozy environments",
    sleepGuidance.every(
      (g) =>
        g.allowedElements.some((el) => /companions present for warmth, not conflict/i.test(el)) &&
        g.allowedElements.some((el) => /familiar, cozy environments/i.test(el))
    )
  );

  // 6. Existing presets remain unchanged by the sleep-story-only branches added to builder.ts.
  checkTrue(
    "meditation guidance unchanged by sleep-story calibration",
    meditationGuidance.every((g) => /invite the listener into/i.test(g.writingFocus)) &&
      meditationGuidance.every((g) => /no fictional characters or narrated persona/i.test(g.characterGuidance))
  );
  checkTrue(
    "classic-asmr guidance unchanged by sleep-story calibration",
    asmrGuidance.every((g) => /not a story to follow or a path toward rest/i.test(g.writingFocus)) &&
      asmrGuidance.every((g) => /no fictional characters, dialogue partners, or narrated persona/i.test(g.characterGuidance))
  );
  checkTrue(
    "narrative guidance unchanged by sleep-story calibration",
    narrativeGuidance.every((g) => /choices and behavior/i.test(g.writingFocus)) &&
      narrativeGuidance.every((g) => /not plot convenience/i.test(g.characterGuidance))
  );
  checkTrue(
    "kids-story guidance unchanged by sleep-story calibration",
    kidsGuidance.every((g) => /curiosity and connection with a friend/i.test(g.writingFocus)) &&
      kidsGuidance.every((g) => /child's eyes/i.test(g.characterGuidance))
  );
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
