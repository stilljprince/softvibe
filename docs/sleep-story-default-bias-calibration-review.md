# RP-011C.8.10O — Sleep Story Default Bias Calibration Review

Read-only architecture review. No production files were modified as part of this task.

## 1. Executive Summary

Sleep Story's traveler / companion / arrival / welcome-ritual pattern is not caused by a single bug in a single layer. It is produced by **five independent, unconditional defaults stacked across the whole pipeline** — planning, scene structure, guidance, writer emphasis, and knowledge content — that all branch *only* on `intent.preset === "sleep-story"` and never on the user's actual scenario or extracted Creative Direction. Each layer independently reintroduces some piece of the pattern, so even where one layer behaves correctly (e.g. guidance/templates.ts correctly frames companions as optional), a sibling layer re-asserts the pattern unconditionally (e.g. guidance/builder.ts injects "any companions offer quiet, familiar presence" into every scene regardless of the blueprint).

The Creative Direction precedence mechanism added in RP-011C.8.10J–M does work — the user's explicit scenario reaches the writer prompt with strong precedence language ("do not ignore, generalize away, or override"). But it is placed in the same prompt alongside multiple *other* unconditional instructions ("Follow the protagonist through... gentle movement", "any companions offer quiet, familiar presence", "Welcome [protagonist] into a peaceful, familiar-feeling place") that never check whether Creative Direction is present or what it implies. The model is left to arbitrate a conflict the code never flags as a conflict.

**Root architectural gap:** nowhere in the pipeline — not `blueprint-builder.ts`, not `scenes/planner.ts`, not `guidance/builder.ts`, not `knowledge/registry.ts` — does a function branch on scenario content or on `intent.creativeDirection` presence. Every branch point keys only on `preset` (and, in scenes, `asmrMode`). Sleep Story has exactly one behavior shape, applied unconditionally, regardless of what the user asked for.

## 2–3. Root Cause Per Bias, With File Locations

### 2.1 Traveler Default

**Files:** `lib/creative-intelligence/planning/templates.ts:12`, `lib/creative-intelligence/planning/blueprint-builder.ts:146-155, 211-214`

`planning/templates.ts:12`:
```ts
"sleep-story": "a gentle traveler the listener follows",
```
A flat `Record<CreativePreset, string>` lookup keyed only by preset name — no branch on prompt/intent content.

`blueprint-builder.ts:211-214` always calls `resolveSleepStoryProtagonist` for every sleep-story request, unconditionally. That function (146-155) hardcodes all five `ProtagonistFoundation` fields as static strings:
```ts
initialState: "arriving in a peaceful place, unhurried and open to what it holds",
desire: "to wander gently through the place and rest inside its comfort",
need: "a warm, welcoming world and companions, with nothing to solve",
internalConflict: "quiet alertness easing, at its own pace, into the comfort of the place",
externalGoal: "settle into the place's rhythm until sleep comes naturally",
```
None of these interpolate `intent` (contrast `resolveMeditationProtagonist`, which does). `initialState` bakes in "arriving" even though `SLEEP_STORY_PROGRESSION_BY_SCALE` opens with "settling in" (not arrival) for 3 of 4 story scales — the default is internally inconsistent with the codebase's own progression table.

Sleep-story is explicitly excluded from `PLOT_DRIVEN_PRESETS` (`planning/templates.ts:20`), and `knowledge/sleep-story/companions-as-warmth.ts` states in its own header comment that Sleep Story "deliberately suppresses" the conflict engine — yet `resolveSleepStoryProtagonist` still populates every conflict-engine-shaped field (`desire`/`need`/`internalConflict`/`externalGoal`) with journey/settling content. Stated design and actual code diverge.

**Classification:**
- Protagonist role string — **over-specific default** (reasonable as a fallback identity, wrong as an unconditional one).
- Forcing `desire`/`need`/`externalGoal` into every blueprint despite sleep-story's stated "no conflict engine" identity — **implementation mistake**.

