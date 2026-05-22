# M-Pilot execution plan — pilot-input style analysis

Execution detail for **M-Pilot** — analytics-plan priority #7. The
analytics plan (`docs/wingtune-analytics-plan.md`, the "M-Pilot"
section) is the "why"; this doc is the slice-by-slice breakdown.

> **Read first:** `wingtune-architecture`, `wingtune-vue-conventions`,
> and the analytics-plan's M-Pilot + M-Style sections. The plan's
> explicit instruction for this milestone: **keep it lightweight,
> don't over-invest** — M-Pilot is a "characterise the flight" view,
> not an every-flight tuning lever.

## What M-Pilot does

M-Pilot reads the pilot's raw stick input and characterises HOW a log
was flown — separating three cases that look alike in the gyro traces
but call for different tuning advice:

- **calm wing, calm pilot** — small, infrequent inputs;
- **stable wing, aggressive pilot** — large, deliberate inputs;
- **unstable wing, pilot fighting it** — constant small, rapid
  corrections.

A panel that says "this gyro is busy" can't tell whether the pilot
caused it. M-Pilot can: it works off `rcCommand` — the pilot's hand,
not the airframe's response.

Its second job is to feed M-Style: the input-style verdict is the
natural signal for *suggesting* a Cruise / Sport / 3D profile —
closing the deferred M-Style Slice 4.

## Status

🚧 **Not started** — execution plan locked 2026-05-22.

## Scope

**In:** `lib/pilotStyle.ts` (the rcCommand analysis),
`PilotStylePanel.vue` (a summary-stat panel on the Summary tab), and
the M-Style auto-suggest hook (= the deferred M-Style Slice 4).

**Out (deferred / not in scope):**
- **No recommender, no CLI.** M-Pilot describes; it doesn't prescribe.
  The single "action" is a non-binding profile *suggestion* in the
  tune-profile control — a UI hint, not a Recommend-tab card. Same
  diagnostic-only shape as M-Coupling / M-Servo-2.
- **No throttle-style verdict.** `rcCommand[3]` activity may be shown
  as a stat, but the calm / aggressive / fighting verdict is driven by
  roll + pitch + yaw — throttle style is a separate axis, out of scope.
- **No cross-log style trend.** "This pilot is flying calmer than last
  week" is a longitudinal feature — blocked on craft persistence, out
  of scope here.
- **No per-flight-phase segmentation** (takeoff / cruise / landing) —
  explicitly dropped in the analytics plan.

## Slice breakdown

### Slice 1 — `lib/pilotStyle.ts` (the analysis)

Layer 2, no Vue. The load-bearing piece.

- **Per stick axis** (roll / pitch / yaw, from `rcCommand[0..2]`):
  - `activityRms` — RMS deflection from centre. How hard the pilot
    worked that axis.
  - `reversalRatePerSec` — significant stick direction-changes per
    second, via a hysteresis zigzag: track the running extremum,
    confirm a turning point when the signal retraces past it by more
    than `reversalDeadband` (rcCommand units), flip direction, count.
    The deadband rejects sensor / decode jitter so only *real*
    corrections count.
  - `strokeMedian` / `strokeP90` — the distribution of confirmed
    turning-point amplitudes (|deflection from centre|). p90 is "how
    big are this pilot's big inputs."
- **Aggregate verdict** across the maneuvering axes (roll + pitch
  primarily):
  - `suggestedProfile: TuneProfile` — from aggregate input amplitude:
    small inputs → `cruise`, large → `3d`, mid → `sport`.
  - `correctionCharacter: 'calm' | 'active' | 'busy'` — from aggregate
    reversal rate. 'busy' is the "fighting the wing" signal.
- All threshold bands (reversal deadband, correction-rate bands,
  amplitude→profile bands) are wing-regime first guesses — mark
  `TODO calibrate`. Low-stakes: the verdict only ever *suggests*.
- **Tests:** synthetic rcCommand — a calm flight (small, slow inputs) →
  low rate, low amplitude, suggests `cruise`; an aggressive flight
  (large deliberate strokes) → high amplitude, suggests `3d`; a
  "fighting" flight (rapid small reversals) → high reversal rate,
  `correctionCharacter: 'busy'`. A clean zigzag of known stroke count →
  exact reversal count; sub-deadband jitter → zero reversals.

### Slice 2 — `PilotStylePanel.vue` (the panel)

Layer 3 — `wingtune-vue-conventions`, `useActiveLog`. A summary-stat
panel on the **Summary tab** (it characterises the log — it belongs
with the other "what is this log" surfaces; confirm placement in the
tab-IA pass).

- Per-axis row: activity bar + reversal rate + stroke p50 / p90.
- The headline: the one-line characterisation, composed from
  `correctionCharacter` + `suggestedProfile` ("Frequent small
  corrections — the wing reads busy; a calmer tune or softer rates may
  help" / "Large deliberate inputs — flown aggressively").
- Honest empty state when the log is too short or has no stick motion.
- Diagnostic only — no CLI, no rec card.

### Slice 3 — M-Style auto-suggest hook (closes M-Style Slice 4)

Layer 3. Wire `pilotStyle().suggestedProfile` into
`TuneProfileControl.vue` as a **non-binding suggestion**: when the
active profile differs from what the log's input style suggests, the
control shows a dismissible hint ("This log looks flown 3D-style —
switch profile? [switch] [dismiss]").

- **The honesty rule (from M-Style):** the profile is the user's
  *declared intent*. M-Pilot may *suggest*; it never auto-applies.
  Worst case the user dismisses a hint.
- This is exactly M-Style's deferred Slice 4 — closing it here.

## Open questions carried into execution

1. **Maneuver-window cross-reference.** M-FF's `detectManeuvers` is
   already shipped. Splitting reversals into "inside a deliberate
   maneuver" vs "scattered correction" would sharpen the
   aggressive-vs-fighting call. Lean: include it in Slice 1 IF it is a
   few lines over the raw rcCommand stats; defer if it complicates —
   the plan says don't over-invest.
2. **rcCommand units.** Roll / pitch / yaw `rcCommand` is conventionally
   ±500 in Betaflight; the amplitude→profile thresholds assume that.
   Verify against a real wing log before the thresholds are trusted.
   Use absolute units, NOT a normalisation by the log's own max —
   normalising would erase the "this pilot only ever used 60% stick"
   signal, which IS the style.
3. **Panel placement.** Summary tab proposed; the tab-IA pass may move
   it. Don't block on that — ship on Summary, revisit with the IA pass.
4. **Throttle.** Show `rcCommand[3]` activity as a stat or omit it?
   Decide in Slice 2 — it does not affect the verdict either way.

## Test plan

- Unit (`tests/unit/`): `pilotStyle.ts` — calm / aggressive / fighting
  synthetic flights, zigzag reversal-count exactness, sub-deadband
  jitter rejection.
- Corpus: every log carries `rcCommand`, so Brian's USE_WING logs
  exercise M-Pilot end to end. `npm run corpus:validate:private`.
- Per-skill self-check before commit.
