# RP-011C.8.10U — Sleep Story Final End-to-End Quality Rebenchmark

Final live comparison of the old generation pipeline
(`lib/script-builder-openai.ts` / `lib/narrative/orchestrator.ts`) vs. the
Creative Intelligence pipeline (`lib/creative-intelligence/orchestration`)
for the **sleep-story** preset, after the full RP-011C.8.10P →
RP-011C.8.10T calibration sequence (scenario-aware defaults, planning
calibration, writer compliance, protagonist calibration, deterministic word
budget).

Goal: decide whether Sleep Story Creative Intelligence output is
production-ready, measured on creativeDirection preservation, scenario
fidelity, recurrence of the RP-011C.8.10M default-bias markers,
named-protagonist preservation, cross-scene continuity, ending quality,
ellipsis usage, and duration accuracy against the *current* production word
budget.

**This is a benchmark/analysis task only. No implementation files were
modified. No fixes were made. No commits. The live run was not repeated.**

---

## 1. Benchmark setup

Script: `scripts/run-sleep-story-end-to-end-quality-final-rebenchmark.ts`.
It reuses `OldPipelineAdapter` / `CreativeIntelligenceAdapter` and
`runCaseThroughAdapters` from `scripts/narrative-benchmark/**` unmodified,
supplies its own 7-case list (not added to the shared `cases/index.ts`
registry), and touches no adapter, classifier, writer prompt, guidance, or
template.

**Provenance note:** the script was authored and the live run executed by a
prior agent instance, which exited before writing this report. This document
is a fresh analysis of the completed artifacts on disk — all 14 output files
(7 cases × 2 pipelines) plus per-case metadata were read in full. The live
run was **not** re-executed; no additional OpenAI spend was incurred.

Completed live-run output directory:

```
benchmark-output/sleep-story-end-to-end-quality-final-rebenchmark-2026-08-17T14-40-13-217Z/
```

containing, per case, `old.txt`, `creative-intelligence.txt`, and
`metadata.json`. All 14 generations completed successfully (every
`metadata.json` carries a non-null `durationMs` and, for CI, a populated
`intent` and `evaluation` object). CI ran `writerMode: "provider"`,
`version: 1.0.0`, `sceneCount: 5` for all 7 cases.

Cases (prompt wording is exact and must not be edited):

| # | Case ID | Prompt |
|---|---|---|
| 1 | `sleep-story-final-01-cozy-cottage` | "A cozy bedtime story about a small cottage in the woods where someone spends a peaceful evening." |
| 2 | `sleep-story-final-02-valley-under-stars` | "A peaceful bedtime story about walking through a quiet valley beneath the stars." |
| 3 | `sleep-story-final-03-train-conductor` | "A cozy sleep story about a train conductor traveling through snowy mountains." |
| 4 | `sleep-story-final-04-lighthouse-keeper` | "A calming bedtime story about a lighthouse keeper watching over the coast during a quiet night." |
| 5 | `sleep-story-final-05-ocean-journey` | "A gentle sleep story about drifting along a peaceful ocean under moonlight." |
| 6 | `sleep-story-final-06-generic-sleep-story` | "A relaxing sleep story to help me fall asleep." |
| 7 | `sleep-story-final-07-fantasy-village` | "A bedtime story about a quiet magical village hidden between ancient trees." |

**Words-per-minute methodology — verified correct.** The script declares
`SLEEP_STORY_WORDS_PER_MINUTE = 135`
(`run-sleep-story-end-to-end-quality-final-rebenchmark.ts:157`) and this
matches production: `PRESET_WORDS_PER_MINUTE["sleep-story"] = 135` in
`lib/creative-intelligence/guidance/duration-budget.ts:22`, which is the
value `computeWordBudget()` actually multiplies by
`intent.durationMinutes`. The script mirrors rather than imports the
constant, following the same "mirror, don't import" convention that module
itself documents, so the benchmark stays free of any
`lib/creative-intelligence` dependency. It additionally records a legacy
150-wpm estimate (`legacyEstimatedMinutes`) purely for back-comparison with
RP-011C.8.10J/Q, which used that rougher rate. All over/undershoot figures
in this report are computed at **135 wpm**, and RP-011C.8.10Q's word counts
have been **recomputed at 135 wpm** in §4 so the regression comparison is
apples-to-apples.

