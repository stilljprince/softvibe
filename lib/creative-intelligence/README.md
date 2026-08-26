# Creative Intelligence Architecture — Foundation

## What this is

Type/contract foundation for a future multi-layer creative pipeline:

```
User Input
  -> Creative Understanding Layer
  -> Creative Knowledge Layer
  -> Experience Planning Layer
  -> Generation Guidance Layer
  -> Creative Editing Layer
  -> Quality Evaluation Layer
  -> Final Output
```

`lib/creative-intelligence/` contains the shared data contracts for those
layers, plus a production-ready Knowledge Module + Registry layer
(RP-011C.7.20). It has no runtime behavior beyond registering and querying
knowledge, and is not called from the active generation pipeline
(`lib/script-builder*`, `lib/narrative/*`, `lib/story-supervisor.ts`).

## Why it exists

The current pipeline generates scripts in a single pass driven by prompt
strings. The Creative Intelligence Architecture is a future direction that
separates *understanding intent*, *structured creative knowledge*, and
*planning* from *generation*, so each concern can improve independently.
This pass lays the ground types down and gives the Knowledge layer a real,
queryable set of modules so later work has a shared vocabulary and content
to build against.

## Layout

- `core/types.ts` — `CreativeIntent`, `StoryBlueprint`, `SceneBlueprint`:
  the planning data models.
- `core/contracts.ts` — one interface per architecture layer above.
- `core/constants.ts` — shared literal unions (presets, audiences,
  principle categories, knowledge scopes/priorities/stages/statuses).
- `knowledge/types.ts` — `KnowledgeModule` (the unit the registry
  operates on), `NarrativePrinciple`, `Applicability` (global vs.
  preset-scoped), `SourceReference`.
- `knowledge/validation.ts` — `validateKnowledgeModule()`: deterministic
  shape validation run before a module can be registered.
- `knowledge/registry.ts` — `CreativeKnowledgeRegistry`: register/get/query
  knowledge modules. `creativeKnowledgeRegistry` is a shared instance.
- `knowledge/init.ts` — `initializeCreativeKnowledge()`: explicitly
  registers the approved active modules. No filesystem auto-discovery.
- `knowledge/principles/`, `knowledge/scene/`, `knowledge/character/`,
  `knowledge/structure/` — where `KnowledgeModule` definitions live, one
  file per module, grouped by area.
- `planning/` — Story Blueprint / Narrative Planning Layer (RP-011C.7.23):
  `buildStoryBlueprint()` turns a `CreativeIntent` + `CreativeContext` into
  a `StoryBlueprint`.
- `scenes/` — Scene Planning Layer (RP-011C.7.24): `buildSceneBlueprints()`
  turns a `CreativeIntent` + `CreativeContext` + `StoryBlueprint` into
  `SceneBlueprint[]`.
- `guidance/` — Generation Guidance Layer (RP-011C.7.25):
  `buildGenerationGuidance()` turns a `CreativeIntent` + `CreativeContext` +
  `StoryBlueprint` + `SceneBlueprint[]` into `GenerationGuidance[]`.
- `writer/` — Narrative Writer Layer (RP-011C.7.26): `writeScene()` /
  `writeStory()` turn a `SceneBlueprint` + `GenerationGuidance` (plus the
  `StoryBlueprint` / `CreativeContext` / `CreativeIntent` they came from)
  into `GeneratedScene`(s) -- the first layer that produces scene text.

## The `KnowledgeModule` contract

A `KnowledgeModule` is a structured knowledge object, not a prompt or a
document. It has:

