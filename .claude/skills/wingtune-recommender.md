---
name: wingtune-recommender
description: Triggers on any change under src/lib/recommenders/, RecommendCard/RecommendList/RecommendTab components, or addition of a new recommender to gatherRecommendations. Enforces the safety invariants for the most safety-critical code path in the project — CLI recommendations that, if wrong, end airframes.
---

# wingtune-recommender

Recommendations are the only place in WingTune where the tool *tells the
user what to do* with their aircraft. Every other surface (charts,
readiness icons, header params, spectrum overlays) is informational —
the user decides what to act on. Recommenders synthesize judgments into
paste-ready `set foo = X` CLI strings. **A wrong CLI here ends an
airframe.** That's the threat model the invariants below are built
against.

This skill pairs with `wingtune-confidence-scoring`. That skill covers
the *confidence aggregation primitive* (`ConfidenceResult<T>`,
green/yellow/red, criteria_met/criteria_failed). This skill covers
*what to do with* a `ConfidenceResult` once you have one — emission
gating, UI rendering, multi-axis discipline, current-vs-proposed
display.

## The invariants

### I1. Red removes the CLI surface entirely. Not "disabled," not "greyed."

The copy button must be **absent from the DOM** on red — not present
and disabled, not present and faded. A disabled button is an action
the user can imagine completing; an absent surface is not. This is
the cardinal rule from `CLAUDE.md` and the foundational threat model
of the recommender pipeline.

Reference: `RecommendCard.vue` already enforces this — see the
`v-if="rec.confidence === 'green'"` gate around the copy block.

### I2. `criteria_failed` non-empty → confidence cannot be green.

This is the aggregation rule from `wingtune-confidence-scoring`, but
restated here because recommender code is where it matters most. Any
new recommender that constructs a `ConfidenceResult` by hand (rather
than via `aggregateConfidence`) must self-check this. If you find
yourself wanting to emit green despite a failed criterion, the right
answer is **fix the criterion** (loosen the threshold, split into
sub-criteria, document why) — never override the gate.

### I3. Criteria are rendered as line items, not collapsed.

Every recommendation UI must surface `criteria_met` and `criteria_failed`
as **individual list rows**, not as an aggregate count ("3 of 7
criteria met") or as a color alone. A yellow recommendation that
doesn't tell the user *which* criterion failed is either over-trusted
(user follows the rec anyway) or ignored (user dismisses the color
as noise). Both outcomes are bad.

Reference: `RecommendCard.vue:177-200` is the existing pattern —
green-tinted `criteria_met` items, red-tinted `criteria_failed`
items, each on its own row under a "confidence criteria" header.
Any new rec surface must follow this shape.

### I4. Current value always visible alongside proposed.

Every CLI emission of the form `set foo = X` must display the
**current value of `foo` from `header_params`** alongside the proposed
`X`. Format: `current 1.45 → proposed 1.80`. If the current value
can't be read (key missing from `header_params`), that is itself a
failed criterion — emit the rec as yellow with a `criterion_failed:
"could not read current foo from log"` entry, do not emit CLI.

This catches three failure modes:
- User has already set the recommended value and the rec is stale
  (visible: current matches proposed; user knows to dismiss)
- Proposed value is wildly different from current (visible delta;
  user can sanity-check before pasting)
- Tool is reading the wrong key (visible "current" value will look
  nonsensical to the user)

### I5. Bounded delta sanity check.

For numeric CLI emissions, compute `|proposed - current| / current`
and downgrade confidence to yellow if it exceeds a per-recommender
threshold (default 50%, can be loosened per-module with documented
rationale). A green recommender suggesting a 4× jump from current
value is almost certainly a bug in the recommender logic, not a
genuine insight — fail-safe by degrading the rec, not by emitting it.

Reference: this is a new invariant; existing recommenders don't yet
enforce it. When adding it, the `RecommenderArgs` already carries
`headerParams` so the current-value read is in-place.

### I6. Per-axis CLIs require per-axis green.

Recommenders that emit per-axis CLI (`set tpa_curve_roll_*`,
`set spa_pitch_*`, etc.) must produce **separate confidence results
per axis** and only emit the per-axis CLI for axes that individually
hit green. A green-on-roll, yellow-on-pitch, red-on-yaw scenario
emits **only the roll CLI** plus diagnostic-only listings for pitch
and yaw — it does NOT emit the pitch and yaw CLI just because the
aggregate is green.

If the recommender's underlying analysis only produces a
whole-airframe judgment (no per-axis decomposition), the CLI must be
all-axes-together or none.

### I7. Yellow with CLI requires documented rationale.

By default, yellow is **diagnostic-only** — confidence is moderate,
emit explanation but no paste-ready string. A recommender that wants
to emit CLI on yellow must document the rationale in a TSDoc block
on the rec-emit function, naming the specific criteria whose failure
is non-blocking (e.g. "low sample count is acceptable here because
the metric is a topology check, not a noise estimate"). Reviewers
checking this skill will flag undocumented yellow-with-CLI.

### I8. All recommendations route through `gatherRecommendations`.

No component, store, or composable may construct a `Recommendation`
object directly. The aggregator in `src/lib/recommendations.ts` is
the single emission path — it sorts by severity, deduplicates, and
applies cross-recommender invariants (e.g. don't emit a TPA-curve
rec if the airspeed-fit blocking it is red). Bypassing the
aggregator means losing those guarantees.

## When this skill triggers

- New file under `src/lib/recommenders/`
- Edit to `src/lib/recommendations.ts` (aggregator) or
  `src/lib/confidence.ts` (primitive)
- Edit to `RecommendCard.vue`, `RecommendList.vue`, or `RecommendTab.vue`
- Addition of a new `Recommendation` shape field
- Any code path that constructs or emits a paste-ready CLI string
  outside the recommender pipeline (auto-trigger for review — should
  probably not exist)

## Quick self-check before committing

For a new recommender:

- [ ] CLI is gated behind `confidence === 'green'`; the copy block
      is absent (not disabled) on red and yellow (unless I7 invoked)
- [ ] Every emitted criterion has a corresponding `criteria_met` or
      `criteria_failed` string the UI can render
- [ ] Per-axis recommendations decompose into per-axis
      `ConfidenceResult`s; CLIs are emitted only for green axes
- [ ] Current value of every `set` target is read from `headerParams`
      and rendered alongside proposed; missing current value =
      failed criterion
- [ ] Numeric proposals run through the I5 bounded-delta check; the
      per-recommender threshold is named in TSDoc
- [ ] Recommender is registered in `gatherRecommendations`, not
      called from a panel directly
- [ ] If emitting CLI on yellow, TSDoc names the specific criteria
      whose failure is non-blocking and why

For UI changes to `RecommendCard` or friends:

- [ ] `criteria_met` and `criteria_failed` are rendered as individual
      rows, never collapsed into a count or color alone
- [ ] Current vs proposed values are visually adjacent, not in
      separate panels
- [ ] Red still removes (does not disable) the copy surface
- [ ] Yellow renders criteria_failed even when no CLI is emitted

## Exception

The named exception comment for legitimate bypass is
`// RECOMMENDER-EXCEPTION:` followed by the invariant being bypassed
and the rationale. Update this skill in the same PR. There is no
exception hatch for I1 (red-removes-CLI) — that one is absolute, same
as the corpus-hygiene GPS rule.
