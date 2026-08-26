# RP-011C.8.10Q — Sleep Story End-to-End Quality Rebenchmark

Live re-run of the RP-011C.8.10J/M-style comparison of the old generation
pipeline (`lib/script-builder-openai.ts` / `lib/narrative/orchestrator.ts`)
vs. the Creative Intelligence pipeline (`lib/creative-intelligence/orchestration`)
for the **sleep-story** preset, after RP-011C.8.10P (scenario-aware defaults,
gated on the `hasExplicitScenario` signal). Goal: check whether the
traveler/companion/arrival/cottage/"There you are" default-bias pattern found
in RP-011C.8.10M has been reduced.

**This is a benchmark/review task only. No implementation files were
modified. No fixes were made. No commits.**

---

## 1. Files added

- `scripts/run-sleep-story-end-to-end-quality-rebenchmark.ts` — new
  benchmark-only script, following the exact shape of
  `scripts/run-sleep-story-end-to-end-quality-benchmark.ts` (RP-011C.8.10J).
  Reuses the existing, unmodified `scripts/narrative-benchmark/**`
  adapters/runner. Does not add cases to the shared `cases/index.ts`
  registry and does not touch any adapter, classifier, writer prompt,
  guidance, or template. Also surfaces `hasExplicitScenario` and
  `storyScale` from the CI `intent` object (RP-011C.8.10P's signal) in the
  per-case metadata and console summary, which the prior J/M script did not.
- `docs/sleep-story-end-to-end-quality-rebenchmark-report.md` — this report.

No other files were changed as part of this task. (The pre-existing
uncommitted changes in the working tree from prior tasks — `lib/narrative/**`,
`lib/story-supervisor.ts`, `lib/tts/elevenlabs.ts`, etc. — were left untouched.)

## 2. Benchmark setup

Harness: `scripts/run-sleep-story-end-to-end-quality-rebenchmark.ts`, reusing
`OldPipelineAdapter` / `CreativeIntelligenceAdapter` from
`scripts/narrative-benchmark/adapters/**` unmodified.

1. **Dry-run validation first** (`--dry-run`): all 10 adapter calls (5 cases
   × 2 pipelines) validated cleanly — prompt/preset/duration argument checks
   passed, no exceptions, no provider/OpenAI calls made. Confirmed the
   harness and case list were well-formed before spending live tokens.
2. **Live run** (`CONFIRM_LIVE_BENCHMARK=true ... --live`): all 10 real
   OpenAI generation calls completed successfully, no failures.

Cases (prompt wording is exact, per the task spec, and intentionally
overlaps in spirit but not in exact wording with the RP-011C.8.10J/M case
list, so this is a fresh sample rather than a byte-for-byte rerun of the
old prompts):

| # | Case ID | Scenario |
|---|---|---|
| 1 | `sleep-story-rebench-01-cozy-cottage` | Cozy Cottage |
| 2 | `sleep-story-rebench-02-valley-under-stars` | Valley Under Stars |
| 3 | `sleep-story-rebench-03-snowy-mountain-train` | Snowy Mountain Train |
| 4 | `sleep-story-rebench-04-fantasy-village` | Fantasy Village |
| 5 | `sleep-story-rebench-05-ocean-journey` | Ocean Journey |

Output: `benchmark-output/sleep-story-end-to-end-quality-rebenchmark-2026-08-17T11-35-46-749Z/<caseId>/{old.txt, creative-intelligence.txt, metadata.json}`.

## 3. Metadata table

| Case | Pipeline | Preset | CD? | `hasExplicitScenario` | `storyScale` | Words | Chars | Est. min | Target | Over/Undershoot | Gen time |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 01 Cozy Cottage | old | sleep-story | false | — | — | 2,610 | 13,982 | 17.4 | 20 | −13.0% | 87.0s |
| 01 Cozy Cottage | creative-intelligence | sleep-story | **true** | **true** | gentle_journey | 2,976 | 16,266 | 19.8 | 20 | **−1.0%** | 70.4s |
| 02 Valley Under Stars | old | sleep-story | false | — | — | 2,646 | 14,373 | 17.6 | 20 | −12.0% | 87.1s |
| 02 Valley Under Stars | creative-intelligence | sleep-story | **true** | **true** | gentle_journey | 3,266 | 18,076 | 21.8 | 20 | +9.0% | 77.3s |
| 03 Snowy Mountain Train | old | sleep-story | false | — | — | 2,705 | 14,861 | 18.0 | 20 | −10.0% | 90.8s |
| 03 Snowy Mountain Train | creative-intelligence | sleep-story | **true** | **true** | gentle_journey | 3,524 | 20,089 | 23.5 | 20 | +17.5% | 87.0s |
| 04 Fantasy Village | old | sleep-story | false | — | — | 2,718 | 14,939 | 18.1 | 20 | −9.5% | 100.3s |
| 04 Fantasy Village | creative-intelligence | sleep-story | **true** | **true** | gentle_journey | 4,347 | 24,397 | 29.0 | 20 | **+45.0%** | 102.2s |
| 05 Ocean Journey | old | sleep-story | false | — | — | 2,720 | 14,412 | 18.1 | 20 | −9.5% | 93.4s |
| 05 Ocean Journey | creative-intelligence | sleep-story | **true** | **true** | gentle_journey | 4,181 | 23,518 | 27.9 | 20 | +39.5% | 94.8s |

`CD?` = `intent.creativeDirection !== undefined`. Every one of the 5
Creative Intelligence cases now has `hasExplicitScenario: true` and a
non-empty `creativeDirection` equal to the literal prompt — this is the
single biggest structural change from RP-011C.8.10M, where all 5 cases had
`creativeDirectionPresent: false` and Creative Direction never reached the
writer at all. The old pipeline never populates these fields (it doesn't use
`lib/creative-intelligence`), so `false`/`—` there is expected, not a
regression.

CI's own deterministic-structural evaluator scored 3 of 5 cases "strong"
(1.0/1.0) and 2 "acceptable" (0.917, both docked only for one instance of
the stock phrase "somehow"/similar — see §4).

## 4. Case-by-case comparison

**Case 1 — Cozy Cottage** (prompt: small cottage in the woods, warm lights,
tea, peaceful evening; companion optional).

- *Old*: Mara prepares tea for herself and her partner Owen, who arrives with
  old woodland maps; they plan a walk for tomorrow, then settle by the
  fireless hearth for the night. Named characters, concrete, specific to the
  prompt, companion present but chosen by the plot rather than forced.
- *Creative Intelligence*: A cottage-in-the-woods atmosphere piece — kettle,
  teapot, hearth, shawl, biscuits, an unnamed "the traveler" who appears only
  in the second half. **No companion at all** — the "companion allowed but
  not required" expectation is met by the strongest possible margin (none
  forced in). Cottage/tea/hearth imagery is dense (`cottage` ×25, `tea` ×20,
  `hearth` ×5), but this is the one case where the *user's own prompt*
  requested exactly that imagery, so it reads as fidelity, not template
  bias. **Zero occurrences of "companion," "There you are," or "welcome"** —
  a clean break from the M pattern. Duration is now within 1% of target,
  the closest of all 10 outputs in this benchmark.

