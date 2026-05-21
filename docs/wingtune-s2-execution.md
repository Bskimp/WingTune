# S2 execution plan — airspeed-resolved spectra (Spectrum roadmap S2)

Execution detail for **S2** of `docs/wingtune-spectrum-roadmap.md` — the
second milestone of the Spectrum-tab track. The roadmap is the "why +
sequencing" reference; this doc is the slice-by-slice breakdown.

> **Read first:** `wingtune-architecture`, `wingtune-memory-model`,
> `wingtune-vue-conventions`. And the `CLAUDE.md` SCOPE box — wing
> airframe modes live in the **sub-3 Hz** band (phugoid down to ~0.02 Hz),
> a regime quad-tuned analyzers never look at.

## What S2 does

M4's whole-log Welch PSD assumes the spectrum is **stationary** across the
flight. On a wing it is not: the plant scales with airspeed, control-surface
buzz and flutter precursors onset *at a speed*, and slow airframe modes
(phugoid, dutch roll) live far below anything M4 resolves. S2 adds two views:

1. **Airspeed × frequency spectrogram** — STFT columns binned by airspeed
   instead of averaged over the whole flight. x = airspeed, y = frequency,
   colour = power. Answers "what frequency shows up at what speed."
2. **Low-frequency airframe-mode detection** — a long-window PSD of the
   sub-3 Hz band with peak detection, labelling peaks by likely airframe
   mode (short-period / dutch roll / phugoid).

## Status

✅ **Shipped 2026-05-21** — Slices 1-4 complete. `lib/airspeedSpectrogram.ts`
+ `AirspeedSpectrogramPanel.vue` (airspeed×frequency heatmap),
`lib/lowFreqModes.ts` + `LowFreqModePanel.vue` (sub-3 Hz airframe-mode
detection), `buildWholeLogAirspeed` added to `airspeedFit.ts`. Both panels
stack on the Spectrum tab via `SpectrumTab.vue`. 319 unit tests (+22 this
milestone), typecheck clean. Slice 5 (wavelet scalogram) deferred per the
roadmap. `lib/stft.ts` (Phase 0) shipped earlier with S1.

Notes from execution:
- **Heatmap rendering** — a uPlot `draw`-hook per-cell `fillRect` blit,
  clipped to the plot bbox; a transparent dummy series anchors the
  airspeed (x) / frequency (y) scales. Open question 1 resolved this way
  — keeps uPlot's axes + cursor machinery.
- **Colormap floor** — the loud sub-8 Hz wing-maneuver band is excluded
  from the spectrogram's dB auto-range (it still draws, clipped to
  full-red) so it can't wash out the resonance band above it.
- **uPlot log-scale gotcha** — `LowFreqModePanel` wants a log frequency
  axis, but uPlot's native log distr (`distr: 3`) rendered blank in this
  build. Resolved by plotting `log10(Hz)` data on a plain LINEAR scale,
  ticks relabelled back to Hz. Also: band shading must run in the `draw`
  hook, not `drawClear` — a throw in `drawClear` aborts the whole draw.
- **Low-freq peak over-detection** — the raw sub-3 Hz PSD is spiky;
  topographic prominence rewards every noise spike, so one broad mode
  read as several. Fixed with frequency-proportional triangular
  smoothing before peak-picking + a one-peak-per-named-band rule (a
  named band is one physical rigid-body mode).
- **No recommender** — both views are diagnostic visualisations; airframe
  modes have no firmware fix and a mode is only a problem when poorly
  damped (damping estimation is out of S2 scope).

## Scope

**In:** `lib/airspeedSpectrogram.ts`, `lib/lowFreqModes.ts`, two new panels
on the Spectrum tab (`AirspeedSpectrogramPanel.vue`, `LowFreqModePanel.vue`),
a whole-log airspeed-series helper.

**Out (deferred, with triggers):**
- **Wavelet / STFT scalogram** (roadmap S2.4 / Phase 4) — speculative;
  land the spectrogram + low-freq core first.
- **No recommender.** Both views are diagnostic visualisations. The
  airspeed spectrogram has no actionable lever. Low-freq airframe modes
  *are* a CG / tail-volume / dihedral diagnostic — but there is no firmware
  CLI fix (same shape as M-Coupling: diagnostic-only). A diagnostic yellow
  rec for a detected mode is a possible later refinement; decide when
  Slice 4 lands, not before.