### 2.2 Companion Default

**Files:** `planning/blueprint-builder.ts:152`, `guidance/builder.ts:86, 128`, `guidance/templates.ts:72, 82`, `writer/templates.ts:92`, `knowledge/sleep-story/companions-as-warmth.ts:9-10, 31-35`

The forcing mechanism is **not** the knowledge module — it's structural, in two places:

1. `blueprint-builder.ts:152` — `need: "a warm, welcoming world and companions, with nothing to solve"` is written into every sleep-story blueprint unconditionally. This is a structural planning field, so it propagates downstream as an implied requirement rather than a possibility.
2. `guidance/builder.ts:128` (`resolveCharacterGuidance`, sleep-story branch, runs for every scene):
   ```ts
   `${blueprint.protagonist.role} and any companions offer quiet, familiar presence -- warmth without dependency...`
   ```
   "any companions" is baked into sentence structure with no conditional on whether companions exist in the blueprint/scene.
3. `guidance/builder.ts:86` (`resolveWritingFocus`, sleep-story branch, also unconditional):
   ```ts
   `Follow ${blueprint.protagonist.role} through "..." via gentle movement and peaceful curiosity...`
   ```
   Emitted for every scene regardless of whether the scenario is a journey.
4. `writer/templates.ts:92` — `"companions as warmth, not conflict"` is an unconditional bullet in the "Preset emphasis" line of every sleep-story system prompt.

By contrast, `guidance/templates.ts:72` (dialogueGuidance: "Dialogue is optional and secondary... **when** a companion speaks...") and `guidance/templates.ts:82` (allowedElementsBase: "companions present for warmth, not conflict", listed as one allowed/additive element among several) are correctly phrased as optional. `knowledge/sleep-story/companions-as-warmth.ts` is also correctly conditional in its core description — it never asserts a story must contain a companion — but its `knowledge[]` examples are concrete and vivid ("a wise innkeeper", "offering tea, a blanket, a lit lantern"), which functions as a latent anchor even though the surrounding prose is optional.

**Classification:** Root forcing mechanism = **implementation mistake** (`blueprint-builder.ts:152`) + **guidance problem** (`guidance/builder.ts:86, 128` unconditional per-scene sentences, `writer/templates.ts:92` unconditional emphasis bullet). The knowledge module's prose is correctly optional; its example imagery is a secondary **knowledge interpretation problem** (see 2.5).

### 2.3 Scene Opening Bias

**Files:** `scenes/templates.ts:104-176`, `scenes/planner.ts:29-42`

`SLEEP_STORY_SCENE_STEPS` (`scenes/templates.ts:130-176`) is a hardcoded 5-step array. `resolveSceneSteps` (`scenes/planner.ts:29-42`) selects it via `case "sleep-story": return SLEEP_STORY_SCENE_STEPS` — the switch keys only on `intent.preset` (and `asmrMode` for classic-asmr); there is no branch on blueprint content, scenario keywords, or Creative Direction anywhere in the function.

Step 1, `narrativeFunction: "Arrival"` (130-139):
```ts
purpose: (b) => `Welcome ${b.protagonist.role} into a peaceful, familiar-feeling place`,   // line 133
relatedStoryProgression: () => "arrival",                                                   // line 138
```
Step 2, `narrativeFunction: "Settling"` (140-148):
```ts
purpose: (b) => `Welcome ${b.protagonist.role} with quiet kindness...`,                     // line 142
settingGuidance: () => "...a companion or gentle host may offer quiet welcome",              // line 146
```
The block comment at `templates.ts:104-129` confirms this was a deliberate design decision from the prior RP-011C.8.10F calibration pass ("the protagonist is an in-world traveler the listener follows... Five steps, not four... Fixed structure regardless of storyScale") — this is not an accidental leftover, it was intentionally locked in one calibration pass earlier without an escape hatch for the case a later pass (8.10J-M) then enabled: user-supplied scenarios that don't imply arrival at all.