- **Identity** — `id`, `name`, `category`, `description`.
- **Applicability** — `appliesTo` (`{ scope: "global" }` or
  `{ scope: "preset", presets: [...] }`) and `stages` (which of
  `planning` / `generation` / `editing` / `evaluation` it's relevant to).
- **Purpose / knowledge** — `purpose` and `knowledge` (short knowledge
  statements, not prose).
- **Quality guidance** — optional `examples`, `antiPatterns`,
  `evaluationCriteria`.
- **Relationships** — optional `relatedModules`, `conflictsWith` (stored
  as references only; no conflict-resolution engine yet).
- **Priority** — `CRITICAL` / `HIGH` / `MEDIUM` / `LOW`.
- **Metadata** — `version`, lifecycle `status`
  (`draft`/`review`/`active`/`deprecated`), and `sourceReference`
  (document + optional section it was distilled from).

## Active modules (RP-011C.7.20)

Six modules are registered by `initializeCreativeKnowledge()`:

| id | scope | priority |
| --- | --- | --- |
| `story_is_change` | global | CRITICAL |
| `trust_the_reader` | global | HIGH |
| `avoid_ai_writing_patterns` | global | HIGH |
| `scene_has_purpose` | global | HIGH |
| `character_wants_needs` | global | CRITICAL |
| `premise_fulfillment` | preset: narrative | CRITICAL |

## Source documents vs. runtime structures

Design docs / narrative-bible-style prose describe creative knowledge for
humans. They should never be pasted into this module as large strings.
Instead, distill them into a small `KnowledgeModule` record (short
`knowledge` statements, `antiPatterns`, `evaluationCriteria`) with a
`sourceReference` back to the document, then register it. The runtime
structure is meant to be queried
(`creativeKnowledgeRegistry.queryApplicableModules(...)`), not read as a
document.

## Querying

```ts
creativeKnowledgeRegistry.queryApplicableModules({
  preset: "narrative",
  stage: "planning",
});
```

Returns active modules applicable to the preset and stage (global modules
always match; preset-scoped modules only match their declared presets),
optionally narrowed with `category`, ordered `CRITICAL -> HIGH -> MEDIUM ->
LOW` with `id` as a stable tiebreak.

## Adding a module

1. Define the module as a `KnowledgeModule` under the appropriate
   `knowledge/<area>/` folder and export it from that folder's `index.ts`.
2. Mark `appliesTo` as `{ scope: "global" }` or
   `{ scope: "preset", presets: [...] }`, and set `stages`.
3. Add it to `ACTIVE_KNOWLEDGE_MODULES` in `knowledge/init.ts` — nothing
   auto-registers, and activation must stay explicit and reviewable.

Wiring any of this into the live generation pipeline is out of scope for
this foundation pass.

## Creative Intent Extraction Layer (RP-011C.7.22)

`intent/` implements the Creative Understanding Layer described in
`core/contracts.ts`: it turns a `RawCreativeInput` (raw prompt + optional
preset hint) into a `CreativeIntent` (extended in this pass with
`storyScale`, `themes`, `emotionalDirection`, `narrativeFocus`,
`requiredElements`, and `metadata`). It answers "what is the user trying to
create?" only — no scenes, chapters, dialogue, or prose, and no calls to
OpenAI/ElevenLabs.

- `intent/classifiers.ts` — one deterministic, keyword-based classifier per
  `CreativeIntent` field. No LLM calls; substring matching only.
- `intent/extractor.ts` — `extractCreativeIntent()` composes the
  classifiers into a full `CreativeIntent`. Also exports
  `deterministicCreativeUnderstandingLayer`, an implementation of the
  `CreativeUnderstandingLayer` interface, so a future model-based
  extractor can be swapped in behind the same contract without changing
  callers.
- `intent/types.ts` — `ExtractionSignals` (normalized prompt shared across
  classifiers) and the `CreativeIntentExtractor` function shape.

It deliberately does **not** call `creativeKnowledgeRegistry` — knowledge
retrieval belongs to `context/builder.ts`, which already accepts a
pre-built `CreativeIntent` via `buildCreativeContext({ rawInput, intent })`.
The intended (not yet wired) flow is:

```
RawCreativeInput -> extractCreativeIntent() -> CreativeIntent -> buildCreativeContext() -> Planning
```

Tests: `scripts/test-creative-intelligence-intent.ts`.

## Story Blueprint / Narrative Planning Layer (RP-011C.7.23)

`planning/` implements the planning step described above: turning a
`CreativeIntent` + the `CreativeContext` built from it into a
`StoryBlueprint` (`core/types.ts`). A blueprint answers "how should this
experience be designed?" — starting state, structural progression,
turning points (only for plot-driven presets/scales), emotional arc, and
guardrails for later layers — never "how should this scene be written?".
No prose, scenes, or dialogue; no LLM calls.

- `planning/templates.ts` — deterministic per-preset / per-scale planning
  defaults (protagonist role, core conflict, progression beats, emotional
  arc). Kids Story uses the fixed 7-beat structure from this project's
  Kids Story preset rules instead of the generic scale progression.
- `planning/blueprint-builder.ts` — `buildStoryBlueprint()` maps a
  `CreativeIntent` + `CreativeContext` onto a `StoryBlueprint`. Reads
  `context.knowledge.modules` (already resolved by `context/builder.ts`)
  for `structureGuidance.avoidPatterns` — it never queries
  `creativeKnowledgeRegistry` itself.
- `planning/types.ts` — `BuildStoryBlueprintParams` and the
  `StoryBlueprintBuilder` function shape, so a future model-based planner
  can implement the same shape without changing callers.

All five presets (`classic-asmr`, `sleep-story`, `meditation`,
`kids-story`, `narrative`) get a blueprint; only `narrative` and
`kids-story` at `arc`/`transformation` scale get `turningPoints` — sensory
and comfort-oriented presets plan an emotional/sensory journey rather than
plot machinery.

The intended (not yet wired) flow is:

```
CreativeIntent -> CreativeContext -> buildStoryBlueprint() -> StoryBlueprint -> Scene Planning
```

Tests: `scripts/test-creative-intelligence-planning.ts`.

## Scene Planning Layer (RP-011C.7.24)

`scenes/` answers the next question after a `StoryBlueprint` exists: "which
scenes does this experience need so the blueprint is fulfilled?" It writes
**no prose, no dialogue, no finished scene text** — only the structural
scene plan a future Writer Layer would consume. No LLM calls.

- **Input**: `CreativeIntent` + `CreativeContext` + `StoryBlueprint`
  (`buildSceneBlueprints({ intent, context, blueprint })`).
- **Output**: `SceneBlueprint[]` (`core/types.ts`) — for each scene: `id`,
  `order`, `purpose`, `narrativeFunction`, `relatedStoryProgression`,
  `charactersInvolved`, `emotionalState`, `conflict`, `desiredChange`,
  `settingGuidance`, `requiredElements`, `avoidPatterns`, `metadata`.
- `scenes/templates.ts` — per-preset scene structures. `narrative` derives
  its scenes directly from the blueprint's own `trajectory.progression` and
  `turningPoints`, so scene count and content vary with the actual story
  (a `transformation`-scale story gets more scenes than an `arc`-scale one
  because it has more turning points — not because of a fixed count).
  `sleep-story`, `meditation`, `kids-story`, and `classic-asmr` each get
  their own fixed, preset-appropriate structure instead of being forced
  into a story shape:
  - Narrative: story progression scenes derived from the blueprint.
  - Sleep Story: an experience progression (`arrival -> relaxation ->
    immersion -> settling`).
  - Meditation: a guided-practice structure (`grounding -> guided
    attention -> deepening practice -> gentle return`).
  - Kids Story: an adventure/discovery structure built on this project's
    fixed, age-safe 7-beat progression (see project `CLAUDE.md`).
  - Classic ASMR: a sensory-immersion progression.
- `scenes/planner.ts` — `buildSceneBlueprints()` composes the per-preset
  steps from `templates.ts` with the blueprint's protagonist/trajectory and
  the context's already-resolved knowledge: `avoidPatterns` comes from the
  `antiPatterns` of whatever `CreativeContext.knowledge.modules` the
  Context Builder resolved as applicable (global principles like
  `story_is_change`, `trust_the_reader`, `scene_has_purpose`,
  `avoid_ai_writing_patterns`, plus preset-scoped ones like
  `premise_fulfillment`); `requiredElements` carries the intent's hard
  constraints (e.g. kids-story age-safety) onto every scene. This layer
  never queries `creativeKnowledgeRegistry` itself — same pattern as
  `planning/blueprint-builder.ts`.
- `scenes/types.ts` — `BuildSceneBlueprintsParams` and the
  `SceneBlueprintsPlanner` function shape, so a future model-based planner
  can implement the same shape without changing callers.

### Why not a beat sheet

Each scene's `narrativeFunction` describes the job the scene does (e.g.
"Establish starting condition", "Show progress toward change"), not a
fixed screenplay slot ("the hook", "the midpoint twist"). The `purpose`,
`conflict`, and `desiredChange` fields are always derived from the actual
blueprint content (protagonist, trajectory beat, turning point) rather than
from the scene's position in the list — a narrative gets exactly as many
"show progress" scenes as its `trajectory.progression` has middle beats,
and exactly one turning-point scene per `trajectory.turningPoints` entry.