## 2. Metadata table

All figures at 135 wpm against a 20-minute target.

| Case | Pipeline | Preset | CD? | `hasExplicitScenario` | `storyScale` | Words | Chars | Est. min | Over/Undershoot | Gen time |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|
| 01 Cozy Cottage | old | sleep-story | false | — | — | 2,529 | 13,565 | 18.7 | −6.5% | 85.6s |
| 01 Cozy Cottage | creative-intelligence | sleep-story | **true** | true | gentle_journey | 2,965 | 16,131 | 22.0 | +10.0% | 69.2s |
| 02 Valley Under Stars | old | sleep-story | false | — | — | 2,539 | 13,806 | 18.8 | −6.0% | 86.8s |
| 02 Valley Under Stars | creative-intelligence | sleep-story | **true** | true | gentle_journey | 2,847 | 15,798 | 21.1 | **+5.5%** | 71.4s |
| 03 Train Conductor | old | sleep-story | false | — | — | 2,284 | 12,354 | 16.9 | −15.5% | 100.4s |
| 03 Train Conductor | creative-intelligence | sleep-story | **true** | true | gentle_journey | 3,195 | 17,594 | 23.7 | **+18.5%** | 73.9s |
| 04 Lighthouse Keeper | old | sleep-story | false | — | — | 2,497 | 13,632 | 18.5 | −7.5% | 89.4s |
| 04 Lighthouse Keeper | creative-intelligence | sleep-story | **true** | true | gentle_journey | 3,065 | 16,875 | 22.7 | +13.5% | 72.9s |
| 05 Ocean Journey | old | sleep-story | false | — | — | 2,341 | 12,610 | 17.3 | −13.5% | 98.1s |
| 05 Ocean Journey | creative-intelligence | sleep-story | **true** | true | gentle_journey | 3,001 | 16,318 | 22.2 | +11.0% | 69.9s |
| 06 Generic (control) | old | sleep-story | false | — | — | 2,648 | 14,258 | 19.6 | −2.0% | 86.0s |
| 06 Generic (control) | creative-intelligence | sleep-story | **true** | **true** ⚠ | gentle_journey | 3,115 | 16,927 | 23.1 | +15.5% | 68.9s |
| 07 Fantasy Village | old | sleep-story | false | — | — | 2,563 | 13,996 | 19.0 | −5.0% | 94.5s |
| 07 Fantasy Village | creative-intelligence | sleep-story | **true** | true | gentle_journey | 2,927 | 16,213 | 21.7 | +8.5% | 69.5s |

Aggregates: **old avg −8.0%** (range −15.5% … −2.0%); **CI avg +11.8%**
(range +5.5% … +18.5%). CI is consistently long, old is consistently short;
CI's spread is now 13 percentage points wide vs. old's 13.5 — comparable
dispersion, opposite sign.

`CD?` = `intent.creativeDirection !== undefined`. **All 7 CI cases carry
`creativeDirection` set to the byte-exact literal prompt** (verified
per-case against `metadata.json`), and `hasExplicitScenario: true`. The old
pipeline never populates these fields, so `false`/`—` there is expected, not
a regression.

⚠ **Case 06 classifier flag.** The control prompt — "A relaxing sleep story
to help me fall asleep." — contains no scenario whatsoever, yet resolved to
`hasExplicitScenario: true`, the identical signal value as the six
scenario-anchored cases. This reproduces the exact classifier
over-inclusiveness that
`docs/sleep-story-protagonist-calibration-live-validation-report.md` §6/§7.1
flagged and is discussed in §5.2. Practical consequence: in this sample
`hasExplicitScenario` has **zero discriminating power** (7/7 true), so it
cannot be the mechanism suppressing the default template in cases 1–5 and 7.

CI's own deterministic-structural evaluator: **5 of 7 "strong" (1.0)**,
2 "acceptable" (0.917) — case 03 docked for the stock phrase "somehow"
(2 literal occurrences), case 04 docked for "he felt". See §5.5 for why
these scores should not be treated as a quality gate.

## 3. Case-by-case comparison

Literal marker counts, word-boundary matched, for every output:

