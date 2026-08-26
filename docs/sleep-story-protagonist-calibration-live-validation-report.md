# RP-011C.8.10R1.5 — Sleep Story Protagonist Calibration Live Validation

Live validation of the generation-time impact of RP-011C.8.10R1 (the
Writer-prompt instruction to preserve a user-named central figure instead of
substituting an invented generic one, and to not introduce a
traveler/companion/host/welcome ritual unless the prompt calls for it — see
`scripts/test-creative-intelligence-sleep-story-scenario-aware-defaults.ts`).
R1 was previously verified only at the prompt-text level (a deterministic,
non-LLM unit suite asserting the instruction string reaches the Writer's
user prompt). This task is the first live check of whether the model
actually obeys that instruction, and the first live test of prompts that
name a role (train conductor, lighthouse keeper, gardener) — the prior live
benchmark, RP-011C.8.10Q, only tested figure-less scenario prompts (valley,
train, coastline) and a fully generic prompt.

**This is a benchmark/review task only. No implementation files were
modified. No fixes were made. No commits.**

## 1. Files added

- `scripts/run-sleep-story-protagonist-calibration-live-validation.ts` — new
  benchmark-only script, following the shape of
  `scripts/run-sleep-story-end-to-end-quality-rebenchmark.ts`
  (RP-011C.8.10Q). Reuses the existing, unmodified
  `scripts/narrative-benchmark/**` adapter/runner. Exercises only
  `CreativeIntelligenceAdapter` (no old-pipeline comparison — this task is
  scoped to Creative Intelligence output only, per the task brief). Does not
  add cases to the shared `cases/index.ts` registry and does not touch any
  adapter, classifier, writer prompt, guidance, or template.
- `docs/sleep-story-protagonist-calibration-live-validation-report.md` —
  this report.

No other files were changed. The pre-existing uncommitted changes in the
working tree from prior tasks were left untouched.

## 2. Benchmark setup

Harness: `scripts/run-sleep-story-protagonist-calibration-live-validation.ts`,
reusing `CreativeIntelligenceAdapter` from
`scripts/narrative-benchmark/adapters/creative-intelligence.ts` unmodified.

1. **Dry-run validation first** (`--dry-run`): all 8 adapter calls validated
   cleanly — prompt/preset/duration argument checks passed, no exceptions,
   no OpenAI calls made.
2. **Live run** (`CONFIRM_LIVE_BENCHMARK=true ... --live`): all 8 real
   OpenAI generation calls (via `runCreativePipeline()`, `writerMode:
   "provider"`) completed successfully, no failures, ~90–100s per case.

Output: `benchmark-output/sleep-story-protagonist-calibration-live-validation-2026-08-17T12-44-01-813Z/<caseId>/{creative-intelligence.txt, metadata.json}`.

Cases (prompt wording is exact, per the task brief):

| # | Case ID | Prompt |
|---|---|---|
| 1 | `protagonist-calib-01-train-conductor` | "A cozy bedtime story about a train conductor traveling through snowy mountains." |
| 2 | `protagonist-calib-02-lighthouse-keeper` | "A gentle bedtime story about a lighthouse keeper watching over a quiet coastline." |
| 3 | `protagonist-calib-03-old-gardener` | "A peaceful bedtime story about an old gardener caring for a magical garden." |
| 4 | `protagonist-calib-04-valley-under-stars` | "A bedtime story about walking through a peaceful valley under the stars." |
| 5 | `protagonist-calib-05-snowy-train-journey` | "A calming bedtime story about a slow train journey through snowy mountains." |
| 6 | `protagonist-calib-06-generic-sleep-story` | "A relaxing bedtime story to help me fall asleep." |
| 7 | `protagonist-calib-07-cottage` | "A cozy bedtime story about a small cottage in the woods with warm lights." |
| 8 | `protagonist-calib-08-ocean-journey` | "A calming bedtime story about traveling along a peaceful coastline while listening to the waves." |

## 3. Metadata table