### Boundary with the (future) Writer Layer

A `SceneBlueprint` is planning-only: short structural fields (a phrase or
one short sentence each), never a paragraph, a line of dialogue, or
literary description. A future Writer Layer is what turns a
`SceneBlueprint` into actual prose, using the Generation Guidance Layer's
output (below) as its instructions.

The intended (not yet wired) flow is:

```
CreativeIntent + CreativeContext + StoryBlueprint
  -> buildSceneBlueprints() -> SceneBlueprint[]
  -> buildGenerationGuidance() -> GenerationGuidance[]
  -> (future) Writer Layer
```

Tests: `scripts/test-creative-intelligence-scenes.ts`.

## Generation Guidance Layer (RP-011C.7.25)

`guidance/` answers the next question after `SceneBlueprint[]` exist: "how
should a planned scene be written?" It writes **no prose, no dialogue, and
no finished scene text**, and it makes **no story-structure decisions** --
those belong to `planning/` and `scenes/`. It only translates a planned
scene into structured writing instructions a future Writer Layer would
consume. No LLM calls.

- **Input**: `CreativeIntent` + `CreativeContext` + `StoryBlueprint` +
  `SceneBlueprint[]` (`buildGenerationGuidance({ scenes, blueprint,
  context, intent })`).
- **Output**: `GenerationGuidance[]` (`guidance/types.ts`) -- one entry per
  scene, pointed back at it via `sceneId`: `writingFocus`,
  `narrativeIntent`, `emotionalApproach`, `characterGuidance`,
  `dialogueGuidance`, `pacingGuidance`, `descriptionGuidance`,
  `allowedElements`, `avoidPatterns`, `styleGuidance`, `metadata`.
