# Betaflight gyro filter-chain reference

Firmware-reference spec for the WingTune M-FilterSim port (`lib/bfFilters.ts`,
Spectrum-roadmap S1 / Slice 2). Every formula here is quoted from Betaflight
source; the TypeScript port is written *from this doc*, and this doc cites the
exact commit so it can be re-verified.

**Source:** `betaflight/betaflight`, branch `master`, commit
**`144702cd57ab3c23ed73590e667f1d15c3ab1975`** (extracted 2026-05-20 via
research pass).

**Version note.** Betaflight has moved to calendar versioning — `master` is
`2026.6.0-alpha` (`FC_VERSION_YEAR=2026`, `FC_VERSION_MONTH=6`). **There is no
BF `4.6` branch or tag.** What this project's CLAUDE.md / the `blackbox-log`
fork call "BF 4.6" is this `2026.6` line. The latest true `4.x` maintenance
branch is `4.5-maintenance` (4.5.4). The filter primitives (`filter.c`,
`rpm_filter.c`, `dyn_notch_filter.c`) are materially unchanged between 4.5 and
2026.6 — same formulas, same constants. Re-pin this doc when a
`2026.6`-maintenance branch is cut.

---

## 1. Biquad — `common/filter.c`

Standard RBJ-cookbook biquad. `H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²)`.

Setup (`biquadFilterUpdate`), given centre frequency `f`, loop period
`refreshRateUs` (microseconds), quality `Q`:

```
omega = 2π · f · refreshRateUs · 1e-6        (= 2π·f·dt, dt in seconds)
sn = sin(omega),  cs = cos(omega)
alpha = sn / (2·Q)
a0 = 1 + alpha
```

**FILTER_LPF** (gyro lowpass of type BIQUAD):
```
b0 = b2 = (1 − cs) / 2
b1 = 1 − cs
a1 = −2·cs
a2 = 1 − alpha
```
**FILTER_NOTCH** (dynamic notch + RPM notches):
```
b0 = b2 = 1
b1 = −2·cs
a1 = −2·cs
a2 = 1 − alpha
```
All five coefficients are then divided by `a0`.

- **Q:** LPF uses `BIQUAD_Q = 1/√2` (Butterworth). Notches take an explicit Q —
  larger Q ⇒ narrower notch (`Q = f0 / (f2 − f1)`).
- BF uses a `sincosf_approx`; the port uses `Math.sin`/`Math.cos` (strictly
  more accurate — acceptable, arguably better, for offline replay).

**Apply — Direct Form 1** (`biquadFilterApplyDF1`), the form every
time-varying gyro stage uses (selected under `USE_DYN_LPF`, always defined on
production FCs):
```
result = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2
x2 = x1;  x1 = x;  y2 = y1;  y1 = result
```
Note BF stores `a1,a2` such that apply *subtracts* them. DF1 keeps separate
input (`x1,x2`) and output (`y1,y2`) history and is stable when coefficients
change every sample — required for the dynamic stages. The port uses DF1
throughout.

**Weighted apply** (`biquadFilterApplyDF1Weighted`) — RPM filter only:
```
result = weight·biquadFilterApplyDF1(...) + (1 − weight)·x
```
A crossfade that fades a notch in/out without a coefficient discontinuity.

---

## 2. PT1 / PT2 / PT3 — `common/filter.c`

One-pole IIR cascades. `dT` is the loop period in **seconds**.

```
pt1FilterGain(fc, dT):  omega = 2π·fc·dT ;  k = omega / (omega + 1)
pt1FilterApply:         state += k·(input − state) ;  return state
```

PT2 / PT3 cascade 2 / 3 one-pole stages with the **same `k`**, shifting the
nominal cutoff up so the cascaded −3 dB point lands on `fc`:

```
CUTOFF_CORRECTION_PT2 = 1.553773974     (= 1/√(2^(1/2) − 1))
CUTOFF_CORRECTION_PT3 = 1.961459177     (= 1/√(2^(1/3) − 1))

pt2FilterGain(fc, dT) = pt1FilterGain(fc · 1.553773974, dT)
pt3FilterGain(fc, dT) = pt1FilterGain(fc · 1.961459177, dT)

pt2FilterApply:  s1 += k·(input − s1);  s  += k·(s1 − s);   return s
pt3FilterApply:  s1 += k·(input − s1);  s2 += k·(s1 − s2);  s += k·(s2 − s);  return s
```

PT1 needs no correction (single pole, −3 dB already at `fc`).

---

## 3. Gyro filter-chain order — `sensors/gyro_filter_impl.c`

Per-sample, per-axis sequence applied to the downsampled gyro value:

