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
suite (M2 / M3 / M5 / M6 / M7) + M-Servo MVP + M-FF feedforward /
maneuver-detection + M1.7 multi-log compare + M1.7.1 time-alignment
UI all shipped.** Analytics-plan milestone M-FF closed 2026-05-19;
**M-Coupling is the active milestone** (analytics-plan priority #2).
Other near-term work is **polish + Brian-blocked** (visual-validation
calibration flights for M3/M5/M6/M7, upstream `blackbox-log` PR,
step-response amplitude calibration vs PIDscope). M1.7 landed
2026-05-17 + M1.7.1 landed 2026-05-18: multi-tenant Web Worker,
session store, every panel migrated off the legacy single-log shim,
LogRoster strip with family colors + eye-as-focus + drag-to-align
handle, every time-domain compare panel (Servo, Tracking, PID,
SPA, S-Term, Airspeed) now iterates `session.logs.values()` with
HSL-tinted per-(log×series) traces on a shared session-time x-axis
via `useAlignedTime` + `src/lib/sessionTime.ts` helpers, Spectrum
and Step intentionally untouched (x = frequency / impulse-relative
time, alignment doesn't apply), RecommendTab "log i of N" pager.
See [[project-m17-multi-log-architecture]] memory for the load-
bearing design decisions.

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
- **M1.7 multi-log compare (one full-day session 2026-05-17)** —
  See `docs/wingtune-m1.7-execution.md` for the execution plan +
  what shipped vs deviated, and [[project-m17-multi-log-architecture]]
  for the load-bearing design decisions. High-level breakdown:
    · **Foundation**: `parser.worker.ts` is multi-tenant
      (`Map<logId, Uint8Array>` byte cache + per-call routing);
      `wasmBridge.ts` ParserClient takes `logId` on scan/hydrate +
      new `closeLog(id)`. New `src/stores/session.ts` with
      `LogState` (id/name/scanReport/time/fields/.../timeOffsetSec)
      wrapped in `shallowReactive` so post-construction property
      writes fire reactivity (latent bug — see
      [[project-m17-multi-log-architecture]]).
    · **Panel migration**: legacy `src/stores/log.ts` deleted; new
      `src/composables/useActiveLog.ts` projects "first VISIBLE log"
      as a single-log handle (eye-toggle off the focused log →
      composable falls through to the next visible one, so
      FlightStrip/ReadinessCard/cursor-readout/etc. re-anchor).
      22 panels migrated to either useActiveLog or direct session
      iteration. AnalysisView eager-pin uses `watchEffect` over
      `session.logs` with a per-logId `eagerlyHydrated` Set.
    · **Multi-log UX**: `src/lib/logColors.ts` (3-family palette
      warm/cool/neutral with HSL `tintTowardFamily()`). New
      `src/components/LogRoster.vue` between TabBar + TimeBar
      (visible at N≥1): family-color chips + filename + cycle
      warning at N>3 + eye toggle (inline SVG, slash overlay when
      hidden) + remove (X) + trailing "+" button calling
      `session.addLog` directly (no reset — additive).
    · **View store key migration**: `hiddenSeries` keys now
      `${logId}:${field}`; new helpers `toggleSeries(logId, field)`,
      `toggleSeriesForAllLogs(field, logIds)`,
      `isSeriesHidden(logId, field)`, `isSeriesHiddenForAllLogs(field, logIds)`,
      plus separate `hiddenLogs` Set + `toggleLogVisibility(logId)` +
      `isLogHidden(logId)` for the eye toggle.
    · **Compare-priority panel rewrites**: SpectrumPanel /
      ServoPanel / StepResponsePanel iterate `session.logs.values()`,
      build per-(log×axis) traces with `tintTowardFamily(axisHue,
      family)` strokes, pad shorter logs' arrays with NaN to a
      shared reference x-axis. Per-axis chips call
      `toggleSeriesForAllLogs` so a single R/P/Y click affects
      every loaded log. Imperatively-applied series visibility
      uses `watchEffect` (not fixed-dep `watch`) so it auto-fires
      on activeId / hiddenSeries / plot.updateCount changes —
      otherwise the chart drifts from chip state after eye-toggle
      or uPlot rebuild.
    · **RecommendTab pager**: at N≥2 a "showing recs for <name> ·
      log i of N ← →" header lets the user step through logs one
      at a time. Local `selectedIndex` ref, clamps on log removal.
      Independent of the eye toggle (recs are per-log; cross-log
      aggregation deferred per scope decision).
    · **M1.7.1 scaffold**: `src/composables/useAlignedTime.ts`
      exposes `toSessionTime(localT)` / `toLogTime(sessionT)` /
      `alignedCursor` for a given logId via `LogState.timeOffsetSec`.
      Convention: `sessionTime = logTime + offset`. 6-case test
      suite at `tests/unit/useAlignedTime.test.ts` covers
      identity, signed offsets, unknown-logId nulls, cursor
      projection, log-removal reactivity. No UI wired yet — that's
      M1.7.1 work.
    · **Edge cases hit + fixed during verification**: (1) all-eyes-off
      was returning user to drop zone — fixed by gating
      `App.vue`'s `hasLog` on `session.logs.size > 0` not on
      `scanReport != null`; (2) PID + Servo chart visibility lost
      sync after eye-toggle because old `watch([hiddenSeries,
      presentTerms], ...)` didn't include activeId/plot.updateCount
      — switched to `watchEffect`.
    · **Test results**: 137/137 unit tests pass (6 new for
      useAlignedTime). 5/5 wasm-binding tests pass against
      btfl_002.bbl seed. `tests/wasm-binding/entry-flow.test.ts`
      updated to seed via `session.__test_seedLog({...})` instead
      of writing legacy-store refs.
- **M1.7.1 time-alignment UI (2026-05-18)** — drag handle (⟷)
  per roster chip with shift=fine / alt=coarse scaling (0.002 /
  0.02 / 0.2 s per px); accent-color `+1.42s` offset badge +
  reset (↺) appear when offset ≠ 0; window-level mouse handlers
  with cursor + user-select lock so the drag survives leaving
  the chip. `useAlignedTime` widened to accept
  `MaybeRefOrGetter<string|null|undefined>` via `toValue` so
  panels with a reactive `activeId` can subscribe without
  re-instantiating the composable (string-overload tests still
  pass). **ServoPanel adopted session time as its x-axis** —
  per-log aligned-time arrays via `alignedTimeFor(log)`, longest
  aligned axis chosen as ref, per-log values resampled onto ref
  via uniform-rate index math (BF logs are uniform; ~O(1) per
  sample). Cursor readout for the active log projects session
  cursor → log-local via `activeAlign.alignedCursor.value`
  before indexing field arrays. Other compare panels (Spectrum,
  Step, PIDContribution) still treat their x as raw log-local
  time — works fine when active-log offset is 0 (common case),
  migrates the same way when needed. **Float32→Float64 fix in
  aligned time:** `alignedTimeFor` returns `Float64Array` when
  offset ≠ 0 (Float32 round-trip at certain offsets like exactly
  −0.60 s landed `localT = ref[0] - offset` at ~−2.4e-8, just
  below `t0 = 0`, which dropped sample 0 and cascaded into a
  blank uPlot chart with no y-axis labels). `resampleOntoRef`
  also got a half-sample eps tolerance + idx clamp for
  belt-and-suspenders. 140/140 unit tests + skipped wasm-binding
  pass; typecheck clean. See [[project-m17-multi-log-architecture]]
  for the Float32 precision lesson.
- **M1.7.2 signal registry guards + corpus unblock (2026-05-18)** —
  Wide-blast session that shipped registry safety guards, found
  + fixed two latent silent-failure bugs, unblocked the corpus
  pull, and pinned vitest. High-level:
    · **Signal registry**: `SignalSource` gains optional
      `expected_range` + `min_firmware`; resolveSignal returns a
      new `out_of_range` state with `{expected, observed, source}`
      when sampled values fall outside the declared range. Walker
      promotes most-informative fallback (out_of_range > inactive
      > missing). Parser-side: `SampleCheck` now tracks
      `value_min`/`value_max` during scan's stride-sample loop;
      `CapabilityReport.firmware_revision` mirrored from
      ScanReport so resolveSignal can apply `min_firmware` gates
      without separate plumbing. ReadinessCard renders the new
      state with a distinct stamp-color icon + structured
      observed/expected block. `capabilityPredicates` surfaces
      `rangeInfo` through `ModuleReport`. 17 new unit tests.
    · **Main-frame `wing*` field bindings**: 10 SignalDefs now
      prefer modern USE_WING main-frame fields (`wingTpaFactor`,
      `wingSpa[axis]`, `wingSetpointAdj[axis]`,
      `wingSTermPost[axis]`, etc.) over their DEBUG_ channel
      fallbacks. Analytics fire without needing the right
      `debug_mode` multiplexed. Three new side-benefit signals
      exposed (`attitude_roll`, `attitude_pitch`, `throttle_calc`
      from DEBUG_TPA ch1/2/3).
    · **DEBUG_TPA channel layout corrected** against limonspb's
      PR #13895 reference: `tpa_factor`=ch0, `tpa_arg`=ch5 (was
      ch4), `tpa_speed_est`=ch4 (was ch3, with `[0,1500]` range
      for the ×10 encoding). Previous best-guesses had `tpa_arg`
      and `tpa_speed_est` on the wrong channels.
    · **blackbox-log fork: BF 4.6 support added.** `types/data/
      Betaflight/4.6/` cloned from 4.5 then `debug_mode.yaml`
      patched from 2026.6 (only debug_mode differs between the
      two). `InternalFirmware::Betaflight4_6` variant inserted +
      `From<Firmware>` mapping. `BETAFLIGHT_SUPPORT` range
      extended (`4.2..4.6` was exclusive — silently rejected 4.6
      logs). Codegen rerun. Committed as `a7b3f42` then amended
      to `6203d45` / `183c43d` over several iterations as missing
      4.6 YAML files were caught.
    · **blackbox-log fork: 3 new debug modes added.** YAML +
      regenerated source for DEBUG_GPS_RESCUE_WING (102),
      DEBUG_SERVO_AUTOTRIM (103), DEBUG_AUTOLAND (104). Also
      caught a latent codegen-stale bug — Brian's prior commit
      `4dd54b5` added TPA/SPA/S_TERM/WING_SETPOINT YAML entries
      but never re-ran codegen, so the generated source never
      had match arms for them. Regen run + committed as
      `3e6d96c`. All wing-mode logs decode through the parser now.
    · **Firmware silent data loss bug found + fixed (`eeafdb052`).**
      In `betaflight-wing-msp`, the wing-block writes in
      `writeIntraframe` and `writeInterframe` were AT THE END of
      each frame (after motor/servo/eRPM) but the
      `blackboxMainFields[]` header def had them BETWEEN axisS
      and rcCommand. The byte stream alignment broke at the first
      `NEG_14BIT` (vbatLatest) — parser tried to read
      variable-byte SIGNED_VB at that position and consumed the
      wrong number of bytes, cascading to ~98% of frames being
      silently skipped as "corrupted." A 2.4 MB bench log decoded
      as only 25 main frames before the fix; same firmware after
      the reorder + reflash decodes 22k+ frames at 1000+ Hz.
      Isolated via a new `crates/wingtune-parser/examples/probe_log.rs`
      diagnostic binary (kept as a permanent tool — paid for
      itself today).
    · **TPA panel two-bug fix** (`fix(tpa)` commit). Panel
      explicitly rejected non-debug source kinds
      (`r.source.kind !== 'debug'`) so the new main-frame routing
      resolved but the panel discarded it. Also `buildTpaFitInputs`
      passed raw field values straight into the fit math which
      expects `x ∈ [0, 1]` — but BF emits `tpa_arg` and
      `tpa_factor` as `value × 1000`. Both fixed with a single
      `BF_TPA_SCALE = 1/1000` constant at the input boundary
      (single source of truth — recommender flows through the
      same builder). Latent since M5 shipped — never noticed
      because no prior log had exercised the panel successfully
      (btfl_002's calibration log had `debug_mode = WingLaunch`
      so the panel always quietly showed "set debug_mode = TPA").
    · **Session hydrate-id race graceful handling.** Vite HMR in
      dev rebuilds the parser worker module → wipes the worker's
      per-logId byte cache → next panel mount triggers
      `ensureFields` → worker says "no bytes for this id" →
      uncaught promise rejection. `ensureFields` now catches the
      specific "no log with id" error class and surfaces as a
      `console.warn` with a "re-drop the log to recover" hint.
      Other hydrate errors with different shapes still propagate.
    · **vitest pinned to 4.1.5** (no caret). 4.1.6 has a
      runner-initialization regression on this stack that crashes
      every test file at the first `describe()` call. Downgrading
      to 4.1.5 makes all 164 tests pass instantly. See
      [[project-vitest-pin]] memory.
    · **Initial corpus pull landed.** Downloaded the 4 limonspb
      PR #13895 reference logs into `tests/corpus-private/`
      (gitignored). All 4 validate cleanly through
      `npm run corpus:validate:private` (new script) once the
      blackbox-log fork has 4.6 YAML. Real airframes, BF 4.6.0,
      DEBUG_TPA active, GPS lock — exercise M3 + M5 +
      DEBUG_TPA cross-check end-to-end (would have caught the
      TPA × 1000 scaling bug if it had existed earlier).
    · **New `wingtune-recommender` skill** added at
      `.claude/skills/`. Codifies safety invariants for the
      "tool tells user what to do" surface — the only major code
      path that was previously without a codified skill. See the
      CLAUDE.md skills index for trigger conditions.

- **2026-05-18 evening session — step + autoalign + servo
  asymmetry (commits 432bdb9..56b13a1).** Closeout of four
  discretionary slices triggered by Brian's first real-flight
  USE_WING logs (btfl_002 / btfl_003 / btfl_005, added to
  private corpus). High-level:
    · **Cleanups (432bdb9, 5daba86, dceab1f, 1c8ee6d):**
      debugMode rec uses `allBlocked` instead of `anyBlocked`
      so per-axis specs only fire when truly all axes blocked
      (S_TERM yaw-only block no longer triggers misleading rec
      on USE_WING). TpaCurvePanel bounded y-scale + fit-
      trustworthiness gate (rejects fits with params outside
      CLI valid ranges, suppresses garbage curve overlay, warn
      ribbon explains narrow-X-range cause). STermPanel routes
      TPA factor through direct `wingTpaFactor` signal instead
      of deriving from post/pre (continuous, no derivation
      noise) with hold-last fallback for non-USE_WING. Vitest
      pool=forks pinned (default threads pool leaks state).
    · **Plan D — step-response metric (0995235):** peak now
      `max(response within first 400 ms)` not global max;
      `settlingTimeMs` → `latencyMs` (first 0.5 crossing,
      PIDscope-aligned, wing-scaled per CLAUDE.md SCOPE box).
      Yellow caveat ribbon stamps the panel when axisF or axisS
      is non-zero (USE_WING logs always trigger it — explains
      "non-zero F+S, full closed-loop, not PD-isolated"). Per-
      tab guide footer points at the F=0+S=0 calibration sortie
      workflow for PIDtoolbox/PIDscope comparability.
    · **Plan A — auto-align first-throttle fallback (c1c5051):**
      new `lib/firstArmEvent.ts` detects first sample where
      `rcCommand[3]` crosses 1100 from below. LogRoster
      orchestrator: gyro xcorr primary, throttle fallback when
      xcorr returns low NCC or peak ratio. Per-log anchor
      method ("gyro xcorr (ncc 0.82)" / "first-throttle
      fallback" / "gyro low-conf → throttle fallback") surfaces
      in the offset-badge tooltip. Resolved Brian's +21.40s
      xcorr outlier on btfl_003 to a sensible -0.67s.
    · **Plan B — M-Servo asymmetric linkage detection (56b13a1):**
      `lib/servoAsymmetry.ts` does pairwise lag + amplitude-ratio
      analysis for axes with ≥ 2 contributing servos. New
      `ServoAsymmetryPanel` embedded under InputChainPanel in
      Servos tab. Yellow recs for warn-severity pairs (no CLI —
      mechanical drift has no firmware fix; detail walks the
      bench-inspection workflow). Footer caveat surfaced: BF
      wing-msp sends paired-identical PWM so this panel can only
      detect mixer-side drift — mechanical asymmetry (loose
      linkage, worn clevis, asymmetric deflection) requires a
      bench deflection gauge.
    · **Plan C — no work needed.** Audit of compare panels
      (Servo, Tracking, PID, SPA, S-Term, Airspeed) confirmed
      ALL of them already use `useSessionRefTime` +
      `resampleOntoRef` + `sessionTimeRangeFn` from M1.7.1. Only
      Spectrum + Step intentionally stay on freq / impulse-
      relative axes. Saved the planned ~2h estimate.
    · **M4 raw-gyro overlay status reset:** SpectrumPanel raw/
      filt comparison was previously marked flight-blocked on
      `debug_mode = GYRO_RAW`, but signalRegistry already
      routes `raw_gyro` through main-frame `gyroUnfilt[axis]`
      first (with the debug-mode fallback for stock-BF). So
      USE_WING logs exercise raw/filt overlay end-to-end with
      no debug-mode requirement. Pure status correction.
    · **Per-tab tuning guide doc** added at
      `docs/wingtune-tab-guide.md` — what each tab shows, what
      to look for, tuning workflow, gotchas. New-contributor
      onboarding + workflow reference.
    · **178/178 unit tests pass** (14 new this session — 8 for
      firstArmEvent + 6 for servoAsymmetry).
    · **Corpus state:** private manifest now has 7 entries —
      the original 4 limonspb PR #13895 logs plus Brian's 3
      real-flight USE_WING logs (basic-wing class). All
      validate cleanly via `npm run corpus:validate:private`.
      See [[project-corpus-pull-state]] memory.

- **2026-05-19/20 session — M-FF + display smoothing + polish
  (commits abff4fa..81a417f).** Closed analytics-plan milestone
  #1 (M-FF) plus polish + docs. High-level:
    · **M-FF — feedforward effectiveness + maneuver detection
      (abff4fa).** `lib/maneuverDetect.ts` — setpoint-velocity
      segment selector flagging + classifying aggressive-input
      windows (snap roll / pitch punch / mixed); shared
      infrastructure, not a standalone panel.
      `lib/ffEffectiveness.ts` — per-axis FF coverage
      (`mean|F| / (mean|F| + mean|P|)` inside maneuver windows) +
      leading-edge overshoot detection. `FFPanel.vue` on the Step
      tab — now "Step · FF" double-duty via new `StepTab.vue`.
      `lib/recommenders/ffEffectiveness.ts` — diagnostic-only
      (yellow, no CLI; CLI deferred until multi-flight
      calibration, per the SPA / inputChain pattern).
    · **Global display-smoothing slider (d28c836).**
      `lib/displaySmooth.ts` `smoothTrace()` — NaN-aware boxcar,
      strength 0 a no-op. `view.smoothingStrength` (0-4) +
      `SmoothingControl.vue`, gated to the smoothable tabs
      (Tracking / Servos / SPA / S-Term / Step·FF), applied to
      6 panels' display traces. HARD RULE: display-only — never
      feeds analysis; header metrics stay computed from raw
      Float32.
    · **Polish:** hover tooltips on analysis-panel header
      metrics (23f71d9); airspeed fix — max-voltage pinned from
      the log + pitch routed through the signal registry
      (ba3716b); independent-verification test coverage for
      step response + TPA curve (efc6d57); smix-table decode for
      deterministic servo classification (81a417f).
    · **Docs:** analytics expansion plan + planning-doc index
      (0818a63), M-FilterSim / smoothing / tab-IA plan items
      (a4493e0), wing-regime spectral batch (7ca6093), end-to-end
      tuning-workflow guide (5bcd526), per-tab tuning guide
      (cc844e0).

**In flight / pending:**

- **M3 + M5 visual validation: PARTIALLY UNBLOCKED 2026-05-18.**
  The 4 limonspb PR #13895 reference logs in
  `tests/corpus-private/` exercise M3 BASIC airspeed fit + M5
  HYPERBOLIC TPA curve fit + DEBUG_TPA cross-check end-to-end.
  Brian's own bench logs work too now (post writer-order fix).
  Real flight-data validation still wants throttle-varying
  cruise + GPS lock to characterize the TPA curve across the
  full airspeed range — Brian to fly when conditions allow.
- **M6 / M7 still held on flight data.** Need a flight with
  `debug_mode = SPA` for M6 effectiveness validation; a flight
  with `debug_mode = S_TERM` for M7 viz. (Note: on USE_WING
  firmware, the main-frame `wingSpa[]` / `wingSTermPost[]`
  fields make these debug modes unnecessary for analytics —
  the registry routes through main-frame first. So in practice
  any USE_WING log with motion exercises both.)
- ~~M4 raw-gyro overlay flight-blocked~~ — **resolved 2026-05-18**.
  USE_WING firmware always logs main-frame `gyroUnfilt[axis]`
  alongside filtered `gyroADC[axis]`, so SpectrumPanel's raw/filt
  overlay no longer needs `debug_mode = GYRO_RAW`. signalRegistry
  routes `raw_gyro` through main-frame first, falls back to
  DEBUG_GYRO_RAW for stock-BF logs.
- Step-response amplitude calibration vs PIDscope — **metric
  definition shipped 0995235** (peak = max within first 400 ms;
  latency = first 0.5 crossing — both PIDscope-aligned, wing-
  scaled). Plus F/S caveat stamp on the panel explaining
  closed-loop-as-flown vs PD-isolated reading. What remains:
  threshold recalibration (when does peak indicate a tuning
  issue?) needs a clean PD-isolated reference flight to anchor
  against. Held until Brian flies F=0 + S=0 calibration sortie. Metric definition + caveat
  shipped in commit 0995235 (see entry above). The remaining
  question — "where do we set the YELLOW/RED thresholds on peak
  amplitude for actionable rec emission?" — needs Brian to fly
  a F=0+S=0 PD-isolated calibration sortie. Until then the
  Step panel is diagnostic-only; no Step-driven CLI recs ship.
- ~~Optional alignment heuristics~~ — **first-throttle-up
  fallback shipped c1c5051** (Plan A from the 2026-05-18 evening
  session). LogRoster auto-align now uses gyro xcorr as primary,
  falls back to first-throttle-up crossing when xcorr returns
  low NCC / peak ratio. Per-log anchor method surfaces in the
  offset-badge tooltip. Resolved the +21.40s xcorr outlier on
  Brian's btfl_003 to a sensible -0.67s.
- Upstream `blackbox-log` PR (held by Brian).
- Upstream firmware writer-order fix PR (held by Brian — fix
  is in his `betaflight-wing-msp` fork as `eeafdb052`).

**Explicitly out of scope (won't build):**
- **Live FC connection / MSP / serial.** WingTune is a log analyzer,
  not a configurator. No reason to plug an FC into the app —
  configuration belongs in BF Configurator, telemetry belongs in
  the OSD or a separate live tool. Bench-FC dumps for things like
  KNOWN_PRESETS come via copy-paste from the CLI, not a serial
  link from WingTune.

**Immediate next step when resuming code work:** the analytics
expansion plan (`docs/wingtune-analytics-plan.md`) drives from
here. M-FF (priority #1) shipped 2026-05-19 (abff4fa). **M-Coupling
— the cross-axis coupling matrix (analytics-plan priority #2) — is
the active milestone.** Decisions locked 2026-05-20: gate the
coupling measurement on transient windows only (reuse the M-FF
`maneuverDetect.ts` segment selector); diagnostic-only — yellow
recs, no CLI (coupling is a mixer / CG / mechanical diagnosis with
no firmware fix). Execution detail in
`docs/wingtune-m-coupling-execution.md`. All other near-term work
is flight-blocked (Step recommender threshold recalibration needs
a clean F=0+S=0 PD-isolated reference flight; M3/M5/M6/M7 visual
validation needs throttle-varying cruise) or held on Brian's call
(upstream `blackbox-log` PR, upstream firmware writer-order PR).

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
| `wingtune-recommender`        | New recommender, RecommendCard edits, CLI-emission path changes      | Safety invariants for the only "tool tells user what to do" surface |

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
- `docs/wingtune-analytics-plan.md` — forward-looking plan for analytics
  beyond M1-M7 + M-Servo. Triaged-with-Brian shortlist (M-FF feedforward
  effectiveness + maneuver detection, M-Coupling cross-axis matrix,
  M-Servo-2 hunt + transfer function, M-Pilot input style, craft
  persistence infra). Records what was dropped + why. Read for "what's
  the next milestone batch?"
- `docs/wingtune-tab-guide.md` — per-tab walkthrough: what each panel
  shows, how to read it, the tuning workflow that uses it.
- `docs/wingtune-tuning-workflow.md` — 10-phase end-to-end tune from
  fresh flash to validated wing, cross-referenced against the tab guide.

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
