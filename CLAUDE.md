> [!IMPORTANT]
> ## SCOPE — PLANES, NOT QUADS
>
> **WingTune is for fixed-wing Betaflight logs.** Betaflight itself, every
> open-source log analyzer in this space (PIDtoolbox, PIDscope, Plasmatree,
> Blackbox Log Viewer), and many of the firmware defaults bake in
> **multirotor assumptions** — quad response times (~20-80 ms), quad noise
> bands (50-500 Hz), differential mixer signals, throttle-scheduled gains,
> PIDF (no S) controller.
>
> **Wings live in a different regime:** 200-500 ms closed-loop response,
> sub-50 Hz interesting noise, paired-identical servo PWMs (physical
> reverse splits L/R, not the mixer), airspeed-scheduled TPA, PIDFS with
> S-term as the dominant maneuver driver.
>
> Translation is required every time we adopt a formula, threshold, time
> window, or convention from quad-side reference code. Concrete examples
> hit this session: PIDscope's 150 ms peak window is quad-tuned (wing
> needs 500-800 ms); the L/R sign-split assumption broke on Brian's
> twin-motor plane because wing servos are paired-identical not
> differential; wing setpoints have huge low-freq energy that quad
> Wiener-λ formulas don't account for.
>
> **When in doubt, ask: "is this assumption true for wings?"** If a
> reference tool says one thing and the wing physics says another, the
> wing physics wins. Document any quad-tuned default we keep so future
> calibration can replace it deliberately.

# WingTune

> Desktop-first (Tauri 2.x) + hosted-demo blackbox log analysis tool for the
> fixed-wing side of Betaflight. Vue 3 + Vite + TypeScript + Pinia + Tailwind
> frontend; Rust parser (`blackbox-log`) compiled to WASM in a Web Worker.
> GPL-3.0-or-later. See `docs/wingtune-roadmap.md` for the long arc.

## Status

Design docs locked through v0.9 (roadmap) / rev 12 (M1 execution).
M1 functionally complete (corpus track aside). **Wing analytics
suite (M2 / M3 / M5 / M6 / M7) now complete** — M2 PIDFS decomp,
M3 BASIC airspeed fit, M4 spectrum + filter analysis, M-Step closed-
loop deconvolution (calibrated against PIDscope), M5 HYPERBOLIC TPA
curve fitter (the previously-deferred module), M6 SPA effectiveness
analyzer, M7 S-term TPA effectiveness viz, M1.5 deeper BBL header
inspector — all shipped with their panels + recommenders + tests.
Tauri shell native file open + LRU field-cache eviction +
estimated scan-progress bar + airspeed-predicate split also landed.
Generic Nelder-Mead extracted to `lib/nelderMead.ts` and shared by
`airspeedFit` and `tpaCurveFit`. M3 / M5 / M6 / M7 visual validation
all deferred (need calibration flights with the right debug modes).

**Done:**