| Case | Pipe | `companion(s)` | `There you are` | `cottage(s)` | `hearth(s)` | `tea` | `travel(l)er(s)` | `welcom*` | `arriv*` | `...` |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01 Cottage | old | 0 | 0 | 13 | 4 | 10 | 0 | 0 | 0 | 0 |
| 01 Cottage | CI | 0 | 0 | 20 | 17 | 0 | 0 | 1 | 0 | 0 |
| 02 Valley | old | 0 | **1** | 0 | 0 | 3 | 0 | 0 | 1 | 0 |
| 02 Valley | CI | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 03 Train | old | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| 03 Train | CI | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| 04 Lighthouse | old | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04 Lighthouse | CI | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| 05 Ocean | old | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 1 | 0 |
| 05 Ocean | CI | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 06 Generic | old | **1** | **1** | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| 06 Generic | CI | 0 | 0 | 0 | 0 | 0 | **42** | 0 | 1 | 0 |
| 07 Village | old | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| 07 Village | CI | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Two headline reads from this table before the prose analysis:

- **`companion` = 0 in all 7 CI outputs and `There you are` = 0 in all 7 CI
  outputs.** The only occurrences anywhere in the benchmark are in the *old*
  pipeline (case 02's Tomas greets Mara with "There you are"; case 06 uses
  "companionable"). The M-era markers are now exclusively an old-pipeline
  artifact.
- **Literal `...` = 0 in all 14 outputs** (Unicode `…` also 0). There is no
  ellipsis-as-trailing-off crutch in either pipeline. This measure is clean
  and needs no further tracking.

---

**Case 1 — Cozy Cottage.** *Prompt: small cottage in the woods where someone
spends a peaceful evening.*