- `guidance/templates.ts` -- per-preset `PresetGuidanceTemplate`
  (dialogue/pacing/description/style defaults, extra allowed-content
  labels, and a `plotDriven` flag). Presets are not all treated as one
  writing style: `narrative` and `kids-story` are `plotDriven` and get
  conflict/turning-point-aware `writingFocus` and `characterGuidance`;
  `sleep-story`, `meditation`, and `classic-asmr` deliberately never
  receive plot- or conflict-shaped guidance.
- `guidance/builder.ts` -- `buildGenerationGuidance()` composes the preset
  template with each scene's own fields and the knowledge modules the
  Context Builder already resolved as applicable
  (`context.knowledge.modules`). It never queries `creativeKnowledgeRegistry`
  itself -- same pattern as `planning/blueprint-builder.ts` and
  `scenes/planner.ts`. `avoidPatterns` is carried over unchanged from the
  scene (already the antiPatterns of applicable modules); `allowedElements`
  additionally folds in the permissive `knowledge` statements of
  `avoid_ai_writing_patterns` and `scene_has_purpose` (both explicitly
  allow ordinary, unremarkable scenes); `styleGuidance` gets an extra note
  when `premise_fulfillment` applies (narrative only), keeping the scene's
  resolution scale consistent with the story's promise.
- `guidance/types.ts` -- the `GenerationGuidance` contract,
  `BuildGenerationGuidanceParams`, and the `GenerationGuidanceBuilder`
  function shape, so a future model-based builder can implement the same
  shape without changing callers.

### Why Generation Guidance produces no prose

`GenerationGuidance` fields are instructions *about* writing (a phrase or
one-to-two short sentences each, e.g. `writingFocus: "Show hesitation
through decisions and behavior"`), never the writing itself -- no finished
sentences of story text, no lines of dialogue, no worked examples in
prose. That distinction is the whole point of the layer: it exists so a
future Writer Layer can stay creative (decide the actual sentences,
descriptions, and dialogue) while still being pointed at *what* the scene
needs to accomplish and which known AI-writing failure patterns to avoid.
Section 4/5 of the RP-011C.7.25 brief calls this out explicitly: the layer
must leave room for ordinary, unremarkable scenes (`allowedElements`) and
must not re-litigate scene-design choices scenes/ already made (no
sentence-by-sentence or stylistic micromanagement).

### Difference from Scene Planning and the (future) Writer Layer

- **Scene Planning (`scenes/`)** decides *which scenes exist* and *what job
  each one does* (`purpose`, `narrativeFunction`, `conflict`,
  `desiredChange`) -- structure, not style.
- **Generation Guidance (`guidance/`)** takes a scene's structure as given
  and decides *how it should be approached while being written* --
  dialogue use, pacing, description approach, what's allowed vs. what to
  avoid. It does not add, remove, or reorder scenes, and does not revise
  any `SceneBlueprint` field.
- **Writer Layer (future, not implemented)** is the only layer that
  produces actual prose/dialogue, using `GenerationGuidance` as its
  instructions.

The intended (not yet wired) flow is:

```
CreativeIntent + CreativeContext + StoryBlueprint + SceneBlueprint[]
  -> buildGenerationGuidance() -> GenerationGuidance[]
  -> (future) Writer Layer
```

Tests: `scripts/test-creative-intelligence-guidance.ts`.

## Narrative Writer Layer (RP-011C.7.26)

`writer/` answers the question everything before it deliberately left open:
"how does a planned scene become actual story text?" It is an **executing**
layer, not a planning or rule-defining one -- it does not change story
structure, invent scenes, plan dramaturgy, interpret the Knowledge Layer
itself, or define its own quality rules. All of that already happened in
`planning/`, `scenes/`, and `guidance/`; the Writer Layer only carries out
what those layers already decided.

