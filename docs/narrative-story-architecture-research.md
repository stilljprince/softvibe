# Narrative Story Architecture — Research

> **Status:** Research-only. No code or prompt changes implied by this document.
> **Audience:** Future implementer of the SoftVibe Narrative Story preset.
> **Goal:** Understand what excellent long-form fiction has in common (and where it
> diverges) so a future *outline → segment* architecture can scale to long
> durations without flattening every story into the same formula.

---

## 0. Reading guide

This report is organized into:

1.  Observations from a cross-section of well-known novelists
2.  Comparison of widely cited story-structure models
3.  Tension and pacing
4.  Chapters / segmentation
5.  Endings
6.  Characters
7.  Failure modes
8.  Recommendations for SoftVibe
9.  Executive summary, strongest findings, surprises, recommendations, verdict

Throughout, **"Observation"** sections describe what literary craft seems to
agree on or disagree about. **"Implication"** sections suggest, tentatively,
what that means for a generative system. Literary theory genuinely disagrees on
many of these points, and the report tries not to paper over those
disagreements.

---

## 1. What excellent novels seem to have in common

The aim here is to identify *universal principles* — things that recur across
authors with radically different styles — and separate them from
*genre-specific conventions* that look universal only inside a single genre.

The authors below are used as **reference points for patterns**, not as
templates to imitate. SoftVibe should not produce work that reads in the voice
of any living author.

### 1.1 Per-author observations

#### Stephen King
- *Process:* explicitly "gardener" rather than "architect" — premise + character,
  then discovery-write.
- *What recurs:* strong vernacular voice; ordinary characters in compressed
  circumstances; long patient build before any supernatural element lands.
- *What's idiosyncratic:* digressive interiority; very high comfort with
  tangential backstory.
- *Genre-specific:* horror's tolerance for slow-dread pacing.

#### J. K. Rowling
- *Process:* heavily outlined; multi-year arcs planned before book one.
- *What recurs:* "chapter as episode" rhythm in earlier books — each chapter
  has its own micro-shape; long-arc planting that pays off books later.
- *Genre-specific:* hidden-world reveal cadence — discovery as a delivery
  vehicle for worldbuilding.

#### Agatha Christie
- *Recurs:* clue density planned backward from the solution; misdirection by
  *omission* rather than by *lying*; fair-play with the reader.
- *Genre-specific:* the entire shape (suspect set → false leads → reveal) is
  bound to mystery convention. Easy to mis-read as a universal "twist rule."

#### Arthur Conan Doyle
- *Recurs:* episodic, observer-narrator, problem-of-the-week. Often *no*
  overarching arc.
- *Implication:* an "excellent" story does not always have a single rising
  tension across the whole work. Episodic shapes are legitimate.

#### J. R. R. Tolkien
- *Recurs:* world predates plot; landscape and deep time function almost as
  characters; multiple POV strands woven across distance.
- *Genre-specific:* slow, ceremonial pacing — would be ruinous in thriller.

#### Ursula K. Le Guin
- *Recurs:* restraint, ambiguity treated as a feature, ideas embedded in
  daily texture rather than expounded.
- *Universal-feeling principle:* trust the reader; under-explain.

#### Isaac Asimov
- *Recurs:* idea-puzzle dominant; characters often vehicles for argument;
  dialogue-heavy scenes; comparatively thin interiority.
- *Useful counter-example:* shows that "deep character interiority" is not
  strictly necessary — some excellent stories *are* the puzzle.

#### Frank Herbert
- *Recurs:* layered politics, prophetic/inner monologue, slow widening of
  stakes from personal to civilizational; comfort with reader confusion early.

#### Andy Weir
- *Recurs:* problem → attempt → setback → new problem cycles; first-person
  technical voice; comic-relief intercut into stakes.
- *Genre-specific:* the cycle works because the genre is procedural.

#### Gillian Flynn
- *Recurs:* unreliable narration; midpoint structural reframe; dual POV
  inversion.
- *Genre-specific:* thriller. The "midpoint reveal" rhythm is a thriller
  convention, not a universal law.

#### Donna Tartt
- *Recurs:* retrospective narration; literary patience; lush detail; opening
  movements that would feel "too slow" by Save-The-Cat standards but are part
  of why the payoff lands.

#### Ken Follett
- *Recurs:* large casts, parallel storylines, time jumps measured in years,
  threads converging in a climactic event. Historical epics often *require*
  this structure; lifting it into a non-epic flattens the form.

