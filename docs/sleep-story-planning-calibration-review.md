# RP-011C.8.10D — Sleep Story Planning Calibration: Review Report

Status: Investigation only. No code changes. Read-only review of the planning layer against the approved Sleep Story Identity Review (`docs/sleep-story-principle-library-v1.md`) and the implemented Sleep Story Knowledge Foundation (`lib/creative-intelligence/knowledge/sleep-story/*`, 8 modules).

---

## 1. Current Planning Architecture

`lib/creative-intelligence/planning/blueprint-builder.ts` builds a `StoryBlueprint` from a `CreativeIntent` + `CreativeContext` via four deterministic resolvers, each branching per-preset:

- `resolveProtagonist` — has dedicated branches for `kids-story`, `meditation`, `classic-asmr` (both `asmrMode`s). `sleep-story` falls through to the **generic non-plot branch** (shared with `narrative` when not plot-driven, though in practice only `sleep-story` uses this branch today since every other preset has its own).
- `resolveProgression` (→ `trajectory.progression`) — has dedicated per-scale tables for `kids-story` (fixed), `meditation`, `classic-asmr` (both modes). `sleep-story` falls through to the **generic `PROGRESSION_BY_SCALE`** table in `templates.ts`.
- `resolveTurningPoints` — gated by `PLOT_DRIVEN_PRESETS` (`narrative`, `kids-story` only) and `PLOT_DRIVEN_SCALES` (`arc`, `transformation`). `sleep-story` is correctly excluded and always gets `turningPoints: []`.
- `resolveStructureGuidance` — `avoidPatterns` is the deduped union of `antiPatterns` across **every** `CreativeContext.knowledge.modules` entry for the preset (not stage-filtered — `context/builder.ts` unions modules across all `USAGE_STAGES` before dedup). `requiredMovements` is `intent.requiredElements` ∪ the resolved `progression` array.

`CORE_CONFLICT_BY_PRESET`, `CENTRAL_QUESTION_END_STATE_BY_PRESET`, `EMOTIONAL_ARC_BY_PRESET`, and `PROTAGONIST_ROLE_BY_PRESET` in `templates.ts` already have sleep-story-specific entries (`"wakeful tension versus safe, restful sleep"`, `"restful sleep"`, ends in `"asleep or nearly asleep"`, `"the listener"`) and are correct as-is — these are not part of the gap.

## 2. Sleep Story Gaps Found

### Gap 1 — Progression leaks Narrative-shaped labels at `arc`/`transformation` scale (real bug, confirmed)

`PROGRESSION_BY_SCALE` (the generic table `sleep-story` inherits) is:

```
arc:            ["starting point", "discovery", "turning point", "resolution"]
transformation: ["starting limitation", "attempted change", "obstacles", "new equilibrium"]
```

These labels are literal Narrative machinery — `turning point`, `obstacles`, `starting limitation`, `attempted change` — and become `blueprint.trajectory.progression` *and* (via `resolveStructureGuidance`) `structureGuidance.requiredMovements` verbatim for a sleep-story request at `arc`/`transformation` scale. This directly contradicts:

- `movement_without_urgency` (antiPatterns: no "obstacle"/"complication"-driven sequencing)
- `episodic_meandering_structure` (antiPatterns: no escalating chain of links)
- `comfort_baseline_and_belonging` (antiPatterns: no dramatic arc; change is a softening only)
- The identity doc's own "Difference from Narrative" section: *"wants are soft, resistance is minimal-to-absent, and transformation (if any) is a softening rather than an arc."*

This is the one place a *required* structural field (`requiredMovements`, fed to downstream Scene Planning) would tell a future layer to build toward "obstacles" and a "turning point" for a sleep story — the opposite of every sleep-story knowledge module's guidance.

**Confirmed untested today:** `scripts/test-creative-intelligence-planning.ts` only pins sleep-story's `gentle_journey`-scale progression (`"settling in" → "gentle movement" → "deepening calm" → "safe arrival"`, which is fine and comfort-shaped). No test exercises sleep-story at `arc` or `transformation` scale, so this leak has shipped un-caught.

### Gap 2 — Protagonist framing is borrowed from Meditation/ASMR's *inward* model, not Sleep Story's *outward* identity (real mismatch, moderate severity)

The generic non-plot branch `resolveProtagonist` gives sleep-story:

