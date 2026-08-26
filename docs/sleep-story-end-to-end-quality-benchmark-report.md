# RP-011C.8.10J — Sleep Story End-to-End Quality Benchmark Report

Live comparison of the old generation pipeline (`lib/script-builder-openai.ts` /
`lib/narrative/orchestrator.ts`) vs. the Creative Intelligence pipeline
(`lib/creative-intelligence/orchestration`) for the **sleep-story** preset,
run after the completed RP-011C.8.10 calibration series (Knowledge Foundation,
Planning, Scene, Guidance, Evaluation, Writer calibration).

No implementation files were modified. Benchmark harness and case files only.

---

## 1. Cases completed

All 5 cases ran successfully through both pipelines in live mode (10 real
OpenAI generation calls, no failures):

| # | Case ID | Scenario |
|---|---|---|
| 1 | `sleep-story-e2e-01-cozy-familiar-place` | Cozy Familiar Place |
| 2 | `sleep-story-e2e-02-gentle-companion` | Gentle Companion |
| 3 | `sleep-story-e2e-03-nature-exploration` | Nature Exploration |
| 4 | `sleep-story-e2e-04-soft-fantasy-world` | Soft Fantasy World |
| 5 | `sleep-story-e2e-05-classic-bedtime-story` | Classic Bedtime Story |

Harness: `scripts/run-sleep-story-end-to-end-quality-benchmark.ts` (new,
benchmark-only script, reuses the existing unmodified
`scripts/narrative-benchmark/**` adapters/runner). Dry-run validation was
executed first (`--dry-run`, all 10 adapter calls validated cleanly), then the
live run (`CONFIRM_LIVE_BENCHMARK=true ... --live`).

## 2. Output locations

```
benchmark-output/sleep-story-end-to-end-quality-benchmark-2026-08-16T18-59-13-811Z/
  sleep-story-e2e-01-cozy-familiar-place/{old.txt, creative-intelligence.txt, metadata.json}
  sleep-story-e2e-02-gentle-companion/{...}
  sleep-story-e2e-03-nature-exploration/{...}
  sleep-story-e2e-04-soft-fantasy-world/{...}
  sleep-story-e2e-05-classic-bedtime-story/{...}
```

## 3. Metadata table

| Case | Pipeline | Words | Chars | Est. minutes | Target | Overshoot/Undershoot | Gen time |
|---|---|---:|---:|---:|---:|---:|---:|
| 01 Cozy Familiar Place | old | 2,563 | 13,830 | 17.1 | 20 | −14.5% | 69.8s |
| 01 Cozy Familiar Place | creative-intelligence | 3,752 | 20,834 | 25.0 | 20 | +25.0% | 78.1s |
| 02 Gentle Companion | old | 2,686 | 14,655 | 17.9 | 20 | −10.5% | 77.9s |
| 02 Gentle Companion | creative-intelligence | 4,076 | 22,501 | 27.2 | 20 | +36.0% | 81.6s |
| 03 Nature Exploration | old | 2,545 | 13,824 | 17.0 | 20 | −15.0% | 70.2s |
| 03 Nature Exploration | creative-intelligence | 3,377 | 18,463 | 22.5 | 20 | +12.5% | 68.2s |
| 04 Soft Fantasy World | old | 2,671 | 14,568 | 17.8 | 20 | −11.0% | 76.9s |
| 04 Soft Fantasy World | creative-intelligence | 3,851 | 21,307 | 25.7 | 20 | +28.5% | 83.5s |
| 05 Classic Bedtime Story | old | 2,667 | 14,313 | 17.8 | 20 | −11.0% | 81.7s |
| 05 Classic Bedtime Story | creative-intelligence | 3,561 | 19,571 | 23.7 | 20 | +18.5% | 72.6s |