- M1.0 parser-support track: firmware-version fix + `WING_LAUNCH`
  YAML + (added later) `TPA` / `S_TERM` / `SPA` / `WING_SETPOINT`
  debug-mode YAML entries for BF 2026.6, all on
  `Bskimp/blackbox-log:wing-support` (latest commit `4dd54b5`).
  Brian's real wing logs decode end-to-end through the WingTune
  parser. Upstream PR drafted, not yet opened (Brian's call).
  Corpus assembly track still not started.
- M1.1 scaffold: Cargo workspace + `crates/wingtune-parser` (WASM via
  wasm-bindgen + wasm-pack) + `crates/validate-parser`, Vite 8 + Vue 3.5
  + TS 6 + Pinia 3 + Tailwind 4 frontend, Layer 1 worker + wasmBridge,
  Tauri 2.11 desktop shell, vitest + WASM-binding tests, GitHub Actions
  CI, `.devcontainer/`.
- M1.2 WASM wrapper + Worker: typed `ScanReport` / `CapabilityReport`
  shapes both sides; real `scan(bytes)` + `hydrate(bytes, fields)`;
  `ParserClient` is the only Layer 1 surface for Layer 2/3.
- M1.3 entry-page surface: `src/lib/dtype.ts` helpers (incl.
  `nearestTimeIndex` binary search); Float32 conversion at the
  wasmBridge boundary; lazy hydration via `useLogStore().ensureFields`;
  `useLogStore()` + `useViewStore()` Pinia stores following
  shallowRef/shallowReactive discipline; M1.3.4-5 file drop +
  CapabilitySummary + ReadinessCard (latter from M1.6) all wired
  against real logs; happy-dom-backed integration test
  (`tests/wasm-binding/entry-flow.test.ts`) exercises drop → store →
  CapabilitySummary against `LOG00113.BFL`.
- M1.4 charts + tabs: tab shell (Summary / Tracking / Servos /
  Spectrum / Step / [Recommend when populated]) driven by
  `useViewStore().activeTab`; shared cursor (cursorTime, cursorPinned,
  pin actions, hover-clear) wired across panels; TimeBar (click-to-pin)
  + CursorReadout (aggregate per-panel sample rows via
  `useCursorSamples` + hint tooltips); `useUPlot` lifecycle composable
  + `useChartPinnedCursor` for cross-chart overlay. Two real chart
  panels shipped: `SetpointTrackingPanel` (gyro vs setpoint per axis,
  RMS/peak error stats, drag-to-zoom, axis selector) and `ServoPanel`
  (multi-trace servo[i] + motor[i] with per-channel toggle, dead-
  channel range filter). Spectrum + Step render `TabPlaceholder` honest
  "module pending" surfaces until their analytics ship.
- M1.6 readiness report: `src/lib/confidence.ts` (ConfidenceLevel,
  ConfidenceResult<T>, aggregateConfidence per skill-spec'd rule),
  `src/lib/capabilityPredicates.ts` (ModuleReport + per-module
  predicates with three-state field presence handling),
  `src/lib/signalRegistry.ts` (multi-source signal abstraction
  grounded in merged BF PRs #13895 / #13719 / #14010 — predicates
  call `resolveSignal()` instead of naming debug_mode strings),
  `ReadinessCard.vue` rendering the 12-module slot list at the top
  of the Summary tab with four-state icons + standardized
  "set `debug_mode = X` in BF to log ..." reason language.
- M2 emission loop (slices 1 + 2): `lib/pidfs.ts` (meanAbs +
  pidfsShares), `PIDContributionPanel.vue` (per-axis P/I/D/F/S traces
  + mean-abs share strip + dominant-term indicator + chip toggle
  with shift-click solo), `lib/recommendations.ts`
  (Recommendation shape + sortBySeverity + gatherRecommendations
  aggregator), `lib/recommenders/debugMode.ts` (first concrete
  recommender — emits green-confidence "set debug_mode = X" CLI
  recs when readiness shows a wing-tuning module blocked by missing
  debug data), Recommend tab UI (RecommendCard with copy-removed-on-
  red gate, RecommendList severity-sorted, RecommendTab header with
  must/should/could/ok score breakdown). TabBar auto-shows the
  Recommend tab when rec count > 0.
- M3 BASIC airspeed fit (slices 1-4): Airspeed tab routed in TabBar;
  `lib/airspeedFit.ts` (physical integrator from BF's CLI-tunable
  delay/gravity/max_voltage params, hand-rolled Nelder-Mead, coverage
  metrics, shared `buildAirspeedFitInputs` helper); `AirspeedPanel.vue`
  (GPS-window-trimmed comparison chart with predicted vs GPS-3D traces,
  fit params/R²/RMS in header, pitch-optional with level-flight
  fallback annotation); `lib/recommenders/airspeedBasic.ts` (7-criteria
  confidence — R², speed range, throttle transitions, voltage sag,
  convergence, fit window, pitch presence — emits paste-ready
  `set tpa_speed_basic_*` CLI when green, red removes CLI per the
  cardinal rule, evidence chip pins cursor at peak residual).
  `RecommenderArgs` now carries `gpsTimeSec`. See
  [[project-bf-basic-airspeed-model]] for the physical formula +
  tuning heuristics.
- Parser GPS hydration: `hydrate.rs` now returns
  `HydrateResult { fields, gps_times_sec }` with GPS-frame iteration
  alongside main-frame; wasmBridge boundary type extended; log store
  exposes `gpsTimeSec`. `lib/timeAlign.ts` resamples GPS values onto
  the main-frame axis (single-sweep linear interpolation, endpoint-
  clamping for pre-/post-fix windows).
- Sample-check + airspeed-readiness state machine: scan.rs now
  populates `sample_check` per field (stride-sampling main frames,
  every GPS frame; tracks first non-zero seen). FieldTable surfaces
  "empty" / "all samples zero" for fields like `gps:GPS_speed` on
  logs where GPS never locked. `checkAirspeedAutoTune` predicate
  refined into a 4-state machine: blocked (no GPS) / inactive (GPS
  present but never locked) / partial (BASIC fit runnable, no
  DEBUG_TPA cross-check) / available (full).
- Pitch sign convention fix: BF logs `attitude[1]` NEGATIVE for nose-
  up; integrator works in nose-up-positive convention so
  `buildAirspeedFitInputs` negates at the boundary (single source of
  truth for the unit). Verified 2026-05-17 by Brian against firmware.
- M4 spectrum tab (slices 1-4): `lib/spectrum.ts` — hand-rolled
  radix-2 Cooley-Tukey FFT + Hann window + Welch's method (PSD via
  averaged windowed periodograms, no external dep). `SpectrumPanel`
  shows per-axis gyro PSD (R/P/Y overlaid, log frequency, dB
  magnitude) with drag-to-zoom, axis toggle chips, and a `filt`/`raw`
  /`both` mode selector (raw via DEBUG_GYRO_RAW signal-registry
  entry). Filter overlays render dyn-notch coverage band + LPF
  cutoff lines + RPM filter markers via uPlot draw hook, each
  togglable independently. `lib/filterDelay.ts` computes per-stage +
  total group-delay budget; surfaced as a header badge (green <5 ms /
  orange 5-8 / red >8) with per-stage tooltip. Filter config
  extracted in `scan.rs` from `headers.unknown()` into typed
  `FilterConfig { dyn_notch + 4 LPFs + rpm_filter }`. Spectrum
  recommender (`lib/recommenders/spectrumFilter.ts`) emits
  notch-coverage extension recs (peak detection ≥6 dB above local
  baseline, yellow confidence) and filter-delay informational recs
  (no CLI — which stage to trim is a judgment call). Pre/post-
  filter gyro overlay closes the loop on visualising what the filter
  chain removes.
- M1.5 BBL header inspector: `header_params: BTreeMap<String, String>`
  exposed on ScanReport — every key/value pair BF wrote into the
  log (~150-250 entries). New `HeaderParamsPanel.vue` on the Summary
  tab: searchable (key OR value substring), click-to-copy
  `set key = value` to clipboard with 1.2s accent flash on the
  copied row. Surfaced a latent serialization bug along the way:
  serde-wasm-bindgen defaults to serializing Rust maps as JS `Map`
  (not plain objects), which broke `obj[key]` access and
  `Object.entries(obj)`. New `js_serializer()` helper in lib.rs
  forces `.serialize_maps_as_objects(true)` for both scan + hydrate
  outputs. Latent bug fixes ride along: FieldTable's "all samples
  zero" status now actually fires for fields like `gps:GPS_velned[2]`,
  and `checkAirspeedAutoTune` correctly hits the `inactive` branch
  on logs where GPS frames exist but never locked.
- M-Step closed-loop deconvolution: `lib/stepResponse.ts` — Wiener
  deconvolution with Welch-style windowed averaging. Three
  algorithmic fixes shipped 2026-05-17 after side-by-side against
  PIDtoolbox + PIDscope reference (`PSstepcalc.m`, GPL-3):
    · Dropped spurious ×2 "Hann coherent-gain correction" (cancels
      in the Wiener ratio when num + denom share window).
    · Switched Wiener λ from data-scaled to absolute `1e-4` (PIDscope
      value — wing setpoints have huge low-freq energy that made
      scaled λ kill mid-band ringing).
    · Replaced setpoint-RMS gate with peak gate (50 deg/s) +
      per-segment cumsum + tail-window QC band `[0.5, 3.0]`.
  Final calibration vs PIDscope still held (PIDscope wasn't loading
  logs locally on 2026-05-17); shape character now matches PIDtoolbox
  (ringy oscillation) but amplitude calibration TBD pending PIDscope
  cross-reference. `StepResponsePanel.vue` is per-axis with R/P/Y
  chips, traffic-light peak/settling metrics, y=1.0 reference line.
- M6 SPA effectiveness: `lib/spaAnalysis.ts` — per-axis SPA
  multiplier analysis with gate-active region detection, wind-up
  events (I-term grows while gate at floor), bounce-back events
  (post-release I-term peak within 200 ms). `SpaPanel.vue` overlays
  SPA multiplier (left axis 0..1) + I-term (right axis) with
  gate-active background bands + event markers via uPlot draw hook.
  `lib/recommenders/spa.ts`: yellow-confidence diagnostic recs with
  BF tuning hints; CLI emission deferred until validated wing SPA
  flight in corpus.
- M7 S-term TPA viz: `lib/sTermAnalysis.ts` — per-sample TPA factor
  (post/pre) with NaN gaps where pre below activeThreshold;
  sign-mismatch samples count as cancelled. `STermPanel.vue` is
  diagnostic-only (no CLI per roadmap Module F): pre-TPA vs
  post-TPA S overlay + TPA factor on secondary axis + y=1.0
  reference line via draw hook.
- M5 HYPERBOLIC TPA curve fitter: `lib/tpaCurveFit.ts` —
  `evaluateHyperbolic(x, params)` port of BF's
  `pid_init.c::tpaCurveHyperbolicFunction` (PR #13805); flat
  plateau below stallThrottle, then `1/log`-derived curve with
  endpoints pinned to (stallThrottle, pidThr0) and (1.0, pidThr100).
  `fitHyperbolicCurve` is a 4-param Nelder-Mead fit with coverage
  stats (low/mid/high band dwell). `TpaCurvePanel.vue`: scatter of
  measured (tpa_arg, tpa_factor) overlaid with fitted curve, header
  surfaces RMS + endpoint params + expo + sample count + x range.
  `lib/recommenders/tpaCurve.ts`: 6-criteria confidence — RMS,
  low/high-band dwell, x range, sample count, convergence — emits
  paste-ready `set tpa_curve_*` CLI; expo line promoted from
  informational to CLI only when `|expo| > 5` after a converged fit.
  Spec doc at `docs/firmware-reference/tpa-hyperbolic-spec.md`
  (extracted via research agent against BF PR #13805 + discussion
  #13786). Added `tpa_factor` signal to the registry (DEBUG_TPA
  channel 2, TODO verify on first real flight). Rewrote
  `checkTpaCurveFit` to read DEBUG_TPA directly (was deriving from
  WING_SETPOINT ratio); collapsed stale WING_SETPOINT spec in
  debugModeRecommender into the TPA spec which now covers BOTH
  cross-check AND curve fit. Closed the deferred M5 module.
- Tauri shell native file open: `tauri-plugin-dialog` +
  `tauri-plugin-fs` (v2) registered in `src-tauri/src/lib.rs`;
  capabilities scoped to `**/*.bbl`/`*.BBL`/`*.bfl`/`*.BFL`/`*.txt`.
  JS-side `@tauri-apps/api` + `@tauri-apps/plugin-dialog` +
  `@tauri-apps/plugin-fs` deps; `tauri:dev` / `tauri:build` npm
  scripts. `src/lib/tauriBridge.ts`: `isTauri()` runtime probe +
  `pickAndOpenLogFile()` that opens the native dialog filtered to
  BF extensions, reads bytes via fs, and returns a browser File
  (so the rest of the load pipeline doesn't branch). "Open file…"
  button rendered in FileDropZone EMPTY state ONLY under Tauri.
- LRU field-cache eviction: log-store cache now sweeps after each
  ensureFields(), evicting from Map insertion order (oldest first)
  until under DEFAULT_FIELD_CACHE_BYTES (256 MB). `pinFields()`
  action exposed so the recommender-required set can be marked
  never-evict — AnalysisView pins ALL_RECOMMENDER_REQUIRED_FIELDS
  on log load so the LRU pass can't thrash hot fields.
- Estimated scan-progress bar: determinate bar bound to
  `scanProgress` ref (0..100), animated by requestAnimationFrame
  ramping 0 → 95% across expected duration (file size / empirical
  ~5 MB/s throughput), snaps to 100% on actual completion. NOT true
  byte-level progress — the Rust `scan_log` is one-shot today;
  real streaming progress remains a future slice. Replaces the
  prior indeterminate striped bar.
- Airspeed predicate split + latent rec-bug fix:
  `checkAirspeedAutoTune` split into `checkAirspeedBasicFit` (pure
  GPS check) + `checkAirspeedTpaCrossCheck` (pure debug-mode check).
  ReadinessCard now shows them as two distinct rows. Fixed latent
  bug in `debugModeRecommender` where the TPA-rec was triggering
  on the GPS-missing path (which `set debug_mode = TPA` doesn't
  fix); now triggers on the actual DEBUG_TPA-missing condition.
- Generic Nelder-Mead extracted: `lib/nelderMead.ts` is the
  canonical simplex optimiser, consumed by both `airspeedFit.ts`
  (refactored from a specialised inline 4-vertex version, all 15
  tests pass) and `tpaCurveFit.ts`. `NelderMeadOptions.initialStep`
  accepts `number | readonly number[]` so per-axis absolute steps
  can handle params with wildly different scales (e.g. ms vs %).
- M-Servo MVP — input-chain lag breakdown. `lib/inputChain.ts`
  computes per-axis windowed normalized cross-correlation across
  three measurable stages: A `rcCommand → setpoint` (rate curves),
  B `setpoint → servo_agg` (PID + mixer), C `servo_agg → gyro`
  (servo + mechanical + aero). `buildPerAxisServoAggregate` sign-
  aligns opposite-sign servos and includes both `servo[i]` and
  `motor[i]` channel families with `|dominantSigned| ≥ 0.25`
  threshold so throttle PWM (often motor[0] on a pusher wing)
  doesn't pollute the per-axis aggregate. `InputChainPanel.vue`
  renders per-axis chain visualization (Roll/Pitch/Yaw rows with
  stage chips colored by health + total Σ stamp). Embedded in the
  Servos tab below `ServoPanel`. `lib/recommenders/inputChain.ts`
  emits yellow-confidence diagnostic recs per axis when total lag
  clears the wing threshold AND one stage accounts for ≥50% of
  total (otherwise no actionable lever); CLI deferred until multi-
  flight calibration. Wing-tuned thresholds (stage A <5/15ms,
  stages B+C <20/50ms, total <40/100ms) marked TODO for
  recalibration after the corpus grows. Three follow-up slices
  intentionally deferred per `project-mservo-deferred-slices`
  memory: per-servo drill-down (asymmetric linkage), airspeed-
  loaded lag bins (requires DEBUG_TPA flight), deadband + slew-
  ceiling detection (better as bench-test workflow).

**In flight / pending:**

- **M3 / M5 / M6 / M7 visual validation flights (held)** — Need
  calibration flights with the right debug modes to fully validate:
    · M3 (BASIC airspeed fit) + M5 (HYPERBOLIC TPA curve fit) +
      DEBUG_TPA cross-check: a sustained-cruise wing flight with
      throttle variation + GPS lock + `debug_mode = TPA` + ideally
      `attitude[1]` in main frame.
    · M4 raw-gyro overlay: a flight with `debug_mode = GYRO_RAW`.
    · M6 (SPA effectiveness): a flight with `debug_mode = SPA`.
    · M7 (S-term TPA viz): a flight with `debug_mode = S_TERM`.
  BF logs one debug mode per flight, so these need separate
  calibration sorties. Current logs (LOG00113, btfl_002) don't
  satisfy any — the panels correctly emit blocked/missing pending
  states. "Go fly" task, not a code task.
- Verify `tpa_factor` is DEBUG_TPA channel 2 on first real flight.
  The signal registry guesses channel 2 (the natural ordering
  after `tpa_speed_est`=0 and `tpa_arg`=1), but the BF source
  channel index wasn't pinned during the M5 recon pass. Wrong
  channel index would surface garbage as "resolved" output.
- Step-response settling-metric refinement vs PIDscope: shape
  character matches PIDtoolbox after the three fixes in `d6781fc`
  but amplitude still inflated. **2026-05-17 follow-up:** Brian got
  PIDscope working locally and did a three-tool side-by-side on
  btfl_002 (PIDscope / PIDtoolbox / WingTune). Findings:
    · Reference tools both report Roll Peak ≈ 1.3 (with latencies
      ~11–18 ms) despite their displayed CURVES looking very
      different. PIDscope's roll curve visually clips at the
      y-max of 1.75 (so the actual visible peak is > 1.75) while
      reporting Peak = 1.3 in the metric box. **So the "peak"
      metric both reference tools report is NOT max(response).**
    · WingTune's `peakAmplitude = max(response)` is reporting a
      fundamentally different quantity (335% on this log) — we've
      been comparing apples to oranges across all the previous
      calibration work.
    · PIDscope keeping n=9 segments with a clean curve while
      WingTune's n=13 produces noisy oscillation tells us the
      averaging / normalisation differs too — segment count
      alone isn't the culprit.
  PIDscope source is GPL-3 and lives locally at
  `C:\Users\Sista\Desktop\PIDscope-main`. Metric formulas
  extracted via research agent against that local copy
  (`src/plot/PStuningParams.m:74-76` + `:149-151`):

  ```
  peak    = max(mean_response WITHIN first 150 ms after t=0)
            # NOT global max — the chart shows 0-500 ms but the
            # metric only sees the first 150 ms. That's why
            # PIDscope's curve can visually clip at 1.75 while
            # reporting Peak = 1.3 in the metric box.
  latency = time when mean_response first crosses 0.5
            # from t=0 of the impulse (50% of unit-step target,
            # not 50% of realized peak).
  ```

  **Critical quad-vs-wing caveat:** the 150 ms peak window is
  hardcoded for quad dynamics (~30-80 ms settling). Wings have
  200-500 ms response, so adopting the formula verbatim would
  report the early *rising shoulder* as "peak" rather than the
  actual overshoot. A wing-scaled window would be ~500-800 ms,
  OR derive from the response's own settling time.

  **Decision: held — gather more data before changing the metric.**
  Brian wants to run multiple newer logs back-to-back through
  PIDscope + PIDtoolbox + Blackbox Log Explorer + WingTune and
  compare side-by-side before committing to a metric definition
  change. One log + three tools is too thin to choose a window
  size that holds across the wing-tuning regime. Knobs still on
  the dial list — QC band `[0.7, 1.5]`, segmentLen 8192 (2 s @
  4 kHz), peak gate 80 deg/s — remain secondary.

  Proposed implementation when ready (~30 min):
    · Replace `peakAmplitude = max(response)` with
      `max(response[0..PEAK_WINDOW_SAMPLES])`, default
      `PEAK_WINDOW_MS = 400` (middle of wing-response range).
    · Replace `settlingTimeMs` (first cross of 0.95 × finalValue)
      with `latencyMs = first time response[i] > 0.5`; gate
      with `max(response within window) < 0.5 → NaN`.
    · Update StepResponsePanel header label `settle 95%` →
      `latency 50%`. Cross-check expected: btfl_002 should drop
      from peak 335% toward 1.3-2.0 range.
- M1.0 corpus assembly track (not started).
- M1.7 multi-log compare (not started — ~1 week). Scope reduced
  from "multi-log + session persistence" 2026-05-17: persistence
  dropped. Tuning sessions are one-shot (drop log, analyse, fly
  again) — re-opening the same log next session is rare, the
  recommender CLI text is already pastable, and OS-level "recent
  files" covers the marginal case. Multi-log compare alone has
  real value (A/B before/after a tune change, cross-flight PIDFS
  share trends, spectrum overlay across filter changes); that's
  the M1.7 scope going forward.
- Upstream `blackbox-log` PR (held by Brian).

**Explicitly out of scope (won't build):**
- **Live FC connection / MSP / serial.** WingTune is a log analyzer,
  not a configurator. No reason to plug an FC into the app —
  configuration belongs in BF Configurator, telemetry belongs in
  the OSD or a separate live tool. Bench-FC dumps for things like
  KNOWN_PRESETS come via copy-paste from the CLI, not a serial
  link from WingTune.

**Immediate next step when resuming code work:** M1.7 multi-log
compare slice 1 (session store refactor). With M-Servo MVP
shipped, M1.7 is now the only remaining concrete code item that
isn't flight-blocked or held-on-Brian. Scope reduced
(~3.5-4.5 days for MVP, no persistence, no MSP/live-FC, no
TuningDiffPanel, no time alignment in MVP — see
`docs/wingtune-m1.7-execution.md` for the full slice plan +
locked scope decisions). One-of-N store model picked over focus+
siblings to match the survey-style tuning workflow (all loaded
logs are peers). Slice 1 is the foundation refactor; slices 2–5
are independent after that. Time alignment lives in a follow-up
M1.7.1 (~1.5-2 days). Everything else either needs flight data,
is held on Brian's call (upstream PR), or is a polish lift.

## Cardinal rules

These are non-negotiable. Each maps to a skill that goes into depth.

1. **Float32 everywhere.** No `Float64Array` on the hot path. No `new Array()`
   for field-shaped allocations. The time axis is `Float32Array` of
   seconds-since-log-start.
2. **Lazy hydration only.** The initial scan produces a capability report and
   a frame index — NOT materialized field arrays. Hydration happens on
   workspace or analysis-module demand, never speculatively.
3. **Three layers, no leakage.** Layer 1 (Ingest / WASM / Worker) →
   Layer 2 (Analytics) → Layer 3 (Vue UI). Layer 1 never imports Vue.
   Layer 2 never imports Vue. Components never call WASM directly.
4. **`shallowRef` for typed-array data.** Never `ref(typedArray)` — Vue's
   deep proxy will catastrophically wrap every element.
5. **Confidence scoring on every CLI recommendation.** Modules that emit
   paste-ready CLI return `ConfidenceResult<T>` with green/yellow/red. On
   `red`, the copy button is removed, not just disabled.
6. **Corpus hygiene is non-negotiable.** No `.bbl` files with home GPS
   coordinates in the public repo, ever. There is no exception hatch on this
   rule.

When in doubt about any of these, read the relevant skill BEFORE writing
code.

## Project structure

```
crates/wingtune-parser/   Rust crate wrapping blackbox-log; compiles to WASM
src/workers/              Web Worker host for the WASM module
src/lib/                  Shared primitives — wasmBridge, fft, confidence, predicates
src/analytics/            Per-module analysis code (one folder per module)
src/components/           Vue 3 SFCs
src/composables/          Vue composition functions (use*)
src/stores/               Pinia stores (one per concern)
src/views/                Route-level components
src-tauri/                Tauri 2.x desktop shell
tests/corpus/             Public, scrubbed regression corpus (manifest.yaml)
tests/corpus-private/     Personal regression corpus (gitignored)
docs/                     Planning docs (roadmap, M1 execution plan)
.claude/skills/           Project skills — read these before writing code
```

## Skills index

Located in `.claude/skills/`. Skills auto-trigger based on their descriptions;
the table below is for human navigation.

| Skill                         | Triggers on                                                          | What it enforces                                          |
|-------------------------------|----------------------------------------------------------------------|-----------------------------------------------------------|
| `wingtune-architecture`       | Any file change under `src/`, `src-tauri/`, `crates/`                | Three-layer separation, where things live                 |
| `wingtune-memory-model`       | Allocating typed arrays, decoding fields, store changes              | Float32, lazy hydration, shallowRef                       |
| `wingtune-corpus-hygiene`     | Any change touching `tests/corpus/` or a `.bbl` file                 | GPS scrubbing, public/private split, no escape hatch      |
| `wingtune-confidence-scoring` | New analysis module, capability predicates, readiness report changes | Two-layer trust model, green/yellow/red                   |
| `wingtune-vue-conventions`    | Any `.vue`, store, or composable change                              | Vue 3 + setup-style Pinia + Tailwind discipline           |

Each skill includes a "Quick self-check before committing" section that
serves as a built-in review checklist.

## Planning docs

- `docs/wingtune-roadmap.md` — long-arc design doc. Vision, three-layer
  architecture, all milestones (M1–M7), risk register, firmware companion PR
  scope. Read for "why does the project look this way?"
- `docs/wingtune-m1-execution.md` — current detailed execution plan for M1.
  Read for "what's the actual next step?" Includes critical path,
  sub-milestones M1.0 through M1.7, exit criteria, and TypeScript stubs for
  the load-bearing pieces.

M2's execution plan does not exist yet by design — it'll be written when
M1.3 lands and the hydration API contract is real. Don't preemptively spec
M2 details against assumptions M1 may violate.

## Common commands

```bash
npm install                     # install JS dependencies
npm run dev                     # web target dev server (Vite)
npm run tauri:dev               # Tauri desktop dev shell
npm run build                   # web target production build
npm run tauri:build             # Tauri desktop bundle (per-OS)
npm run test:unit               # vitest unit tests
npm run test:wasm               # WASM binding integration tests
npm run corpus:validate         # validate-parser against tests/corpus/manifest.yaml
npm run corpus:validate:private # against tests/corpus-private/manifest.yaml (local only)
```

Rust toolchain (one-time setup):

```bash
rustup install stable           # Rust toolchain
cargo install wasm-pack         # WASM build tooling
```

## How to work in this project

When starting a task on this codebase:

1. **Read the relevant skill(s) first.** Skill descriptions are the auto-trigger
   mechanism, but for any task touching code under `src/`, at minimum
   `wingtune-architecture` and `wingtune-memory-model` are likely relevant.
2. **Check status in the M1 execution doc.** The status section at the top of
   `docs/wingtune-m1-execution.md` tracks what's landed and what's next.
3. **For non-trivial tasks, sketch a brief plan before coding.** What files
   change, what tests validate, which skills apply. Surface the plan for
   review before implementation when scope is non-trivial.
4. **Run the per-skill self-check before committing.** Each skill has a
   "Quick self-check" section near the bottom — use it as a literal
   pre-commit checklist for the change.
5. **Exceptions are named and documented.** If a rule needs to be bypassed
   for a legitimate reason, use the named exception comment
   (`// LAYER-EXCEPTION:`, `// MEMORY-EXCEPTION:`, `// CONFIDENCE-EXCEPTION:`,
   `// VUE-EXCEPTION:`) with rationale, and update the relevant skill in the
   same PR. The corpus-hygiene skill has no exception hatch — its rules are
   absolute.
6. **Surface uncertainty.** If a decision sits in an "Open questions" section
   of a skill (component library, i18n, etc.) and the current task forces
   resolution, raise the question rather than picking silently.

## Out of scope (for now)

To keep M1 from becoming M-everything:

- M2+ analysis modules (PIDFS decomp, airspeed fit, TPA fit, SPA, S-term viz)
- The Betaflight firmware companion PR (parallel track, not gating M1)
- Code signing for Tauri bundles (deferred to v1 release time)
- Migration into / out of the BF Configurator (separate project, deliberately)

These have entries in the roadmap; they're acknowledged as future work, not
forgotten.
