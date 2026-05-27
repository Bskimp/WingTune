# WingTune analytics expansion plan

Forward-looking plan for analytics beyond the shipped M1-M7 + M-Servo
suite. Captured 2026-05-19 from a brainstorm of "what else can we pull
from the blackbox data." This is a **planning doc, not an execution
doc** — each item has a sketch, not a slice-by-slice breakdown. Write
the execution detail when a milestone is actually picked up.

Items here were triaged with Brian — what's IN reflects his actual
interest as a sport-flying pilot, not a generic feature list. The
"Dropped / deferred" section records what was rejected and WHY so we
don't re-litigate it later.

---

## Priority order

> **Status (2026-05-22):** items 1 (M-FF), 2 (M-Coupling), 3
> (M-FilterSim / Spectrum-roadmap S1), 4 (Spectrum-roadmap S2),
> 5 (M-Style), 6 (M-Servo-2), 7 (M-Pilot) and 10 (Airspeed-binned
> step response — slotted in as a discretionary slice 2026-05-19)
> have all shipped. **Every buildable-now analytics-plan milestone
> has shipped.** What remains is threshold calibration (gated on the
> purpose-built sorties in `docs/wingtune-calibration-flights.md`),
> the opportunistic Airspeed voltage-sag slice (#8), and the
> research-deferred craft persistence work (#9).

1. ~~**M-FF — Feedforward effectiveness + maneuver detection**~~ —
   ✅ **shipped** abff4fa (2026-05-19)
2. ~~**M-Coupling — Cross-axis coupling matrix**~~ —
   ✅ **shipped** e5f9d87 (2026-05-20)
3. ~~**M-FilterSim (S1) — per-stage filter simulation**~~ —
   ✅ **shipped** 2026-05-20, see `docs/wingtune-spectrum-roadmap.md`
4. ~~**Airspeed-resolved spectra (S2)**~~ — airspeed×frequency
   spectrogram + low-frequency airframe-mode detection —
   ✅ **shipped** 2026-05-21, see `docs/wingtune-s2-execution.md`
5. ~~**M-Style — Tune-style profiles (the "style dial")**~~ —
   ✅ **shipped** 2026-05-21 (`c52ee74` + `f1d9030`), see
   `docs/wingtune-m-style-execution.md`. Slice 4 (auto-suggest hook)
   closed by M-Pilot Slice 3 (2026-05-22).
6. ~~**M-Servo-2 — Servo hunt + airframe transfer function**~~ —
   ✅ **shipped** 2026-05-21 (`0700b0c`..`6f350cc`), see
   `docs/wingtune-m-servo-2-execution.md`
7. ~~**M-Pilot — Pilot-input style analysis**~~ —
   ✅ **shipped** 2026-05-22 (`39a1e91`), see
   `docs/wingtune-m-pilot-execution.md`. Closed the deferred
   M-Style Slice 4 along the way (non-binding profile auto-suggest
   on `TuneProfileControl`).
8. **Airspeed slice — voltage-sag ↔ fit-accuracy correlation** (small,
   folds into the existing Airspeed panel)
9. **Craft persistence infrastructure** — needs its own design pass
   before any of the above can have a longitudinal-history feature
10. ~~**Airspeed-binned step response**~~ — ✅ **shipped** 2026-05-19
   (slotted in as a discretionary slice off the analytics-plan
   queue, alongside the I-term trim diagnostic that day). Lives on
   the Step tab (`AirspeedStepResponsePanel`), reuses
   `computeStepResponse` + the M3 airspeed estimate. The wavelet
   scalogram (item 4's deferred sub-slice) is the one wing-regime
   spectral-batch item still NOT shipped.

**UX / infrastructure follow-ups** (not analytics — surfaced during
M-FF, 2026-05-19):
- ~~**App-wide display smoothing**~~ — ✅ **shipped** d28c836
  (2026-05-19): `lib/displaySmooth.ts` + `SmoothingControl.vue`,
  display-only boxcar on 6 time-domain panels.
- **Tab IA consolidation** — 10 tabs is a lot; collapse the wing-
  scheduled-gain family into one.

M-FF is first because it has the clearest tuning payoff, it's self-
contained (no persistence-infra dependency), and FF is genuinely hard
to tune by feel — turning it into a number is high user value.

---

## M-FF — Feedforward effectiveness + maneuver detection ✅ SHIPPED

> ✅ Shipped 2026-05-19 (commit `abff4fa`): `lib/maneuverDetect.ts`
> (segment selector), `lib/ffEffectiveness.ts`,
> `lib/recommenders/ffEffectiveness.ts` (diagnostic-only),
> `FFPanel.vue` on the Step tab. The sketch below is the original
> design intent, kept for reference.

**Why:** FF is one of the harder terms to tune even with data. It
responds to stick *velocity* (rate of setpoint change), not error —
it's a "head start" that pushes the servo the instant the stick moves
instead of waiting for gyro error to accumulate. The standard
"adjust FF until the P-term does nothing during the move" workflow is
feel-based; we can measure it directly.

**Key insight — maneuver detection is not standalone.** It's the
*segment selector* that feeds the FF analysis (and improves Step
response too). Whole-flight Wiener deconvolution hopes the averaging
catches aggressive inputs; auto-detecting "here are the 6 snap rolls"
lets FF + Step analysis run on exactly those windows. Maneuver
detection + FF panel is ONE feature, not two.

### Maneuver detection (the segment selector)

- **Data:** `setpoint[0..2]`, `gyroADC[0..2]`.
- **Approach:** compute setpoint velocity (d/dt setpoint) per axis;
  flag windows where |velocity| crosses an aggressive threshold for
  a sustained-enough span. Classify rough type by which axis(es)
  spiked (roll-dominant → snap roll; pitch-dominant → pitch punch;
  both → mixed). Merge adjacent windows.
- **Output:** a list of `{axis, startSec, endSec, type, peakVelocity}`
  maneuver windows. Not a panel on its own — consumed by FF + Step.
- **Open question:** thresholds are wing-regime-dependent. Start with
  a conservative aggressive-velocity gate, mark `TODO calibrate`
  against the corpus.

### FF effectiveness panel

- **Data:** `setpoint[i]` (→ velocity), `axisF[i]`, `axisP[i]`,
  `gyroADC[i]`.
- **What it shows:** per-axis, within detected maneuver windows —
  - setpoint velocity trace (the FF input)
  - F contribution trace (should track velocity tightly; F/velocity
    ratio IS the effective FF gain)
  - P contribution trace (should stay LOW during fast moves if FF is
    doing its job)
- **Derived metric — "FF coverage":** during high-velocity windows,
  `mean|F| / (mean|F| + mean|P|)`. High = FF pulling its weight;
  low = FF undergained, P is doing FF's job.
- **Derived flag — leading-edge overshoot:** stick moved fast → did
  gyro punch past setpoint immediately after the transient? =
  FF overgain.
- **Recommender:** yellow-confidence rec when FF coverage is low
  ("FF coverage on roll is 35% during fast inputs — P is carrying
  the transient, raise `f_roll`") or when leading-edge overshoot is
  detected ("FF overshoots on pitch — lower `f_pitch`"). CLI emission
  deferred until calibrated against multiple wing flights.
- **Caveat:** FF only reacts to stick speed — smooth flying gives FF
  nothing to do. The panel is meaningless without aggressive inputs,
  which is exactly why it's gated to detected maneuver windows.

### Synergy with Step

Step response currently runs whole-flight Wiener deconvolution. Once
maneuver detection exists, Step can optionally run per-maneuver
deconvolution on just the aggressive windows — cleaner signal than
whole-flight averaging. Low-effort follow-on once the detector exists.

---

## M-Coupling — Cross-axis coupling matrix ✅ SHIPPED

> ✅ Shipped 2026-05-20 (commit `e5f9d87`): `lib/coupling.ts`,
> `CouplingPanel.vue` on the Tracking tab,
> `lib/recommenders/coupling.ts` (diagnostic-only). Gated on
> transient single-axis snap windows. The sketch below is the
> original design intent; execution detail in
> `docs/wingtune-m-coupling-execution.md`.

**Why:** "the wing rolls fine but pitches weirdly when I correct" is
a real mystery-bug class no current panel surfaces. When you command
roll, does pitch wobble? = mixer bug, CG issue, or mechanical bind.
When you pitch up, does yaw drift? = adverse yaw or bind.

- **Data:** `gyroADC[0..2]`, `setpoint[0..2]`.
- **Approach:** during windows of high setpoint velocity on ONE axis,
  measure the gyro response on the OTHER two axes. Normalize by the
  commanded-axis response. Build a 3×3 matrix: diagonal = intended
  response, off-diagonal = unwanted coupling.
- **Output:** 3×3 matrix visualization (commanded axis × responding
  axis). Off-diagonal cells colored by coupling strength.
- **Recommender:** yellow rec for significant off-diagonal coupling
  ("Roll inputs perturb pitch by 18% — check mixer balance / CG").
  No CLI — diagnosis is mechanical/config-side.
- **Open question:** how to separate genuine coupling from
  aerodynamically-expected coupling (e.g. a banked turn naturally
  loses some pitch authority). Probably gate on transient windows
  only, not sustained-attitude windows.

---

## M-Servo-2 — Servo hunt + airframe transfer function ✅ SHIPPED

> ✅ Shipped 2026-05-21 (`0700b0c`..`6f350cc`):
> `lib/transferFunction.ts` (Welch cross-spectral H(f) + coherence +
> bandwidth estimator), `AirframeBandwidthPanel.vue` (per-axis Bode
> plot, maneuver-window region selection with whole-flight fallback),
> `lib/servoHunt.ts` (per-servo hunt score via 2-pole high-pass on
> servo PWM vs same-band setpoint cross-correlation),
> `ServoHuntPanel.vue` (worst-first row list). All four slices
> diagnostic-only — no recommender, no CLI (servo hunt is bench-side;
> airframe bandwidth is a physics ceiling). Execution detail in
> `docs/wingtune-m-servo-2-execution.md`. The sketch below is the
> original design intent.

Extends the M-Servo suite (ServoPanel / InputChain / Asymmetry).

### Servo hunt detection (#10)

**Why:** fast small oscillations around a target = mechanical play,
worn linkage, or noisy feedback. Not visible in the bulk-lag view.

- **Data:** `servo[i]` / `motor[i]` PWM.
- **Approach:** d/dt servo PWM, look for sustained high-frequency
  small-amplitude wobble that doesn't correspond to a matching gyro
  command. Per-servo "hunt score."
- **Output:** extends ServoAsymmetryPanel or ServoPanel — per-channel
  hunt indicator.

### Airframe transfer function (#11)

**Why:** the InputChain panel reports bulk servo→gyro lag as a single
ms number. Splitting it by frequency reveals the airframe's
*bandwidth* — at low frequency the airframe follows servo input 1:1,
at higher frequency it rolls off, and the rolloff point is the hard
ceiling on how fast the airframe can EVER be tuned to respond. That
ceiling is genuinely useful: it tells you when you're chasing a tune
that physics won't deliver.

- **Data:** per-axis servo aggregate (`buildPerAxisServoAggregate`)
  + `gyroADC[i]`.
- **Approach:** FFT-based transfer-function estimate (cross-spectral
  density / coherence). The FFT machinery already exists in
  `lib/spectrum.ts` — reuse it. Magnitude response = |G(f)/S(f)|.
- **Output:** Bode-style magnitude plot per axis; mark the −3 dB
  rolloff frequency as the airframe bandwidth.
- **Open question:** needs decent excitation across the frequency
  band — pairs naturally with maneuver detection (M-FF) for window
  selection.

---

## M-Pilot — Pilot-input style analysis ✅ SHIPPED

> ✅ Shipped 2026-05-22 (`39a1e91`): `lib/pilotStyle.ts` (per-axis
> activity / reversals / strokes via hysteresis zigzag + aggregate
> roll+pitch verdict), `PilotStylePanel.vue` on the Summary tab
> (under `SummaryTab.vue`), and the M-Style auto-suggest hook on
> `TuneProfileControl.vue` — non-binding "this log looks flown 3D-
> style — switch profile?" hint with `[switch]` / `[dismiss]`.
> Closed the deferred M-Style Slice 4 along the way. Execution
> detail in `docs/wingtune-m-pilot-execution.md`. The sketch below
> is the original design intent.

**Why:** distinguishes "wing is unstable + pilot is fighting it" from
"wing is stable + pilot is aggressive" from "calm wing, calm pilot."
That distinction changes the tuning advice.

- **Data:** `rcCommand[0..3]`.
- **Approach:** stick activity histogram + correction frequency
  (reversals per second, amplitude distribution). A wing that needs
  constant small corrections reads differently from one flown with
  deliberate large inputs.
- **Output:** a summary-stat panel — correction rate, input amplitude
  distribution, per-axis activity. Possibly a one-line characterization
  ("frequent small corrections — wing may want more dihedral / softer
  rates").
- **Feeds M-Style:** the input-style classification is the natural
  signal for *suggesting* a tune-style profile (Cruise / Sport / 3D) —
  see M-Style below.
- **Open question:** this leans toward "interesting once in a while"
  rather than "tune against it every flight" — keep it lightweight,
  don't over-invest.

---

## M-Style — Tune-style profiles (the "style dial") ✅ SHIPPED

> ✅ Shipped 2026-05-21 (Slices 1-3; commits `c52ee74` + `f1d9030`):
> `lib/tuneProfile.ts`, the persisted `view.tuneProfile`,
> `TuneProfileControl.vue`, and the coupling / filter-delay /
> step-response thresholds migrated to be profile-aware. TPA audited
> + deliberately not migrated. Slice 4 (M-Pilot auto-suggest)
> deferred until M-Pilot ships. Execution detail:
> `docs/wingtune-m-style-execution.md`. The notes below are the
> original design intent.

**Why:** every recommender emits thresholds and CLI targets against an
implicit "default wing." But the *same log* should produce different
advice depending on what the wing is FOR. A relaxed cruiser and a 3D /
aggressive plane want genuinely different tunes: the cruiser trades
latency for smoothness and wants well-damped, predictable behaviour;
the 3D plane wants the filter chain as short as possible, leans on
feedforward, and treats light damping as a feature, not a fault. The
analysis math is identical — what changes is the *interpretation*.

**The idea:** one user-facing setting — **Cruise / Sport / 3D** — that
shifts the recommenders' thresholds and targets. Not new analysis: an
interpretation layer over everything already built. Sport is the
jack-of-all-trades middle, and the default — so an un-set profile gives
balanced advice ≈ today's behaviour, and nothing regresses.

**Data:** none new. A `tuneProfile` setting + a profile-aware threshold
layer the recommenders read.

### What each profile shifts (per recommender)

- **Filter-delay budget (M4)** — 3D tightens the green/orange/red bands
  (less tolerated latency); Cruise loosens them.
- **TPA curve fit (M5)** — 3D biases the recommended `tpa_curve_pid_thr0`
  higher (more low-speed authority boost); Cruise lower.
- **Step response (M-Step)** — different "good" peak / latency targets;
  3D wants a snappier rise and tolerates more overshoot.
- **Coupling matrix (M-Coupling)** — 3D raises `SIGNIFICANT_COUPLING`
  (aggressive flight naturally couples axes; don't flag the expected).
- **Airframe modes (S2)** — 3D tolerates lighter damping; relevant only
  if that panel ever emits a rec (today it deliberately doesn't).
- The remaining recommenders (PIDFS shares, input-chain, SPA, airspeed)
  get a per-recommender review of which thresholds are style-sensitive.

### Architecture

- `tuneProfile: 'cruise' | 'sport' | '3d'` in the view store, persisted
  to `localStorage` so it survives reload.
- `lib/tuneProfile.ts` — the single place mapping profile → threshold
  set. Every per-style number is `TODO calibrate`; the Sport set equals
  today's hardcoded constants, so the default selection is a no-op.
- Recommenders take the active profile via `RecommenderArgs` and read
  thresholds from the profile instead of file-scope constants.
- A 3-way UI selector — global, near the Recommend tab (sibling to
  `SmoothingControl`).

**The honesty rule:** the profile is the user's *declared intent*. The
tool never silently picks it — worst case the user leaves it on Sport.
(Same fingerprint-as-suggestion principle as craft persistence.)

### Relationship to M-Pilot

M-Pilot *describes* how a log was flown (correction rate, input
amplitude); M-Style is the *setting* that changes the advice. They
pair: once M-Pilot ships it can *suggest* a profile ("this log was
flown aggressively — switch to the 3D profile?") — a suggestion, never
an override. M-Style ships first with manual selection; M-Pilot later
adds the suggest hook. M-Style does NOT depend on M-Pilot.

### Open questions

- **How many profiles** — 3 (Cruise / Sport / 3D) proposed; a 4th
  (race / efficiency?) could earn its place later. Start with 3.
- **Per-axis style?** A plane can be 3D in pitch/roll but tame in yaw —
  keep the dial global for v1; revisit only if it bites.
- **Targets vs confidence** — the profile shifts *thresholds and
  targets*, not the green/yellow/red confidence machinery itself.
- **Calibration** — every per-profile number wants corpus logs flown in
  each style. Ship conservative; Sport ≈ current behaviour.

**Slice sketch** (execution doc written when the milestone is picked
up): (1) `lib/tuneProfile.ts` + view-store ref + persistence; (2)
migrate the most style-sensitive recommenders — filter delay, TPA
curve, step response — to profile-aware thresholds; (3) the UI
selector; (4) — later, with M-Pilot — the auto-suggest hook.

---

## Airspeed slice — voltage-sag ↔ fit-accuracy correlation (#9)

**Why:** the BASIC airspeed model uses voltage as a thrust proxy.
When pack sag is high, the model's prediction degrades. Right now the
Airspeed panel shows R² but not WHY a fit is poor.

- **Data:** already-hydrated airspeed fit residual + `vbatLatest` /
  voltage field.
- **Approach:** plot the predicted-vs-actual airspeed RESIDUAL against
  instantaneous voltage. A residual that grows with sag confirms the
  battery is the fit's limiting factor.
- **Output:** enhancement to the existing AirspeedPanel — a small
  residual-vs-voltage inset or a header annotation. Recommender could
  add "fly with a fresher pack — sag is degrading the airspeed fit."
- **Scope:** small. Not a milestone — a slice that folds into the
  next time the Airspeed panel is touched.

---

## Craft persistence infrastructure

**Why:** longitudinal features (tune-revision history, baseline-per-
craft, cross-log trend tracking) all need a way to know "these logs
are the same plane." This is the first genuinely persistent-state
feature in the project — everything else is per-session.

**The mess-avoidance principle:** the mess happens when software
*decides* craft identity and gets it wrong silently. The design rule
is **fingerprint-as-suggestion, never as authority.**

### Fingerprint tuple

Stable across every P/I/D/F/S/rates/filter/TPA change — i.e. things
that DON'T change during tuning:

- Board target name (e.g. `FLYWOOF405NANO`)
- Mixer type + motor count + servo count
- Gyro hardware ID
- Receiver protocol + motor protocol + motor pole count
- Sensor presence (baro / mag / GPS)

Two genuinely-different builds almost always differ in mixer or
channel count. Two identical builds collide — handled below.

### The flow

1. On log load, compute the fingerprint hash.
2. Exactly one known craft matches → suggest *"Looks like
   **brian-wing-1** — same craft? [yes] [no, new craft]"*.
3. Multiple match (identical twin builds) → rank by soft similarity
   on the wider set-once-never-tuned config (`gyro_to_use`,
   `align_board_*`, OSD layout, serialrx settings) and suggest the
   top-ranked.
4. No match → *"New craft? Name it:"*.
5. **The user's confirmation is the source of truth.** The
   fingerprint only makes the suggestion smart. Nothing is ever
   auto-grouped silently — worst case is one extra tap.

### Store shape

- Keyed by **user-confirmed craft ID**, not by fingerprint.
- Craft record: label + fingerprints-seen + log references +
  optional designated baseline log.
- A misassigned log can be re-pointed.

### Open question — storage backend

Browser build → IndexedDB. Tauri build → a JSON file. This needs its
own design pass: it's the first persistent cross-session state, and
the browser/desktop split means the storage layer needs an
abstraction. **Do not start longitudinal features until this is
designed.**

### What persistence unlocks (future, post-infra)

- Tune-revision tracking — tag logs by CLI-config hash or manual
  label; plot RMS / peak / latency across revisions.
- Baseline-per-craft — auto-load the craft's reference flight next
  to every new log of the same craft.
- Cross-log trend analysis — "your last 5 tune changes show RMS
  90 → 75 → 80 → 65 → 60."

---

## M-FilterSim — interactive per-stage filter preview

**Why:** the Spectrum tab currently shows raw gyro vs full-chain
filtered gyro — the whole filter chain's net effect. It can't show
what any *individual* filter stage does, because logs only contain
raw (`gyroUnfilt`) and full-chain post-filter (`gyroADC`) — BF emits
no intermediate per-stage signal.

To show per-stage effect, the filter chain has to be **simulated**:
port BF's filter math to JS, apply it to the raw gyro stage by stage.
The existing raw/filt/both buttons then become a toggle per stage —
the displayed "filtered" trace is recomputed from whichever stages
are enabled. Toggle the dyn-notch and watch that peak reappear;
toggle a LPF and see the high-frequency rolloff vanish. Directly
answers "what noise is this filter actually touching."

**The honesty rule:** the simulation is not measured truth. The
logged `gyroADC` IS ground truth for the actual config. The sim must
be **validated against it** — apply the simulated *full* chain to raw
gyro, compare against the logged post-chain. Match → the per-stage
breakdown is trustworthy. Mismatch → flag it loudly ("sim diverges
from logged filter output — per-stage view unreliable"). Without that
check the per-stage spectra are just plausible fiction.

**Data:** `gyroUnfilt[i]` (raw), `gyroADC[i]` (validation ground
truth), `FilterConfig` from headers (already parsed in `scan.rs` —
dyn-notch + 4 LPFs + RPM filter). FFT machinery exists in
`lib/spectrum.ts`.

**Incremental path:**
1. Port BF biquad (PT1/PT2/PT3) + dynamic notch + RPM filter math to
   JS. Validate the simulated full chain against logged `gyroADC`.
   Load-bearing — nothing downstream is trustworthy without this.
2. Per-stage spectrum display — toggle each filter stage on/off,
   PSD recomputed from enabled stages.
3. Interactive cutoff editing — a filter sandbox. Edit a cutoff, see
   the predicted spectrum + delay budget update live. Preview a
   config change before flashing + flying.

**Open question — the dynamic notch.** It tracks frequency over time,
so an exact sim needs the per-sample notch center (logged only under
some debug modes). A static-center approximation works for stage 1;
exact tracking is a refinement, not a blocker.

**Relationship to other work:** the simulator is the foundation for
the deferred **wing filter estimator** (referenced in the dropped
wind-estimator note below). Build M-FilterSim and the filter
estimator becomes a much smaller follow-on.

---

## Wing-regime spectral batch

From the 2026-05-19 PTB-vs-wing discussion. PIDtoolbox conflates two
things: universal signal processing (transfers to wings unchanged) and
a quad-specific interpretive overlay (does not). WingTune already
rebuilt most of the overlay — wing-scaled step metrics, airspeed-based
TPA physics, SPA event detection, servo-lag decomposition. Four gaps
remain, each about giving an analysis a wing-correct *axis* or *band*.

Items 2-4 share short-time-FFT (spectrogram) machinery — build one and
the rest get cheaper. Items 1-2 are the high-value pair: both reuse
engines that already exist (M-Step, M4 spectrum, M3 airspeed) and both
turn TPA-curve guessing into measurement. Items 3-4 are more
speculative — capture now, prioritise later.

### 1. Step response binned by airspeed

**Why:** M-Step runs one whole-log Wiener deconvolution. On a wing the
plant scales with dynamic pressure (q = ½ρV²) — a tune crisp at cruise
is sluggish slow / twitchy fast, and one averaged step response hides
that. Binning by airspeed shows plant variation across the envelope,
and that variation *is* the TPA curve being tuned.

- **Data:** existing M-Step inputs (`setpoint[i]`, `gyroADC[i]`) + the
  M3 airspeed estimate.
- **Approach:** reuse `computeStepResponse`; segment the log into 4-6
  airspeed bins, deconvolve per bin. Pairs with M-FF maneuver
  detection for clean per-bin excitation.
- **Output:** small-multiples (step response per bin) or an overlay;
  surfaces peak / latency drift vs airspeed.
- **Open question:** sample sufficiency — a short flight won't
  populate the fast bins. Grey out under-sampled bins.
- **Note:** highest-leverage item — ties M-Step + M3 + M5 together,
  all already built.

### 2. Airspeed × frequency spectrogram

**Why:** M4 Spectrum is a 1-D whole-log PSD. Wing resonances,
control-surface buzz, flutter precursors *onset at a speed* — a
whole-log PSD smears that out. The quad throttle×frequency view
doesn't help (throttle barely tracks gyro noise on a vibration-
isolated tractor wing); airspeed is the dimension the plant scales
with.

- **Data:** `gyroADC[i]` + M3 airspeed estimate. FFT machinery in
  `lib/spectrum.ts`.
- **Approach:** STFT — short windows along the log, each → a PSD
  column; sort / bin columns by airspeed instead of time.
- **Output:** per-axis heatmap (x = airspeed, y = frequency, colour =
  power). The primary spectral view for wings, beside the whole-log
  PSD.
- **Open question:** sparse fast-end airspeed data → sparse columns.

### 3. Low-frequency airframe-mode detection

**Why:** nothing targets the 0.05-3 Hz band where wing airframe modes
live — short-period (~0.5-2 Hz), dutch roll (~0.2-1 Hz), phugoid
(~0.02-0.07 Hz). A peak there is an airframe dynamic mode (CG, tail
volume, dihedral diagnostic), not noise. PTB points at 30-90 Hz; on a
wing that band is structural and the interesting band is ~100× lower.

- **Data:** `gyroADC[i]` catches short-period + dutch roll; phugoid is
  a speed / altitude exchange mode barely visible on the gyro — needs
  airspeed + altitude.
- **Approach:** low-frequency PSD + peak detection below ~3 Hz.
  Phugoid needs a window down to ~0.02 Hz → 100 s+ of continuous
  flight to resolve; flag when the log is too short.
- **Output:** detected modes (frequency + rough damping), labelled by
  likely mode. A panel or a Spectrum sub-view.
- **Open question:** damping from a log is noisy and mode labelling
  needs heuristics; phugoid detection is log-length-limited — likely
  "best effort."

### 4. Wavelet / non-stationary spectral analysis

**Why:** M4 uses Welch's method — averaged periodograms, a stationary
assumption. Correct for motor harmonics; wrong for wing disturbances,
which are mostly non-stationary (discrete gusts, a one-off buffet, a
flutter-onset transient). Averaging smears those into the noise floor;
a time-localised transform keeps "broadband transient at t = 14.2 s."

- **Data:** `gyroADC[i]`.
- **Approach:** STFT scalogram first (reuses FFT machinery, shares
  code with item 2); evaluate a continuous wavelet transform later if
  the low-freq / time tradeoff matters.
- **Output:** a time×frequency scalogram — complements the stationary
  PSD, does not replace it.
- **Open question:** is a CWT worth the extra code over an STFT?
  Start STFT, decide later.

---

## UX / infrastructure follow-ups

Surfaced during M-FF when the feedforward panel's raw setpoint-velocity
trace rendered as a blocky mess and the 10-tab bar started feeling
crowded. Neither is analytics — both are presentation/IA.

### App-wide display smoothing ✅ SHIPPED

> ✅ Shipped 2026-05-19 (commit `d28c836`). Sketch below kept for
> reference.

**Why:** the raw derivative on the FF panel (and noisy raw traces
generally — Tracking, Servos, PID contribution, SPA, S-Term) is hard
to read on a poorly-tuned or turbulent flight. A global raw/smoothed
toggle + strength slider lets the user clean up the chart for trend-
reading, or stay on raw for "is this real signal."

**The hard rule — smoothing is DISPLAY-ONLY.** It must never feed the
analysis layer. Step peak, RMS error, FF coverage, filter delay are
all computed from raw Float32 arrays; if a smoothing slider fed those,
the chart would disagree with its own header numbers and — worse — a
bad tune could be smoothed into looking fine. Per
`wingtune-confidence-scoring`, that's a no-go.

**Design:**
- Global `smoothingStrength` in the view store (0 = raw, N = boxcar
  width or similar).
- A display-layer transform applied to the *render copy* of raw
  traces — never the analysis input. New Float32 arrays per the
  memory-model cardinal rule.
- Clear raw/smoothed indication in the UI — smoothing hides real
  high-frequency problems, which is sometimes the exact thing the
  user needs to see.
- **Does NOT apply everywhere.** Spectrum PSD is already a frequency
  transform; Step is already an average; TPA is a discrete scatter.
  Applies only to raw time-domain field traces: Tracking, Servos,
  PID contribution, SPA, S-Term, FF.

**Scope:** a feature slice — touches ~6 panels + the view store +
wherever the slider lives (header? a settings strip?). Not a
milestone, but bigger than a drive-by.

Note: the FF panel already smooths its *velocity* display trace
locally (commit for M-FF) — a derivative is intrinsically noisy and
needs it regardless. The global feature is for raw field traces.

### Tab IA consolidation

**Why:** the tab bar grew from ~4 (tracking / setpoint / airspeed /
spectrum) to 10. That's a lot to scan. FF going onto the Step tab
(Step · FF, double-duty) held the count at 10 rather than 11, but the
underlying crowding is real.

**Highest-leverage cut:** Airspeed / TPA / SPA / S-Term are all one
family — wing-specific scheduled-gain analyses (airspeed feeds TPA,
TPA scales S, SPA gates I). Collapsing those four into a single
"Scheduling" tab (stacked panels, the way Servos already stacks 3)
takes the bar 10 → 7.

**Why it's not done inline:** this is an information-architecture
redesign — tab grouping, possibly a sub-nav within the consolidated
tab, naming. It interacts with the locked visual direction
(see `project-direction-c-blueprint` memory). Deserves a deliberate
design pass, not a mid-milestone edit.

---

## Dropped / deferred — and why

Recorded so we don't re-litigate.

- **Per-flight-phase segmentation (takeoff/cruise/landing).** More
  useful to other people than to a sport flyer. Reasonable IF BF's
  autopilot/nav direction matures — revisit then.
- **Wind / turbulence estimator.** "Look at it once in a while" tab,
  not an every-flight tool for sport flying. Would become worthwhile
  if a wing filter estimator is ever built (the two share the
  steady-state-disturbance math).
- **Power profile / thrust efficiency (#6), battery health (#7),
  energy management (#8).** Whole power/energy domain deferred —
  becomes relevant if/when BF leans further into navigation/XC. Not
  sport-flying priorities now.
- **Saturation event log (#12).** Easily checked on the bench and
  should be anyway — not worth a log-analysis feature.
- **Cross-log maneuver-quality comparison.** The maneuver *detection*
  is kept (it feeds M-FF); comparing maneuver quality across logs is
  dropped — unclear payoff, and it depends on craft persistence
  anyway.

---

## Sequencing note

M-FF, M-Coupling, M-Servo-2, M-Pilot were all independent — none
depended on another, so they shipped in payoff-priority order
(2026-05-19 through 2026-05-22). The Airspeed voltage-sag slice (#8)
remains opportunistic — folds in next time the Airspeed panel is
touched.

Craft persistence is the one with a hard ordering constraint:
**design the storage layer before building any longitudinal feature.**
Until then, every analytic above is per-session, which is fine — they
all work on a single dropped log.

The post-analytics work is **threshold calibration** — every
TODO-calibrate constant in the suite gets resolved by Brian's
purpose-built sorties (`docs/wingtune-calibration-flights.md`) plus a
follow-on pass to convert the first-guesses into measured numbers.
Until those flights are flown, the suite is feature-complete on this
plan's terms; no new analytics-plan milestone is queued.
