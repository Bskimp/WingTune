# WingTune

> Desktop-first (Tauri 2.x) + hosted-demo blackbox log analysis tool for the
> fixed-wing side of Betaflight. Vue 3 + Vite + TypeScript + Pinia + Tailwind
> frontend; Rust parser (`blackbox-log`) compiled to WASM in a Web Worker.
> GPL-3.0-or-later. See `docs/wingtune-roadmap.md` for the long arc.

## Status

Design docs locked through v0.9 (roadmap) / rev 12 (M1 execution).
M1 functionally complete (corpus track aside); M2 emission loop
landed; M3 BASIC airspeed fit + recommender landed; M4 spectrum tab +
filter analysis + spectrum recommenders landed; M1.5 deeper BBL
header inspector landed; M-Step closed-loop deconvolution landed.
Step tab no longer a placeholder. M3 + M4 raw-gyro visual validation
deferred (need calibration flights with the right debug modes).

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
  deconvolution (`H(f) = G·conj(S)/(|S|²+λ)`, λ = 1% peak |S|²) with
  Welch-style windowed averaging across overlapping segments. Drops
  segments below the setpoint-RMS gate (deconvolving against near-
  zero input amplifies noise). Hand-rolled `ifftInPlace` via the
  FFT(conj(x))/N trick, no new dependency. Exposed metrics: peak
  amplitude (>1 = overshoot), peak time, settling time (first
  crossing of 0.95×finalValue), final value, num kept segments.
  `StepResponsePanel.vue` is per-axis (PIDtoolbox convention) with
  R/P/Y selector chips, peak %+settling ms header metrics
  (traffic-light coloured), reference line at y=1.0 via uPlot draw
  hook, honest "fly more aggressive manoeuvres" pending state for
  low-excitation logs. Replaces the M-step TabPlaceholder.

**In flight / pending:**

- **M3 + M4 visual validation flight (held)** — Need calibration
  flights to fully validate:
    · M3 (BASIC airspeed fit): a sustained-cruise wing flight with
      throttle variation + GPS lock the whole flight + ideally
      `debug_mode = TPA` for firmware-estimator cross-check + ideally
      `attitude[1]` in the main frame (some BF builds skip the AHRS
      estimator).
    · M4 (pre/post-filter overlay): a flight with
      `debug_mode = GYRO_RAW` (separate flight from the TPA one since
      BF logs one debug mode per flight).
  Current logs (LOG00113, btfl_002) don't satisfy any of these — the
  fit + overlay surfaces are correctly emitting blocked/missing
  states. This is a "go fly" task, not a code task. Flagged so it
  doesn't get lost.
- Pitch sign convention vs BF firmware (currently `−g·sin(pitch)`
  assuming BF nose-up positive). Verify against firmware source when
  M5 work begins.
- M1.0 corpus assembly track (not started).
- Step-response settling-metric refinement: on btfl_002 the reported
  peak (164 %) and settling (109 ms) didn't visually match the chart
  curve (peak visually ~155 %, response crossed 0.95·finalValue
  around 220 ms). Possible causes: cumsum edge artifact, finalValue
  tail-window edge case, or Hann coherent-gain interaction in the
  amplitude scaling. Math is roughly correct (synthetic first-order
  tests pass) but absolute calibration may want refining. Worth a
  pass when comparing against PIDtoolbox reference numbers on the
  same log.
- M1.7 multi-log + alignment (not started).
- Scan-progress streaming UX (indeterminate striped bar today;
  real % needs Layer 1 worker progress messages).
- LRU eviction policy on hydrated-field cache (constant only today).
- Tauri-side `openSource(path)` command + native file picker.
- Upstream `blackbox-log` PR (held by Brian).
- `checkAirspeedAutoTune` predicate split: currently gates on
  `debug_mode = TPA` (cross-validation case) but the BASIC fit
  recommender doesn't need DEBUG_TPA — the readiness BLOCKED label
  reads as more pessimistic than reality. Split into two checks
  (BASIC-fit-runnable vs DEBUG_TPA-cross-check) when the M3 UX shakes
  out on a clean log.

**Immediate next step when resuming code work:** Brian's call —
candidates are M3 (airspeed/TPA fit using DEBUG_TPA signal),
deeper M2 recs (e.g. PIDFS share-imbalance detection), M5 (TPA
curve fit using WING_SETPOINT pre/post pair), Tauri shell wire-up,
or scan-progress streaming. The chart + cursor + rec infrastructure
is in place — pick a module, write its analytics, plug recs into
the existing recommender registry.

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