No alternative opening shapes exist as templates or branches — "already being somewhere peaceful," "slow movement through an environment," "observing a quiet place," and "gentle routine" are not represented anywhere in `scenes/templates.ts`; only the arrival/welcome shape exists, and it always runs first.

**Classification:** **Scene problem** (primary — fixed unconditional template) compounded by an **architecture limitation** (the scene planner has no mechanism at all to branch on scenario content; it would need a new parameter, not just a code path, since `resolveSceneSteps`'s signature only receives `intent`/`asmrMode`).

### 2.4 Writer / Guidance Reinforcement

**Files:** `writer/templates.ts`, `writer/prompts.ts:61-70, 89-99`, `guidance/builder.ts:86, 128`

`writer/templates.ts` and `writer/prompts.ts` contain **no** hardcoded "traveler"/"arrival"/"welcome"/"tea"/"fireplace"/"cottage"/"there you are" prose (confirmed by direct search) — `writer/prompts.ts` is pure formatting/interpolation by its own header comment, so it cannot itself be "imitating" an example. The one recurring template string is `writer/templates.ts:92`'s `"companions as warmth, not conflict"` preset-emphasis bullet, unconditional in every sleep-story system prompt (see 2.2).

Creative Direction precedence **does** exist and is well-placed: `writer/prompts.ts:61-70` inserts a `USER CREATIVE DIRECTION` section, ordered before `STORY DESIGN`/`THIS SCENE`/`WRITING GUIDANCE`, with explicit language: *"Respect this direction faithfully -- do not ignore, generalize away, or override the user's explicit creative choices."*

The gap: nothing in the `WRITING GUIDANCE` section (populated by `guidance/builder.ts`'s `resolveCharacterGuidance`/`resolveWritingFocus`) is conditioned on `intent.creativeDirection`. Those functions compute their sleep-story output purely from `intent.preset` / `blueprint.protagonist.role`. So the same prompt tells the model, in order: (1) "respect the user's valley-walk, no companion, do not override" and later, unconditionally, (2) "...and any companions offer quiet presence... Follow the protagonist through gentle movement." Nothing tells the model that (2) is a template default that should yield when it conflicts with (1).

**Classification:** **Guidance problem** (primary — `guidance/builder.ts:86, 128` hardcode per-scene sentences with no conditional on blueprint/creative-direction content) plus a **precedence problem** (secondary — `writer/prompts.ts:89-99` wraps `WRITING GUIDANCE` with no "these are defaults, defer to Creative Direction where present" framing).

### 2.5 Knowledge Interaction

**Files:** `knowledge/sleep-story/companions-as-warmth.ts:9-10, 31-35`, `knowledge/sleep-story/rest-worthy-setting.ts:19-21`, `knowledge/sleep-story/episodic-meandering-structure.ts:20`, `knowledge/sleep-story/comfort-baseline-and-belonging.ts:19-21`, `knowledge/sleep-story/movement-without-urgency.ts:18`, `knowledge/registry.ts:62-93`

Three modules contain wording that presupposes a protagonist/companion/journey rather than presenting one as an option among several:

- `companions-as-warmth.ts:31-35` — concrete example strings: *"a kindly elder, a loyal animal friend, a patient guide, **a wise innkeeper**"*; *"Small caretaking gestures -- **offering tea, a blanket, a lit lantern** -- stand in for heroics."* These are the literal textual source of "innkeeper"/"tea" imagery. The file never frames companion presence as conditional — it describes *how* companions should behave, never *whether* one exists.
- `rest-worthy-setting.ts:19-21` — *"Spaces should have soft, contained boundaries -- **dens, nooks, cottages, boats, hollows**"*; *"...home, garden, meadow, **hearth**, harbor"*; *"Travel and description should take up real airtime rather than being summarized"* — travel is asserted as a structural given, not conditioned on the scenario implying travel.
- `episodic-meandering-structure.ts:20` repeats: *"Travel and description take up real airtime rather than being summarized."*
- **`comfort-baseline-and-belonging.ts:19-21`** is the clearest single textual source of the arrival/welcome pattern, and it is CRITICAL priority (always injected): *"The protagonist is **welcomed into places and among characters** -- belonging, not achievement, is Sleep Story's emotional currency."* Framed as universal/unconditional, not one of several belonging mechanisms.
- `movement-without-urgency.ts:18` also assumes characters + travel as a given: *"Characters travel and act, but nothing pushes them via pressure... a character wanders toward a lit window because it looked warm."*

Neutral (no character/host/arrival/journey language): `ambient-sensory-calm.ts`, `peaceful-non-demanding-endings.ts`, `sleep-transition-arc.ts`.

`registry.ts:62-93` (`queryApplicableModules`) filters only by `status`, `preset`, `stage`, and optional `category`/`asmrMode` — there is no scenario-conditional parameter anywhere in the function signature or body. All 8 sleep-story modules, including the four biased ones above, are returned for **every** sleep-story generation regardless of the user's prompt. `validation.ts` is a pure schema/shape checker with no content-level logic — it neither causes nor could fix this.

**Classification:** **Knowledge interpretation problem** (primary — wording in 4 of 8 modules presupposes protagonist/companion/journey as given rather than optional) plus an **architecture limitation** (secondary — `registry.ts` has no mechanism to conditionally include/exclude modules based on scenario content; it would need a new signal, not just a wording edit, to support selective injection).

## 4. Classification Summary

| Bias | Primary classification | Secondary |
|---|---|---|
| Traveler protagonist role | Over-specific default | — |
| Forced desire/need/externalGoal fields | Implementation mistake | — |
| Companion in blueprint `need` field | Implementation mistake | — |
| Companion in per-scene guidance sentences | Guidance problem | — |
| Arrival/Settling scene steps | Scene problem | Architecture limitation (no scenario-aware branching) |
| Writer emphasis bullet ("companions as warmth") | Guidance problem | — |
| Creative Direction vs. default guidance conflict | Guidance problem | Precedence problem |
| companions-as-warmth / rest-worthy-setting examples | Knowledge interpretation problem | — |
| comfort-baseline-and-belonging "welcomed" language | Knowledge interpretation problem | — |
| Unconditional module injection (registry.ts) | Architecture limitation | — |

## 5. Recommended Smallest Next Implementation Step

Every layer's branch logic keys only on `intent.preset`. The lowest-risk, highest-leverage starting point is to introduce **one new boolean signal** — e.g. `hasExplicitScenario: boolean`, derived once during intent extraction from whether `intent.creativeDirection` (or an equivalent extracted-scenario field) is non-empty — and thread it as an additional parameter into exactly the four unconditional call sites identified above:

1. `blueprint-builder.ts:146-155` (`resolveSleepStoryProtagonist`) — skip/soften "companions" in `need` and "arriving" in `initialState` when `hasExplicitScenario` is true.
2. `scenes/planner.ts:29-42` (`resolveSceneSteps`) — when `hasExplicitScenario` is true, select a non-arrival first-scene variant (or parameterize Step 1's `purpose`/`relatedStoryProgression` instead of hardcoding "Welcome"/"arrival").
3. `guidance/builder.ts:86, 128` (`resolveWritingFocus`, `resolveCharacterGuidance`) — drop "any companions"/"Follow... through" framing when `hasExplicitScenario` is true and the scenario doesn't imply a companion/journey.
4. `writer/prompts.ts:89-99` — wrap the `WRITING GUIDANCE` section with a one-line framing statement ("the following are defaults; where Creative Direction above implies otherwise, Creative Direction governs") so the model has an explicit precedence rule instead of two unflagged, co-equal instructions.

This is intentionally the smallest step: one new signal computed once, four call sites updated to branch on it, no changes to `knowledge/registry.ts`'s injection model or the knowledge module prose itself (those are lower-priority secondary contributors and would be a separate follow-up once the structural forcing in planning/scenes/guidance is resolved).