```
1.  downsample        raw oversampled stream → loop-rate sample
2.  RPM filter        rpmFilterApply        (all motor × harmonic notches)
3.  static notch 1    gyro_soft_notch_1     (biquad notch; default OFF)
4.  static notch 2    gyro_soft_notch_2     (biquad notch; default OFF)
5.  LPF1              gyro_lpf1_*           (the dynamic gyro lowpass — §8)
6.  dynamic notch     dynNotchFilter        (§4)
→   gyro.gyroADCf[axis]   ← logged as gyroADC[axis]
```

`gyroUnfilt[axis]` is the value **before** this chain.

**Important — there is no in-line LPF2 stage.** `gyro_lpf2` is the
**downsampler** (step 1): when `downsampleFilterEnabled`, the raw oversampled
stream is filtered by LPF2 and accumulated; otherwise downsampling is a plain
average and LPF2 is absent. Model LPF2 as a pre-downsample stage, not a
fourth in-line filter. The simulator's stage toggles are: RPM → (static
notches, usually off) → LPF1 → dyn-notch.

---

## 4. Dynamic notch — `flight/dyn_notch_filter.c`

- `count` = `dyn_notch_count` notches per axis (default 3, max 7).
- `q` = `dyn_notch_q / 100` (header value ×100; default 300 → Q = 3.0).
- `minHz` / `maxHz` from config; `maxHz` clamped to ≥ minHz and ≤ Nyquist.
- Each detected SDFT peak becomes a `FILTER_NOTCH` biquad at its (smoothed)
  centre frequency, fixed Q, **weight 1.0** (plain `biquadFilterApplyDF1`).
- Apply: the `count` notches applied in series.
- Centre-frequency smoothing: a PT1 at `DYN_NOTCH_SMOOTH_HZ = 4 Hz` is applied
  to each peak before it updates a notch.

The SDFT peak-detection internals are **not** ported — M-FilterSim
re-tracks the peaks with its own STFT (`lib/stft.ts`) peak-picker constrained
to `[minHz, maxHz]`, `count` peaks. This doc only needs how a notch is *placed*
given a centre frequency: `FILTER_NOTCH` biquad, Q = `dyn_notch_q/100`.

---

## 5. RPM filter — `flight/rpm_filter.c`, `drivers/dshot.c`

**eRPM → motor frequency (Hz).** `ERPM_PER_LSB = 100`, `SECONDS_PER_MINUTE = 60`:
```
erpmToHz   = 100 / 60 / (motor_poles / 2)
motorFreqHz = erpmToHz · erpmLsb
```
`erpmLsb` is the raw DShot bidirectional-telemetry value (`getDshotErpm()`).
`motor_poles / 2` = pole pairs (eRPM is *electrical* RPM). Firmware then PT1-
smooths `motorFreqHz` at `rpm_filter_lpf_hz` (default 150 Hz) — see §6 for the
logged-field caveat.

**Harmonics.** `rpm_filter_harmonics` (0..3, default 3). Harmonic index `i`
(0-based) → a notch at:
```
freq = clamp( (i + 1) · motorFreqHz,  rpm_filter_min_hz,  maxHz )
maxHz = 0.48 · 1e6 / looptimeUs        (just under Nyquist)
```
So harmonic 0 = fundamental `f`, 1 = `2f`, 2 = `3f`.

**Q.** Single shared `q = rpm_filter_q / 100` for every motor × harmonic
(default 500 → Q = 5.0). No per-harmonic Q.

**Weight + fade-out.** Per (harmonic) notch:
```
weight = rpm_filter_weights[i] / 100          (clamped 0..1; default 100 → 1.0)
marginHz = freq − rpm_filter_min_hz
if marginHz < rpm_filter_fade_range_hz:
    weight *= marginHz / rpm_filter_fade_range_hz
```
The fade drives `weight → 0` as the notch frequency descends to `min_hz`, so
the notch crossfades fully off (the `biquadFilterApplyDF1Weighted` crossfade).

**Apply.** For each harmonic with `weight > 0`, for each motor, in series:
`value = biquadFilterApplyDF1Weighted(notch, value)`. Notch coefficients are
computed once on the ROLL axis and copied verbatim to PITCH and YAW (all axes
share identical RPM notches). Order is irrelevant (LTI).

**Constants:** `RPM_FILTER_HARMONICS_MAX = 3`. Firmware staggers *coefficient
updates* (a few notches per loop, full sweep ≤ 1 ms) — a CPU budget device,
not math; an offline replay recomputes all coefficients every sample.

---

## 6. Blackbox `eRPM` field — `blackbox/blackbox.c`