```
initialState: "arriving with unresolved tension the experience will ease"
desire: "to settle into {emotionalDirection[0] ?? 'calm'}"
need: "permission to slow down"
internalConflict: "restlessness competing with the wish to rest"
externalGoal: "complete the experience calmly"
```

This is an *internal-state* model — appropriate for `meditation` and `classic-asmr`, whose identities are explicitly about the listener's own attention/arousal settling. But the Sleep Story identity doc is explicit that this is backwards for this preset:

> "attention rests *on a place and its inhabitants*, not on the self" ... "The listener is a witness/companion to the story, not its subject." ... "Sleep Story directs attention *outward*, onto an imagined world and characters other than the listener."

The current fields (`internalConflict: "restlessness competing with the wish to rest"`) describe the listener's internal arousal state — the same shape as classic-asmr's/meditation's protagonist model — not an outward, in-world witness/companion perspective. It isn't unsafe (nothing here violates an antiPattern), but it's an identity mismatch: it plans sleep-story as "an experience the listener settles through" rather than "a world the listener watches/accompanies while settling," which is the documented differentiator from Meditation and ASMR.

This also under-serves the `companions_as_warmth` and `rest_worthy_setting` modules, which both talk about "the protagonist" as an in-world figure (dwelling in places, accompanied by companions) — a role the current `ProtagonistFoundation` doesn't represent at all; there's no field describing *who the listener is watching/following*.

### Gap 3 — Knowledge integration is automatic for `antiPatterns`, and that's already sufficient; no explicit preset handling is needed

Checked directly: `context/builder.ts`'s `buildCreativeContext` unions `queryApplicableModules` results across **all** `USAGE_STAGES`, then dedupes by module id — so all 8 sleep-story modules land in `context.knowledge.modules` regardless of which stage they declare (`peaceful_non_demanding_endings` and `ambient_sensory_calm` only declare `generation`/`evaluation`, but still surface here). `blueprint-builder.ts`'s `resolveStructureGuidance` then flat-maps `antiPatterns` from all of them into `avoidPatterns` with no per-preset code required. **This part of Planning already works correctly and automatically for the new modules — no change needed.**

Not a gap, but worth flagging as a pre-existing, cross-cutting limitation (out of scope here, applies to every preset equally): the *positive* `knowledge` guidance strings (as opposed to `antiPatterns`) are computed into `CreativeContext.guidance.planning` by `context/builder.ts` but are **never read** by `blueprint-builder.ts` — only `avoidPatterns` feeds `StructureGuidance`. This means the ~30 positive knowledge bullets across the 8 sleep-story modules (e.g. "characters travel and act, but nothing pushes them via pressure") don't shape the blueprint directly; they'd need to reach generation/writer layers some other way (out of scope: `writer/**`, `guidance/**`).

## 3. Recommendation

### Decision: Protagonist model

**Option 1, scoped narrowly** — add a dedicated `resolveSleepStoryProtagonist()`, mirroring the existing `resolveKidsStoryProtagonist` / `resolveClassicAsmrStoryProtagonist` pattern (same function shape, same file). It should describe an in-world witness/traveler/resident figure the listener follows — not the listener's own internal arousal state — consistent with "gentle traveler / resident of a cozy place / observer within a peaceful world" from the ticket's option list, and with `companions_as_warmth`/`rest-worthy-setting`'s assumption that there's someone in the world to be accompanied and welcomed. `PROTAGONIST_ROLE_BY_PRESET["sleep-story"]` may also need to move from `"the listener"` to something like `"a gentle traveler the listener follows"`, matching the pattern classic-asmr's story mode already uses (`` `${role}, guided through a gentle in-scene persona and setting` ``).

This is not "Sleep Story needs a character system" — it's the same one-function, structural-label-only pattern every other preset already uses. Scope stays inside `blueprint-builder.ts` + one `templates.ts` entry.

### Decision: Progression model

Add a dedicated `SLEEP_STORY_PROGRESSION_BY_SCALE` table (same shape as `MEDITATION_PROGRESSION_BY_SCALE` / `CLASSIC_ASMR_PROGRESSION_BY_SCALE`) and route `resolveProgression` to it for `sleep-story`, the same way classic-asmr/meditation already opt out of the generic table. Labels should follow `episodic_meandering_structure` (vignette scenes, no escalating chain) and `sleep_transition_arc` (longer scales add *more time in the same decelerating rhythm*, never new stakes) — the same "extend the rhythm, don't escalate" principle classic-asmr's transformation-scale entry already encodes (`"continued rhythmic immersion"`). No turning points, obstacles, or "resolution"-as-achievement language at any scale. `PLOT_DRIVEN_PRESETS`/`PLOT_DRIVEN_SCALES` should **not** include `sleep-story` — the existing exclusion is correct and must be preserved.

