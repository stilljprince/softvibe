# RP-011C.8.10M — Sleep Story Creative Direction Quality Benchmark Report

Live comparison of the old generation pipeline (`lib/script-builder-openai.ts` /
`lib/narrative/orchestrator.ts`) vs. the Creative Intelligence pipeline
(`lib/creative-intelligence/orchestration`) for the **sleep-story** preset,
run after RP-011C.8.10L (the fix that made `classifyCreativeDirection()` in
`lib/creative-intelligence/intent/classifiers.ts` populate `creativeDirection`
verbatim for the sleep-story preset, closing the gap RP-011C.8.10J found).

No implementation files were modified. Benchmark script, output, and this
report only.

---

## 1. Files added/changed

- `scripts/run-sleep-story-creative-direction-quality-benchmark.ts` (new) —
  benchmark harness, reuses the existing, unmodified
  `scripts/narrative-benchmark/**` adapters/runner exactly as
  `scripts/run-sleep-story-end-to-end-quality-benchmark.ts` (RP-011C.8.10J)
  did. Adds a `creativeDirectionMatchesPrompt` metadata check and surfaces
  `intent.storyScale` in the summary table, on top of the 8.10J script's
  shape.
- `benchmark-output/sleep-story-creative-direction-quality-benchmark-2026-08-16T19-33-40-938Z/**`
  (new) — 5 cases × 2 pipelines × `{old.txt | creative-intelligence.txt,
  metadata.json}`.
- `docs/sleep-story-creative-direction-quality-benchmark-report.md` (this
  file, new).

No adapter, classifier, writer prompt/template, or other production file was
touched, per task scope.

## 2. Benchmark setup

- Dry-run validated first: `npx tsx scripts/run-sleep-story-creative-direction-quality-benchmark.ts --dry-run`
  — all 10 adapter calls (5 cases × 2 pipelines) validated cleanly with no
  OpenAI calls.
- Live run: `CONFIRM_LIVE_BENCHMARK=true npx tsx scripts/run-sleep-story-creative-direction-quality-benchmark.ts --live`
  — 10 real OpenAI generation calls, no failures.
- Cases (exact prompts from the RP-011C.8.10M brief, unedited):

| # | Case ID | Prompt |
|---|---|---|
| 1 | `sleep-story-cd-01-cozy-cottage` | "A cozy bedtime story about a small cottage in the woods, with warm lights, tea, and a peaceful evening." |
| 2 | `sleep-story-cd-02-valley-under-stars` | "A bedtime story about walking through a peaceful valley under the stars." |
| 3 | `sleep-story-cd-03-snowy-mountain-train` | "A cozy bedtime story about a slow train journey through snowy mountains." |
| 4 | `sleep-story-cd-04-fantasy-village` | "A gentle bedtime story about discovering a quiet magical village where friendly people welcome the traveler." |
| 5 | `sleep-story-cd-05-ocean-journey` | "A calming bedtime story about traveling along a peaceful coastline while listening to the waves." |

Output: `benchmark-output/sleep-story-creative-direction-quality-benchmark-2026-08-16T19-33-40-938Z/<case-id>/{old.txt, creative-intelligence.txt, metadata.json}`

## 3. Metadata table

| Case | Pipeline | creativeDirection present | = prompt verbatim | storyScale | Words | Chars | Est. min | Target | Overshoot |
|---|---|:---:|:---:|---|---:|---:|---:|---:|---:|
| 01 Cozy Cottage | old | — | — | — | 2,600 | 14,052 | 17.3 | 20 | −13.5% |
| 01 Cozy Cottage | creative-intelligence | ✅ | ✅ | gentle_journey | 4,138 | 22,733 | 27.6 | 20 | +38.0% |
| 02 Valley Under Stars | old | — | — | — | 2,542 | 13,880 | 16.9 | 20 | −15.5% |
| 02 Valley Under Stars | creative-intelligence | ✅ | ✅ | gentle_journey | 3,414 | 19,096 | 22.8 | 20 | +14.0% |
| 03 Snowy Mountain Train | old | — | — | — | 2,706 | 15,055 | 18.0 | 20 | −10.0% |
| 03 Snowy Mountain Train | creative-intelligence | ✅ | ✅ | gentle_journey | 4,377 | 24,657 | 29.2 | 20 | +46.0% |
| 04 Fantasy Village | old | — | — | — | 2,815 | 15,586 | 18.8 | 20 | −6.0% |
| 04 Fantasy Village | creative-intelligence | ✅ | ✅ | gentle_journey | 4,423 | 24,620 | 29.5 | 20 | +47.5% |
| 05 Ocean Journey | old | — | — | — | 2,510 | 13,463 | 16.7 | 20 | −16.5% |
| 05 Ocean Journey | creative-intelligence | ✅ | ✅ | gentle_journey | 3,784 | 21,245 | 25.2 | 20 | +26.0% |

