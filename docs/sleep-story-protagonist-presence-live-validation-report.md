# RP-011C.8.10V.5 — Sleep Story Protagonist Presence Live Validation

Live validation of RP-011C.8.10V
(`scripts/test-creative-intelligence-sleep-story-protagonist-presence-calibration.ts`),
the Writer-prompt instruction telling the Writer not to remove or abstract
an established figure into passive/bodyless prose. V was previously verified
only at the prompt-text level (a deterministic, non-LLM unit suite asserting
the instruction string reaches the Writer's user prompt). This task is the
first live check of whether the model actually obeys it, run against the
defect RP-011C.8.10U (`docs/sleep-story-end-to-end-quality-final-rebenchmark-report.md`)
found live: in 4 of 7 cases the Creative Intelligence pipeline deleted an
established protagonist entirely, producing agentless passive prose ("A cup
was taken down from a shelf") or bodyless description ("the hands", "the
walking") instead of keeping the figure the creative direction named.

**This is a benchmark/review task only. No implementation files were
modified. No fixes were made. No commits.**

## 1. Files added

- `scripts/run-sleep-story-protagonist-presence-live-validation.ts` —
  new benchmark-only script, following the shape of
  `scripts/run-sleep-story-protagonist-calibration-live-validation.ts`
  (RP-011C.8.10R1.5). Reuses the existing, unmodified
  `scripts/narrative-benchmark/**` adapter/runner. Exercises only
  `CreativeIntelligenceAdapter` (no old-pipeline comparison — this task is
  scoped to Creative Intelligence output only, per the task brief). Does not
  add cases to the shared `cases/index.ts` registry and does not touch any
  adapter, classifier, writer prompt, guidance, or template.
- `docs/sleep-story-protagonist-presence-live-validation-report.md` — this
  report.

No other files were changed. The pre-existing uncommitted changes in the
working tree from prior tasks were left untouched.

## 2. Benchmark setup

Harness: `scripts/run-sleep-story-protagonist-presence-live-validation.ts`,
reusing `CreativeIntelligenceAdapter` from
`scripts/narrative-benchmark/adapters/creative-intelligence.ts` unmodified.

1. **Dry-run validation first** (`--dry-run`): all 6 adapter calls validated
   cleanly — prompt/preset/duration argument checks passed, no exceptions,
   no OpenAI calls made.
2. **Live run** (`CONFIRM_LIVE_BENCHMARK=true ... --live`): all 6 real
   OpenAI generation calls (via `runCreativePipeline()`, `writerMode:
   "provider"`) completed successfully, no failures.

Output: `benchmark-output/sleep-story-protagonist-presence-live-validation-2026-08-17T15-53-40-209Z/<caseId>/{creative-intelligence.txt, metadata.json}`.

Cases (prompt wording is exact, per the task brief):

| # | Case ID | Prompt |
|---|---|---|
| 1 | `protagonist-presence-01-train-conductor` | "A cozy sleep story about a train conductor traveling through snowy mountains." |
| 2 | `protagonist-presence-02-lighthouse-keeper` | "A calming bedtime story about a lighthouse keeper watching over the coast during a quiet night." |
| 3 | `protagonist-presence-03-old-gardener` | "A gentle sleep story about an old gardener caring for a quiet magical garden." |
| 4 | `protagonist-presence-04-valley-under-stars` | "A peaceful bedtime story about walking through a quiet valley beneath the stars." |
| 5 | `protagonist-presence-05-ocean` | "A gentle sleep story about drifting along a peaceful ocean under moonlight." |
| 6 | `protagonist-presence-06-generic` | "A relaxing sleep story to help me fall asleep." |

## 3. Metadata table

All figures also recomputed at 135 wpm (matching RP-011C.8.10U's production
rate) for apples-to-apples duration comparison; the script's own console
output uses 150 wpm (labelled separately).

| Case | CD? (byte-exact) | `hasExplicitScenario` | `storyScale` | Words | Est. min @135wpm | Over/under vs 20-min target |
|---|---|---|---|---:|---:|---:|
| 01 Train conductor | true | true | gentle_journey | 3,399 | 25.2 | +25.9% |
| 02 Lighthouse keeper | true | true | gentle_journey | 3,286 | 24.3 | +21.7% |
| 03 Old gardener | true | true | gentle_journey | 3,132 | 23.2 | +16.0% |
| 04 Valley under stars | true | true | gentle_journey | 3,029 | 22.4 | +12.2% |
| 05 Ocean | true | true | gentle_journey | 3,006 | 22.3 | +11.3% |
| 06 Generic | true | true | gentle_journey | 2,821 | 20.9 | +4.5% |

`creativeDirection` is present and byte-exact verbatim in all 6 cases
(verified per-case against `metadata.json`). Duration is a smoke check only
per the task brief and is not the focus of this validation — see §6.

**Case 6 classifier flag (pre-existing, unchanged).** The maximally generic
control prompt again resolves to `hasExplicitScenario: true`, the identical
signal value as the five scenario-anchored cases. This is the same
over-inclusiveness first flagged in RP-011C.8.10R1.5 §6/§7.1 and reconfirmed
in RP-011C.8.10U §2. Not new, not a regression, not evaluated further here.

## 4. Case-by-case findings

**Case 1 — Train conductor.** **The defect U found is gone.** `conductor`
appears 27 times, and — unlike U, where this exact role got **zero
pronouns** and was routed around with body-part constructions ("the
conductor's coat", "the face") — this output carries **191 he/his/him**
hits, all unambiguously referring to the conductor. He is the sustained
grammatical subject from the opening sentence ("The train conductor stood in
the narrow aisle...") to the closing one ("his folded hands remained quiet
in his lap as the train went on"). Zero occurrences of "traveler",
"companion", "There you are", "cottage", "hearth", "tea", or `...`. A
running-prop continuity thread (a child's boots nudged straight, a
passenger's slipped scarf resettled, a blanket smoothed over a sleeping
passenger) recurs consistently across the story with no contradiction; the
child and passenger are background objects/figures, never a source of
pronoun ambiguity. Ending: soft trail-off. **Named role preserved: Y.
Passive/agentless disappearance: N. Generic traveler: N.**

**Case 2 — Lighthouse keeper.** Same result. `keeper` appears 25 times,
carried by **148 he/his/him** hits (U already found this the
best-balanced case with 117 pronoun hits; this run holds and slightly
improves on it). Opens directly on him ("The lighthouse keeper was already
awake...") and stays centered throughout to the close ("the keeper slept in
his chair beneath it"). Zero `traveler`, `companion`, `cottage`, `hearth`,
`tea`, "There you are". The single `arriv*` hit is metaphorical ("the ease
of someone who has long since arrived where he belongs"), not a host/arrival
ritual. **Named role preserved: Y. Passive/agentless disappearance: N.
Generic traveler: N.**

**Case 3 — Old gardener.** New case (not tested in U). `gardener` appears
26 times, carried by **144 he/his/him** hits, sustained protagonist from
open ("the old gardener was already among the beds...") to close ("the old
gardener rested with his hands loose on his knees ... until morning"). The
"quiet magical garden" half of the prompt is also honored with real content
— 4 explicit `magic` mentions plus a recurring silver-glow motif at watered
roots, described as magic that "settled rather than stirred" and "never
clung too tightly" — gentle magic without spectacle, a stronger scenario-
fidelity result than U's Case 7 (fantasy village), where `magic` appeared
only once and only as narration of its absence. Zero `traveler`,
`companion`, `cottage`, `hearth`, `tea`. **Named role preserved: Y. Garden +
magic preserved: Y. Passive/agentless disappearance: N. Generic traveler:
N.**

**Case 4 — Valley under stars.** No named figure was requested, and none is
forced. The story addresses the listener in **second person throughout (64
`you`/`your` hits)** — "The valley was already quiet when the walk began" →
"you remained on the smooth ground beside the path" — reproducing
RP-011C.8.10R1.5's improved resolution for this same prompt shape (a direct
address, not a third-person "traveler", and not an orphaned passive subject
like U's "the walk"/"the walking" phrasing). One `companion` hit refers to
the stars ("quiet companions to the walk"), not a human character — no
bias regression. Zero `traveler`, `cottage`, `hearth`, `tea`, "There you
are". **Environment preserved: Y. Forced protagonist: N. Traveler-bias
reintroduction: N.**

**Case 5 — Ocean.** No named figure was requested. Unlike Case 4, this
output has **zero** `you`, zero he/she/him/her, zero "listener", and — this
is the key contrast with U's finding for this same prompt shape — **zero**
bodyless-anatomy phrases ("the hands", "the body", "the fingers", "the
face"): U's Ocean Journey case dissolved a human into disembodied anatomy
("the wood beneath the hands", "the knuckles"); this run's Ocean case never
introduces a person to dissolve in the first place, keeping the boat itself
as the sustained grammatical subject ("The boat rose a little, then settled
again..."). This is a different resolution strategy than Case 4's, and the
inconsistency between the two (why one environment-only case gets direct
address and the other stays fully depersonalized) is worth tracking, but
neither is a defect: no figure was requested in either prompt, and neither
shows forced-character insertion or U's disembodied-anatomy pattern. Zero
`traveler`, `companion`, `cottage`, `hearth`, `tea`. **Environment preserved:
Y. Forced protagonist: N. Traveler-bias reintroduction: N.
Disembodied-anatomy pattern (U's finding for this exact case): not
reproduced.**

**Case 6 — Generic.** **The M-era hardcoded template did not reproduce.**
U found this exact control prompt fell back to "a gentle traveler" verbatim
(`traveler` ×42, plus the full gate/cat/room sequence). This run has **zero**
`traveler` hits. Instead it resolves to a coherent bedroom/falling-asleep
default keyed to a single stable identity, "the listener" (32 hits), with
body-part references ("one hand resting near the pillow", "the air ...
touched the forehead, the hands") consistently attached to that named
identity rather than orphaned — not the same failure mode as U's
disembodied-anatomy cases, since there is no dissolved *established* figure
here (none was established) and no ambiguity about who "the hands" belong
to. Zero `companion`, `cottage`, `hearth`, `tea`, "There you are". **No
forced companion: confirmed. No cottage/gate/cat-arrival template: confirmed.
No traveler-bias reintroduction: confirmed (0 vs. U's 42).**

## 5. Cross-case regression check against RP-011C.8.10U

| Bias tracked | U finding (7 cases) | V.5 finding (6 cases) |
|---|---|---|
| Companion insertion | 0/7 (only old-pipeline case 06) | **0/6** — zero `companion` hits referring to a person in any output |
| "There you are" arrival greeting | 0/7 CI outputs | **0/6** |
| Cottage/tea/hearth outside a requesting prompt | Confined to the one requesting case | **0/6** — none of these 6 prompts requested a cottage, and none appears |
| Forced generic traveler role | 1/7 (case 06, ×42) | **0/6** — including case 06, which no longer reproduces the template |
| Named-role preservation | 2/2 role-naming prompts preserve the role, but 0/7 get ordinary pronouns | **3/3 role-naming prompts preserve the role, and all 3 now carry ordinary pronouns** (144–191 he/his/him hits each) |
| **Protagonist deleted via passive/agentless prose (V's chartered defect)** | **4/7 cases** (01, 02, 05, 07) had no human subject at all — agentless passive or bodyless anatomy | **0/3 named-figure cases** — the specific defect V targets does not reproduce in any named-figure case |
| Environment-only cases forcing a character | Not applicable in U's sample shape | **0/2** (valley, ocean) — no forced character in either |
| Cross-scene continuity | 7/7 clean | **3/3 named-figure cases clean** — running props (boots, scarf, blanket) tracked without contradiction |
| Ending quality | Soft trail-offs 7/7 | **Soft trail-offs 6/6**, no moral, no twist, no abruptness |
| Literal `...` usage | 0/14 outputs | **0/6** |
| Duration overshoot (CI, 135 wpm, 5 directly comparable cases) | +5.5%…+18.5%, avg +12.8% | +4.5%…+25.9%, avg +15.1% — see §6 |
| `hasExplicitScenario` gate (case 06) | true (over-inclusive) | **true** (unchanged, same pre-existing defect) |

## 6. Duration note (smoke check only, per task brief)

Duration was explicitly not the target of RP-011C.8.10V and is treated here
as a smoke check, not a scored dimension. At the 135-wpm rate U used for
direct comparison: the 4 cases that overlap in shape with U's sample
(train conductor, lighthouse keeper, valley, ocean, generic) show overshoot
in the same broad band as U (all outputs remain "gentle_journey"-scale
overshoots, none catastrophic, none undershooting), but the average in this
6-case sample (+15.1%) is somewhat higher than U's (+12.8%), driven mainly
by the train conductor (+25.9% vs U's +18.5%) and lighthouse keeper (+21.7%
vs U's +13.5%) cases running longer this time. Given the small sample size
and known run-to-run variance in this pipeline (R1.5's 8-case sample ranged
+something even wider), this is not evidence of a new regression tied to
V's change — V's instruction is about figure removal, not length — but it
is also not evidence of improvement. Duration control remains a distinct,
already-tracked open item, unaffected either way by this validation.

## 7. Is RP-011C.8.10V validated?

**Yes, for the specific defect it was chartered to fix.** U's finding — that
the Writer, after being told not to *substitute* a named figure (R1), had
started to *remove* it entirely, producing agentless or bodyless prose in
4 of 7 cases — does not reproduce in this run. All three named-figure
prompts (train conductor, lighthouse keeper, old gardener) keep their named
role as the sustained protagonist, carried by ordinary pronouns throughout,
with clean cross-scene continuity and no passive/object-centered
disappearance anywhere in any of the three outputs.

At the same time, none of R1/U's previously-fixed biases reappear:
companion insertion, "There you are" arrival ritual, and cottage/tea/hearth
bleed remain at zero across all 6 outputs, and — notably — the one bias
U found reintroduced in its no-scenario control case (the M-era "gentle
traveler" template, ×42) also does not reproduce here (0/6). Environment-
only prompts (valley, ocean) are not forced into having a protagonist,
matching R1/P's established behavior, though the two cases resolve the
"no forced character" requirement two different ways (second-person direct
address vs. fully depersonalized object-centered prose) — an inconsistency
worth tracking, not a defect.

**No new regression was found** beyond the pre-existing, already-tracked
`hasExplicitScenario` classifier over-inclusiveness (unchanged from
R1.5/U) and a small, likely-noise increase in average duration overshoot
that is out of scope for this calibration.

## 8. Remaining issues / follow-up

1. **`hasExplicitScenario` classifier calibration** — unchanged, pre-existing
   (RP-011C.8.10R1.5 §7.1, RP-011C.8.10U §2). Not evaluated further here.
2. **Inconsistent strategy for "no forced protagonist" in environment-only
   cases** — valley resolves via second-person direct address, ocean via
   fully depersonalized object-centered prose. Both satisfy the requirement,
   but the inconsistency means this is not (yet) a deliberate, controlled
   choice. Worth a follow-up look if a consistent house style is wanted for
   figure-less prompts.
3. **Duration overshoot persists**, average and per-case overshoot in this
   small sample trending slightly higher than U's, though within plausible
   run-to-run noise and not attributable to V's change. Remains a distinct,
   separately-tracked open item.
4. **Character continuity and ending quality** were both smoke-checked only
   (per task brief) — clean in this run, but not deeply scored.

**Recommendation: Sleep Story protagonist-presence calibration is complete
for the defect chartered under RP-011C.8.10V.** The live-generation evidence
across all three named-figure cases shows zero recurrence of U's
passive/agentless-disappearance defect, zero recurrence of R1's original
traveler-substitution defect, and zero reintroduction of any of R1/U's
previously-fixed biases across the full 6-case sample — including a new,
unprompted improvement (the M-era generic template no longer reproduces in
the no-scenario control case). The two open items noted above (classifier
over-inclusiveness, duration overshoot) are pre-existing and out of scope
for this calibration, not blockers to calling it complete; a targeted
follow-up on either would be a new, separately-scoped task rather than a
continuation of V.