**Case 2 — Valley Under Stars** (prompt: walking through a peaceful valley
under the stars; no cottage, no forced companion).

- *Old*: Elias walks the valley path to a "far meadow" his sister asked him
  to find; meets shepherd Nora Vale, helps guide a flock across meltwater,
  they sit and talk under the rising moon. Concrete, named, faithful.
- *Creative Intelligence*: **This is the case RP-011C.8.10M flagged as the
  single clearest regression** — the M-era CI output replaced the valley
  entirely with an indoor cottage/tea scene. In this rebenchmark, the output
  is a five-scene valley walk under the stars — grass, stream, wildflowers,
  a stone bridge is crossed, ending with the traveler lying down in a meadow
  hollow to rest under the stars. **Zero occurrences of "cottage," "tea,"
  "hearth," or "companion."** The valley, the walking, and the stars are
  present in every scene, not just the opening. This is the clearest
  head-to-head fix of an M-era defect found in this rebenchmark.

**Case 3 — Snowy Mountain Train** (prompt: slow train journey through snowy
mountains, cozy; no forced traveler+companion structure, no danger/urgency).

- *Old*: Mara takes the night train to St. Alden to meet her brother Elias;
  fellow passenger Agnes Bell shares buns and station gossip, the train
  passes through a tunnel to reveal the valley and Elias waiting on the
  platform. Warm, concrete, gently plotted, no danger.
- *Creative Intelligence*: A five-scene train journey through snowy
  mountains — carriage, snowfields, fir trees, a snow shed, a distant
  village glimpsed below, settling into the seat's warmth. **Zero
  "cottage"/"companion"/"hearth"/"tea."** The two `arriv` hits are "the lamp
  remained... for whoever might arrive later" and "the train did not seem
  to be trying to arrive anywhere quickly" — atmospheric prose about the
  train's pace, not a forced arrival-at-a-cottage ritual. No danger or
  urgency; the train "never hurries." This is a full scenario match.