The blackbox logs `getDshotErpm(i)` directly into the `eRPM[i]` field — i.e.
the **raw DShot LSB value** (field comment: `eRPM / 100`, because
`ERPM_PER_LSB = 100`). One field per motor, present per the
`MOTOR_n_HAS_RPM` condition; intraframe `UNSIGNED_VB` predictor 0, interframe
`SIGNED_VB` delta-from-previous.

Convert a logged `eRPM[i]` sample to motor frequency:
```
motorFreqHz = eRPM_field · 100 / 60 / (motor_poles / 2)
            = eRPM_field · erpmToHz
```
**Caveat:** the logged value is the *unfiltered* telemetry — the
`rpm_filter_lpf_hz` PT1 smoothing happens after `getDshotErpm()` and is not in
the log. The port should PT1-smooth the per-frame `eRPM`-derived frequency at
`rpm_filter_lpf_hz` to match what the firmware's RPM filter actually saw.

---

## 7. Header / CLI parameters

All present in the BBL header unless noted. Ranges from `cli/settings.c`.

| Parameter | Default | Notes |
|---|---|---|
| `gyro_lpf1_type` | PT1 | PT1 / BIQUAD / PT2 / PT3 |
| `gyro_lpf1_static_hz` | — | static LPF1 cutoff |
| `gyro_lpf1_dyn_hz` (min,max) | 250, 500 | dynamic LPF1 range (§8); `>0 min` enables dyn LPF |
| `gyro_lpf1_dyn_expo` | 5 | dyn-LPF throttle-curve expo |
| `gyro_lpf2_type` | PT1 | the downsampler filter (§3) |
| `gyro_lpf2_static_hz` | 500 | |
| `gyro_soft_notch_hz_1/2`, `gyro_soft_notch_cutoff_1/2` | off | static notches |
| `dyn_notch_count` | 3 | 0..7 |
| `dyn_notch_q` | 300 | Q = value / 100 |
| `dyn_notch_min_hz` | 100 | 20..250 |
| `dyn_notch_max_hz` | 600 | 200..1000 |
| `rpm_filter_harmonics` | 3 | 0..3 |
| `rpm_filter_q` | 500 | Q = value / 100 |
| `rpm_filter_weights` | 100,100,100 | per-harmonic, /100 |
| `rpm_filter_min_hz` | 100 | 30..200 |
| `rpm_filter_fade_range_hz` | 50 | 0..1000 |
| `rpm_filter_lpf_hz` | 150 | motor-freq PT1 smoothing |
| `motor_poles` | 14 | only logged with `USE_DSHOT_TELEMETRY` |

**Caveat:** `rpm_filter_*` and `motor_poles` header lines only appear when the
firmware was built with `USE_RPM_FILTER` / `USE_DSHOT_TELEMETRY`. If the RPM
filter is inactive there is no RPM stage to simulate.

---

## 8. Dynamic gyro LPF1 — `sensors/gyro.c`, `flight/pid.c`

`gyro_lpf1` is dynamic by default (whenever `gyro_lpf1_dyn_min_hz > 0`): its
cutoff is recomputed every frame from throttle ∈ [0,1], then the filter gain
updated. A time-varying stage, like the dynamic notch.

**Expo curve** (`gyro_lpf1_dyn_expo > 0`, the default — `dynLpfCutoffFreq`):
```
expof = expo / 10
curve = throttle · (1 − throttle) · expof + throttle
cutoffHz = (dynMax − dynMin) · curve + dynMin
```

**Legacy curve** (`gyro_lpf1_dyn_expo == 0` — `dynThrottle`):
```
dynThrottle(t) = t · (1 − t·t/3) · 1.5
cutoffHz = max( dynThrottle(throttle) · dynMax,  dynMin )
```

`throttle` for an offline replay comes from the log — `setpoint[3]` is
`throttle × 1000`. The recomputed cutoff feeds `pt1/pt2/pt3FilterGain` or
`biquadFilterUpdate` (the chosen `gyro_lpf1_type`); biquad uses DF1.

---

## Port notes (for `lib/bfFilters.ts`)

- Use DF1 (`biquadFilterApplyDF1`) for every stage; `*Weighted` for RPM.
- RPM filter simulates **exactly** — `eRPM` is logged per motor per frame,
  notch placement is the deterministic §5 formula. The only inputs are the
  log + header config.
- Dynamic notch carries the one approximation: BF's SDFT peak track is
  re-derived by `lib/stft.ts` peak-picking the raw gyro. The validation
  harness (sim full chain vs logged `gyroADC`) is the check on it.
- LPF1 (and LPF2-as-downsampler) cutoffs may be dynamic — recompute per frame
  from throttle (§8). Static-`hz` configs are the simple case.
- Loop rate: `refreshRateUs` / `dt` come from the log time axis
  (`estimateSampleRate` in `lib/spectrum.ts`).