### 1.2 What looks universal across the set

The genuinely cross-author patterns are surprisingly few and surprisingly
abstract:

- **Consequence.** Actions in the story matter for what follows. This is the
  most universal property and the easiest one to lose in generated text.
- **Specificity over abstraction.** Memorable scenes are built from concrete
  sensory detail, not summary.
- **A consistent interior.** Even idea-driven authors (Asimov) maintain a
  consistent narrative stance. Voice may be flat or rich, but it is *coherent*.
- **Setup and payoff over distance.** Something planted earlier comes back
  later — even in episodic works, on a smaller scale.
- **Restraint.** Nearly every author cited above under-explains relative to
  their genre's lowest common denominator.

### 1.3 What looks like it's universal but actually isn't

- A single rising arc with a climax near the end.
- "The protagonist must change."
- A midpoint reversal.
- An inciting incident inside the first 10–15%.
- A villain.
- A romance subplot.
- A "save the cat" likability beat.

Each of these is common, defensible, and *often* effective. None is required.

---

## 2. Story-structure models

The brief is explicit: do not crown a winner. The honest comparative reading is
that these models describe **overlapping abstractions of the same few ideas**,
plus genre-specific decoration.

| Model | Origin | Mandatory shape |
|---|---|---|
| Three Act | Classical (via Aristotle, Field) | setup → confrontation → resolution |
| Hero's Journey | Campbell / Vogler | departure → initiation → return, with mythic stations |
| Fichtean Curve | Freytag-derived | chained rising crises, minimal setup |
| Kishōtenketsu | Classical East Asian | introduction → development → *twist/turn* → reconciliation, no central conflict required |
| Seven-Point | Wells / Card | hook, plot turn 1, pinch 1, midpoint, pinch 2, plot turn 2, resolution |
| Save the Cat | Snyder (screenwriting) | 15 specific beats at specific percentages |

### 2.1 Ideas that recur across most or all models

- A **change of state** from start to end.
- An **orientation phase** during which the reader gains footing.
- A **complication** that changes what the situation is "about."
- A **transformation point** (not necessarily a "twist") where direction or
  understanding shifts.
- A **closing state** distinct from the opening state — even if the change is
  only the reader's understanding.

These five ideas are abstract enough to survive across genres. They are also
permissive: they describe a *trajectory*, not a beat sheet.

### 2.2 Ideas that look universal but are not

- **Inciting incident at ~10% / midpoint at ~50%.** A screenwriting heuristic
  imported into novels. Many great novels are very front-loaded or
  very back-loaded. Kishōtenketsu doesn't have an inciting incident at all.
- **The "false lead" / pinch points.** Useful for thrillers and mysteries.
  Foreign to literary fiction, slice-of-life, and many quiet novels.
- **The hero refuses the call.** A Campbell-specific station that does not
  describe most non-mythic fiction.
- **15-beat exact placement.** Save the Cat works in screenwriting because
  films are time-bound; novels are not.

### 2.3 Where formulas creep in

The risk is not in *using* a model; it's in **enforcing the same model on
every story**. Every model except Kishōtenketsu assumes external conflict at
its core. Several assume Western three-act tempo. Save the Cat in particular
becomes formulaic almost on contact, because its beats are positionally
specific.

**Implication:** the abstraction worth carrying forward is the five-idea
trajectory above. The decorations (false leads, exact beat positions,
mandatory midpoint reveals) should be optional, not default.

---

## 3. Tension and pacing

### 3.1 What tension actually is

Tension is *anticipation under uncertainty*. It is not the same as conflict.
A scene with no external conflict can be extraordinarily tense (a character
choosing whether to say a single sentence). A scene with overt conflict can
be tensionless if the outcome doesn't matter.

Tension sources that recur across great novels:

- **Withheld knowledge** — the reader knows something a character doesn't, or
  vice versa.
- **Unresolved want** — the character wants something they cannot currently
  have.
- **Approaching event** — something is coming and cannot be avoided.
- **Moral ambiguity** — the right action is unclear.
- **Time pressure** — but this is the most overused and least durable of the
  sources.

### 3.2 Twists

Twists are *optional*. Many of the most respected novels have none in the
"reveal" sense:

