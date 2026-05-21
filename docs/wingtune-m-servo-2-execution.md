# M-Servo-2 execution plan — servo hunt + airframe transfer function

Execution detail for **M-Servo-2** — analytics-plan priority #6. The
analytics plan (`docs/wingtune-analytics-plan.md`, the "M-Servo-2"
section, sub-items #10 + #11) is the "why"; this doc is the
slice-by-slice breakdown.

> **Read first:** `wingtune-architecture`, `wingtune-memory-model`,
> `wingtune-vue-conventions`. And the `CLAUDE.md` SCOPE box — wing
> closed-loop response is 200-500 ms, the interesting band sub-50 Hz.

## What M-Servo-2 does

Two servo/airframe diagnostics, both built on data already in every
log (servo PWM + gyro) — no debug mode, no special flight required:

1. **Servo hunt detection.** A servo can oscillate on its own — worn
   linkage, slop, noisy feedback — independently of what the FC
   commanded. Bulk input-chain lag (M-Servo MVP) can't see it.
   M-Servo-2 scores per-servo "hunt": high-frequency servo motion
   that does NOT correlate with the commanded setpoint / gyro.
2. **Airframe transfer function.** The InputChain panel reports
   servo→gyro lag as one bulk millisecond number. Splitting it by
   frequency gives the airframe's *bandwidth* — at low frequency the
   airframe tracks servo input ~1:1, then rolls off, and the rolloff
   point is the hard ceiling on how fast the wing can EVER be tuned
   to respond. That ceiling is genuinely useful: it tells you when a
   tune is chasing something physics will not deliver.

## Status

✅ **Complete** — all four slices shipped 2026-05-21.

- ✅ **Slice 1** — `lib/transferFunction.ts` shipped 2026-05-21.
  Welch-averaged cross-spectral estimator: `estimateTransferFunction`
  (H(f) = Sxy/Sxx, magnitude/dB/phase, coherence γ²) +
  `estimateBandwidth` (−3 dB rolloff vs the low-freq gain plateau,
  coherence-gated, returns `trustworthy`). 13 unit tests.
- ✅ **Slice 2** — `AirframeBandwidthPanel.vue` shipped 2026-05-21.
  Per-axis Bode panel on the Servos tab: |H(f)| dB + coherence vs log
  frequency, −3 dB rolloff marked, low-coherence spans greyed.
  Resolved open question 1 — `estimateTransferFunction` gained an
  optional `regions` param so the estimate runs over M-FF maneuver
  windows (each padded ±1 s and merged) when the flight has enough
  maneuver coverage, falling back to whole-flight otherwise; segments
  never straddle a region boundary so non-contiguous spans introduce
  no join discontinuity. 3 more unit tests for `regions`.
- ✅ **Slice 3** — `lib/servoHunt.ts` shipped 2026-05-21. Per-servo
  hunt score: 2-pole high-pass isolates the servo PWM hunt band,
  `hfRmsPwm` measures its amplitude, peak normalized cross-correlation
  against the high-passed rate setpoint gives the commanded fraction,
  `huntScore = hfRmsPwm · (1 − r)`. Setpoint (not gyro) is the command
  reference — see the module header for why gyro would make the score
  degenerate. 11 unit tests.
- ✅ **Slice 4** — `ServoHuntPanel.vue` shipped 2026-05-21. Per-channel
  hunt rows (HF RMS · cmd-corr · hunt score · severity badge), sorted
  worst-first, on the Servos tab. Built as its OWN panel rather than a
  strip on `ServoAsymmetryPanel` — hunt is per-channel and applies to
  every classified servo, whereas the asymmetry panel only renders
  axes with ≥ 2 servos, so embedding hunt there would hide it on
  single-surface-per-axis wings. **No recommender** (decided here per
  Scope) — a hunting servo is a bench investigation, not a firmware
  `set`; consistent with the rest of M-Servo-2 being diagnostic-only.

## Scope

**In:** `lib/transferFunction.ts` (cross-spectral estimator),
`lib/servoHunt.ts` (per-servo hunt score), an airframe-bandwidth Bode
panel on the Servos tab, a per-servo hunt indicator on an existing
servo panel.

**Out (deferred / not in scope):**
- **No recommender / no CLI.** Both outputs are diagnostic: a servo
  hunt is a mechanical fix (linkage, servo) and the airframe
  bandwidth is a physics ceiling — neither has a firmware `set`.
  Same diagnostic-only shape as M-Coupling / the airframe-modes panel.
  A diagnostic-yellow hunt rec is a possible later refinement —
  decide at Slice 4, do not pre-build.
- **Servo-loop identification** (modelling the servo's own transfer
  function) — out of scope; M-Servo-2 measures the airframe, and
  scores hunt as a scalar, nothing deeper.

## Slice breakdown

### Slice 1 — `lib/transferFunction.ts` (cross-spectral estimator)

Layer 2, no Vue. The load-bearing analytical piece.

- Welch-averaged **cross-spectral density**: over Hann-windowed
  overlapping segments (reuse `fftInPlace` + `hannWindow` from
  `lib/spectrum.ts` — do NOT add a second FFT), compute the auto-
  spectra `Sxx`, `Syy` and the complex cross-spectrum `Sxy`.
- **Transfer function** `H(f) = Sxy(f) / Sxx(f)`; the magnitude
  response is `|H(f)|`. **Coherence** `γ²(f) = |Sxy|² / (Sxx·Syy)`
  ∈ [0,1] — the honesty metric: γ² near 1 means the output is
  linearly driven by the input at that frequency, near 0 means noise
  or no excitation there. A magnitude point with low coherence is not
  trustworthy and the UI must grey it.
- `estimateBandwidth` — the −3 dB rolloff relative to the low-frequency
  gain plateau (NOT relative to 1.0 — the airframe's low-freq gain is
  whatever the mixer + control authority make it). Returns the rolloff
  frequency + a confidence flag derived from the coherence in the band.
- Inputs: an `x` (servo) + `y` (gyro) Float32 pair + sample rate.
  Float32 throughout (memory-model cardinal rule).
- **Tests:** a synthetic known first-order system (`y` = low-passed
  `x`) → `|H|` matches the analytic rolloff, coherence ≈ 1; `x` and
  `y` uncorrelated → coherence ≈ 0 everywhere; the −3 dB estimate
  lands on the planted cutoff.

### Slice 2 — airframe-bandwidth panel

Layer 3 — `wingtune-vue-conventions`, `useActiveLog`. New panel on the
Servos tab.

- Per-axis Bode-style magnitude plot: `|H(f)|` in dB vs log frequency.
  The input is the per-axis servo aggregate (`buildPerAxisServoAggregate`
  from `lib/inputChain.ts`) vs `gyroADC[axis]`.
- The −3 dB rolloff marked + labelled "airframe bandwidth ≈ X Hz".
- **Coherence-gated:** frequency regions where γ² is below a trust
  threshold are greyed / the trace dimmed — the estimate there is
  unreliable. A panel-level note when coherence is poor across the
  whole band ("not enough broadband input — fly more aggressively").
- Window selection — see open question 1.

### Slice 3 — `lib/servoHunt.ts` (per-servo hunt score)

Layer 2, no Vue.

- Per servo: isolate the high-frequency band of the servo PWM signal,
  measure its energy, and measure how much of that HF content
  correlates with the commanded axis (setpoint / gyro). **Hunt score
  ≈ HF servo energy × (1 − correlation-with-command)** — high HF
  motion that the FC did NOT command.
- The HF band edge + the hunt-score threshold are wing-regime first
  guesses — mark `TODO calibrate`.
- **Tests:** a servo signal that is pure commanded response → hunt
  score ~0; a servo with an injected uncommanded oscillation → high
  score; a clean low-frequency servo → ~0.

### Slice 4 — per-servo hunt indicator (UI)

Layer 3. Extend `ServoAsymmetryPanel` (or `ServoPanel`) with a
per-channel hunt indicator — a small score / traffic-light per servo.
Decide here whether a diagnostic-yellow hunt rec is worth emitting
(see Scope).

## Open questions carried into execution

1. **Window selection for the transfer function** — whole-flight, or
   only the M-FF maneuver-detection windows (`detectManeuvers`)?
   Maneuver windows have the broadband excitation a transfer-function
   estimate needs; whole-flight cruise has little. Coherence gates
   trust either way, but maneuver-window selection should give a
   cleaner estimate. Lean: compute over maneuver windows when enough
   exist, fall back to whole-flight, and let coherence flag the rest.
2. **−3 dB reference** — relative to the low-frequency gain plateau,
   not to unity. Resolve the plateau estimate in Slice 1.
3. **Hunt HF band + threshold** — `TODO calibrate`; conservative
   wing-regime first guess, fail-safe because diagnostic-only.
4. **Servos tab is getting heavy** — ServoPanel + InputChainPanel +
   ServoAsymmetryPanel + the new bandwidth panel = 4. Same tab-IA
   pressure the Spectrum tab hit; defer to the tab-IA design pass,
   do not solve inline.

## Test plan

- Unit (`tests/unit/`): `transferFunction.ts` (synthetic known
  system + uncorrelated pair), `servoHunt.ts` (commanded vs injected
  hunt).
- Corpus: Brian's USE_WING logs carry servo PWM + gyro — they
  exercise both end to end. Flight 4 in `wingtune-calibration-flights.md`
  (aggressive maneuvers) supplies the broadband excitation the
  transfer function wants. `npm run corpus:validate:private`.
- Per-skill self-check before commit.
