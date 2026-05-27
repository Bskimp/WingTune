# WingTune tab guide

What each tab shows, what to look for, how to use it for tuning, and what
it can't tell you. Wing-specific framing throughout — many of the metrics
have quad-side analogues that are NOT directly applicable here (see the
SCOPE-PLANES-NOT-QUADS box in `CLAUDE.md`).

The general workflow this tool supports: **drop log → check Readiness →
read Recommend if anything's red → drill into the relevant tab for the
data behind the rec → make the BF CLI change → fly again → compare.**
Multi-log compare exists for the last step — drop two logs into the
LogRoster, the panels stack the traces so you can see what changed.

The **Tune Profile dial** (Cruise / Sport / 3D) sits in the controls
strip under the time bar — it reweights the recommendation and panel
thresholds for your flying style: a 3D wing tolerates less filter
delay and more overshoot than a relaxed cruiser. Default Sport is the
neutral all-rounder. When the loaded log's pilot-input style (see
Summary tab) doesn't match the active profile, a non-binding hint
appears: *"this log looks flown 3D-style — switch profile?"* with
`[switch]` / `[dismiss]`. The profile is your declared intent —
M-Pilot may suggest, never auto-apply.

---

## Summary

The first-impression tab. **Four sections, top-to-bottom:**

1. **Entry / Hrs / Firmware / Size** — log metadata strip. Confirms you
   loaded what you thought you loaded.
2. **Readiness · module capability** — which analytics WILL run on this
   log + which need different `debug_mode` / firmware to unlock. Each
   row resolves through the multi-source signal registry: USE_WING logs
   light up most modules via main-frame `wing*` fields without needing
   any debug-mode multiplexing; stock-BF logs surface "set
   `debug_mode = X`" hints for the modules that need debug channels.
3. **Header params panel** — every `key = value` BF wrote into the log
   header (~150-250 entries). Searchable; click-to-copy a `set k = v`
   command to clipboard. Useful for verifying current config or pasting
   a chunk into a new build.
4. **Pilot style · rcCommand** — characterises HOW the log was flown,
   from the raw stick traces. Per-axis activity bar + reversal rate +
   stroke p50/p90, plus an aggregate verdict (suggests Cruise / Sport /
   3D from amplitude; flags calm / active / busy from reversal rate).
   The gyro can't tell calm wing from busy pilot — the stick can. Roll
   + pitch drive the verdict; yaw is reported per-axis but excluded.
   Honest empty state when the log is < 3 s or the sticks barely moved.
   Feeds the auto-suggest hint on the Tune Profile dial above.

**What to use this tab for:** sanity-check before drilling in. The
pilot-style panel is the "what kind of flight am I looking at?" read —
a busy verdict tells you the gyro chatter you'll see in Tracking is
probably pilot-correction-driven, not airframe oscillation. If a tab
you care about shows BLOCKED on Readiness, the panel will show an
explanation — saves you opening it just to see "no data."