- *Old*: Mara arrives at the cottage before dusk, lights the stove to test
  whether the chimney draws, is visited by a village cat and then by Mrs.
  Bell (who forgot the honey); they share onion-and-cheese toast and tea,
  Mrs. Bell leaves, Mara sleeps under the eaves. Named characters, concrete
  props, real dialogue, a small stated task ("tell her whether the chimney
  still drew properly") resolved without tension.
- *CI*: A five-scene cottage atmosphere piece — kettle, lamp, book, shawl,
  rosemary in a clay pot, fire laid and lit, wool wrap over the knees,
  ending asleep in the chair by the hearth. **Scenario fidelity: full.**
  `cottage` ×20 and `hearth` ×17 are the highest in the benchmark, but this
  is the one prompt that *asked* for a cottage — fidelity, not bias.
  `tea` = 0 (the drink is "the warm herbal drink"), `companion` = 0,
  "There you are" = 0.
- **Protagonist is dissolved.** The prompt's "someone" becomes "The one
  spending the evening there" (×1) and then "the person" (×14), with heavy
  agentless passive: "A cup was taken down from a shelf... Water was poured...
  The cup was carried to the table in both hands." Zero he/she pronouns.
  This is discussed as the run's main residual defect in §5.1.
- Continuity: consistent (same room, chair, hearth, cup, book, shawl, wrap
  tracked correctly across all five scenes; the cup is rinsed in scene 3 and
  correctly stays "upside down on its cloth" in scenes 4–5). Ending: soft
  trail-off, no moral.

**Case 2 — Valley Under Stars.** *Prompt: walking through a quiet valley
beneath the stars.*

- *Old*: Mara descends into the valley to meet her brother Tomas at a
  shepherd's hut; they fix a lantern wick, light the stove, share dried
  apple slices and tea, and find their childhood names carved by the door
  ("MARA. TOMAS.") before sleeping in the bunks. Warm, specific, faithful to
  valley + stars, though it moves indoors for its back half.
- *CI*: Five scenes of continuous outdoor walking — pale path, low grasses,
  stream, wildflowers, thyme, reeds, moss-topped stones, moonlight bands —
  ending with the walk coming to rest beside a widened bank of thick grass.
  Present tense throughout. `valley` ×29, `star` ×14, `moonlight` ×10;
  **zero `cottage`, `hearth`, `tea`, `companion`, "There you are"**. The
  single `arriv*` hit is not an arrival beat. **This was RP-011C.8.10M's
  worst regression (the valley prompt replaced entirely by an indoor
  cottage/tea scene); it does not reproduce, and stays outdoors for all five
  scenes** — a stricter result than the old pipeline, which goes indoors.
- **No protagonist noun at all.** The grammatical subject is "the walk"
  ("The valley is already quiet when the walk begins", "The walk eases",
  "At length the walking comes to rest"). Zero he/she/you. See §5.1.
- Continuity: consistent (path/stream/hills/stars recur without
  contradiction). Ending: soft trail-off.

**Case 3 — Train Conductor.** *Prompt: a train conductor traveling through
snowy mountains.*

- *Old*: Jonah Bell works the mountain line carrying a package to Alder
  Pass; he finds Mara Wynn's blue cloth tied to a retaining pin, learns from
  Leo and engineer Cora that she engineered a reason for him to come inside,
  and ends drinking coffee with her, her hand resting on his. Named,
  warm, romantic — but note it is built on a *mystery* beat (the unexplained
  cloth, the withheld answer) and has a small continuity fault of its own:
  the porter is introduced as **Edwin**, then the same conversational thread
  is answered by **Leo** at line 45 with no introduction.
- *CI*: **The role identity holds.** `conductor` ×60, sustained as the
  protagonist from the first sentence to the last, never displaced by a
  generic traveler (`travel*` = 0). Five scenes of rounds through the
  carriages: ticket pouch, turned-down lamps, a snug outer latch, a child's
  mittens drying by the radiator, the dining-car stove and humming kettle,
  brief warm exchanges with the porter ("'Quiet tonight,' the porter said.
  'Yes,' said the conductor. 'A good kind of quiet.'"), ending with the
  conductor dozing in the end-carriage seat. `train` ×27, `snow` ×23. No
  danger, no urgency, no arrival ritual. The single `cottage` hit is distant
  scenery seen from the window — "small lamps from far cottages shone like
  patient, waiting stars" — not an interior, not entered.
- **Prose artifact:** the conductor is given a role identity but no name and
  **no pronouns at all** — the writer routes around gender with body-part and
  possessive constructions: "the conductor's coat", "the face", "the gloved
  hand", "coat settling with a faint, comfortable weight", "as naturally as
  if the motion belonged to the body itself". The only 6 `he/his` hits in
  this output all refer to the *porter*, who does get a pronoun. Also the
  source of the evaluator's "somehow" ding (×2).
- Continuity: consistent, and notably good — the mittens are tracked as a
  running prop across four scenes (warm → dry → cuffs turned to face the
  same direction → "dry and waiting for morning"). Ending: soft trail-off,
  "The conductor did not rise again."

**Case 4 — Lighthouse Keeper.** *Prompt: a lighthouse keeper watching over
the coast during a quiet night.*

- *Old*: **The old pipeline escalates into a rescue.** Elias Ward's wireless
  fails, fog closes the shoal, Nora Bennett climbs the tower, they hear a
  boat "feeling their way", start the fog bell, shout instructions into the
  dark ("Hold for the bell, then come west of the second lamp"), and a voice
  cries "Light!" from the fog before Ben Coyle's launch reaches safe water.
  This directly violates the case's "no storm/rescue/danger escalation"
  expectation. It is warm, well-written, and wrong for a sleep story — the
  middle third is a tension sequence. *(Formatting bug: `old.txt` emits
  "Night settled around the lantern room." on line 1, then the title
  "Harbor Light" on line 3 — the title is misplaced after the opening line.)*
- *CI*: **The best-balanced output in the run.** `keeper` ×22 (2 as the full
  "lighthouse keeper"), and — uniquely in this benchmark — the keeper is
  carried by **ordinary pronouns**: `he/his/him` ×117. Five scenes of the
  lantern room: the turning lamp, brass rails, the logbook line written and
  the pen laid straight, a descent to the landing window, a crescent of old
  salt brushed with a handkerchief, the stool by the wall, a folded cloth
  laid over the knees, ending "the lighthouse keeper sat resting against the
  warm stone, hands quiet, while the lamp turned on." Solitude and quiet duty
  are preserved exactly; **no companion, no storm, no rescue, no danger.**
  The 4 `arriv*` hits are all the tide ("the waves arrived in small, regular
  folds", "the sea continued its soft arrival and retreat") — not a
  protagonist arrival beat.
- Continuity: consistent (logbook, folded cloth, stool, harbor, keeper's
  house all recur correctly; the cloth introduced on the shelf in scene 2 is
  the same cloth taken down over the knees in scene 5). Ending: soft
  trail-off. Source of the evaluator's "he felt" ding.

**Case 5 — Ocean Journey.** *Prompt: drifting along a peaceful ocean under
moonlight.*

- *Old*: Leo sails out with Mira to a bioluminescent patch, dolphins run
  alongside, and she reveals a ring of old buoys she and her brother built
  years ago; they drink tea on the small platform and drift home on the
  tide. Named, specific, emotionally warm — but eventful, with a mild
  suspense structure ("what is the one thing she wanted him to see") and a
  small revelation beat.
- *CI*: Five scenes of a boat rocking on moonlit open water — silver ribbon
  on the swell, folded blanket drawn over the legs, smooth salt-worn wood,
  the cool-at-the-rim / warm-within temperature contrast, the hull's soft
  creak. `ocean` ×8, `moonlight` ×11, `boat` ×46. **Zero `cottage`,
  `hearth`, `tea`, `companion`, "There you are"**; the 2 `arriv*` hits are
  not arrival beats. Fidelity is complete and there is no host/arrival
  pattern.
- **Protagonist is the most dissolved of the seven.** There is no character
  noun; the human presence exists only as detached anatomy — "the wood
  beneath the hands", "laid across resting legs", "the knuckles", "a hand
  resting near the seat", and one oblique "a place that had accepted the one
  who sat within it". Zero he/she/you.
- Continuity: consistent, at the cost of near-zero event — scenes 3, 4 and 5
  restate the same blanket/wood/moonlight/rocking inventory with diminishing
  variation. Ending: soft trail-off.

**Case 6 — Generic (intentional no-scenario control).** *Prompt: "A relaxing
sleep story to help me fall asleep."*

- *Old*: An invented, fully concrete scenario — Mara's three-errand evening
  in a rainy courtyard: returning Theo's blue scarf, a stray cat that has
  "hired" Theo to free a laundry line snagged on the gate latch, Mrs. Bell's
  running commentary, three bowls of onion-and-thyme soup on the covered
  bench. Charming and specific. It also contains the run's only old-pipeline
  bias markers: "There you are," Mara said (×1) and "companionable" (×1).
- *CI*: **The M-era default template, essentially verbatim.** Opening line:
  *"A gentle traveler moved along a narrow path that wound between low hedges
  and quiet fields"* — the literal "gentle traveler" role string
  RP-011C.8.10M identified as hardcoded. It then runs the full template
  sequence: path → **a simple wooden gate, standing slightly open** →
  garden with lavender and a watering can → **a cat on the mat that lifts its
  head "as if this meeting had been expected"** → **entry into a dim room**
  with lamp, chair, folded blanket, ticking clock → sits → sleeps in the
  chair. `traveler` ×42. Notably it still avoids the *worst* markers even
  here: `companion` = 0, "There you are" = 0, `cottage`/`hearth`/`tea` = 0,
  `welcom*` = 0 — there is no host and no greeting ritual, only an arrival
  into an empty room.
- **Judgement: acceptable for this case, but it changes what we can claim.**
  The task brief explicitly allows a template default here, and the *critical*
  test — does this template also appear in the six scenario-anchored cases —
  passes cleanly: `traveler` = 0 in cases 1–5 and 7, and the gate/arrival/
  cat/room sequence appears in none of them. So bias is genuinely confined
  to the no-scenario case.
  However, this proves the M-era template **still exists in the system** and
  is still the fallback; it has been *displaced* by concrete scenarios, not
  removed. And because `hasExplicitScenario` is `true` here too (⚠ in §2),
  the suppression in the other six cases cannot be attributed to that gate
  — it is the presence of concrete scenario content in the prompt doing the
  work. That is a weaker guarantee than "the gate prevents it," and it means
  a thin-but-nonempty prompt (e.g. "a calm story about resting") is untested
  and could plausibly land in the template.
- Continuity: consistent. Ending: soft trail-off.

**Case 7 — Fantasy Village.** *Prompt: a quiet magical village hidden
between ancient trees.*

- *Old*: Mara the baker walks to the hidden village; Old Elsin's blue lamp
  has cracked, and Mara, Toma and Nella help her hang dozens of glowing blue
  glass charms so the early-arriving bell-swallows can find their nests.
  Genuinely inventive worldbuilding (trunks "wide as cottages", windows in
  the bark, a bridge from one smooth branch), real magic with a payoff, no
  danger. Its one `welcom*` hit is incidental.
- *CI*: Five scenes touring the village at dusk — moss-soft round roofs,
  lantern posts, a mill wheel by a footbridge, covered market stalls with
  awnings tied down, tiny gardens of sage and mint, an arch of roots with
  lamps in niches, a bench by a pond, clay pots with new shoots, a pair of
  shoes left on a doorstep. `village` ×23. **Zero `traveler`, `companion`,
  `cottage`, `hearth`, `tea`, `welcom*`, `arriv*` — the cleanest marker
  profile in the benchmark, and no forced welcome-the-traveler ritual
  whatsoever.** No escalation, no quest.
- **Two fidelity gaps.** (a) No protagonist and no villagers: the prompt's
  village is inhabited only by inference — a curtain moves, a door closes
  "somewhere deeper among the houses", a window opens for a moment and lets
  out the scent of bread. It reads as a beautifully observed *empty set*.
  (b) The magic is essentially absent: `magic` appears once, and only as
  narration about the absence of change — *"Nothing else changed. That, too,
  was part of the village's quiet magic."* The prompt asked for a *magical*
  village; "gentle magic without spectacle" was the expectation, but this is
  below that floor. The old pipeline's bell-swallows are what the prompt
  actually invited.
- Continuity: consistent (pond, bench, bridge, wool cloth, stone wall all
  recur correctly; a second, narrower footbridge is introduced in scene 4
  without contradicting the first). Ending: soft trail-off.

## 4. Regression comparison against RP-011C.8.10Q (with notes on J/M)

Q's duration figures are recomputed here at 135 wpm from Q's own §3 word
counts, so the columns are directly comparable.

| Measure | RP-011C.8.10Q finding (5 cases) | RP-011C.8.10U finding (7 cases) | Verdict |
|---|---|---|---|
| `creativeDirection` reaches the writer | 5/5 present, verbatim | **7/7 present, byte-exact verbatim** | Held |
| Unconditional `companion` insertion | 0/5 outputs | **0/7 outputs** (only old-pipeline case 06 has "companionable") | Held |
| "There you are" arrival ritual | 0/5 outputs | **0/7 outputs** (only old-pipeline cases 02, 06) | Held |
| Cottage/tea/hearth bleeding into non-cottage prompts | Confined to case 1, which requested it | **Confined to case 1, which requested it.** Case 03's single `cottage` is distant scenery seen from a train window; `tea` = 0 in all 7 CI outputs (down from Q's cottage-case ×20) | Held / improved |
| Forced generic traveler role | 4/5 cases used "the traveler" | **1/7 cases** — only the no-scenario control (case 06, ×42). `travel*` = 0 in all six scenario-anchored cases | **Clearly improved** |
| Cross-case convergence on one template | 5/5 visibly distinct | **7/7 visibly distinct** props and sensory registers | Held |
| Valley/stars prompt losing its scenario (M's worst defect) | Not reproduced | **Not reproduced**; valley stays outdoors for all 5 scenes | Held |
| Named-role preservation (untested in Q; first tested in R1.5) | n/a | **2/2 role-naming prompts preserve the role** (conductor ×60, keeper ×22) with zero substitution. **0/7 get an actual name** | Partially improved |
| Protagonist presence (Q's residual finding) | Anonymous "the traveler" in 4/5 | **Worse in kind.** 4/7 cases (01, 02, 05, 07) have *no protagonist at all* — agentless passive or an inanimate grammatical subject. Q at least had a figure to follow | **Regressed** |
| Cross-scene continuity | Not evaluable in Q (no companion cases) | **7/7 clean.** No protagonist/setting/prop drift or contradiction found in any CI output; case 03 tracks a running prop (mittens) across 4 scenes correctly. The one continuity fault in the run is in the *old* pipeline (case 03: porter "Edwin" answered by "Leo") | Improved |
| Ending quality | Soft trail-offs 5/5, no moral/twist | **Soft trail-offs 7/7**, no moral, no twist, no abruptness | Held |
| Literal `...` usage | Not measured in Q | **0 in all 14 outputs** (and 0 Unicode `…`). No ellipsis crutch in either pipeline | Clean |
| Duration overshoot, CI (135 wpm) | +10.0% … **+61.0%**, avg **+35.5%** | **+5.5% … +18.5%, avg +11.8%** — and +10.7% avg across just the five Q-comparable scenarios | **Substantially improved** |
| Duration overshoot, old (135 wpm) | −3.5% … +0.5%, avg −0.9% | −15.5% … −2.0%, avg −8.0% | Old drifted shorter |
| `hasExplicitScenario` as a discriminating gate | 5/5 true (all cases had scenarios, so untested) | **7/7 true including the no-scenario control** — confirms R1.5's over-inclusiveness finding on a second independent sample | Open defect |
| Evaluator usefulness as a quality gate | 3 strong / 2 acceptable; blind to scenario fidelity | 5 strong / 2 acceptable; **additionally shown to be blind to protagonist absence** (see §5.5) | Still unreliable |

Relative to **RP-011C.8.10J/M**: every one of the five original M-era bias
markers is now either zero in scenario-anchored output or confined to the
prompt that requested it, and M's headline duration finding (+12.5%…+36%,
avg +24.1% at the then-current rate) is now +5.5%…+18.5% at the *stricter*
135-wpm production rate. The trajectory on bias and duration is
monotonically good from M → Q → U.

## 5. Remaining failures

Stated without softening.

**5.1 The protagonist has been deleted, not named — and this is a
regression from Q.** Q's residual finding was anonymity ("the traveler").
U's is worse in kind: in **4 of 7 cases the story has no human subject at
all**.

- Case 01: "The one spending the evening there" → "the person" (×14), with
  agentless passive throughout — *"A cup was taken down from a shelf. Water
  was poured."* The user's prompt said "someone spends a peaceful evening";
  that someone never materialises.
- Case 02: the grammatical subject is *the walk* — "the walk begins", "The
  walk eases", "the walking comes to rest".
- Case 05: the human exists only as detached anatomy — "the hands", "resting
  legs", "the knuckles".
- Case 07: nobody is present; the village is toured empty.

Where the prompt names a role, the role survives (case 03 conductor, case 04
keeper) — that is R1's win, and it is real. But **0 of 7 cases produce a
named protagonist**, against 7 of 7 in the old pipeline (Mara, Tomas, Jonah,
Elias, Leo/Mira, Theo, Elsin). And case 03 shows a second-order artifact of
the anonymity strategy: the conductor gets **no pronouns at all**, forcing
prose like "the face", "the gloved hand", "as if the motion belonged to the
body itself", while the incidental porter is freely called "he". Case 04 is
the counterexample that proves this is avoidable — the keeper takes ordinary
`he/his` 117 times and is the strongest output in the run. The behaviour is
inconsistent across cases rather than a controlled choice.

**5.2 `hasExplicitScenario` is a non-functional gate.** It returned `true`
for all 7 cases including a prompt with no scenario. This is the second
independent live confirmation (after R1.5 §7.1) and means scenario-bias
suppression currently rests on the model reacting to concrete prompt content,
not on the gate RP-011C.8.10P introduced. The M-era "gentle traveler / gate /
arrival / room" template is still in the system and still fires (case 06),
so behaviour for *thin but nonempty* prompts — the realistic middle of the
distribution, e.g. "a calm story about resting" — is untested and unguarded.
Follow-up belongs in `lib/creative-intelligence/intent/classifiers.ts`.

**5.3 Duration still overshoots on every single case, systematically.** All
7 CI cases are long: +5.5% to +18.5%, avg +11.8%, which at a 20-minute
target means 21.1–23.7 minutes. This is a large improvement over Q
(+35.5% avg) and no case is now wildly off, but the error is **one-directional
and never within ±5%**. A production duration guarantee of "20 minutes"
cannot be made from this; the honest claim is "20–24 minutes". The old
pipeline has the mirror-image problem (−8.0% avg, one case at −15.5%).

**5.4 Two cases are under-delivering on prompt content, in opposite ways.**
Case 07 was asked for a *magical* village and produced one mention of
"magic" describing the absence of change, with no inhabitants and no
magical event — the setting is preserved but the premise is not. Case 05
reaches near-zero event density: scenes 3–5 restate the same
blanket/wood/moonlight/rocking inventory with diminishing variation. For a
sleep story, low event density is partly the point, but "faithful to the
scenario" and "actually about the scenario" are not the same thing, and
case 07 fails the second.

**5.5 The evaluator is now demonstrably worse than unreliable — it is
actively misleading.** It scored `character_development` = 1.0, *"The
protagonist has a distinct desire, need, and internal conflict to act
from,"* on cases 02, 05 and 07 — the three outputs that contain **no
protagonist whatsoever**. It also scored `story_movement` = 1.0 on the same
cases. It is evidently scoring the *blueprint*, not the generated text, and
it has no criterion for scenario fidelity or cross-case similarity. Its
verdict on this run (5 strong / 2 acceptable, dinged only for "somehow" and
"he felt") would have shipped case 07's premise failure and case 05's
protagonist deletion without comment. Every substantive finding in this
report was established by direct text reading.

**5.6 Not testable with this case set, still open.** Companion-identity
continuity (M's human ↔ animal-like drift) remains unretestable: no CI case
produced a persistent companion, because CI now produces almost no
characters at all. A case that explicitly requests a companion is required.

## 6. Recommendation

**No — Sleep Story Creative Intelligence calibration is not complete and is
not production-ready.** One blocker, stated precisely:

> **The protagonist-presence defect (§5.1).** In 4 of 7 cases the generated
> story has no human subject, and in 0 of 7 does the protagonist have a
> name. This is a *regression in kind* from RP-011C.8.10Q, whose residual
> finding was an anonymous-but-present "the traveler." A paid sleep story
> whose prose reads "A cup was taken down from a shelf. Water was poured."
> is not shippable against an old pipeline that produces Mara, Jonah and
> Elias, and it is not what the user asked for when the prompt says
> "someone spends a peaceful evening."

This is a narrow, well-localised blocker, and case 04 shows the fix is
within reach: the same pipeline, on the same day, produced a keeper carried
by ordinary `he/his` pronouns across 117 uses — the strongest output in the
run. The problem is that the writer's resolution of "do not force an
unnecessary protagonist" is uncontrolled, ranging from full pronouns (04) to
role-noun-without-pronouns (03) to total grammatical dissolution (01, 02,
05, 07). The next implementation step is to make that choice deliberate:
when the prompt implies a figure ("someone", a role), the writer should
commit to one referent — ideally a name, minimally a role plus consistent
pronouns — rather than routing around it.

Everything else this task was chartered to check is **genuinely fixed and
should be treated as closed**:

- creativeDirection preservation: 7/7 verbatim.
- Scenario fidelity: 7/7, sustained across all five scenes each; M's
  worst-case defect (valley → cottage) does not reproduce.
- The five M-era bias markers: zero in all scenario-anchored output;
  cottage/hearth confined to the prompt that requested it; the traveler
  template confined to the deliberate no-scenario control.
- Named-role preservation where a role is given: 2/2, zero substitution.
- Cross-scene continuity: 7/7 clean (the only continuity fault in the run is
  in the old pipeline).
- Ending quality: 7/7 soft trail-offs, no moral, no twist.
- Ellipsis crutch: nonexistent (0 in all 14 outputs) — close this measure.
- Duration: improved from +35.5% to +11.8% average overshoot at the stricter
  135-wpm production rate.

Two further items should stay open but are **not** blockers on their own:
the `hasExplicitScenario` classifier being non-discriminating (§5.2 — a
latent risk for thin prompts, not a defect in current output), and the
systematic one-directional duration overshoot (§5.3 — a "20–24 min" honesty
problem, not a quality failure). The evaluator's blindness (§5.5) is not a
product blocker but must not be used as the gate that declares Sleep Story
done; it would have passed this run.