### Files expected to change (future implementation phase)

- `lib/creative-intelligence/planning/templates.ts` — add `SLEEP_STORY_PROGRESSION_BY_SCALE`; update `PROTAGONIST_ROLE_BY_PRESET["sleep-story"]` if the role wording changes.
- `lib/creative-intelligence/planning/blueprint-builder.ts` — add `resolveSleepStoryProtagonist()`; branch `resolveProtagonist` and `resolveProgression` for `preset === "sleep-story"` before the generic fallback (same `if` pattern as the existing meditation/classic-asmr branches).
- `scripts/test-creative-intelligence-planning.ts` — extend sleep-story coverage to `arc`/`transformation` scale (currently only `gentle_journey` is pinned) so the Narrative-label leak can't regress silently again.

### Files explicitly not needed

- `core/types.ts` — existing `ProtagonistFoundation`/`StoryTrajectory` shapes are generic enough; no new fields required.
- `PLOT_DRIVEN_PRESETS` / `PLOT_DRIVEN_SCALES` — must stay unchanged; sleep-story must remain non-plot-driven.
- `context/builder.ts` / `knowledge/registry.ts` — antiPattern integration already works automatically; nothing to wire up.
- Any of `scenes/**`, `guidance/**`, `evaluation/**`, `writer/**`, `intent/**` — out of scope per ticket, and the gaps found are contained entirely within `planning/`.

## 4. Risk Assessment

- **Low implementation risk.** The fix follows an established, four-times-repeated pattern (kids-story, meditation, classic-asmr ×2 modes) — adding a fifth preset branch is mechanical, not architectural.
- **Regression risk is currently live, not hypothetical.** Any sleep-story request classified at `arc` or `transformation` `storyScale` today already produces a blueprint with `"turning point"` / `"obstacles"` in `requiredMovements` — this is shipped behavior, not a future risk, and it's the reason the `resolveProtagonist`/`resolveProgression` gap should be prioritized over the protagonist-framing gap.
- **Test-coverage gap compounds the risk.** Because `test-creative-intelligence-planning.ts` never exercises sleep-story past `gentle_journey`, this class of leak has no regression guard today, and the same could be true of the protagonist mismatch. Both should get explicit checks per the "files expected to change" list.
- **Protagonist change is lower urgency but should land together.** It's an identity-fidelity issue, not a policy violation (no antiPattern is currently triggered) — safe to defer briefly, but doing it alongside the progression fix avoids a second review/implementation pass touching the same functions.
- **No risk of narrative-focus/requiredElements interference.** `intent.narrativeFocus`/`requiredElements` come from the intent extractor (out of scope, untouched) and are additive to whatever progression table is chosen, so a new sleep-story-specific table composes safely with them.

## 5. Proposed Next Implementation Step

Implement Gap 1 first (dedicated `SLEEP_STORY_PROGRESSION_BY_SCALE` + routing in `resolveProgression`), since it's the confirmed, currently-shipping defect with the clearest knowledge-module contradiction. Implement Gap 2 (`resolveSleepStoryProtagonist()`) in the same change, since it touches the same file/function shape and avoids a second pass. Extend `test-creative-intelligence-planning.ts` sleep-story coverage to all four `storyScale` values as part of the same change, asserting the absence of Narrative-shaped labels (`"turning point"`, `"obstacles"`, `"resolution"`, `"attempted change"`, `"starting limitation"`) in `blueprint.trajectory.progression` for every scale.

---

## Verification

`git status` is clean except for this report and pre-existing untracked state from prior sessions (`lib/creative-intelligence/**`, `scripts/test-creative-intelligence-*`, `scripts/narrative-benchmark/**`, `docs/sleep-story-principle-library-v1.md`, etc. — none of which were created or modified by this investigation). No files under `scenes/`, `guidance/`, `evaluation/`, `writer/`, production pipeline files, or intent/classifier logic were modified. No commits were made.