| Case | CD? | `hasExplicitScenario` | `storyScale` | Words | Est. min | Target |
|---|---|---|---|---:|---:|---:|
| 01 Train conductor | true | **true** | gentle_journey | 3,768 | 25.1 | 20 |
| 02 Lighthouse keeper | true | **true** | gentle_journey | 3,633 | 24.2 | 20 |
| 03 Old gardener | true | **true** | gentle_journey | 4,945 | 33.0 | 20 |
| 04 Valley under stars | true | **true** | gentle_journey | 3,072 | 20.5 | 20 |
| 05 Snowy train journey | true | **true** | gentle_journey | 3,825 | 25.5 | 20 |
| 06 Generic sleep story | true | **true** | gentle_journey | 2,512 | 16.7 | 20 |
| 07 Cottage | true | **true** | gentle_journey | 2,684 | 17.9 | 20 |
| 08 Ocean journey | true | **true** | gentle_journey | 2,862 | 19.1 | 20 |

`CD?` = `intent.creativeDirection !== undefined`. Duration/word-count is
recorded for reference only — duration control is explicitly out of scope
for this task per the brief and is not analyzed further here.

**Notable classifier observation**: Case 6's prompt ("A relaxing bedtime
story to help me fall asleep.") is the maximally generic Sleep Story
request the task brief describes as the case where "generic Sleep Story
defaults allowed." It nonetheless resolved to `hasExplicitScenario: true`
with `creativeDirection` set to the literal prompt. This is a live-only
finding — the existing unit suite
(`test-creative-intelligence-sleep-story-scenario-aware-defaults.ts`) checks
this exact prompt string only for preset resolution (`generic.preset ===
"sleep-story"`), not for `hasExplicitScenario`, so this behavior was never
asserted either way. In practice it did not produce a bad outcome in this
run (see Case 6 below — the model still fell back to inventing "a gentle
traveler," the expected/allowed generic-default shape), but it means the
`hasExplicitScenario` gate is currently over-inclusive: it does not
distinguish "no concrete scenario at all" from "a concrete scenario." Worth
tracking as a classifier-calibration item, separate from R1's Writer-prompt
change.

## 4. Case-by-case findings

**Case 1 — Train conductor.** Zero occurrences of "the traveler" / "a
traveler" / "the wanderer." "conductor" appears 26 times; the exact phrase
"train conductor" does not recur verbatim (expected — natural prose refers
to him by role noun alone after the opener), but he is unambiguously the
sustained protagonist from the first sentence ("Inside the engine car, the
conductor stood in his dark wool coat...") through the story's end. Two
`tea` hits are his own thermos tea while working ("he poured a little tea
from a metal flask into the lid-cup..."), not a cottage/hearth ritual — no
`cottage`, `hearth`, or `companion` anywhere in this output. **Named role
preserved: Y. Generic traveler: N.**

**Case 2 — Lighthouse keeper.** Zero occurrences of "the traveler" / "a
traveler." "keeper" appears 40 times (6 as the full phrase "lighthouse
keeper," the rest as "the keeper," consistent with normal prose economy,
not drift to a different figure). Opens with him directly: "the lighthouse
keeper was already at work" and stays centered on him checking the lamp,
walking the stairs, watching the light's rounds. Zero `companion`, zero
`cottage`, zero `hearth`, zero `tea`. **Named role preserved: Y. Generic
traveler: N.**

**Case 3 — Old gardener.** Zero occurrences of "the traveler" / "a
traveler." "gardener" appears 35 times, always referring to the same figure
("The old gardener was already in the garden...", "...the gardener
paused...", "The gardener rose and picked up his can again"). The magical
garden is co-central throughout (glowing soil, night-blooming flowers,
herb beds), matching the prompt's expectation that both the gardener and the
garden remain central. Zero `companion`, `cottage`, `hearth`, `tea`.
**Named role preserved: Y. Garden preserved: Y. Generic traveler: N.**

**Case 4 — Valley under stars.** Zero occurrences of "the traveler," "a
traveler," or any other invented character noun (no "someone," no named
figure at all). The story addresses the listener directly in second person
throughout — "The valley is already there around you," "As you walk...,"
"You keep walking at the same easy pace," ending "...the valley gathered
around you" — the strongest possible form of "no unnecessary protagonist
introduction," and a stricter result than RP-011C.8.10Q's equivalent valley
case, which still narrated a third-person "the traveler." "valley" appears
37 times; the walking/stars imagery is present in every scene, matching the
prompt. Zero `companion`, `cottage`, `hearth`, `tea`. **Environment
preserved: Y. Generic traveler: N (no protagonist noun introduced at all).**

**Case 5 — Snowy train journey.** "the traveler"/"The traveler" appears 5
times (e.g., "And the traveler sat within that steady motion, while the
evening settled more deeply over the white slopes"). This prompt, unlike
Cases 1–3, names no person — only an activity ("a slow train journey"). A
generic anonymous protagonist here is not itself a violation of R1 (R1's
"do not replace a named figure" instruction has nothing to preserve when no
figure was named); it reproduces the same residual pattern
RP-011C.8.10Q flagged for figure-less prompts. "train" appears 49 times and
the carriage/snowfields/mountain imagery is sustained end to end. One `tea`
hit is atmospheric ("the clean scent of wool, old wood, and a little trace
of tea," describing the carriage air, not a cottage/host ritual). Zero
`companion`, `cottage`, `hearth`. **Train/journey preserved: Y. Generic
traveler present: Y (expected — no figure was named in the prompt).**

**Case 6 — Generic sleep story.** "the traveler"/"The traveler" appears 16
times; opens with "a gentle traveler walked at an easy pace" — the literal
generic-default shape the task brief explicitly allows for this case
("generic Sleep Story defaults allowed"). One incidental "cottages" (plural,
background scenery passed on the road: "There were cottages set back from
the road... The traveler did not stop to look for long") — not an
arrival/entry scene, no interior, no tea, no hearth, no companion. Zero
`companion`, `cottage` (exact singular word), `hearth`, `tea`. **Generic
traveler present: Y (expected/allowed for this case per the brief). No
forced companion: confirmed. No cottage-arrival ritual: confirmed (cottages
appear only as passed-by background, not entered).**

**Case 7 — Cottage.** Zero occurrences of "the traveler" or any character
noun at all — this is a pure atmosphere piece with no protagonist
introduced, matching the prompt's lack of any character request. `cottage`
appears 29 times, `hearth` 5 times, but zero `tea` — this is the one prompt
that explicitly asked for a cottage with warm lights, so the imagery
density reads as fidelity, not template bias (consistent with
RP-011C.8.10Q's Case 1 finding for the same prompt shape). Zero
`companion`. **Cottage preserved: Y. No character forced in (stronger than
"companion allowed but not required" — none appears at all). Generic
traveler: N.**

**Case 8 — Ocean journey.** "the traveler"/"The traveler" appears 21 times
(e.g., "The traveler walks there without hurry, following the curve of the
land where the water meets the earth"). Like Case 5, this prompt names an
activity ("traveling along a peaceful coastline") but no person, so an
anonymous generic protagonist here is the same figure-less-prompt pattern,
not an R1 violation. `coastline` appears 14 times, `coast` 10, `waves` 19 —
the ocean/coastline setting is sustained throughout. The single `welcome`
hit is the adjective "more welcome" describing warmth ("the stored warmth
of the wood and sand feel more noticeable, more welcome") — not a
greeting/arrival ritual; there is no host, no threshold, no "There you
are." Zero `companion`, `cottage`, `hearth`, `tea`. **Coastline/ocean
preserved: Y. Generic traveler present: Y (expected — no figure was named
in the prompt).**

## 5. Cross-case regression check against RP-011C.8.10Q's fixed biases

| Bias tracked | Q finding | R1.5 finding |
|---|---|---|
| Companion insertion | 0/5 cases | **0/8 cases** — `companion`/`companions` appears zero times in all 8 outputs |
| "There you are" arrival greeting | 0/5 cases | **0/8 cases** — zero occurrences anywhere |
| Cottage/tea/hearth outside a cottage prompt | Confined to Case 1 (which requested it) | **Confined to Case 7** (which requested it); the only other hits are two atmospheric, non-ritual `tea` mentions (Case 1's conductor's own thermos, Case 5's carriage air) and one incidental background `cottages` (Case 6, passed by, not entered) |
| Generic/anonymous protagonist for figure-less prompts | 4/5 cases ("the traveler") | **3/5 figure-less cases** (Cases 5, 6, 8) still produce "the traveler"; Case 4 (valley) improved further, dropping to a second-person address with no protagonist noun at all |
| Named-figure substitution (the specific R1 target — untested in Q) | *Not tested in Q* | **0/3 cases** — Cases 1–3 (train conductor, lighthouse keeper, old gardener) each keep the named role as the sustained, unambiguous protagonist from the opening sentence onward, with zero substitution by an invented generic figure |

## 6. Is RP-011C.8.10R1 validated?

**Yes, for the specific defect it was chartered to fix.** R1's Writer-prompt
instruction — preserve a user-named central figure, do not replace them
with an invented generic figure — is confirmed at the live-generation level,
not just the prompt-text level. All three prompts that name a role (train
conductor, lighthouse keeper, old gardener) produced a story in which that
named role is the sustained protagonist throughout, with zero instances of
"the traveler" or any other generic substitute appearing anywhere in those
three outputs. This is the first live evidence for R1's claim; the prior
verification (the unit suite) only confirmed the instruction text reaches
the Writer, not that the model obeys it.

RP-011C.8.10Q's previously-fixed biases (companion insertion, arrival/
welcome ritual, cottage/tea/hearth outside a requesting prompt) all remain
fixed in this larger 8-case sample, including the three new named-figure
cases — R1 did not reintroduce any of them.

**No new regression was found.** The one residual pattern from Q — an
anonymous "the traveler" protagonist for prompts that describe an activity
or environment but name no person (Cases 5, 6, 8) — persists unchanged, as
expected: R1's instruction only prevents *substituting* a named figure, it
does not invent a name for prompts that never supplied one. This is not a
defect in R1's scope; the task brief treats duration, endings, and
continuity as separate workstreams, and by the same logic, "should a
figure-less prompt get a named character" was never part of what R1 was
chartered to change.

## 7. Remaining issues before RP-011C.8.10R2

1. **`hasExplicitScenario` classifier calibration.** Case 6's maximally
   generic prompt ("A relaxing bedtime story to help me fall asleep.")
   resolved to `hasExplicitScenario: true`, the same signal value as the
   three named-figure cases. It did not cause a visible bad outcome in this
   run (the model still produced the generic-default "gentle traveler"
   shape the brief allows for this case), but the signal is not currently
   distinguishing "the user gave a concrete scenario" from "the user gave
   no scenario at all" — worth a follow-up look at
   `lib/creative-intelligence/intent/classifiers.ts` before relying on this
   signal for anything more consequential than the Writer-prompt framing it
   currently drives.
2. **Anonymous protagonist for figure-less prompts is unchanged by R1**
   (tracked already by RP-011C.8.10Q as a residual gap, not newly found
   here). Cases 5 and 8 (train journey, ocean journey — activity/environment
   prompts with no named person) still default to "the traveler." Case 4
   (valley) shows an alternate resolution — second-person address, no
   protagonist noun at all — suggesting the model has more than one way to
   satisfy "no unnecessary protagonist," but this is inconsistent across
   cases rather than a deliberate, controlled choice.
3. **Duration overshoot persists and was not evaluated here per the task
   brief's scope** — all 8 cases in this run overshot the 20-minute target
   (16.7–33.0 estimated minutes), consistent with RP-011C.8.10Q's finding
   that duration control remains an open, separately-tracked issue.
4. **Character continuity was not evaluated here per the task brief's
   scope** — none of Cases 1–3 introduce a second character, so this
   validation cannot speak to whether a named figure's identity or
   supporting-character continuity holds up across scenes; that remains a
   distinct, not-yet-started workstream as the brief specifies.
5. **Ending quality was not evaluated here per the task brief's scope.**

**Recommendation:** the specific defect this task was chartered to verify
— RP-011C.8.10R1's Writer-prompt instruction actually preventing generic
substitution of a user-named central figure, in live model output — is
confirmed fixed, with clean evidence across all three named-figure cases
tested and no regression of RP-011C.8.10Q's previously-fixed biases across
the full 8-case sample. The classifier over-inclusiveness noted in §6/§7.1
and the persistent figure-less-prompt anonymity noted in §7.2 are both
pre-existing, out-of-scope-for-R1 observations, not blockers to calling R1
itself validated.
