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

1. **M-FF — Feedforward effectiveness + maneuver detection** (combined)
2. **M-Coupling — Cross-axis coupling matrix**
3. **M-Servo-2 — Servo hunt + airframe transfer function**
4. **M-Pilot — Pilot-input style analysis**
5. **Airspeed slice — voltage-sag ↔ fit-accuracy correlation** (small,
   folds into the existing Airspeed panel)
6. **M-FilterSim — interactive per-stage filter preview** (simulate
   the BF filter chain; foundation for the wing filter estimator)
7. **Craft persistence infrastructure** — needs its own design pass
   before any of the above can have a longitudinal-history feature
8. **Wing-regime spectral batch** — airspeed-binned step response +
   airspeed×frequency spectrogram (both high-value, reuse existing
   engines) + low-frequency airframe-mode detection + wavelet / non-
   stationary spectra (more speculative). From the 2026-05-19
   PTB-vs-wing discussion.

**UX / infrastructure follow-ups** (not analytics — surfaced during
M-FF, 2026-05-19):
- **App-wide display smoothing** — global raw/smoothed toggle + strength
  slider.
- **Tab IA consolidation** — 10 tabs is a lot; collapse the wing-
  scheduled-gain family into one.

M-FF is first because it has the clearest tuning payoff, it's self-
contained (no persistence-infra dependency), and FF is genuinely hard
to tune by feel — turning it into a number is high user value.

---

## M-FF — Feedforward effectiveness + maneuver detection

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

## M-Coupling — Cross-axis coupling matrix

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

## M-Servo-2 — Servo hunt + airframe transfer function

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

## M-Pilot — Pilot-input style analysis

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
- **Open question:** this leans toward "interesting once in a while"
  rather than "tune against it every flight" — keep it lightweight,
  don't over-invest.

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

### App-wide display smoothing

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

M-FF, M-Coupling, M-Servo-2, M-Pilot are all independent — none
depends on another, so they can be picked up in any order (priority
order above is by payoff). The Airspeed slice is opportunistic.

Craft persistence is the one with a hard ordering constraint:
**design the storage layer before building any longitudinal feature.**
Until then, every analytic above is per-session, which is fine — they
all work on a single dropped log.
