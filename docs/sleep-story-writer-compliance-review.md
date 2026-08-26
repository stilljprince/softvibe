# RP-011C.8.10N — Sleep Story Writer Compliance Review

Read-only investigation. No production files modified. No commits made.

## 1. Executive Summary

RP-011C.8.10M's Creative Direction fix works: the user's concrete scenario now
reaches the Writer Layer and is respected. The five remaining defects are
**not writer-model failures** — they are traceable to specific, identifiable
gaps in the deterministic layers upstream of the writer (planning, scenes,
guidance) and to two outright missing mechanisms (a duration/word-count
signal, and cross-scene continuity). None of the five issues require a new
knowledge module from scratch; four are caused by content that is already
*too specific/too fixed* in `planning/templates.ts` and `scenes/templates.ts`,
and the fifth (duration) and the companion-drift half of issue 3 are caused
by things that were simply never built.

Severity ranking (most architecturally fundamental first):

1. **Duration overshoot (#4)** — `CreativeIntent.durationMinutes` is computed
   into `context.input.durationSeconds` and then **never read again by any
   downstream layer**. No word/length target of any kind reaches the writer
   prompt. This is a missing feature, not a miscalibrated one.
2. **Companion identity drift (#3)** — Each scene's writer prompt is built in
   total isolation from every other scene's *generated text*. There is no
   continuity channel at all. This is an architecture limitation, not a
   prompt-wording problem.
3. **Traveler + companion default (#1)** — Literal, hardcoded strings in
   `planning/templates.ts` and `planning/blueprint-builder.ts` bake "a gentle
   traveler" and "companions" into the protagonist model for *every*
   sleep-story request, regardless of whether the user asked for either.
4. **Arrival ritual / repetition (#2)** — `scenes/templates.ts`'s
   `SLEEP_STORY_SCENE_STEPS` is a **fixed, always-5-scene** structure whose
   first two steps are literally named "Arrival" and "Settling" and whose
   settingGuidance for step 2 explicitly suggests "a companion or gentle host
   may offer quiet welcome." This runs on every generation, every time.
5. **Ending quality (#5)** — The knowledge/guidance language repeatedly uses
   the *metaphor* "trailing off" without ever operationalizing what that
   means in prose (a settled image/action), and the evaluator's ending
   checks are keyword-blocklists that don't check for literal ellipsis
   characters or lack of closural punctuation at all.

---

## 2. Traveler + Companion Pattern

**Origin: Planning layer (protagonist model), reinforced by Guidance layer's
allowed-elements list. Not a writer-prompt problem, not a knowledge-module
problem in isolation.**

- `lib/creative-intelligence/planning/templates.ts:13` —
  `PROTAGONIST_ROLE_BY_PRESET["sleep-story"] = "a gentle traveler the
  listener follows"`. This string is used verbatim in every prompt
  (`writer/prompts.ts` interpolates `blueprint.protagonist.role` directly:
  "Follow a gentle traveler the listener follows through..."). It is a
  **hardcoded literal**, not derived from the user's request in any way.
- `lib/creative-intelligence/planning/blueprint-builder.ts:146-155` —
  `resolveSleepStoryProtagonist()` hardcodes
  `need: "a warm, welcoming world and companions, with nothing to solve"`
  for every sleep-story blueprint, and `initialState: "arriving in a
  peaceful place, unhurried and open to what it holds"`. Companions are
  written into the protagonist's *need* unconditionally — there is no branch
  checking whether the user's intent/creativeDirection mentioned a companion
  at all.
- `lib/creative-intelligence/guidance/templates.ts:79-84` — sleep-story's
  `allowedElementsBase` permanently includes `"companions present for
  warmth, not conflict"`. This flows into every scene's `allowedElements`
  list in the writer prompt (`guidance/builder.ts:143-149`,
  `resolveAllowedElements`), regardless of request content.
- `lib/creative-intelligence/guidance/builder.ts:128` —
  `resolveCharacterGuidance()` for sleep-story always emits: `"${role} and
  any companions offer quiet, familiar presence..."` — this line appears in
  every scene's `characterGuidance`, whether or not any companion was ever
  planned.

**Is companion presence required or optional?** Nominally optional — the
knowledge module `companions_as_warmth` uses conditional language ("any
companions," "if characters appear," per its own evaluation criterion in
`evaluation/criteria.ts:222-231`). But the *planning and guidance layers*
never actually condition on presence/absence of a companion in the user's
request; they always assert companions into the protagonist's need,
allowed-elements, and character guidance. The knowledge layer's hedging is
undermined by the planning/guidance layers' unconditional phrasing.

**Layer responsible:** Planning (protagonist model) is the primary cause;
Guidance (allowedElementsBase, characterGuidance) is a secondary reinforcing
cause. Knowledge (`companions_as_warmth`) is not itself the cause — it
correctly describes *how* a companion should behave, but never says a
companion must exist. Scene templates (`SLEEP_STORY_SCENE_STEPS` step 2,
below) add a third reinforcement.

---

## 3. Arrival Ritual / Repetition ("There you are", welcome, tea/fireplace)

**Origin: Scene Planning layer's fixed, always-5-step template. Reinforced
by Planning layer's protagonist `initialState`.**

- `lib/creative-intelligence/scenes/templates.ts:130-176` —
  `SLEEP_STORY_SCENE_STEPS` is a **fixed array of exactly 5 steps, used for
  every sleep-story request regardless of `storyScale` or
  `durationMinutes`** (confirmed: `scenes/planner.ts:36` calls
  `resolveSceneSteps()` which returns this array unconditionally for
  `"sleep-story"`; nothing scales scene count by length).
  - Step 1 (`narrativeFunction: "Arrival"`, line 131-139): purpose is
    literally `"Welcome ${role} into a peaceful, familiar-feeling place"`.
  - Step 2 (`narrativeFunction: "Settling"`, line 140-148): purpose is
    `"Welcome ${role} with quiet kindness..."` and — critically —
    `settingGuidance` at line 146 says **"a companion or gentle host may
    offer quiet welcome."** This is the literal source of the
    welcome/greeting beat that produces phrasing like "There you are."
- `lib/creative-intelligence/planning/blueprint-builder.ts:149` —
  `initialState: "arriving in a peaceful place, unhurried and open to what
  it holds"` primes "arrival" framing before scene planning even runs.

**Are these phrases hardcoded?** No literal phrase like "There you are" is
hardcoded anywhere in the codebase (confirmed via search of
`writer/prompts.ts`, `scenes/templates.ts`, `guidance/templates.ts`,
`knowledge/sleep-story/*` — none contain the string). It is a **conceptual**
default: "Arrival" + "Settling with welcome from a companion/host" is baked
into the *structure* every single sleep-story generation goes through, so
the model reliably converges on the same class of greeting phrase because it
is answering the same templated instruction every time, with no variation
mechanism at the planning/scene layer.

**Are they generated because of repeated scene structure?** Yes, specifically:
because `SLEEP_STORY_SCENE_STEPS` never varies (same 5 steps, same purposes,
same settingGuidance) across requests, and because — per §4 below — there is
no cross-scene memory, each generation independently re-derives an
arrival/welcome beat from the same static instruction, producing the same
"arrival ritual" shape story after story. Case 1 in the benchmark report
(`docs/sleep-story-creative-direction-quality-benchmark-report.md:85-99`)
additionally shows the arrival beat getting *restaged 3-4 times within a
single story* — see §4, this is the same missing-continuity mechanism:
without knowledge of what a prior scene already established, later scenes
can re-enact "arriving/being welcomed" again.

**Layer responsible:** Scene Planning (`SLEEP_STORY_SCENE_STEPS`) is the
direct cause of the ritual's recurrence across generations. Cross-scene
continuity architecture (§4) is the cause of *within-story* duplication.

---

## 4. Companion Continuity

**Origin: Architecture limitation. There is no continuity mechanism of any
kind between scenes at the Writer Layer.**

- `lib/creative-intelligence/scenes/planner.ts:74` —
  `charactersInvolved: [blueprint.protagonist.role]`. This is the *only*
  character data ever attached to a `SceneBlueprint`. It is always just the
  protagonist's generic role string (e.g. "a gentle traveler the listener
  follows") — there is no field anywhere in `SceneBlueprint`,
  `GenerationGuidance`, or the writer prompt for a *named or identified*
  companion. Companions are conceptual ("companions present for warmth") but
  never instantiated as a concrete, trackable entity in any data structure.
- `lib/creative-intelligence/writer/writer.ts:112-128` —
  `writeStoryWithProvider()` iterates scenes **sequentially** ("Sequential,
  not Promise.all", per its own comment at line 121-122) but does so only to
  keep output order deterministic — it does **not** thread any prior scene's
  generated text (or any extracted character state) into the next scene's
  call. Each call to `writeSceneWithProvider()` receives only
  `{scene, guidance, blueprint, context, intent}` — the same static,
  scene-independent blueprint/guidance for every scene.
- `lib/creative-intelligence/writer/prompts.ts:47-105` —
  `buildWriterUserPrompt()` confirms this: nothing in the prompt references
  any other scene's generated text, a companion's name, or any established
  detail from a previous segment. Each scene's prompt is built from
  `scene`, `guidance`, `blueprint`, `context`, `intent` alone — all of which
  are computed once, upfront, and never updated with generation results.

**Whether scenes receive previous character state:** No. Confirmed absent.

**Whether the writer has continuity constraints:** No explicit instruction
anywhere tells the writer "the companion introduced in the previous segment
was named X, keep using that name/identity." The `characterGuidance` line
(`"${role} and any companions offer quiet, familiar presence"`) is identical,
static text repeated for every scene — it carries no state.

**Is companion drift expected from the current architecture?** Yes —
this is the expected behavior of an architecture with no continuity channel,
not a surprising emergent failure. The benchmark
(`docs/sleep-story-creative-direction-quality-benchmark-report.md:134-139,
219-234`) documents exactly this: a different unnamed companion effectively
appears fresh in most segments of the same story.

**Layer responsible:** Architecture limitation — spans Scene Planning
(`charactersInvolved` never carries an identity), Writer Layer
(`writeStoryWithProvider`/`writeSceneWithProvider`, no state threading), and
the writer prompt builder (no continuity section). This is not fixable by
editing any one template; it requires a new mechanism (e.g., an evolving
"established story state" object threaded through `writeStoryWithProvider`'s
loop and surfaced in `buildWriterUserPrompt`).

---

## 5. Duration Overshoot

**Origin: Missing feature. `durationMinutes`/`durationSeconds` is computed
once and then dropped — it never reaches Planning, Scene Planning, Guidance,
or the Writer prompt.**

Confirmed via full-module search (`grep -rn "durationMinutes"
lib/creative-intelligence/`): the only places `durationMinutes` is *read* are:

- `lib/creative-intelligence/orchestration/pipeline.ts:62-65` —
  `applyRequestedDuration()` folds the request's `durationMinutes` onto the
  extracted `CreativeIntent`.
- `lib/creative-intelligence/context/builder.ts:73-74,80` — converts it to
  `durationSeconds` and stores it at `context.input.durationSeconds`.

That's the entire lifecycle. From there:

- `planning/blueprint-builder.ts` never reads `intent.durationMinutes` or
  `context.input.durationSeconds` — `resolveProgression()` branches only on
  `intent.storyScale` (`planning/blueprint-builder.ts:48-59`), and
  `storyScale` itself is a coarse 4-value enum (`vignette` /
  `gentle_journey` / `arc` / `transformation`) with **no numeric duration or
  word-count mapping anywhere** (checked `core/constants.ts`,
  `intent/classifiers.ts` referenced indirectly — no `wordsPerMinute` or
  similar constant exists in the module).
- `scenes/planner.ts` / `scenes/templates.ts` never read duration either —
  `SLEEP_STORY_SCENE_STEPS` is a fixed 5-item array regardless of scale (see
  §3); the file's own comment (`scenes/templates.ts:126-129`) states this
  explicitly: "a longer bedtime listen spends more time in the same
  unhurried rhythm, it doesn't add new movements" — i.e., **length must
  come entirely from per-scene prose length, and nothing tells the writer
  what that length should be.**
- `guidance/builder.ts` and `guidance/templates.ts` contain no word-count or
  length field of any kind in `GenerationGuidance`'s type
  (`guidance/types.ts:28-58` — no `targetWordCount`/`targetLength` field
  exists in the type at all).
- `writer/prompts.ts:47-105` — `buildWriterUserPrompt()` never includes
  `context.input.durationSeconds`, `intent.durationMinutes`, or any
  word/length instruction. The entire `EXPERIENCE` section
  (`prompts.ts:53-59`) omits duration even though `CreativeIntent` has the
  field available (`intent.durationMinutes` is simply never referenced in
  `prompts.ts`).

**Whether writer receives word targets:** No, confirmed absent at every
layer, for every scene, in every request.

**Whether scene count or scene length guidance causes expansion:** Yes, but
indirectly: because scene count is fixed at 5 regardless of requested
duration, and because sleep-story's own guidance style explicitly pushes
toward *not* summarizing or rushing (`rest_worthy_setting.ts:21`: "Travel and
description should take up real airtime rather than being summarized";
`episodic_meandering_structure.ts:20`: same instruction almost verbatim;
`guidance/templates.ts:74`: pacing guidance says "introducing fewer new
elements as the scene continues" but never a stopping point), the model has
strong pressure toward longer prose and zero counter-pressure (no ceiling,
no target, no evaluation check) to stop. This combination — expansive
"don't rush" instructions with a totally absent length signal — is
consistent with the benchmark's finding that duration overshoot **got worse,
not better**, after Creative Intelligence's calibration work
(`docs/sleep-story-creative-direction-quality-benchmark-report.md:247,
265-268`: "CI now overshoots more... consistently and more severely over
target (+14% to +47.5%)").

**Whether CI adds more prose requirements than the old pipeline:** Yes —
CI's sleep-story-specific "dwell/don't summarize/take real airtime" guidance
(§`rest_worthy_setting`, `episodic_meandering_structure`) is new relative to
a generic pipeline, and was added without a corresponding length-control
mechanism.

**Layer responsible:** Architecture limitation (no duration→word-target
translation exists anywhere), compounded by Guidance/Knowledge content that
actively encourages expansion (`rest_worthy_setting`,
`episodic_meandering_structure`, sleep-story `pacingGuidance`) with nothing
to counterbalance it.

---

## 6. Ending Quality

**Origin: Guidance/Knowledge problem (metaphorical language never
operationalized) + Evaluation problem (blocklist doesn't check for literal
ellipsis or absence of closural punctuation).**

- `lib/creative-intelligence/knowledge/sleep-story/peaceful-non-demanding-endings.ts:18-21`
  — "understatement and trailing off are preferable to a stated resolution,"
  "the last paragraph can be shorter and quieter... with no punchline, twist,
  or summary following." This never states *how* trailing off should read in
  prose — it doesn't rule out literal ellipsis (`"..."`) as the mechanism,
  nor does it require a concrete final image/action (e.g., "a character
  closing their eyes") as the *substitute* for a stated resolution. The
  module's own `knowledge[0]` line (line 18) does suggest a concrete image
  ("a character falling asleep, settling by the fire, closing their eyes")
  but this is advisory content buried in a `knowledge` array bullet, not an
  explicit instruction surfaced to the writer distinct from "trail off."
- `lib/creative-intelligence/scenes/templates.ts:167-175` — the final scene
  step's own purpose/desiredChange/settingGuidance repeat "trailing off"
  three times ("trailing off rather than resolving," "quietly trails off,"
  "closing on a soft image rather than a stated ending") without ever
  distinguishing "trail off in *content*" from "trail off in *punctuation*."
  A writer model reading "trail off" repeated this many times, with no
  explicit anti-instruction against literal ellipsis, has a plausible and
  literal interpretation available (typographic "...") that satisfies every
  stated instruction while still failing the actual product intent.
- `lib/creative-intelligence/evaluation/evaluator.ts:259-266,490-502` — the
  `peaceful_non_demanding_endings` check
  (`SLEEP_STORY_ENDING_HOOK_PHRASES` + `STOCK_MORAL_PHRASES`) only screens
  for twist/reveal/moral phrases ("little did they know," "turns out," "the
  truth was," etc.). Nothing in this evaluator, or in
  `sleep_transition_arc`'s check (lines 473-488, only screens
  `SLEEP_STORY_LATE_NOVELTY_PHRASES` / `SLEEP_STORY_ACTIVE_FINAL_PHRASES`),
  looks for literal `"..."` characters, a missing final sentence-terminator,
  or the absence of a concrete closing action/image. A story that ends in a
  bare ellipsis with no twist/moral/novelty phrase **passes both checks**.

**Does ending guidance exist?** Yes, conceptually (knowledge module +
scene-template language), but it is expressed as metaphor ("trail off")
rather than as a concrete instruction ruling out the literal typographic
device, and it is not checked for at evaluation time.

**Do final scenes encode ending behavior?** Yes (scene 5, "Gradual rest" —
`scenes/templates.ts:167-175`), but only at the conceptual level described
above.

**Does writer receive explicit final-state instructions?** Partially — the
`desiredChange` for step 5 is "Listener drifts toward sleep as the scene
quietly trails off," which is passed through to the prompt via
`prompts.ts:84` (`Desired change by the end: ${scene.desiredChange}`), but
this is the same ambiguous "trails off" language, not an instruction to
close on a concrete image without punctuation-based trailing.

**Is the issue missing guidance or generation behavior?** Both, but the
primary lever is guidance: the instruction is present but ambiguous, and the
evaluation layer that should have caught the literal-ellipsis interpretation
as a mismatch has no check for it at all.

**Layer responsible:** Knowledge (`peaceful_non_demanding_endings`,
`sleep_transition_arc`) and Scene Planning (`SLEEP_STORY_SCENE_STEPS` step
5) share the ambiguity; Evaluation (`evaluator.ts`'s ending-related
blocklists) is the layer that fails to detect the resulting defect.

---

## 7. Summary Table

| Issue | Primary layer | Secondary layer(s) | Classification |
|---|---|---|---|
| #1 Traveler + companion default | Planning (`blueprint-builder.ts`, `templates.ts`) | Guidance (`allowedElementsBase`, `characterGuidance`) | Planning problem |
| #2 Arrival ritual / repetition | Scene Planning (`SLEEP_STORY_SCENE_STEPS` steps 1-2) | Planning (`initialState`) | Scene problem |
| #3 Companion continuity/drift | Writer Layer + Scene Planning (no state threading, no identity field) | — | Architecture limitation |
| #4 Duration overshoot | Missing duration→length translation (absent at every layer) | Knowledge/Guidance (expansion-biased instructions with no counterweight) | Architecture limitation |
| #5 Ending quality | Knowledge + Scene Planning (ambiguous "trail off" metaphor) | Evaluation (blocklist doesn't check ellipsis/closure) | Guidance problem + Evaluation gap |

---

## 8. Recommended Smallest Next Implementation Step (per issue — not to be
implemented in this task)

1. **#1 Traveler + companion:** Make `resolveSleepStoryProtagonist()`
   (`planning/blueprint-builder.ts:146-155`) and sleep-story's
   `allowedElementsBase` (`guidance/templates.ts:79-84`) conditional on
   whether the extracted intent (creativeDirection/themes) actually mentions
   a companion or a specific protagonist framing, falling back to the
   current defaults only when the user's request is generic.
2. **#2 Arrival ritual:** Make `SLEEP_STORY_SCENE_STEPS`' step 2
   settingGuidance (`scenes/templates.ts:146`) not unconditionally suggest a
   companion/host welcome, and/or vary the arrival-beat phrasing space (a
   small set of alternative settingGuidance strings selected deterministically
   per request) so the same welcome shape doesn't recur verbatim.
3. **#3 Companion continuity:** Smallest viable step is adding a single
   "established story state" string (accumulated companion name/identity,
   updated after each `writeSceneWithProvider` call) threaded through
   `writeStoryWithProvider`'s loop (`writer/writer.ts:112-128`) and surfaced
   as a new prompt section in `buildWriterUserPrompt`
   (`writer/prompts.ts`) — no new types needed beyond a plain string
   accumulator.
4. **#4 Duration overshoot:** Add a `durationMinutes` → target-word-count
   translation (a simple words-per-minute constant) at the Guidance layer,
   surfaced per scene as a new `GenerationGuidance` field (e.g.
   `targetWordCount`) and included in `buildWriterUserPrompt`'s WRITING
   GUIDANCE section. This is the smallest change that gives the writer any
   signal at all, where today there is none.
5. **#5 Ending quality:** Replace the "trailing off" language in
   `peaceful-non-demanding-endings.ts` and `SLEEP_STORY_SCENE_STEPS` step 5
   with an explicit instruction to close on a concrete image/action and to
   avoid literal ellipsis punctuation, and add an ellipsis/no-terminal-
   punctuation check to `evaluator.ts`'s `peaceful_non_demanding_endings`
   criterion so a regression here is caught automatically.