`creativeDirection` is present and equals the verbatim, trimmed user prompt
in **all 5/5** Creative Intelligence cases — the root cause identified in
RP-011C.8.10J (`creativeDirectionPresent: false` in all 5 of that
benchmark's cases) is fixed at the intent-extraction layer. `storyScale`
still collapses to `gentle_journey` in all 5 cases regardless of prompt —
unchanged from 8.10J and not part of this fix's scope, noted for awareness
only.

## 4. Case-by-case comparison

**Case 1 — Cozy Cottage** (prompt: a small cottage in the woods, warm
lights, tea, peaceful evening).

- *Old*: Mara waits for her neighbor Elias, who returns her teapot with
  home-baked biscuits; they discover a stray cat and two kittens nesting by
  the woodpile, bring them in to warm by the fire, then return them to their
  owner (Mrs. Bell) down the path. Concrete, single continuous scene,
  genuinely charming and specific to "cottage, tea, warm lights."
- *Creative Intelligence*: A "traveler" reaches a cottage in the woods,
  greeted by a "companion"/"host" with tea by the hearth — matches the
  prompt's core ask (cottage, tea, warmth) well. But the **arrival beat is
  restaged near-verbatim four times**: segments 1 and 2 both open with "By
  the time the traveler reached the edge of the woods, evening had already
  settled/gathered..." (same sentence structure, same images — gate, garden,
  "There you are," tea by the hearth), and segments 3–4 restage the
  "traveler steps into the clearing / cottage" beat again with only minor
  variation. By the closing paragraphs the story visibly loses track of who
  the companion even is: *"If there was a companion here, it was the kind
  that asks for nothing at all. **Perhaps** a small cat had already curled
  into itself..."* — the writer hedges with "perhaps" rather than
  committing to a character, the clearest companion-identity failure in this
  run.

**Case 2 — Valley Under Stars** (prompt: walking through a peaceful valley
under the stars — no cottage, no companion requested).

- *Old*: Elias walks the valley path at Mara's invitation, crosses a
  footbridge to watch lantern-bugs, climbs to a meadow to see the Milky Way,
  and the sequence culminates in villagers gathering with lanterns at an old
  stone circle to sit quietly under the stars together. Faithful, warm, and
  ends outdoors under the sky as requested.