Creative Intelligence's own deterministic-structural evaluator scored 4 of 5
cases **"strong" (1.0/1.0)** and one **"acceptable" (0.917)** — see §7 for why
these scores should not be trusted as a proxy for real quality here.

## 4. Case-by-case comparison

**Case 1 — Cozy Familiar Place** (prompt: arriving at a cottage in the forest,
exploring warm rooms, settling in for the night — no companion or traveler
specified).

- *Old*: Mara drives to a rented forest cottage, is met by the caretaker Mrs.
  Holloway, gets a specific, sense-rich tour (tea, apple cake, a sticking
  window latch, an iron door key, a creaky porch board), and settles into bed.
  Concrete, prompt-specific, single coherent scene sequence.
- *Creative Intelligence*: Opens on an unnamed "traveler" arriving at a garden
  gate, greeted by a companion/host with "There you are," tea by the hearth,
  a garden wander, then bed. The prose is smooth and calm in isolation, but
  the "traveler + gate + garden + companion" frame is not what the prompt
  asked for (a solo cottage exploration) — and, as detailed in §7, this exact
  scaffolding recurs almost verbatim in every other case regardless of prompt.
  The document also narrates the *same arrival beat twice* in immediate
  succession (paragraphs 1–31 and 33+ both restage "traveler reaches gate →
  garden → host says 'There you are' → tea by hearth").

**Case 2 — Gentle Companion** (prompt: listener follows a kind traveler who
finds a welcoming place to rest).

- *Old*: Mara walks a country road, is directed by a passing carter to a
  "lantern house," and is welcomed into a full household (Arden, Elsie, Lena,
  Jonah) with a warm communal supper and specific in-world lore (a disused
  millstream, a lantern-for-travelers custom). Companion warmth is earned
  through concrete social detail, and there is genuinely no conflict.
  Excellent match to the case's evaluation targets.
- *Creative Intelligence*: This is the one prompt where CI's default
  "traveler arrives at cottage, companion says 'There you are'" template is
  actually the requested scenario — but it is executed almost identically to
  Case 1's and Case 3's CI output (see §7), and it repeats the arrival beat
  across two consecutive scenes again, and the companion's nature drifts
  mid-story (mending human by the hearth → later a cat/animal-like presence
  that "murmurs," ear lifting → later ambiguous again). No dependency, no
  conflict — those checks pass — but the companion is not a stable, single
  identity across the piece.

**Case 3 — Nature Exploration** (prompt: slowly walking through a peaceful
valley at dusk, noticing nature, resting beneath the stars — explicitly no
cottage or companion mentioned).

- *Old*: Excellent, faithful match. Mara walks downhill through a valley at
  dusk, meets a shepherd (Mr. Fen) and a beekeeper (Lina) who each offer a
  small piece of practical, character-driven guidance, crosses a footbridge,
  and lies down on open ground to fall asleep watching the stars come out.
  Movement is unhurried throughout; the sleep transition (lying down, feeling
  the walk leave her legs, watching stars appear one by one) is the strongest
  of all 10 outputs in this benchmark.
- *Creative Intelligence*: **This is the most serious defect found.** The
  output ignores the prompt almost entirely — there is no valley, no dusk
  walk, no stream crossing, and, most notably, no stars or outdoor sleep at
  all. Instead it produces the same cottage/gate/companion/hearth/bed template
  as Cases 1, 2, and 4. A user who asked for an outdoor stargazing walk would
  receive an indoor cottage-and-tea story instead.

**Case 4 — Soft Fantasy World** (prompt: visiting a quiet village where
friendly characters welcome the traveler and prepare a place to sleep).

- *Old*: Mara arrives at "Willowmere," met by lantern-bearer Tovin, who
  introduces her to innkeeper Nella and her sister Elsi. Light, warm
  worldbuilding (green-glass lanterns, copper bells, a village square) without
  any adventure pressure. Strong match to the "fantasy without adventure
  pressure" and "worldbuilding" targets.
- *Creative Intelligence*: Once again opens on "the gentle traveler reached
  the little gate," a cottage, and a companion saying a variant of "There you
  are" / "You've come at a gentle hour." There is a village-adjacent framing
  later in the piece, but the core template and phrasing are shared almost
  word-for-word with Cases 1–3. Worldbuilding is present but generic (mint,
  rosemary, pear tree, lantern — the same props recur across every case).

**Case 5 — Classic Bedtime Story** (prompt: a traditional bedtime story with a
gentle journey, comforting characters, a quiet ending).

- *Old*: Mara carries letters to her aunt in "Bracken Hollow," with a very
  mild framing mystery (a lantern seen nightly on an old path) that resolves
  warmly (Sella Wren, a family connection) rather than dramatically. This is
  the one old-pipeline case worth watching: the "mystery" framing introduces
  a soft curiosity hook ("who carries the lantern, and why") that is closer
  to narrative device than pure sleep-story stillness, though it never
  escalates into danger or suspense and resolves gently.
- *Creative Intelligence*: Same recurring cottage/traveler/companion template
  as Cases 1–4.

## 5. Old vs. Creative Intelligence summary

| Dimension | Old pipeline | Creative Intelligence |
|---|---|---|
| Sleep Story identity (external world, drift-into-able) | Strong — five distinct, concrete worlds | Weak — one recycled interior scene across 4 of 5 cases |
| Prompt fidelity | Strong — every case reflects its specific prompt | Poor — Case 3 (valley/stars) receives a cottage/tea story; Cases 1, 2, 4 converge on the same beats |
| Narrative drift (conflict/danger/urgency) | None found; Case 5's "lantern mystery" is a mild curiosity hook, not danger | None found |
| Character quality | Strong, named, specific companions with in-world roles | Present but generic ("the traveler," "a companion," "a host"); companion identity drifts within a single output in Cases 1–2 |
| Sleep compatibility / pacing | Strong; Case 3 in particular nails the sleep transition | Generally calm and non-demanding in isolation, undermined by cross-case repetition and duration overshoot |
| Generic AI patterns | Minimal | Significant: near-identical opening/closing scaffolding reused verbatim across unrelated prompts; duplicated arrival beat within a single story (Cases 1, 2) |
| Duration accuracy (target 20 min) | Consistently under target (−10% to −15%) | Consistently over target (+12.5% to +36%), matching the overshoot pattern previously seen in the ASMR benchmark |
| Automated self-evaluation | N/A (old pipeline has no evaluator) | Overconfident — scores 4/5 "strong" (1.0) despite the cross-case genericness described above |

## 6. Strengths

- **Old pipeline**: All 6 planning/scene/guidance/evaluation/writer
  calibrations are not directly exercised here (they target CI), but the old
  pipeline continues to reliably produce prompt-faithful, sensorially specific,
  low-conflict sleep stories with named, distinct characters and clean,
  peaceful endings across all 5 scenarios.
- **Creative Intelligence, within a single output**: Sentence-level prose
  quality is genuinely good — calm, unhurried, sensorially warm, no
  detectable danger/urgency/twist, and endings consistently trail off into
  soft closure rather than a punchline or stated moral (matching the
  Sleep Story Identity and Sleep Compatibility checks the calibration series
  targeted). The deterministic evaluator's per-story checks (ending quality,
  movement without urgency, companions-as-warmth, sleep transition arc) are
  each individually well-designed and did correctly pass on real generated
  text, not just placeholders.