- Stoner (Williams) — no twists, sustained quiet tension.
- The Old Man and the Sea (Hemingway) — the outcome is essentially announced
  in the premise.
- Tinker, Tailor, Soldier, Spy — has a reveal, but is the exception not the
  rule for its author.

A generative system that defaults to a twist per story will eventually feel
like a magic trick repeated too many times.

### 3.3 Climaxes

Multiple climaxes are *also* optional. Some excellent novels:

- Climax once and dwell in aftermath (the last third of *Atonement*).
- Climax repeatedly at chapter scale but never at book scale (episodic).
- Avoid a discrete climax and end on a slow recognition.

### 3.4 Quiet scenes

Quiet scenes are not "filler." They:

- Let consequence register emotionally.
- Recharge the reader's tolerance for intensity.
- Provide texture and specificity that makes later intensity land.
- Mark transitions between phases without needing exposition.

In an audio-sleep context, this is doubly important: the *quiet* is part of
the product, not a break from it.

### 3.5 Do great novels share pacing curves?

Probably not. Pacing curves cluster *within genre* (thrillers accelerate;
literary novels often plateau or decelerate). The cross-genre commonality is
narrower: **rhythm**, not curve. A great novel varies intensity at a tempo
suited to its material; it does not match any specific curve.

---

## 4. Chapters and segmentation

This section is the most directly load-bearing for SoftVibe's future
architecture, so it's treated with the most care.

### 4.1 What actually creates a segment boundary in excellent novels

The honest answer is: **a rhetorical cut**. A chapter break is a punctuation
mark in the reader's attention, not a slot with a predetermined function.

Cuts cluster around:

- **Time jumps** — minutes, days, years; the gap itself does narrative work.
- **Location changes** — a new room, a new city, a new world.
- **POV changes** — including subtle shifts within third-person.
- **Knowledge-state changes** — a character learns something; everything after
  is colored by that knowledge.
- **Emotional-valence shifts** — the felt temperature of the story changes.
- **Conflict shifts** — what's at stake reframes.
- **New-information arrivals** — a letter, a body, a sentence overheard.
- **Aftermath / breath beats** — a deliberate decompression.

A single break often does several of these at once. Few do exactly one.

### 4.2 Are chapter purposes fixed?

In excellent novels: **no**. The mapping "Chapter 1 = setup, Chapter 2 =
complication, Chapter 3 = false lead" is a screenwriting habit, not a novelistic
one. Looking across the reference authors:

- Chapter lengths vary wildly within a single novel (sometimes 1 page,
  sometimes 60).
- Chapter "purpose" is usually emergent — the reader can describe what a
  chapter *did* after reading it, but the author wasn't filling a slot.
- Some novels have no chapters; some have hundreds.

The closest thing to a universal is that chapters tend to *end on a leaning
question* — something the reader carries across the gap.

### 4.3 What this means for an "outline → segments" system