- *Creative Intelligence*: **This is the case RP-011C.8.10J flagged as the
  clearest regression** ("no valley, no dusk walk, no stars... replaced by
  an indoor cottage/tea scene"). With `creativeDirection` now populated, the
  valley and stars are preserved throughout nearly the entire piece: the
  traveler walks the starlit valley path, crosses a footbridge, sits under a
  willow by a stream, and the story ends outdoors — *"the traveler lay very
  still beside the water, under the willow, in the peaceful valley, with the
  soft night gathered close."* This is a genuine, direct fix of the 8.10J
  defect. One residual issue: segment 2 still detours into an unrequested
  cottage arrival with a host saying "There you are" before the story
  returns to the valley — a vestige of the old stock template intruding on
  an otherwise well-matched output.

**Case 3 — Snowy Mountain Train** (prompt: a slow train journey through
snowy mountains).

- *Old*: Mara Voss rides the winter mountain line to see her brother Tomas
  in Rieden; a conductor (Halden) and fellow passenger (Clara) build
  specific, warm detail (Falken Shelf stop, Himmel Pass, the "high bowl"
  view of the village) with no danger or urgency despite mentioning a delay.
  Faithful and well-paced.
- *Creative Intelligence*: **Fully committed to the train/snow scenario for
  the whole piece** — a station platform, a lit carriage, a dining car with
  a samovar, snow-laden firs passing the window, a conductor bringing tea.
  This is the strongest evidence the fix works: unlike the cottage case, the
  writer never substitutes in an unrelated indoor-cottage scene. The
  recurring defect here is different: the "companion" is not one stable
  character but a **new, unnamed presence introduced fresh in nearly every
  segment** (a blanket-sharing seatmate who says "There you are," later a
  window-gazing companion with "Still snowing higher up," later another who
  says "Still snowing" again) — continuity of a single companion across the
  journey is not maintained, even though no single companion's identity
  visibly "drifts" mid-scene the way Case 1's does.

**Case 4 — Fantasy Village** (prompt: discovering a quiet magical village,
friendly people welcome the traveler).

- *Old*: Elias stumbles on a hidden village guided by lantern-light,
  welcomed by Mara and Tomas, fed communal stew by Lina, and shown a
  "listening" basin and a stone circle where "people arrive twice" — light,
  well-built fantasy worldbuilding without any adventure pressure, and a
  clean "Good night."
- *Creative Intelligence*: Preserves the prompt closely — a traveler
  discovers a small stone village, is welcomed at a square by name-dropped
  villagers (a woman in a gray shawl, a baker, a "guest cottage" host), given
  tea and a bed. Companion/host identity is more stable here than in Cases 1
  or 3 (the same "woman in the gray shawl" recurs through arrival, tea, and
  bedding-down). This is the best-preserved and most internally consistent
  of the 5 CI outputs.

**Case 5 — Ocean Journey** (prompt: traveling along a peaceful coastline,
listening to the waves).

- *Old*: Elias drives the coast road to meet Lena in Maren Bay, guided by
  her texted directions (a chapel, a bakery, almond rolls), and the piece
  ends with her giving him a key to her flat — warm, specific, and a clean
  "Good night."
- *Creative Intelligence*: Preserves the coastal setting and wave sound
  faithfully across all 5 segments — cottage porch by the shore, a walk
  past dunes and driftwood, a dune-side rest, a bench above the beach. The
  "There you are" stock greeting recurs again here (companion at the
  cottage door), but the companion stays reasonably consistent afterward
  (same cardigan-wearing presence through the porch scene). Ends with the
  waves trailing off rather than a stated close.

## 5. Cross-case variation

The central 8.10J failure — 4 of 5 prompts collapsing into the *same*
cottage/gate/garden/companion template regardless of what was asked, and
Case 3 losing its scenario outright — **is fixed**. Read side by side, the 5
Creative Intelligence outputs now build 5 recognizably different worlds
(cottage interior, starlit valley + stream, snow train, stone village,
coastline), matching each prompt's setting, activity, and requested
atmosphere. This is the benchmark's headline result.

What has **not** changed: a stock "arrival ritual" — an unnamed "traveler"
reaches a place, a "companion" or "host" is already there, says a variant of
**"There you are"**, and tea/a blanket is offered — still appears in 4 of 5
outputs (Cases 1, 2, 3, 5; only Case 4 avoids the literal phrase, using
"Welcome along" / "You've come at a peaceful hour" instead). Previously this
ritual *was* the entire story regardless of prompt; now it is grafted onto
the correct scenario as connective tissue, which is a real improvement, but
it is still a generic, cross-case-recurring beat rather than something
specific to each prompt. None of the 5 protagonists are named (all are "the
traveler" / "you"); the old pipeline, by contrast, names a protagonist in
every case (Mara, Elias) — though it reuses that same small pool of names
(Mara/Elias/Tomas/Lena) across its own 5 cases too, so naming specificity is
a difference in degree, not a defect unique to Creative Intelligence.

## 6. Sleep Story identity check (Creative Intelligence outputs)

| Case | External world | Gentle movement | No urgency/suspense/escalation | Gradual settling | Explicit "Good night." close |
|---|:---:|:---:|:---:|:---:|:---:|
| 01 Cozy Cottage | ✅ (indoor cottage) | ✅ | ✅ | ✅ | ❌ (trails off in ellipsis) |
| 02 Valley Under Stars | ✅ | ✅ | ✅ | ✅ | ❌ (ends mid-sentence-style, no ellipsis but no "Good night.") |
| 03 Snowy Mountain Train | ✅ | ✅ | ✅ | ✅ | ❌ (trails off in ellipsis) |
| 04 Fantasy Village | ✅ | ✅ | ✅ | ✅ | ❌ (trails off in ellipsis) |
| 05 Ocean Journey | ✅ | ✅ | ✅ | ✅ | ❌ (trails off in ellipsis) |

All 5 Creative Intelligence outputs pass every safety/pacing property (no
conflict, no danger, no rushed transitions, genuine settling into stillness
or sleep). The one **consistent, new observation** across all 5: none of
them end with an explicit "Good night." (or equivalent direct closing
line) — every one trails off with an ellipsis or a lingering
present-tense image instead. All 5 old-pipeline outputs, by contrast, end
with a plain "Good night." on its own line. This wasn't scored as a defect
in 8.10J's rubric, but it's a real difference in closing convention worth a
product decision either way (trailing-off can work for sleep content, but
it is a departure from the old pipeline's convention and from the
evaluation criterion "ending quality" used in the 8.10 calibration series).

## 7. Duplicated beats and companion-identity drift (within a single story)

- **Case 1 (cozy cottage)** is the clear outlier: the "traveler arrives at
  the cottage" beat is restaged 3–4 times with near-identical phrasing
  across the piece's 5 segments, and the ending explicitly hedges on who (or
  what) the companion even is ("Perhaps a small cat..."). This is the same
  category of defect 8.10J found (duplicated arrival beat, unstable
  companion), and it is arguably *worse* here (4 restagings vs. 8.10J's 2) —
  likely because this prompt's own scenario (a cottage) overlaps with the
  writer's stock default, so the model has no signal telling it not to keep
  re-approaching the same template beat.
- **Case 3 (train)** shows a related but distinct issue: no single beat is
  duplicated, but the "companion" character is not continuous — a different
  unnamed seatmate/companion effectively appears fresh in 3 of the 5
  segments.
- **Cases 2, 4, 5** do not show duplicated arrival beats and keep a single,
  stable companion (or none) through the piece.

## 8. Old vs. Creative Intelligence summary

| Dimension | Old pipeline | Creative Intelligence (this run) |
|---|---|---|
| Sleep Story identity | Strong — 5 distinct, concrete, external worlds | Strong — no conflict/urgency/escalation in any of the 5 |
| Prompt fidelity / scenario preservation | Strong — every case matches its prompt | **Now strong** — all 5 cases build the correct, distinct scenario (fixed from 8.10J, where 4/5 collapsed and 1/5 lost its scenario entirely) |
| Cross-case genericness | Minimal | Reduced but not gone — a stock "traveler + companion + 'There you are' + tea/blanket" arrival ritual recurs in 4/5 cases as connective tissue |
| Within-story duplication | None found | Case 1 restages its arrival beat 3–4 times; not present in Cases 2–5 |
| Companion identity stability | Strong, named, consistent | Mixed: stable in Cases 2, 4, 5; unstable/hedged in Case 1; discontinuous (different companion per scene) in Case 3 |
| Ending convention | Consistent explicit "Good night." | No case ends with "Good night." — all trail off instead (new observation, not previously scored) |
| Duration accuracy (target 20 min) | Consistently under target (−6% to −16.5%) | Consistently and more severely over target (+14% to +47.5%) — worse overshoot than 8.10J's already-flagged +12.5%–36% range |
| storyScale variety | N/A | Still `gentle_journey` for all 5 regardless of prompt (unchanged from 8.10J, out of this fix's scope) |

## 9. Did `creativeDirection` solve the original failure?

**Yes, for its stated scope.** The original RP-011C.8.10J failure was: "the
Creative Intelligence intent/planning layer is not carrying the user's
specific requested scenario into the generated story for sleep-story
prompts," with Case 3 (valley/stars) as the clearest evidence, losing the
scenario outright. In this run, `creativeDirection` is present and matches
the verbatim prompt in all 5 cases, and — more importantly — the *generated
prose* now visibly follows it: the valley/stars scenario is preserved, the
train/snow scenario is preserved and does not degrade into a cottage story,
and the fantasy village and coastline scenarios are both well-matched. The
core defect the fix targeted is resolved.

## 10. Remaining blockers before Sleep Story production readiness

1. **Duration overshoot is unresolved and got worse.** CI now overshoots
   the 20-minute target by +14% to +47.5% (vs. 8.10J's +12.5% to +36%),
   while the old pipeline stays within −6% to −16.5%. This is a pacing/
   length-control gap independent of `creativeDirection` and should be
   addressed before shipping this preset.
2. **The generic arrival-ritual template still recurs across 4 of 5 cases**
   ("traveler" + "companion"/"host" + "There you are" + tea/blanket), now as
   connective tissue layered onto the correct scenario rather than
   replacing it outright. It's a smaller defect than 8.10J's full collapse,
   but it means outputs are still recognizably from the same underlying
   template rather than being fully bespoke to each prompt.
3. **Case 1 (cozy cottage) still duplicates its arrival beat 3–4 times** and
   ends with the writer visibly unable to commit to who/what the companion
   is. Prompts whose requested scenario overlaps with the writer's stock
   default appear to trigger this more than prompts with a clearly
   different setting (train, coast, village) — worth investigating whether
   scene planning is deduplicating against the *scenario* or only against a
   structural label, as 8.10J's finding #3 suspected.
4. **No case produces a stable companion across the entire story except
   Cases 2, 4, and 5.** Case 3 in particular introduces a new unnamed
   companion in most segments rather than carrying one character through.
5. **No output ends with an explicit "Good night."** (or equivalent),
   unlike the old pipeline's consistent closing line. This is a new
   observation from this run, not previously scored — worth a deliberate
   product decision on whether the ellipsis/trailing-off style is
   acceptable for Sleep Story's identity, since the calibration series
   scored "ending quality" as a first-class criterion.
6. **No protagonist is ever named** in Creative Intelligence output (always
   "the traveler"/"you"), a smaller specificity gap relative to the old
   pipeline's named protagonists (though the old pipeline's own name pool is
   itself narrow and reused across cases).

**Recommendation**: the specific defect this benchmark targeted
(`creativeDirection` not reaching the writer) is fixed and verified. Sleep
Story is closer to production-ready than at 8.10J, but duration control and
the residual generic arrival-ritual/companion-continuity issues (items 1–4
above) should be addressed, and the ending-convention question (item 5)
resolved deliberately, before considering this preset fully ready for
pipeline integration.