- **Input**: a `SceneBlueprint` + its `GenerationGuidance`, plus the
  `StoryBlueprint` / `CreativeContext` / `CreativeIntent` they were built
  from (`writeScene({ scene, guidance, blueprint, context, intent })`).
  `writeStory({ scenes, guidance, blueprint, context, intent })` runs this
  over a full `SceneBlueprint[]` + `GenerationGuidance[]`, matching each
  scene to its guidance by `sceneId`.
- **Output**: `GeneratedScene` (`writer/types.ts`) -- `sceneId`, `text`,
  `metadata`. One `GeneratedScene` per scene, in order.
- `writer/templates.ts` -- `WRITER_TEMPLATE_BY_PRESET`: a per-preset unit
  label (`scene` for narrative/kids-story, `segment` for the
  atmosphere/guidance-driven presets) and an `emphasis` list describing what
  that preset's writing should foreground (e.g. narrative: plot
  progression, dialogue, character development; sleep-story: atmosphere,
  calm sensory experience, slow transitions; meditation: guided language,
  safety, stillness; classic-asmr: sensory description). Labels only, never
  content.
- `writer/writer.ts` -- `writeScene()` / `writeStory()`. For this pass,
  `text` is a **deterministic structural placeholder**, not finished prose:
  it composes the scene's own fields (`purpose`, `narrativeFunction`,
  `charactersInvolved`, `avoidPatterns`) with its guidance
  (`writingFocus`, `characterGuidance`, `dialogueGuidance`,
  `pacingGuidance`, `descriptionGuidance`) and the preset's `emphasis`, so
  it's verifiable that the Writer Layer actually consumed its inputs
  without needing a real story to prove it. No LLM/provider calls, no
  hand-written example story text.
- `writer/types.ts` -- `GeneratedScene`, `WriteSceneParams`,
  `WriteStoryParams`, and the `SceneWriter` / `StoryWriter` function
  shapes, so a future LLM-backed writer can implement the same shape
  without changing callers.

### Why the Writer Layer stays deterministic (for now)

Sections 4/5 of the RP-011C.7.26 brief are explicit: no large example
stories, no few-shot prose, no hard-coded scenes baked into the code as
"production logic". The point of this pass is the **contract**, not the
prose quality -- proving that `SceneBlueprint + GenerationGuidance ->
GeneratedScene` is a shape a future LLM-backed writer can fill in later.

### Difference from Generation Guidance and the Planning layers

- **Planning (`planning/`, `scenes/`)** decide *what exists*: the story's
  shape, which scenes it needs, and each scene's job.
- **Generation Guidance (`guidance/`)** decides *how a scene should be
  approached while being written* -- instructions, never prose.
- **Writer (`writer/`)** is the only layer that turns those instructions
  into scene text. It adds no new creative decisions of its own; it
  executes the ones already made upstream.

### Provider-backed generation (RP-011C.8.5)

`writeScene()` / `writeStory()` stay exactly as described above --
deterministic, unchanged, still the implementation every existing caller
(`prototype/coordinator.ts`, `orchestration/pipeline.ts`, and their tests)
gets. Alongside them, `writer/` now also has a real, LLM-backed
implementation of the same input shape:

```
SceneBlueprint + GenerationGuidance (+ StoryBlueprint / CreativeContext / CreativeIntent)
  -> buildWriterPrompt()        (writer/prompts.ts)
  -> CreativeTextProvider       (writer/provider.ts)
  -> GeneratedScene
```