**Case 4 — Fantasy Village** (prompt: discovering a quiet magical village
where friendly people welcome the traveler; no escalation/adventure
structure).

- *Old*: Mara Bell wanders off her mapped route into an unmapped village
  (Elsi, Tobin, Nella, Ren); communal supper, floating lanterns over a
  stream, an invitation to stay the night. Warm, worldbuilt, no adventure
  pressure.
- *Creative Intelligence*: A five-scene village-wandering piece — lanes,
  lamps, a fountain square, a stream-side bench, a guest room offered near
  the end. "Traveler" appears 61 times and "welcome"/"arriv-" a handful of
  times, but this directly mirrors the user's *own* prompt wording
  ("friendly people welcome **the traveler**") rather than an unconditional
  system default — the prompt itself specified a traveler being welcomed.
  No companion (`companion` ×0), no escalation, no adventure pressure; the
  villagers' warmth is episodic (a baker, a child and her grandfather, an
  old man mending a sleeve) rather than one continuity-breaking companion
  character. **This is the case with the largest duration overshoot in the
  rebenchmark (+45%, 29.0 vs. 20 target minutes)** — see §7.

**Case 5 — Ocean Journey** (prompt: traveling along a peaceful coastline
while listening to the waves; no forced cottage/host pattern).

- *Old*: Elias drives the coast road to an inn Mara recommended, checks in
  with innkeeper Lena, talks briefly with Tomas on the porch about the tide,
  falls asleep listening to the sea and a buoy bell. Named, concrete, warm,
  faithful to "coastline" + "waves."
- *Creative Intelligence*: A five-scene coastal walk — sand, tide pools,
  driftwood, dunes, a weathered bench — ending with the traveler resting by
  the shore. **Zero "cottage"/"companion"/"hearth"/"tea."** The 15 `arriv`
  hits are all "waves arriving and retreating" — the tide's rhythm, not a
  protagonist arrival beat; confirmed by inspection, none describe a
  character reaching a threshold or being welcomed. No host, no forced
  companion. Second-largest overshoot (+39.5%, 27.9 vs. 20 min).

## 5. Comparison against RP-011C.8.10M