**Caveats:** Readiness shows what CAN run, not whether the analytics
will produce a USEFUL result. A green row on Airspeed BASIC fit just
means GPS is present; whether the fit is reliable depends on flight
content (Recommend's confidence gate handles that). Pilot-style
thresholds are wing-regime first guesses — the verdict only ever
*suggests*; calibration TODO against the corpus.

---

## Tracking

Setpoint vs gyro per axis, with RMS error + peak error stats.

**What you're looking at:** two overlaid time-domain traces per selected
axis: the commanded setpoint (rate of rotation the pilot asked for via
the rate curve) and the actual gyro reading (rate of rotation the
airframe achieved). The vertical gap between them at any moment IS the
tracking error.

**What it tells you:**
- **Sustained gap** between gyro and setpoint → controller is undergained
  (gyro can't catch up to commanded rates).
- **Gyro overshoots setpoint after stick movements** → P or F is too
  aggressive, response is rampant rather than damped.
- **Gyro oscillates around setpoint at idle** → noise filter chain
  isn't keeping up, or there's a mechanical resonance feeding back.
- **Big spike in peak error** at a specific time → either a sudden gust
  hit the airframe or you whipped the stick faster than the loop could
  follow. Time-stamp lets you correlate against other panels.

**Tuning workflow:** read this tab AFTER a tune change to compare the
before/after. RMS error is the single-number summary; lower = closer
tracking. Peak error tells you the worst moment, which is usually where
you'd start investigating.

**Caveats:** sustained 0 RMS isn't necessarily the goal — wings have
unavoidable transient lag from servo + aero physics. "Healthy" is
60-150 deg/s peak error during normal flight + low sustained error
during cruise.

---

## Servos

Three panels stacked: actuator PWM, input-chain lag breakdown, and
per-axis servo asymmetry.

### ServoPanel (top)

**What you're looking at:** every servo[i] + motor[i] channel's raw
PWM trace, with saturation strip showing how often each channel ran
at or near 1000/2000 (the rail). Per-channel toggle chips let you
isolate or hide.

**What it tells you:**
- **A servo saturating heavily** (high % in the strip) → the
  controller wants more authority than the surface can deliver.
  Either rates are too high for the surface, or you have a tuning
  oscillation slamming a servo against its endpoint.
- **A servo flat at 1500** → unwired or dead-channel; the strip's
  hidden-channels footer counts these.
- **Two paired servos with visually different patterns** → mixer
  asymmetry (see Asymmetry panel below).

### InputChainPanel (middle)

**What you're looking at:** per-axis lag breakdown across three
measurable stages of the pilot → airframe-motion chain:
```
rcCommand ─[A]─▶ setpoint ─[B]─▶ servoAgg ─[C]─▶ gyro
```
Each stage gets a colored ms chip; the row's Σ is the total. Yaw
typically empty (no setpoint→servo path on a single-elevon wing).

**What it tells you:**
- **Stage A high** (rate curves slow) → unusual; check
  `rc_smoothing_*` CLI values.
- **Stage B high** (PID + filter delay) → trim the filter chain
  (Spectrum tab shows where the delay accumulates) or raise P gain.
- **Stage C high** (servo + mechanical + aero) → bounded by physics
  (servo speed, surface size, airframe inertia, airspeed). Faster
  servos or higher airspeed help; PID tuning won't.
- **Total > 100 ms** on a wing → yellow band; > 200 ms is concerning
  and usually traces to either filter delay or a slow servo.

### ServoAsymmetryPanel (bottom)

**What you're looking at:** per-axis pairwise comparison of
contributing servos. For axes with ≥ 2 servos (typically Roll on
dual-aileron wings), one is picked as the reference (highest
correlation to the axis) and others are reported as `lag · amp · corr`
vs reference.

**What it tells you:**
- **lag ≠ 0** → one servo's PWM responds later than the other
  (signaling mixer-side or software-side delay).
- **amp ≠ 1.0** → different deflection amplitude commanded
  (sub-trim mismatch, endpoint asymmetry).
- **`ok` chip** → PWM-side healthy.

**Tuning workflow for Servos:** start with ServoPanel to confirm
all the actuators you expect are wired and not saturating. Then
read InputChainPanel — if total lag is high and one stage dominates,
that stage is your lever. ServoAsymmetryPanel is a sanity check;
warn-severity pairs prompt a check-your-linkage workflow.

**Caveats:** **BF wing-msp sends paired-identical PWM to both
ailerons** (physical reversal is mechanical, not mixer-side). A
perfect `ok` on the asymmetry panel validates the firmware side
ONLY — mechanical drift (loose horn, worn clevis, asymmetric
deflection) won't show in PWM. The only way to verify mechanical
asymmetry is a bench deflection gauge.

---

## Airspeed

The BASIC airspeed model fit (BF `tpa_speed_type = BASIC`). Fits
predicted airspeed (derived from throttle + voltage + pitch + a
handful of CLI-tunable model params) against measured GPS 3D speed.

**What you're looking at:** two overlaid traces over the GPS-window-
trimmed time range: solid = predicted speed from the BASIC model,
dashed = GPS 3D speed. Header shows R² (fit quality), RMS (residual
m/s), and the four fitted CLI params (delay, gravity %, max V, etc.).
"no pitch field — level flight assumed" annotation appears when
pitch isn't logged.

**What it tells you:**
- **R² > 0.7** → fit is reliable; the recommender will emit a
  paste-ready `set tpa_speed_basic_*` CLI block (green confidence).
- **R² 0.4-0.7** → drifty fit; recommender keeps it as analysis-only
  (no CLI), yellow confidence.
- **R² < 0.4** → poor fit; red confidence, no CLI. Usually means the
  flight had insufficient throttle variation, no GPS lock during
  cruise, or voltage sag dominating.

**Tuning workflow:** fly a sortie with throttle excursions across the
full range (slow cruise → fast cruise → hover where the wing can
tolerate it). The fitter needs ≥ 3 distinct throttle regimes to
constrain the model. Once R² clears 0.7, the rec emits CLI you can
paste into the BF Configurator.

**Caveats:** BASIC is BF's simpler airspeed model; ADVANCED uses a
pitot-equivalent feedback. WingTune currently fits BASIC only.

---

## TPA

The HYPERBOLIC TPA curve fit. Scatters measured `(tpa_arg, tpa_factor)`
pairs from the firmware + overlays the fitted 4-parameter HYPERBOLIC
curve (BF PR #13805 spec).

**What you're looking at:** scatter dots on `x ∈ [0, 1]` showing the
airspeed-argument-to-PID-multiplier mapping your aircraft actually
experienced + the Nelder-Mead-fitted curve. Header shows RMS,
endpoint params (`thr0` / `thr100`), expo curvature, and X RANGE
(the band of x values your flight actually covered).

**What it tells you:**
- **Curve flat-ish near 1.0 across full X range** → your aircraft
  doesn't need much TPA scheduling; PID gain is appropriate across
  the airspeed range you fly.
- **Curve drops sharply at high x** → wing needs PID attenuation at
  high airspeed (typical for fast cruise birds — without TPA, control
  authority becomes brittle at speed).
- **Curve climbs at low x** → wing needs PID boost at low airspeed
  (typical for sluggish low-speed response).

**Yellow warn ribbon** ("fit unreliable — params out of range,
x range only [0.05, 0.51] — fly throttle excursions") → the X RANGE
of your flight didn't cover enough of the curve domain to constrain
the fit. Nelder-Mead wandered into nonsense params; curve overlay is
suppressed but the scatter is still real data.

**Tuning workflow:** fly throttle excursions from cruise to max + back
to slow cruise. The fitter wants samples across the full x range,
especially the high-x end. Once X RANGE clears [0.0, 0.9] and the
warn ribbon disappears, the rec emits paste-ready `set tpa_curve_*` CLI.

**Caveats:** TPA factor > 1 = amplification (boost low-speed authority),
not attenuation. The y axis is capped at 5x to keep the chart readable
even if a wonky fit produces extreme values.

---

## SPA

Setpoint-rate-based I-term attenuation per axis. Shows the SPA
multiplier overlaid with the I-term value across the flight, plus
gate-active bands and wind-up / bounce-back event markers.

**What you're looking at:** SPA multiplier (left axis, 0..1) and
I-term value (right axis, scaled to fit). Two-color background bands
mark when SPA gate was active (briefly attenuating I to prevent
windup during fast setpoint excursions). Yellow / orange event
markers flag windup (I climbing while gate is at floor) and
bounce-back (post-release I peak within 200 ms).

**What it tells you:**
- **SPA flat at 1.0 most of the flight** → controller isn't aggressive
  enough during fast inputs to need attenuation; either you fly
  smoothly or SPA gain is set too low.
- **SPA dipping to 0 during stick whip + smooth recovery** → SPA is
  working as intended.
- **Wind-up events (I keeps climbing while gate is floored)** → SPA
  isn't preventing I from accumulating; either the gate threshold is
  too high or the I-term decay is too slow.
- **Bounce-back events (I peaks after stick release)** → I accumulated
  during the input and is now overshooting target — the wing might
  oscillate slightly after each fast input.

**Tuning workflow:** if you see frequent wind-up + bounce-back events,
lower the SPA threshold OR raise I-term decay. If SPA never engages,
either you don't need it (sluggish wing) or the threshold is too high.

**Caveats:** dual-axis chart — the I-term wave is on the RIGHT axis,
the SPA multiplier on the LEFT. The wavy line that dominates the
visual is usually I-term, NOT SPA dropping all the time.

---

## S-Term

How TPA is scaling the S-term (the wing-specific maneuver-authority
PID term) on the selected axis.

**What you're looking at:** pre-TPA S contribution + post-TPA S
contribution overlapping (mostly identical on flights where TPA
factor stayed at 1.0) + TPA factor itself on the right axis. Header
shows MEAN ATTEN (1 - mean(factor) across active samples), MIN
FACTOR (lowest factor reached), ACTIVE (% of flight where S was
above threshold).

**What it tells you:**
- **MEAN ATTEN 0% + MIN FACTOR 1.00** → TPA never engaged. Either
  airspeed never crossed the curve's activation point, or your TPA
  curve is configured to not attenuate.
- **MEAN ATTEN 20-40%** → TPA actively scaling S during high-airspeed
  portions, which is the design intent on fast cruise wings.
- **MIN FACTOR < 0.3** → S is being heavily gated; if combined with
  sluggish response in those moments, the curve might be too aggressive.

**Tuning workflow:** diagnostic-only — there's no S-specific CLI;
TPA-on-S tuning shares the same `tpa_curve_*` knobs as TPA-on-PID
(see TPA tab). Use this view to sanity-check whether your TPA
configuration is actually engaging on S during cruise.

**Caveats:** the TPA factor signal is routed direct from firmware
(`wingTpaFactor` on USE_WING; DEBUG_TPA fallback) — continuous, no
derivation noise. Earlier WingTune versions derived it from post/pre
ratio which produced sample-level spikes; that's fixed.

---

## Spectrum

Four stacked panels — the spectral workbench. Top to bottom:
whole-log PSD, per-stage filter sim, airspeed×frequency spectrogram,
sub-3 Hz airframe modes.

### Whole-log PSD (SpectrumPanel)

Welch PSD of gyro per axis, with filter coverage overlays + a delay
budget badge.

**What you're looking at:** log-frequency, dB-magnitude PSD of the
gyro signal. Drag to zoom; chips toggle Roll/Pitch/Yaw and select
raw / filt / both. Overlay markers show dyn-notch coverage band,
LPF cutoff lines, RPM filter centers — each togglable independently.
Header badge shows total filter group-delay budget — the warn / red
bands track the Tune Profile dial (Sport default green < 5 ms /
orange 5-8 / red > 8; a 3D profile tightens them).

**What it tells you:**
- **Peak in raw gyro 6+ dB above local baseline** that the dyn-notch
  isn't covering → the recommender flags it; consider extending the
  notch range.
- **Filter delay into the badge's red band** → filter chain is eating
  closed-loop headroom; trim by raising the heaviest stage's cutoff or
  removing a redundant filter (the recommender names the heaviest).
- **Raw vs filt comparison shows huge mid-band attenuation** → filter
  chain is suppressing flight-relevant frequencies as well as noise.

### Per-stage filter simulation (FilterSimPanel)

Replays Betaflight's gyro filter chain on the logged raw gyro so each
stage — RPM filter, LPF1, dynamic notch — becomes a toggle: answers
"what is this one filter actually removing." A `simFidelity` badge
says how closely the simulated full chain reproduces the logged
gyroADC; when it's low (the dyn-notch self-track is the approximation)
the per-stage view is flagged unreliable rather than shown as fact.

### Airspeed × frequency spectrogram (AirspeedSpectrogramPanel)

Gyro STFT columns binned by airspeed instead of averaged whole-flight
— a heatmap: x = airspeed, y = frequency, colour = power. A peak that
climbs the airspeed axis is a speed-dependent resonance (control-
surface buzz, a flutter precursor) — exactly what a whole-log PSD
smears away. Airspeed-source toggle: the M3 model estimate, or GPS
groundspeed. Under-sampled airspeed bins are faded.

### Sub-3 Hz airframe modes (LowFreqModePanel)

A long-window FFT of the band below 3 Hz, where a wing's slow
rigid-body modes live — phugoid (~0.02-0.12 Hz), dutch roll
(~0.15-1.2 Hz), short period (~0.4-3 Hz). Detected peaks are labelled
by mode (frequency band + axis); each band carries a resolved flag
(the phugoid needs ~100 s of continuous flight to resolve). A peak
here is an airframe dynamic — a CG / tail-volume / dihedral
diagnostic — not motor noise. Diagnostic-only, no recommender.

**Tuning workflow:** for filter work, use the whole-log PSD in `both`
mode (raw + filt overlay) — where the raw trace peaks and the filt
trace doesn't, the chain is working; where they match, that band
isn't being filtered and could be trimmed. FilterSim attributes the
effect to a specific stage. The delay badge is the primary lever.
The spectrogram + airframe-mode panels are exploratory — read them
when chasing a speed-dependent buzz or a slow oscillation.

**Caveats:** wings have interesting noise in sub-50 Hz, NOT the
50-500 Hz quad band — quad-side FFT tutorials don't translate without
rescaling. The delay badge's bands shift with the Tune Profile dial.

---

## Step

Closed-loop step response per axis via Wiener deconvolution. **PIDscope-
aligned metrics, wing-scaled.** Per-axis curve showing the airframe's
response to a unit-step setpoint command at t = 0.

**What you're looking at:** averaged step response curve from
deconvolving setpoint → gyro across all clean-enough segments of the
flight. Reference line at y = 1.0 = perfect tracking. Header shows
PEAK % (max within first 400 ms — wing-scaled, NOT global max),
LATENCY 50% (first crossing of 0.5, ms), and segment count.

**What it tells you:**
- **PEAK close to 100%** → controller hits target without overshoot;
  clean PD tune.
- **PEAK 110-130%** → mild overshoot; might be acceptable on a soft
  wing.
- **PEAK > 130%** → hard overshoot; rings before settling; PID is
  too aggressive OR FF is pushing too hard.
- **LATENCY 20-40 ms** → controller is responsive.
- **LATENCY < 15 ms** with FF active → FF is providing instant push
  (which is desirable for snap inputs but means PD isn't doing the
  initial work).
- **LATENCY = NaN** → response never reached 50% within the peak
  window; under-gained or sluggish controller.

**Yellow caveat ribbon** ("non-zero F+S — full closed-loop response,
not PD-isolated") → axisF or axisS magnitudes are non-zero on this
log, so the curve reflects the FULL controller behavior including
feedforward. To compare against PIDtoolbox/PIDscope's PD-only
workflow, you need to zero F + S in BF CLI before the calibration
flight and reflash.

**Tuning workflow (recommended PD-isolation):**
1. Zero F + S gains in BF, reflash.
2. Fly a calibration sortie with sharp stick inputs.
3. Drop the log here; the caveat ribbon should be GONE.
4. Read PEAK / LATENCY directly — those are the PD response metrics.
5. Tune PD ratio against this curve.
6. Re-enable S, fly again, tune S authority.
7. Re-enable F, tune for stick-velocity response.

**Caveats:** Wiener deconvolution is sensitive to setpoint excitation
content — quiet cruise produces noisy step responses. Fly some
deliberately sharp stick inputs in the calibration sortie. The 400 ms
peak window is wing-scaled (PIDscope uses 150 ms for quads); won't
catch overshoot past the 400 ms mark, which is correct behavior for
wing dynamics but means you can't use the metric for very-slow-
responding airframes.

---

## Recommend

Aggregated tuning suggestions from every recommender, sorted by
severity (MUST → SHOULD → COULD → OK), each card showing
confidence-scored CLI when applicable.

**What you're looking at:** card per recommendation with severity
stamp, domain chip, axis attribution (if applicable), title, summary,
and (when expanded) detail + paste-ready CLI + confidence-scored
criteria. **Red-confidence recs do NOT show a copy-CLI button** —
the cardinal rule is "untrustworthy = no copy affordance, not just
disabled." Yellow recs sometimes show CLI when explicit rationale
exists; otherwise they're informational.

**What it tells you:** what to change about your tune, with the
confidence to act on it. Domain filter chips at the top group by
concern (Setup / PID / TPA / SPA / Filters / Servo).

**Tuning workflow:**
1. Open Recommend after any flight.
2. Read MUST items first — these typically indicate setup mistakes
   or actively-harmful settings (e.g. filter delay >> 8 ms).
3. SHOULD items are tuning improvements with green confidence + CLI.
   Copy the CLI, paste in BF Configurator, reflash, fly, drop the
   new log here, see if the rec moved to OK.
4. COULD items are nice-to-haves; act on if you're chasing fine
   details.
5. Yellow-confidence cards (with or without CLI) are informational —
   they describe an observation the tool can't fully act on.

**Caveats:** the recommender doesn't know about your specific
airframe or your flying style. A rec to "lower D-LPF cutoff" might be
right for a quiet airframe and wrong for a noisy one. Read the
detail before pasting CLI.

---

## LogRoster + multi-log compare

Not a tab — the strip between TabBar and the time-bar that's visible
at N ≥ 1 loaded logs. Per-log chip with family-tinted color, drag
handle for time offset, eye toggle to hide/show, X to remove. `+`
button adds another log (additive — doesn't reset session). At N ≥ 2,
`auto-align` button runs the gyro cross-correlation + first-throttle
heuristic to put all logs on a common session-time axis.

**Multi-log workflow:**
1. Fly + drop the original log → drop a follow-up log via `+`.
2. Click `auto-align` to put them on a shared session axis.
3. Open any time-domain tab (Tracking / PID / Servos / SPA / S-Term /
   Airspeed). All visible logs render as tinted overlays so you can
   directly see what changed between flights.
4. Eye-toggle to focus on one log at a time when stats / pending /
   readiness need to anchor to a single log.

**Anchor method tooltip** on the offset badge: hover an aligned chip
to see how the offset was computed (`gyro xcorr (ncc 0.82)` /
`first-throttle fallback` / `gyro low-conf → throttle fallback` /
`no anchor`). Cross-correlation is preferred but falls back to
first-throttle-up when the two logs don't share enough motion
content for a confident xcorr peak.

**Caveats:** Spectrum + Step don't use session time (frequency / impulse-
relative axes don't align that way). The Recommend tab is per-log; at
N ≥ 2 it shows a pager so you can step through logs one at a time
(cross-log rec aggregation is deferred until a workflow demands it).