- `writer/provider.ts` -- `CreativeTextProvider`: a one-method interface
  (`generateText({ systemPrompt, userPrompt }): Promise<string>`) that
  `writer.ts` depends on instead of any concrete SDK.
  `createOpenAICreativeTextProvider()` is a minimal, isolated
  implementation of it for this pass: it lazily constructs its own OpenAI
  client inside `generateText()` (per this project's CLAUDE.md -- "OpenAI
  must be lazily initialized inside request handlers"), and makes no other
  calls (no API route usage, no job integration, no database usage, no
  audio usage). It is intentionally separate from the module-level client
  the active production script builder uses.
- `writer/prompts.ts` -- `buildWriterPrompt()` (plus
  `buildWriterSystemPrompt()` / `buildWriterUserPrompt()`) formats
  already-decided upstream data -- `CreativeIntent`, `CreativeContext`,
  `StoryBlueprint`, `SceneBlueprint`, `GenerationGuidance` -- into the
  system/user prompt pair a `CreativeTextProvider` consumes. It adds no
  genre rules, narrative principles, safety rules, character rules, or
  story-structure rules of its own -- all of that already came from
  `CreativeContext` / `StoryBlueprint` / `GenerationGuidance`; this file
  only arranges it.
- `writer/writer.ts` -- `writeSceneWithProvider()` /
  `writeStoryWithProvider()`: the provider-backed counterparts to
  `writeScene()` / `writeStory()`. They take an extra required `provider:
  CreativeTextProvider` field (dependency injection -- the caller decides
  real vs. mocked, `writer.ts` never constructs one itself), build the
  prompt, call `provider.generateText()`, and return a `GeneratedScene`
  with `metadata.writerMethod: "model-based"`.

**Why separate exports instead of changing `writeScene()` / `writeStory()`
in place:** a real provider call is necessarily asynchronous, but
`writeScene()` / `writeStory()` are called synchronously today by
`prototype/coordinator.ts`, `orchestration/pipeline.ts`, and their tests --
none of them `await` the call. Changing the existing functions' return
type to a `Promise` would silently break every one of those call sites
(they'd receive a `Promise` where they expect a `GeneratedScene[]`) for no
test-suite benefit. Adding `writeSceneWithProvider()` /
`writeStoryWithProvider()` as new exports keeps every existing contract and
test passing unchanged while still giving the Writer Layer a real
generation path.

`writer/` stays the *only* layer in this module allowed to depend on a
provider SDK -- `planning/`, `scenes/`, `guidance/`, `evaluation/`, and
`orchestration/` remain structural only, exactly as before.

### Not yet wired to production

None of this is called by `app/api/jobs/*`, `app/generate/*`,
`lib/script-builder*`, `lib/narrative/*`, `lib/story-supervisor.ts`, or
`lib/tts/*`. `orchestration/pipeline.ts` and `prototype/coordinator.ts`
still call the deterministic `writeStory()`, not
`writeStoryWithProvider()` -- wiring either of those coordinators to the
provider-backed writer (and, further out, to the active generation
pipeline) is a future migration step, not part of this pass.

The intended (not yet wired) flow is:

```
CreativeIntent + CreativeContext + StoryBlueprint + SceneBlueprint[] + GenerationGuidance[]
  -> writeStory() -> GeneratedScene[]                              (deterministic, wired into prototype/orchestration)
  -> writeStoryWithProvider() -> GeneratedScene[]                   (LLM-backed, not wired anywhere yet)
```

Tests: `scripts/test-creative-intelligence-writer.ts` (unchanged,
deterministic path), `scripts/test-creative-intelligence-writer-provider.ts`
(new, provider-backed path -- always uses a mocked `CreativeTextProvider`,
never a real OpenAI call).

## Narrative Evaluation Layer (RP-011C.7.27)

`evaluation/` answers the question that comes after the Writer Layer
produces text: "does the generated content fulfill the planned creative
goals and quality principles?" It is a **judging** layer only -- it does
not rewrite, repair, or generate anything. It scores story quality,
principle fulfillment, structural fidelity, genre fit, and typical AI
writing problems, and reports what it found. No LLM/provider calls for
this pass; only simple, deterministic structural/keyword checks (per the
RP-011C.7.27 brief -- no large text analysis).

- **Input**: `GeneratedScene[]` + the full upstream chain it was built
  from -- `StoryBlueprint`, `SceneBlueprint[]`, `GenerationGuidance[]`,
  `CreativeContext`, `CreativeIntent`
  (`evaluateNarrative({ generatedContent, storyBlueprint, scenes, guidance, context, intent })`).
- **Output**: `EvaluationResult` (`evaluation/types.ts`) -- `overallAssessment`
  (`"strong" | "acceptable" | "needs-work" | "weak"`), `overallScore`,
  `criteriaResults` (one `CriteriaResult` per applicable criterion:
  `criterionId`, `score`, `passed`, `explanation`), `strengths`,
  `weaknesses`, `violations` (failed criteria grounded in CRITICAL-priority
  principles or this project's non-negotiable Kids Story safety rules),
  `suggestions` (short pointers to *what* to look at -- never a rewrite
  instruction or edited text), and `metadata`.
- `evaluation/criteria.ts` -- `EVALUATION_CRITERIA`: eleven structured
  criterion definitions (pure data, no scoring logic), plus
  `getApplicableCriteria(preset)`. Seven are global and apply to every
  preset, answering the RP-011C.7.27 brief's questions directly: Premise
  Fulfillment, Story Movement, Character Development, Scene Purpose, Trust
  The Reader, AI Writing Patterns, Ending Quality. Four are preset-scoped,
  covering dimensions that don't fit a classic plot-driven story shape --
  "Nicht alles als klassische Story bewerten": `sensory_quality`
  (classic-asmr), `sleep_atmosphere_and_safety` (sleep-story),
  `guided_clarity` (meditation), `age_appropriate_imagination`
  (kids-story). Narrative needs no extra criterion beyond the global seven;
  kids-story additionally gets its own safety-specific one.
- `evaluation/evaluator.ts` -- `evaluateNarrative()`: runs each applicable
  criterion's deterministic check function against the
  `EvaluationInput`, then composes the result. It never queries
  `creativeKnowledgeRegistry` directly -- like `planning/blueprint-builder.ts`,
  `scenes/planner.ts`, and `guidance/builder.ts`, it only reads what the
  Context Builder already resolved onto `CreativeContext`
  (`context.knowledge.modules` for anti-patterns/principles,
  `context.guidance.evaluation` for evaluation-stage knowledge statements).
  Checks are intentionally simple: structural completeness (every planned
  scene got written, every scene/purpose is non-empty and distinct, the
  protagonist's desire/need/internal conflict are present and distinct,
  starting point vs. ending state actually differ) plus small fixed-phrase
  keyword checks (stock explanatory phrases, stock moral-of-the-story
  phrases, the applicable `avoid_ai_writing_patterns` anti-patterns).
- `evaluation/types.ts` -- `EvaluationInput`, `EvaluationResult`,
  `CriteriaResult`, `EvaluationCriterionDefinition`, and the
  `NarrativeEvaluator` function shape, so a future LLM-backed evaluator can
  implement the same shape without changing callers. Intentionally defines
  its own contracts, distinct from the placeholder
  `QualityEvaluationResult` / `QualityEvaluationLayer` sketched in
  `core/contracts.ts` -- same reasoning as `guidance/types.ts` vs.
  `GenerationGuidanceBundle`: that sketch predates the real per-layer
  shape.

### Difference from the Writer Layer

- **Writer (`writer/`)** produces content: it turns planning + guidance
  into `GeneratedScene[]`.
- **Evaluation (`evaluation/`)** judges content that already exists: it
  turns `GeneratedScene[]` (plus the planning/guidance/context chain it
  came from) into a structured verdict. It adds no story content and
  changes nothing it is given.

### Difference from `lib/story-supervisor.ts`

This layer does **not** replace the existing, active
`lib/story-supervisor.ts` and is not called by it or by anything in the
active generation pipeline (`app/api/jobs/*`, `lib/script-builder*`,
`lib/narrative/*`, `lib/tts/*`). `lib/story-supervisor.ts` is production
code operating on real generated scripts today; `evaluation/` is an
isolated, deterministic prototype of a future evaluation contract inside
the Creative Intelligence Architecture, exercised only by its own test
script.

### Future use: Repair / Rewrite Layer

`EvaluationResult` is designed to be the input to a future Repair / Rewrite
Layer, not the end of the line:

```
GeneratedScene[] -> evaluateNarrative() -> EvaluationResult -> (future) Repair / Rewrite Layer -> revised GeneratedScene[]
```

`violations` and `weaknesses` identify *what* underperforms and
`suggestions` point at *which quality dimension* to revisit -- but
deliberately stop short of saying *how* to rewrite anything. That decision
is left entirely to the future Repair / Rewrite Layer this result is meant
to feed, keeping the Evaluation Layer a pure judge.

Tests: `scripts/test-creative-intelligence-evaluation.ts`.

## Creative Intelligence Prototype Coordinator (RP-011C.7.28)

`prototype/` is an isolated architecture-validation layer: it connects the
seven Creative Intelligence stages above (Intent -> Context -> Blueprint ->
Scenes -> Guidance -> Writer -> Evaluation) into one executable, end-to-end
path and proves the whole chain is internally coherent. It is **not**
production-wired -- nothing in the active generation pipeline calls it --
and it is the foundation a future migration would start from, not a
migration itself.

- **Input**: `CreativeIntelligencePrototypeInput` (`prototype/types.ts`) --
  `prompt`, optional `preset`, optional `durationMinutes`.
- **Output**: `CreativeIntelligencePrototypeResult` -- every intermediate
  artifact the seven stages produced, in order: `input`, `intent`,
  `context`, `storyBlueprint`, `scenes`, `guidance`, `generatedOutput`,
  `evaluation`, `metadata`.
- `prototype/coordinator.ts` -- `runCreativeIntelligencePrototype()` maps
  the prototype input onto `RawCreativeInput` (`core/contracts.ts`), then
  calls `extractCreativeIntent()`, `buildCreativeContext()`,
  `buildStoryBlueprint()`, `buildSceneBlueprints()`,
  `buildGenerationGuidance()`, `writeStory()`, and `evaluateNarrative()` in
  sequence, threading each stage's output into the next exactly as their
  own contracts already require. It creates no new principles, planning
  logic, writing rules, or evaluation criteria -- each layer stays
  responsible for its own logic; the coordinator only orchestrates. The one
  piece of data it adds is folding an explicit `durationMinutes` onto the
  `CreativeIntent` extractCreativeIntent() returns (that layer never
  populates it), without mutating the extractor's output.
- `prototype/types.ts` -- `CreativeIntelligencePrototypeInput`,
  `CreativeIntelligencePrototypeResult`,
  `RunCreativeIntelligencePrototypeOptions` (an optional isolated
  `CreativeKnowledgeRegistry` and a deterministic `createdAt` override for
  tests). By default the coordinator builds and initializes its own
  isolated registry per call, so repeated runs never collide with each
  other or with the shared `creativeKnowledgeRegistry` instance.
- `prototype/index.ts` -- deliberately **not** re-exported from
  `lib/creative-intelligence/index.ts`: the prototype stays outside this
  module's general public surface until an explicit future migration
  decides otherwise.

### Not a pipeline replacement

`runCreativeIntelligencePrototype()` is not called by `app/api/jobs/*`,
`app/generate/*`, `lib/script-builder*`, `lib/narrative/*`,
`lib/story-supervisor.ts`, or `lib/tts/*`, and makes no
OpenAI/ElevenLabs/database calls -- same isolation guarantee as every other
layer in this module. Its only job is proving the seven stages compose into
one coherent path end-to-end, across all five presets, without changing any
production behavior.

Tests: `scripts/test-creative-intelligence-prototype.ts`.

## Creative Intelligence Orchestration Layer (RP-011C.8.4)

`orchestration/` is the first **production-oriented** coordinator for the
Creative Intelligence stages -- the migration foundation this project's
future production wiring would start from. It connects the same seven
stages as `prototype/` (Intent -> Context -> Blueprint -> Scenes ->
Guidance -> Writer -> Evaluation) but is a distinct layer with its own
contracts, not a rename of the prototype: `prototype/` stays an isolated
architecture-validation harness, while `orchestration/` is the shape a real
production call site would depend on going forward. Like every other layer
in this module, it defines **no creative rules of its own** -- it only
coordinates the existing layers, is not called from the active generation
pipeline, and makes no OpenAI/ElevenLabs/database calls.

- **Input**: `CreativePipelineRequest` (`orchestration/types.ts`) --
  `prompt`, optional `preset`, optional `durationMinutes`.
- **Output**: `CreativePipelineResult` -- every intermediate artifact each
  stage produced, in order: `request`, `intent`, `context`,
  `storyBlueprint`, `scenes`, `guidance`, `generatedScenes`, `evaluation`,
  `metadata`.
- `orchestration/pipeline.ts` -- `runCreativePipeline()` maps the pipeline
  request onto `RawCreativeInput` (`core/contracts.ts`), then calls
  `extractCreativeIntent()`, `buildCreativeContext()`,
  `buildStoryBlueprint()`, `buildSceneBlueprints()`,
  `buildGenerationGuidance()`, `writeStory()`, and `evaluateNarrative()` in
  sequence, threading each stage's output into the next exactly as their
  own contracts already require -- the same duration pass-through as
  `prototype/coordinator.ts` (folding an explicit `durationMinutes` onto
  the `CreativeIntent` `extractCreativeIntent()` returns, without mutating
  the extractor's output). It is declared `async` -- the stages themselves
  stay synchronous for this pass, but the `Promise`-based contract means a
  future migration can swap the deterministic-template Writer or
  Evaluation layer for a provider-backed implementation behind the same
  `runCreativePipeline()` signature without changing callers.
- `orchestration/types.ts` -- `CreativePipelineRequest`,
  `CreativePipelineResult`, `RunCreativePipelineOptions` (an optional
  isolated `CreativeKnowledgeRegistry` and a deterministic `createdAt`
  override for tests). By default the pipeline builds and initializes its
  own isolated registry per call, so repeated runs never collide with each
  other or with the shared `creativeKnowledgeRegistry` instance.
- `orchestration/index.ts` -- deliberately **not** re-exported from
  `lib/creative-intelligence/index.ts`: orchestration stays outside this
  module's general public surface until an explicit future migration pass
  decides otherwise (same posture as `prototype/index.ts`).

### Not a pipeline replacement

`runCreativePipeline()` is not called by `app/api/jobs/*`,
`app/generate/*`, `lib/script-builder*`, `lib/narrative/*`,
`lib/story-supervisor.ts`, or `lib/tts/*`, and makes no
OpenAI/ElevenLabs/database calls -- same isolation guarantee as every other
layer in this module. This pass is scoped to the orchestration skeleton
only: no migration of the active generation pipeline happens here, and no
provider calls are introduced.

Tests: `scripts/test-creative-intelligence-pipeline.ts`.