| Bias tracked in M | M finding | Q finding |
|---|---|---|
| Traveler as default protagonist | "a gentle traveler the listener follows" hardcoded in every case's blueprint regardless of prompt | Protagonist is generic/unnamed ("the traveler") in 4 of 5 cases, but no longer a forced role string independent of scenario — see residual note below |
| Companion insertion | "and any companions offer quiet, familiar presence" injected into every scene's guidance regardless of blueprint | **0 occurrences of "companion" in all 5 outputs.** Case 1 (companion explicitly optional) has none; Case 4 (prompt itself mentions "the traveler" being welcomed) still has no single named/forced companion character |
| Arrival/welcome ritual | Scene 1 always `narrativeFunction: "Arrival"`, purpose `"Welcome {role} into a peaceful place"`, in every case including the valley/stars case that had nothing to arrive at | **0 occurrences of "There you are."** No forced arrival-at-a-threshold scene in Cases 2, 3, 5 (valley/train/coastline); Case 4's welcoming language matches the user's own prompt wording, not a template default |
| Cottage/fireplace/tea imagery | Recurred across all 5 cases regardless of prompt (Case 3's valley/stars prompt was replaced entirely by a cottage/tea scene) | **Cottage/tea/hearth imagery appears only in Case 1**, whose prompt explicitly requested it. Zero occurrences in Cases 2–5 |
| "There you are" openings | Present in Cases 1, 2, 4 as the companion/host greeting | **0 occurrences across all 5 outputs** |
| Cross-case convergence | 4 of 5 cases produced near-identical cottage/gate/companion/hearth scaffolding regardless of prompt content | 5 of 5 cases produced visibly distinct settings, props, and sensory detail specific to their own prompt (cottage/kettle/shawl vs. valley/stream/wildflowers vs. train/carriage/snowfields vs. village/lanterns/fountain vs. coast/dunes/driftwood) |
| Case 3-equivalent (M): valley/stars prompt loses its scenario entirely | Confirmed — replaced by an indoor cottage/tea scene | Not reproduced. Case 2 (this rebenchmark's valley/stars case) stayed outdoors, on the path, under the stars, for all 5 scenes |
| Duration overshoot | +12.5% to +36% across 5 cases (avg +24.1%) | −1.0% to +45.0% across 5 cases (avg +22.0%) — roughly unchanged in aggregate, but now bimodal: 2 cases near-target (−1%, +9%), 3 cases still overshooting substantially (+17.5%, +39.5%, +45.0%) |

## 6. Did scenario-aware defaults solve the main bias?

**Yes, for the specific defect RP-011C.8.10M/O identified and RP-011C.8.10P
targeted.** The five markers tracked across both benchmarks —
traveler-as-forced-role, unconditional companion insertion, the
arrival/welcome scene template, cottage/fireplace/tea imagery outside a
cottage prompt, and "There you are" openings — are absent or reduced to
zero in this rebenchmark, and the specific worst-case regression from M
(the valley/stars prompt losing its scenario to an indoor cottage scene)
did not reproduce. All 5 cases now carry `hasExplicitScenario: true` and a
verbatim `creativeDirection`, and the generated text visibly reflects each
prompt's specific setting, activity, and atmosphere rather than converging
on one template. This is a genuine, verifiable fix of the root cause
documented in `docs/sleep-story-default-bias-calibration-review.md`.

**No, for Sleep Story's overall production readiness** — several issues
tracked as "remaining known issues" in the task brief, and one residual
bias-adjacent observation, still stand (see §7).

## 7. Remaining blockers before Sleep Story production readiness

1. **Duration overshoot is not resolved and is now more variable.**
   RP-011C.8.10M found a consistent +12.5%–36% overshoot; this rebenchmark
   found −1.0% to +45.0%, with the two "journey through a populated place"
   cases (Fantasy Village +45%, Ocean Journey +39.5%) overshooting the most.
   The average overshoot (+22%) is not meaningfully improved from M's
   +24.1%. Not fixed in this task per the brief; still a blocker for
   production duration-accuracy guarantees.
2. **Protagonist is now anonymous rather than mistemplated.** In 4 of 5
   cases the protagonist is referred to only as "the traveler" with no name,
   versus the old pipeline's named, specific protagonists (Mara, Elias) in
   all 5. RP-011C.8.10P removed the *hardcoded* "gentle traveler the
   listener follows" role string for explicit-scenario cases (confirmed by
   `scripts/test-creative-intelligence-sleep-story-scenario-aware-defaults.ts`),
   but the writer still defaults to an unnamed generic label rather than
   inventing a name the way the old pipeline does. Not one of the five
   biases this task was scoped to check, but worth tracking as a residual
   character-quality gap between the two pipelines.
3. **Companion continuity** (tracked in the task brief, not evaluated here
   because no case in this rebenchmark produced a companion character to
   check for identity drift — Case 4's villagers are episodic/one-scene
   figures, not a single continuing companion). RP-011C.8.10M's finding that
   a single companion's identity could drift human ↔ animal-like within one
   story was not re-testable with this case set; a case that explicitly
   requests a persistent companion would be needed to re-check this.
4. **Ending quality** (tracked, not fixed): endings in this rebenchmark are
   consistently soft trail-offs with no stated moral or twist (evaluator's
   `peaceful_non_demanding_endings` and `sleep_transition_arc` criteria
   passed on all 5), matching M's finding that per-scene prose quality was
   already strong; no regression or improvement to report here.
5. **Repeated phrases** (tracked, not fixed): the evaluator flagged the
   stock phrase "somehow" (Case 3) and an unspecified similar phrase (Case
   5) in the two "acceptable" (0.917) cases. Within-story sentence-level
   repetition of phrasing patterns like "Nothing needed," "Nothing asked,"
   "settled/settling" is dense in all 5 CI outputs (a stylistic trait of
   this atmospheric-descriptive register) but the deterministic evaluator's
   `trust_the_reader`/`ai_writing_patterns` checks do not catch this kind of
   repetition, consistent with the evaluator gap M already identified (its
   checks operate on structure, not cross-sentence phrase reuse).
6. **The deterministic-structural evaluator remains an unreliable quality
   gate for the specific failure mode this task tracks.** It has no
   criterion for "did this output preserve the user's specific scenario" or
   "does this output resemble the output for an unrelated prompt" — it can
   only score a single story's internal structure. This rebenchmark's
   central finding (scenario fidelity restored) had to be established by
   direct cross-case text comparison, exactly as M's central finding
   (scenario fidelity lost) was — the evaluator's scores (3 "strong," 2
   "acceptable") do not, by themselves, tell you anything about the bias
   this task was scoped to check.

**Recommendation:** the specific defect this task was chartered to verify
(scenario-aware defaults reducing traveler/companion/arrival/cottage
default bias) is confirmed fixed. Sleep Story is closer to pipeline
integration than it was after RP-011C.8.10M, but duration overshoot and the
evaluator's blind spot for cross-case/scenario-fidelity checks remain open
blockers, consistent with the task brief's instruction to continue tracking
rather than fix them here.