The risk to flag now, before any code is written: it is very easy to design a
segment system whose **slots have implicit narrative roles** ("the third
segment is for the first complication"). That structure will look fine on the
first story and exhaust its variety by the tenth.

A segment system that respects what excellent novels actually do should:

- Treat segments as **cuts**, not slots.
- Allow segment count and segment length to vary per story.
- Let the *kind* of cut be chosen per boundary (time, place, POV, knowledge,
  emotional, aftermath), not assigned globally.
- Never label a segment with a fixed narrative function in the prompt.

---

## 5. Endings

### 5.1 Why an ending feels like an ending

Ending-quality is the single hardest property to fake. The cross-author
observation is that endings land when they deliver **consequence** and
**specificity** together:

- *Consequence:* the trajectory of the story has reached a place from which it
  cannot return. This is true even of open endings — what's set in motion is
  set in motion.
- *Specificity:* the final note is a concrete image, gesture, sentence, or
  silence — not a summary of what happened.

Endings that feel artificial almost always fail one of those two tests. They
either tie off consequence too tidily (everything resolves, nothing matters
afterward) or they default to abstraction (a moral, a summary, a "and so they
learned…").

### 5.2 Modes of ending

All of these are legitimate; none is superior.

- **Resolved.** Threads close; the world returns to equilibrium, changed.
- **Bittersweet.** A win and a loss arrive together. Often the most
  memorable mode in adult fiction.
- **Tragic.** The trajectory completes downward. Requires the ending to feel
  *inevitable*, not punitive.
- **Open.** The story stops but its motion continues. Works when the reader
  can extrapolate; fails when it feels like the writer didn't decide.
- **Ambiguous.** Multiple readings remain available. Closely related to open
  but more deliberate about it.
- **Moral / didactic.** A theme stated. Almost always weaker than the
  alternatives; rarely chosen by the authors above except in children's
  fiction, where it can be appropriate.
- **Summary.** A retrospective gloss. Usually the weakest mode and the
  default mode of generated text. Worth flagging explicitly.

### 5.3 What makes endings memorable

- A **final image** that recurs in memory after the book closes.
- A **deferred emotion** that lands a paragraph after the event.
- A **shift in register** — the prose slows, the sentences shorten or
  lengthen, the camera pulls back.
- An **echo** of an image or phrase from earlier — without explanation.

### 5.4 What makes endings feel artificial

- Restating the theme.
- Summarizing what the protagonist learned.
- Resolving every secondary thread.
- A coda that says "and from then on…"
- A final twist that reframes the whole story (sometimes works, often feels
  like a magic trick).
- Symmetry pursued past the point of usefulness ("we end where we began").

For SoftVibe's sleep context, there is an additional pull toward
summary-as-ending because summarization feels "calm." It isn't — it's flat.
The calmest endings in adult fiction are concrete and small, not abstract and
tidy.

---

## 6. Characters

### 6.1 What makes characters feel alive

Across the reference authors, alive characters tend to share:

- **Contradictory desires.** They want two things that cannot both happen.
- **Interior fear.** Not necessarily a phobia — a stance toward the world
  that they're trying to protect.
- **Specificity of attention.** What a character notices is who they are.
- **Decisions, not reactions.** A character pushed around by plot is not yet a
  character. A character making a choice the reader didn't expect — but
  immediately understands — is.
- **Refusal of change.** It's a common mistake to assume every protagonist
  must transform. Some of the most enduring characters refuse change, and the
  story is about the cost of that refusal.

### 6.2 Universal vs. genre-specific

Universal:
- Interior coherence — a character behaves like one mind across the work.
- Specificity of perception.
- Stakes that are personal as well as situational.

Genre-specific:
- Depth of interiority (literary >> procedural).
- Backstory density (epic >> short fiction).
- Arc explicitness (children's fiction states the arc; adult literary fiction
  often doesn't).

### 6.3 Relationships

Even "lone protagonist" novels almost always have a relational structure —
with an absent character, a place, an idea, a past self. Pure isolation is
rare and difficult to sustain. For SoftVibe, this means that even
single-character meditative stories should carry some relational tension,
however quiet (with a memory, a season, a self).

---

## 7. Failure modes

A dedicated catalog of things to watch for, given that generative systems
default toward most of them.

### 7.1 Structural

- **Rigid beat sheets.** Every story producing the same shape.
- **Predictable chapter purposes.** Segment N always does the same job.
- **Mandatory inciting incident at fixed position.**
- **Mandatory false leads.** Especially in non-mystery genres.
- **Mandatory midpoint reversal.**
- **Forced convergence.** Every thread connects; nothing is allowed to be
  loose.

### 7.2 Tension and pacing

- **Twist-as-default.** Every story has a reveal.
- **Forced emotional peaks.** A scene of intensity inserted because "it's
  time."
- **Uniform pacing.** Every chapter the same length, same tempo, same
  intensity.
- **No quiet.** Continuous action; no breathing room.
- **All quiet.** Continuous stillness; no contrast.

### 7.3 Genre habits taken as universals

- Every romance ends happily.
- Every mystery resolves in the second-to-last chapter.
- Every children's story states its lesson.
- Every literary story ends ambiguously.
- Every adventure ends in triumph.

### 7.4 Voice and texture

- **Voice collapse.** All characters sound alike.
- **Abstract sensory writing.** "Beautiful" instead of a specific image.
- **Theme explanation.** The story explains what it means.
- **Adjective inflation.** Compensating for missing specificity.

### 7.5 Endings

- **Summary disguised as ending.**
- **Moral disguised as ending.**
- **"And from then on…" codas.**
- **Symmetry pursued past usefulness.**
- **Final-line twist used to "fix" a weak ending.**

### 7.6 Generation-specific

Failure modes that arise from how LLMs default, not from human writing:

- **Average-of-everything voice.** Smooth, generic, slightly literary, no
  edge.
- **Equal-weighted everything.** No section is allowed to be more important
  than another.
- **Defensive prose.** Adverbs and qualifications that hedge specificity.
- **Closing-paragraph reflex.** A retrospective summary at the end of every
  segment.

---

## 8. Recommendations for SoftVibe

The brief asks for *principles, not prescriptions*. The recommendations below
are intentionally abstract; the specific implementation should be designed by
whoever builds it, with these constraints in mind.

### 8.1 The trajectory abstraction

Use a coarse, permissive trajectory as the high-level frame. Something like:

> **orientation → complication → escalation → change → resolution**

This is abstract enough to fit most genres and most pacing curves. It is
*not* a beat sheet. It does not specify:

- how long each phase is,
- whether the change is internal or external,
- whether resolution is closed, open, or bittersweet,
- whether escalation is monotonic or oscillating.

Different preset variants (calm meditative, episodic, single-arc,
Kishōtenketsu-like, problem-cycle) can map onto this trajectory differently
or skip phases.

### 8.2 Multiple shapes, not one

Rather than a single global structure, the system should hold **several story
shapes** and pick one per generation based on preset, genre, length, and
randomness. Suggested initial shapes (names indicative only):

- **Single arc.** Classic rising tension, one climax, short aftermath.
- **Episodic.** Loosely linked micro-stories; soft cadence; no overarching
  reveal required.
- **Quiet drift.** Plateau-shaped; no discrete climax; resolution by
  recognition.
- **Problem cycle.** Try-fail-try cycles; suited to procedural.
- **Turn (Kishōtenketsu-inflected).** Late shift that reframes without
  conflict; suited to gentle adult fiction.

Even a small library (3–5) of shapes, *not* applied uniformly, will produce
far more variety than one beat sheet applied stochastically.

### 8.3 Segments as cuts, not slots

When the long-form generation is split into segments, the segments should be
**rhetorical cuts**, not narrative slots. Concretely:

- Do not label segments with fixed narrative functions in the prompt.
- Choose the *kind of cut* per boundary (time / place / POV / knowledge /
  emotion / aftermath). Cuts should vary within a story, not repeat.
- Allow segment count and length to vary per story.
- Allow a story to be one segment, or twenty.

The outline should describe the **story's trajectory and the cut points**, not
"segment 3 contains the first complication."

### 8.4 The outline as a constraint sketch, not a script

The outline that drives segment generation should specify:

- Trajectory shape (which of the few shapes is being used).
- Anchor points (a handful of concrete images, decisions, or moments that
  *will* appear, without prescribing their position).
- Cut points (where and what kind of cut).
- Closing image (specific, concrete, small).
- Voice and register parameters (calmer or warmer; sparser or richer).

The outline should *not* specify:

- Per-segment summaries that pre-decide every event.
- Exact word counts per segment.
- Mandatory beats by position.
- The moral or theme to be stated.

### 8.5 Variety mechanisms

To prevent the generator from collapsing to one shape:

- Randomize trajectory shape across stories (within preset constraints).
- Randomize cut kinds per story.
- Randomize segment count and length distribution per story.
- Vary the *ending mode* per story (resolved / bittersweet / open /
  ambiguous), with weights tuned per preset.
- Avoid any prompt construct of the form "this segment is the X" — the model
  will reify it.

### 8.6 Audio-sleep specific overlay

Sleep audio adds one constraint the literary tradition does not: **arousal
should slope downward overall**. This is the *only* place a uniform
trajectory rule is defensible.

Even within that, variety remains possible:

- Calm-throughout (no rise at all).
- Slow rise then long fade.
- Episodic with progressively quieter episodes.
- Single small rise mid-story, long aftermath fade.

Avoid: the screenwriting curve (rise → climax → cut-to-credits). The "credits"
moment is wrong for sleep.

### 8.7 What to leave to the model

Do not over-specify in the outline or system prompt:

- Concrete sensory choices.
- Dialogue.
- Interior monologue.
- Final image (specify *that there is one*, not *what it is*).
- Names, places, textures.

The model is competent at these and the outline-level constraints will pin
down structure without flattening voice.

### 8.8 What to specify hard

- The closing register (small, concrete, no summary, no moral statement).
- The non-occurrence of forbidden moves per preset (e.g., Kids Story:
  never violent; Narrative: never a final-paragraph thematic gloss).
- Cut points and cut kinds (chosen by the outliner, not the segment writer).
- Voice and pacing parameters for the run.

---

## 9. Closing sections

### 9.1 Executive summary

Across a broad sample of well-known novelists, structural agreement is much
narrower than popular craft books suggest. The genuine universals are
abstract: consequence, specificity, coherent interiority, restraint, and a
change-of-state from start to end. Almost everything else — twists,
midpoints, beats at fixed percentages, false leads, mandatory transformation
arcs — is genre convention misread as universal law.

The single largest risk to SoftVibe's Narrative Story preset is therefore
*not* generating prose; it is generating **the same shape over and over**.
That risk arises both from screenwriting-style beat sheets and from the
LLM's own tendency to settle into an averaged literary register.

An outline → segment architecture is recommended for scaling to long
durations, **with strict caveats**: segments should be rhetorical cuts, not
slots; segment functions must not be pre-labeled; trajectory shape should
vary across stories; and the outline should be a constraint sketch, not a
script.

### 9.2 Strongest findings

1.  Excellent novels share principles, not patterns. The principles are
    abstract enough to be permissive; the patterns vary by genre.
2.  Twists, midpoint reversals, and false leads are *genre conventions*,
    not universal narrative requirements.
3.  Chapter purpose, in great novels, is emergent, not pre-assigned. Chapter
    breaks are rhetorical cuts at moments of time/place/POV/knowledge/emotion
    change.
4.  Endings land on consequence and specificity. They fail when they
    summarize or moralize.
5.  "The protagonist must change" is a craft-book maxim, not a literary
    fact. Refusal to change is a legitimate and powerful arc.

### 9.3 Biggest surprises

1.  Save the Cat, Hero's Journey, and Seven-Point Structure are far more
    similar to each other than the marketing around them suggests; they share
    a few core ideas plus distinct decorations.
2.  Kishōtenketsu is the most useful corrective in the set, because it
    *does not require external conflict* — which makes it directly relevant
    to gentle / sleep-suited storytelling.
3.  Quiet, slow novels (Stoner, much of Le Guin) are tense without being
    twisty. Tension and twist are not the same axis.
4.  Several of the canonical "rules" (inciting incident by 10%, midpoint
    reversal) come from screenwriting and only fit prose by accident.
5.  Generated text's most likely failure mode is not bad prose — it's
    *uniformity of shape* across many generations. This is the
    architecture-level problem, not a prose-level one.

### 9.4 Recommendations for the future narrative architecture

1.  Adopt a **coarse trajectory** (orientation → complication → escalation
    → change → resolution) as the high-level frame, treating each phase as
    optional and variable in size.
2.  Hold a **small library of story shapes** (e.g., single arc, episodic,
    quiet drift, problem cycle, turn-shaped) and select per story.
3.  Treat **segments as cuts, not slots**. Don't label them with narrative
    function in the prompt.
4.  Generate the **outline as a constraint sketch**: trajectory shape,
    anchor moments, cut points, closing image, voice parameters — and stop.
5.  **Vary ending modes** explicitly. Default to resolved is fine; make
    bittersweet, open, and ambiguous reachable.
6.  Apply the **sleep overlay** (downward arousal slope) as the *only*
    uniform constraint, and even there allow multiple slope shapes.
7.  Prohibit, at prompt level, the LLM defaults: summary endings,
    thematic glosses, "and from then on" codas, mandatory twist endings,
    uniform segment lengths.
8.  Let the model own sensory detail, dialogue, and interior voice; pin
    down structure and closing register at the architecture layer.

### 9.5 Verdict: should we use an outline → segment system?

**Yes, with the architectural constraints above.** The motivation is sound:

- Long durations (60+ minutes) cannot be generated in a single call
  reliably or affordably.
- Segments give us natural retry/repair boundaries.
- An outline allows global coherence to be enforced cheaply.

The risk is also real and was the entire reason for this research: a naive
outline → segment system, especially one with fixed segment roles, will
produce stories that all feel the same. The system avoids that risk only if
it (a) varies trajectory shape per story, (b) treats segments as cuts not
slots, (c) leaves sensory and dialogue choices to the model, and (d) hard-
constrains the ending register against the LLM's summarizing reflex.

If those four guards are present, an outline → segment architecture is the
right choice. Without them, a single-call generator at shorter durations may
actually produce more varied stories than a long-form segmented one.

---

*End of report.*