## 7. Remaining defects

1. **Prompt-specific scenario is not reaching the writer.** All 5 CI
   `intent` objects collapse to the same shape regardless of prompt content:
   `genre: "comfort"`, `themes: ["comfort"]` (or `["curiosity"]`),
   `storyScale: "gentle_journey"`, `narrativeFocus: "comfort_and_safety"`,
   and — critically — `creativeDirection` is **absent** in every one of the 5
   cases (`creativeDirectionPresent: false`). `creativeDirection` is the
   documented verbatim-preservation field for "a specific roleplay scenario,
   persona, or activity" from the user's request
   (`lib/creative-intelligence/core/types.ts:50-57`). Because it's never
   populated for sleep-story prompts, the planning/writer layers have no
   signal distinguishing "explore a forest cottage alone," "follow a
   traveler," "walk a valley at dusk and sleep under stars," and "visit a
   fantasy village" — all four collapse into the same generic
   traveler-arrives-at-a-cottage-with-a-companion template. This is the root
   cause of the near-duplicate output across Cases 1, 2, 3, and 4.
2. **Case 3 in particular loses the user's explicit scenario entirely** — no
   valley, no dusk walk, no stars, no outdoor sleep — replaced by an indoor
   cottage/tea scene. This is the single clearest quality regression relative
   to the old pipeline found in this benchmark.