- **Tab IA / sub-nav** — the Spectrum tab grows to four stacked panels
  (SpectrumPanel, FilterSimPanel, + these two). It is getting heavy; the
  sub-nav consolidation is explicitly deferred to the tab-IA design pass
  (`wingtune-analytics-plan.md`, roadmap open decision #4). Do not solve it
  inline.

## Slice breakdown

### Slice 1 — `lib/airspeedSpectrogram.ts` + whole-log airspeed series

Roadmap S2 Phase 2 (analysis half). Layer 2, no Vue.

- **`binStftByAirspeed(gyro, airspeed, sampleRateHz, opts)`** — runs
  `computeStft` on the gyro signal, assigns each column the airspeed at its
  `centreTimeSec` (the `airspeed` array is main-frame-aligned, so index by
  `centreSampleIndex`), bins columns into `airspeedBinCount` linear bins
  across `[speedMin, speedMax]`, averages the per-column PSD within each
  bin → a 2D grid `[airspeedBin][freqBin]`.
- Returns `{ grid, airspeedEdges, frequencies, columnsPerBin, binHz }`.
  `columnsPerBin` is the coverage honesty signal — a bin with too few
  columns is under-sampled (greyed in the UI, same pattern as M-Coupling's
  greyed rows + the M3 `samplesPerSpeedBin`).
- Source-agnostic: takes a pre-built airspeed `Float32Array` aligned to
  the gyro's main-frame axis. The model-vs-GPS choice is the panel's
  (Slice 2) — the binning lib never sees a fit.
- Float32 throughout (memory-model cardinal rule).
- **Tests:** a synthetic signal whose frequency rises with a ramped
  airspeed input → the grid's peak bin migrates with airspeed; a constant-
  airspeed signal → all energy in one airspeed column; under-sampled bins
  reported in `columnsPerBin`; short-signal / empty-airspeed guards.

### Slice 2 — `AirspeedSpectrogramPanel.vue`

Roadmap S2 Phase 2 (display half). Layer 3 — `wingtune-vue-conventions`,
`useActiveLog` (single-log, focus-one — like `FilterSimPanel`).

- Per-axis R/P/Y selector. Heatmap: x = airspeed, y = frequency, colour =
  power (dB). Under-sampled airspeed columns greyed with an explicit note.
- **Whole-log airspeed series.** The M3 fit (`buildAirspeedFitInputs`)
  trims to the GPS-lock window; the spectrogram wants airspeed across the
  *whole* flight. The panel runs the BASIC fit for params, then re-runs
  `integrateBasicAirspeedModel` over an un-trimmed full-main-frame
  `ModelInputs`. The supporting helper lands in `airspeedFit.ts` (the
  airspeed home) — Layer 2 + tested.
- **Airspeed-source toggle:** `model` (M3 BASIC whole-log estimate,
  continuous, default) / `GPS` (`gps:GPS_speed` resampled — measured
  groundspeed, has dropouts + wind error). Honest empty state when neither
  is available (no throttle/vbat for the model, no GPS lock for GPS).
- **Heatmap rendering** — the codebase is all uPlot *line* charts; a 2D
  heatmap is new. Recommended: a uPlot draw-hook that blits an `ImageData`
  (keeps the tab's axis / zoom / cursor machinery). Fallback: a plain
  `<canvas>` with hand-drawn axes. See open question 1.
- Stacked on `SpectrumTab.vue` below `FilterSimPanel`.

### Slice 3 — `lib/lowFreqModes.ts`

Roadmap S2 Phase 3 (analysis half). Layer 2, no Vue.

- A **long-window** FFT of the gyro (resolving 0.05 Hz needs a ~20 s
  window; 0.02 Hz phugoid needs ~100 s) → PSD over the sub-3 Hz band.
  Not STFT — this view wants frequency resolution, not time localisation.
- Peak detection below ~3 Hz; label each peak by likely airframe mode
  from its frequency band + axis: short-period ~0.5-2 Hz (pitch),
  dutch roll ~0.2-1 Hz (roll/yaw), phugoid ~0.02-0.07 Hz (pitch).
- **Honesty:** when the log is shorter than the window needed to resolve
  the phugoid band, return that band flagged "log too short" rather than a
  spurious peak.
- **Tests:** synthetic low-freq tones land in the right band + get the
  right mode label; a too-short log flags the phugoid band; the wing-regime
  band edges match the SCOPE box.

### Slice 4 — `LowFreqModePanel.vue`

Roadmap S2 Phase 3 (display half). Layer 3.

- Sub-3 Hz PSD (log-x line chart — `useUPlot`, the normal pattern) with
  detected peaks marked + mode labels. Per-axis. Honest "log too short for
  phugoid resolution" ribbon.
- Stacked on `SpectrumTab.vue` below `AirspeedSpectrogramPanel`.
- Decide here whether a diagnostic-only rec is worth emitting (see Scope).

### Slice 5 — wavelet / STFT scalogram — DEFERRED

Roadmap S2.4 / Phase 4. Speculative; land Slices 1-4 first.

## Open questions carried into execution

1. **Heatmap rendering** — uPlot ImageData-blit draw hook vs a standalone
   `<canvas>`. Recommend the uPlot path for axis/cursor reuse; fall back if
   it fights the line-chart machinery. Resolve in Slice 2.
2. **Airspeed source default** — `model` proposed (continuous, whole-log).
   GPS is measured truth but lags and carries wind error. Both selectable
   in the UI; `model` is the default. Reversible.
3. **Airspeed bin count** — 16-24 linear bins is the working default;
   `TODO calibrate` once a throttle-varying cruise log is in the corpus.
4. **Low-freq window length** — fixed long window vs adaptive to log
   length. Start fixed, flag too-short logs (Slice 3).

## Test plan

- Unit (`tests/unit/`): `airspeedSpectrogram.ts`, `lowFreqModes.ts`.
- Corpus: a throttle-varying cruise log best exercises the spectrogram —
  flight-blocked on Brian flying one (same blocker as M3/M5 visual
  validation). The 7-log private corpus exercises the code paths;
  `npm run corpus:validate:private`.
- Per-skill self-check before commit.
