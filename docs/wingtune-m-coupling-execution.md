# M-Coupling execution plan — cross-axis coupling matrix

Execution detail for M-Coupling, analytics-plan priority #2 (the
first un-built item now that M-FF has shipped). Sketch lives in
`docs/wingtune-analytics-plan.md` § M-Coupling.

> **Read first:** `wingtune-architecture`, `wingtune-memory-model`,
> `wingtune-vue-conventions`, `wingtune-confidence-scoring`,
> `wingtune-recommender`. And the `CLAUDE.md` SCOPE box — response
> windows are wing-regime (200-500 ms), not quad.

## What M-Coupling answers

"The wing rolls fine but pitches weirdly when I correct" — a real
mystery-bug class no current panel surfaces. Command roll: does
pitch wobble? = mixer imbalance, CG, or mechanical bind. Pitch up:
does yaw drift? = adverse yaw or bind. M-Coupling turns that into a
3×3 number.

## Status

Not started. Plan locked 2026-05-20 with three decisions from Brian:

1. **Gate on transient windows only.** Coupling is measured *only*
   inside detected aggressive-input windows — never sustained-
   attitude windows. This resolves the analytics-plan open question
   ("how to separate genuine coupling from aerodynamically-expected
   coupling" — e.g. a banked turn naturally bleeds pitch authority):
   transient gating sidesteps it. **Reuse the M-FF segment
   selector** (`lib/maneuverDetect.ts`, shipped abff4fa) rather than
   building a new gate.
2. **Diagnostic-only.** Yellow-confidence recs, NO CLI. Coupling is
   a mixer / CG / mechanical-bind diagnosis — there is no firmware
   `set` that fixes it. Pattern: `lib/recommenders/spa.ts` /
   `inputChain.ts` / `ffEffectiveness.ts`.
3. **Tracking tab.** The coupling matrix panel stacks *below*
   `SetpointTrackingPanel` — coupling is the cross-axis extension
   of setpoint tracking (gyro response on the *other* axes).
   Mirrors how the Servos tab stacks 3 panels and how M-FF put
   `FFPanel` on the Step tab via `StepTab.vue`.

## Scope

**In:**
- `lib/coupling.ts` — the 3×3 coupling analysis (Layer 2).
- `CouplingPanel.vue` — the matrix visualization (Layer 3).
- Tracking tab → multi-panel (`TrackingTab.vue`).
- `lib/recommenders/coupling.ts` — diagnostic-only recommender.

**Out (deferred, with triggers):**
- **Multi-log compare for the matrix.** MVP shows the active log's
  matrix only (`useActiveLog`). N side-by-side 3×3 matrices is a
  layout problem — defer until someone actually wants to diff
  coupling across a tune revision (pairs naturally with craft
  persistence).
- **CLI emission** — out permanently for this module by decision 2.
- **Aero-coupling modelling** — transient gating makes it
  unnecessary; do not build a banked-turn compensation model.

## Approach

- **Data:** `setpoint[0..2]`, `gyroADC[0..2]` via the signal
  registry. No new debug mode — all four are main-frame fields.
- **Segment selection:** call `maneuverDetect`, keep only
  **single-axis-dominant** windows (its `roll` / `pitch` / `yaw`
  classes — *exclude* `mixed`; coupling needs one cleanly commanded
  axis). The window's dominant axis is the *commanded* axis.
- **Per window:** measure the gyro response magnitude on the
  commanded axis (the normalizer) and on the other two axes.
  Off-diagonal `coupling[commanded][responding] =
  response[responding] / response[commanded]`.
- **Aggregate** across all windows sharing a commanded axis → the
  3×3 matrix, with a per-row sample count.
- **Matrix shape:** rows = commanded axis, cols = responding axis.
  Diagonal = the normalizer (≡100% by construction — the panel
  de-emphasizes it). Only the 6 off-diagonal cells carry signal.

## Slice breakdown

### Slice 1 — `lib/coupling.ts` (Layer 2, no Vue)

- Input: the three setpoint + three gyro Float32 arrays, the time
  axis, and the `maneuverDetect` window list (caller passes it in —
  keep `coupling.ts` decoupled from the detector's invocation).
- Filter windows to single-axis-dominant; group by commanded axis.
- **Response metric:** peak |gyro| within the window for each axis
  (peak, not RMS — coupling shows as a discrete wobble; matches the
  detector's peak-velocity character). `// TODO` note if RMS proves
  better on the corpus.
- **Response tail:** coupling lags the command — extend each window
  by a short tail before measuring the responding axes. Start
  conservative (~150-250 ms, wing-regime); `// TODO calibrate`.
- Output: `CouplingResult` = `{ matrix: number[3][3] (signed
  fraction), sampleCount: number[3], coverage per commanded axis }`.
  Keep the **sign** internally (direction of coupling); the panel
  displays magnitude.
- Float32 for any field-shaped scratch arrays (memory-model
  cardinal rule).
- **Tests:** pure single-axis command with zero cross-axis gyro →
  ~zero off-diagonal; injected roll→pitch coupling at a known
  ratio → matrix recovers it within tolerance; `mixed` windows
  excluded; commanded axis with too few windows → flagged
  under-sampled.

### Slice 2 — `CouplingPanel.vue` (Layer 3)

- A **3×3 grid**, not a uPlot chart — no `useUPlot`.
- Off-diagonal cells colored by coupling magnitude (green low →
  yellow → red high; thresholds shared with the recommender via a
  single source of truth). Each cell shows the percentage + sample
  count.
- Diagonal cells de-emphasized ("— commanded").
- Under-sampled commanded axis (row) → hatched / greyed with a
  "needs more single-axis <axis> inputs" note. Honest empty state
  when no single-axis maneuvers were detected at all.
- Active-log only via `useActiveLog` (see deferred multi-log note).
- *Optional:* click an off-diagonal cell → pin the shared cursor at
  the worst representative window for that pair (evidence
  affordance, like the airspeed recommender's peak-residual chip).

### Slice 3 — Tracking tab → multi-panel

- If the Tracking tab still renders `SetpointTrackingPanel`
  directly, introduce `TrackingTab.vue` that stacks
  `SetpointTrackingPanel` + `CouplingPanel`, mirroring
  `StepTab.vue` (added in abff4fa) and the Servos tab.
- Wire `TrackingTab.vue` into the tab router; one-line `TabBar`
  touch if needed. Tab count stays at 10.
- Confirm `SmoothingControl` gating is unaffected — the smoothing
  slider is gated to smoothable tabs; the coupling matrix is not a
  raw time-domain trace, so it neither needs nor receives smoothing
  (`SetpointTrackingPanel` above it still does).

### Slice 4 — `lib/recommenders/coupling.ts`

- **Diagnostic-only**, yellow-confidence, NO CLI (pattern:
  `spa.ts` / `inputChain.ts` / `ffEffectiveness.ts`).
- For each off-diagonal cell over the significance threshold:
  yellow rec — "Roll inputs perturb pitch by 18% — check mixer
  balance, CG, or a mechanical bind." Prose hint, no `set`.
- Gate on sample sufficiency: under-sampled commanded axis → no
  rec for that row (don't recommend off three windows).
- Still returns a `ConfidenceResult` per cardinal rule 5, even
  with no CLI.
- Register in `lib/recommendations.ts` `gatherRecommendations`
  (M-FF added `ffEffectiveness` there in abff4fa — same spot).

## Open questions carried into execution

1. **Significance threshold** — what off-diagonal % is "real"
   coupling vs measurement noise? Wing-regime value, `// TODO
   calibrate` against the corpus. Conservative start; diagnostic-
   only means a too-low threshold just over-reports, no bad CLI.
2. **Response tail length** — how far past the command window to
   look for the coupled response. `// TODO calibrate`.
3. **Peak vs RMS** response metric — start with peak; revisit if
   the corpus says RMS is steadier.
4. **Sample-sufficiency floor** — minimum single-axis windows per
   commanded axis before a row is trusted / a rec fires.

All four are calibration knobs, not blockers — the module ships
diagnostic-only with conservative defaults and `TODO` markers, the
same way M-Servo input-chain and M-FF shipped.

## Test plan

- Unit (`tests/unit/`): `coupling.ts` (synthetic cases above),
  `coupling` recommender.
- Corpus: Brian's USE_WING logs (btfl_002/003/005) via
  `npm run corpus:validate:private` — check whether they contain
  isolated single-axis maneuvers; if not, the honest empty state
  is what the panel should show.
- Per-skill self-check before commit. Note: the vitest runner-init
  crash (`project-vitest-pin`) may still block the suite — resolve
  that first so Slice 1's TDD-shaped tests actually run.