3. **Within-story duplication of the arrival beat.** Cases 1 and 2 narrate
   "traveler reaches a gate → crosses a garden → companion/host says a
   variant of 'There you are' → tea by the hearth" twice in immediate
   succession, as two separate planned scenes, rather than progressing to new
   content. The evaluator's `scene_purpose` criterion passed both cases
   ("every scene has its own, non-duplicated purpose") — it checks the
   planned scene's structural purpose label, not whether the generated prose
   actually differs, which is a gap between the automated check and the
   actual reader experience.
4. **Companion identity is unstable within a single generated story.** In
   Cases 1 and 2, the companion reads as an unambiguous human host early on
   (mending, cardigan, pours tea, speaks in full sentences) and later reads
   as animal-like (an "ear lifted," "drowsed on a rug," "murmured") without a
   clear transition — likely a side effect of the writer regenerating the
   companion per-scene without carrying forward a stable character
   description.
5. **Duration overshoot persists**, consistent with the pre-existing ASMR
   benchmark finding: CI overshoots the 20-minute target by 12.5%–36% across
   all 5 cases (vs. the old pipeline's more consistent 10–15% undershoot).
   The calibration series does not appear to have closed this gap for
   sleep-story.
6. **The deterministic-structural evaluator is not a reliable quality gate
   for this failure mode.** It scored 4/5 outputs "strong" (1.0) and the
   worst offender (Case 1, with the duplicated arrival beat) only lost points
   for a single stock phrase ("somehow"). None of its criteria can detect
   "this output ignored the user's specific scenario" or "this output is
   nearly identical to the output for a different prompt," because it only
   evaluates a single story's structure in isolation.
7. **Minor**: one stock explanatory phrase flagged by CI's own evaluator in
   Case 1 ("somehow").

## 8. Recommendation

**Needs further calibration — not ready for pipeline integration for the
sleep-story preset.**

The per-scene prose quality, tone, and safety properties that the six
completed calibration passes targeted (ending quality, movement without
urgency, sleep transition arc, companions-as-warmth, absence of narrative
escalation) are genuinely present and generally strong when a single CI
output is read in isolation. But the calibration series has not addressed —
and this benchmark did not previously surface, because prior reviews compared
single cases rather than 5 different prompts side by side — a more
fundamental gap: **the Creative Intelligence intent/planning layer is not
carrying the user's specific requested scenario into the generated story for
sleep-story prompts.** Four of five cases converge on the same
cottage-arrival-with-companion template regardless of what was actually
asked, and one case (the valley/stars prompt) loses the requested scenario
entirely. This is a Sleep Story Identity and prompt-fidelity defect the
automated evaluator cannot see, and it would be immediately visible to any
real user who generated more than one Sleep Story.

Suggested next step: extend the sleep-story intent extractor to populate
`creativeDirection` (or an equivalent scenario-preservation signal) from the
user's prompt, the same mechanism already documented for other presets, and
re-run this benchmark before considering pipeline integration.
