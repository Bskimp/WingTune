# WingTune — Roadmap (v0.9)

> Desktop-first (Tauri) + hosted-demo log analysis tool for the fixed-wing side of Betaflight. Wing-specific analytical primitives built around servo dynamics, airspeed-scheduled gains, and the PIDFS controller — with confidence-scored CLI recommendations rather than blind paste-ready output. Analyses resolve their data needs against a **source-agnostic signal registry**: same predicate works on a 2025.x log with `debug_mode = TPA` and on a 2026.6+ log with the promoted main-frame fields. Multi-log workflows are additive features on existing surfaces — there is no separate "campaign" UI. The parser layer (Rust `blackbox-log` wrapped to WASM) is consumed via a fork (`Bskimp/blackbox-log:wing-support`) with a parallel upstream PR — WingTune development does not gate on the upstream merge.

## Changes from v0.8

- **Risk #3 rewritten** to name the unified path: fork → PR upstream in parallel → patch-override locally → bump-or-maintain depending on merge outcome. The earlier framing implied a hard "gate on PR" model; that was wrong. Patch-and-continue is standard Rust dependency practice; that's what WingTune uses.
- **M1.0 (in the M1 execution doc) now includes a Parser support track**: explicit steps for forking, opening the upstream PR, configuring the workspace `[patch.crates-io]` override, and the two endings (upstream merges → bump dep; upstream doesn't → fork is the long-term dep).
- **Last-resort fallback named**: wrapping `betaflight/blackbox-tools` (C) via Emscripten if the fork strategy ever falls apart. Bounded to Layer 1 by `wasmBridge.ts`. Not the default.

## Changes from v0.7 → v0.8 (carried forward)

- **M1.7 reframed**: dedicated "campaign mode" surface is gone. Replaced by **multi-log + session persistence** — additive features on time-series, readiness, and header surfaces, plus a save/load mechanism for named sessions. Reasoning: every concrete need (multi-log overlay, time alignment, parameter diff, unioned readiness, persistence) lives better as a feature than as a modal view. No `CompareView.vue` or `/compare` route.
- **Tuning diff panel** added as the dedicated multi-log surface — a side panel showing ~30 curated main tuning parameters across loaded logs, with diffs highlighted. **Not** a 200-row dump.
- **Tuning history matrix** added to post-M7 backlog — the full `parameter × flight` table is deferred until M1 has been used on a real tuning sequence and the right column/row controls become obvious from use.
- **Time alignment** flagged as a non-trivial chunk of M1.7 work, not a one-line toggle (X-axis transform with three modes: `absolute`, `first-arm`, `first-mode-change`).

## Changes from v0.6 → v0.7 (carried forward)

- **Source-agnostic signal resolution**: WingTune does **not** gate analyses on the firmware companion PR landing. Each wing-tuning signal (TPA speed estimate, TPA argument, pre-TPA sTerm per axis, SPA per axis, adjusted setpoint per axis) is resolved via a registry that prefers the new main-frame `USE_WING` field but falls back to the existing debug-mode channel. Predicates never name a source — they ask the registry. M3/M5/M6/M7 work today on existing debug-mode logs; they keep working unchanged when 2026.6 ships. A partial PR (e.g. only the TPA family lands) unlocks the matching analyses while the rest stay on debug fallback.

## Changes from v0.5 → v0.6 (carried forward)

- **Distribution model**: Tauri desktop shell is now the primary build target, with the static hosted site as a "try it" demo. Same Vue 3 + Vite + WASM frontend; Tauri wraps it for native file access and unconstrained memory. License stays GPL-3.0-or-later (works for both targets).
- **Memory architecture**: Layer 1 now specifies **fielded lazy decode + Float32 throughout** instead of decoding every field as a full Float32/Float64 typed array at end-of-decode. Workspace switches trigger field hydration. Predicate evaluation and readiness need only presence + `sample_check`, not materialized values. Composes with multi-log sessions (multiple logs × hot-fields-only).
- **Event/annotation track** (M1.4): flight mode changes, arm/disarm, RX loss, failsafe events render as flagged markers on the timeline.
- **Multi-log support promoted** from post-M7 backlog to **M1.7** — debug-mode exclusivity forces multi-flight workflows from M3 onwards. (v0.6→v0.7 framed this as "campaign mode"; v0.8 reframes as additive features on existing surfaces — see v0.7→v0.8 changes above.)
- **Voltage sag** added as an M3 confidence criterion (`vbatLatest` is already in the main frame — easy to track).
- **Test surface expanded**: vitest for predicates / wing detection / confidence scoring; WASM binding integration test (Node-side); FFT correctness against synthetic sines; curve-fit determinism via snapshot; confidence property tests; Playwright smoke (post-M1.6).
- **Firmware companion PR** scoped separately — promote DEBUG_TPA / DEBUG_S_TERM / SPA-related signals to first-class main-frame fields under `USE_WING`, following the `axisS` precedent. Target BF 2026.6. See "Firmware companion work" section.

## Changes from v0.5 → v0.6 (carried forward from earlier versions)

- **Scope locked** (v0.2): Betaflight wing logs only.
- **Parser path locked** (v0.2): `blackbox-log` (Rust) → WebAssembly in a Web Worker.
- **License locked** (v0.2): GPL-3.0-or-later.
- **Risk #1 retired** (v0.2): `axisS[0..2]` is a first-class main-frame field under `USE_WING`.
- **Frontend: Vue 3 + Pinia** (v0.3): alignment with active BF Configurator Vue migration.
- **Milestone reorder** (v0.4): PIDFS quick decomp at M2, airspeed estimation at M3.
- **Golden-log corpus, confidence scoring, M1.6 readiness report** (v0.4).
- **Closed-loop wing response math** (v0.4): no more "servo step response" framing.
- **Corpus hygiene rules** (v0.5): explicit anonymization/exclusion policy for public `.bbl` logs.
- **M1.6 wording** (v0.5): capability predicates evaluated at runtime, validated by corpus — not corpus-class matching.
- **Dependency policy** (v0.5): current stable unless WASM/Worker compatibility forces a pin.

## Status

**Wing analytics suite (M2 / M3 / M5 / M6 / M7) complete** as of 2026-05-17 — every wing-specific analysis module on this doc has shipped its first slice with panel + recommender + tests. M1 foundation + M1.5 header inspector + M1.6 readiness report + M4 spectrum tab + M-Step closed-loop deconvolution all landed. Tauri shell now opens via the native dialog; field cache has LRU eviction; scan-progress shows an estimated bar; airspeed readiness is split into BASIC-fit vs DEBUG_TPA-cross-check rows. Generic Nelder-Mead optimiser shared by the airspeed + TPA fits.

**Held on flight data** (not code work): M3 + M5 + M6 + M7 + M4-raw-gyro visual validation against debug-mode calibration sorties. BF logs one debug mode per flight so these are four separate test flights. Current corpus logs (LOG00113, btfl_002) don't have the right debug modes; panels correctly surface blocked/missing pending states.

**Still pending in code:**

- M1.0 corpus assembly track (not started).
- M1.7 multi-log + session persistence (not started).
- Real Rust scan-progress callback (interim estimated bar shipped; true byte-level progress needs Rust callback threading + WASM rebuild + worker plumbing).
- Step-response settling-metric calibration vs PIDscope (shape character matches PIDtoolbox; amplitude calibration held on PIDscope's log loader).
- Verify `tpa_factor` is DEBUG_TPA channel 2 (signal-registry TODO).
- Upstream `blackbox-log` PR (held — Brian's call).

The detailed status of every Done item lives in `CLAUDE.md`; that file is the authoritative state-of-the-project doc for resuming work.

## Vision

Existing blackbox analyzers (PIDtoolbox, PIDscope, Plasmatree, Blackbox Log Viewer) were built around multirotor dynamics. The math, windowing, FFT bands, and response assumptions are all calibrated for ~20 ms motor responses and 50–500 Hz prop noise.

Fixed wing flies in a different regime:
- Closed-loop response times are 200–500 ms, not 20 ms
- Interesting noise band is sub-50 Hz, not 50–500 Hz
- Controller is PIDFS, not PIDF — S-term is the dominant maneuver driver
- Attenuation is airspeed-scheduled (TPA airspeed), not throttle-scheduled
- I-term gating is setpoint-rate-driven (SPA), not throttle-driven
- Gust response and coupled-axis behavior are first-class concerns
- Tuning decisions can put aircraft in trees — recommendations must be confidence-scored, not magical

WingTune is a fresh take on the analytics and visualization layers, reusing `blackbox-log` for the decoder. Desktop-first via Tauri, with a static hosted demo built from the same codebase. Output is both visual analysis and conditionally paste-ready CLI commands gated on data adequacy.

## Architecture

Three-layer separation. The discipline is to keep each layer narrow.

### Layer 1 — Ingest

- **Parser**: [`blackbox-log`](https://github.com/blackbox-log/blackbox-log) (Rust, Apache-2.0/MIT) → WASM via `wasm-pack`, hosted in a Web Worker.
- **Web Worker isolation**: parsing runs off the main thread.
- **Streaming output**: emits decode progress incrementally during the initial scan.
- **Fielded lazy decode** (load-bearing): the initial pass builds the **capability report** (field presence + debug mode + GPS + per-field `sample_check`) and a **frame index** (byte offsets per N frames for fast seeking) — but does **not** materialize per-field typed arrays. Workspaces declare their required fields; switching workspaces triggers hydration of just those fields. M2+ analysis modules state their field list and only hydrate what they need. Hydrated fields use **Float32** values and a **Float32 time-since-start** axis (not Float64) — roughly halves peak memory.
- **Capability report**: structured metadata drives M1.6 and is the only thing M1.6 needs — no field values required.
- **Desktop shell**: Tauri target gets direct filesystem reads (no `arrayBuffer()` round-trip), `.bbl` file association, and no browser memory cap. Web demo target keeps the file-drop UX.

### Layer 2 — Analytics

Six wing-specific modules plus a shared foundation:

**Shared foundation**
- Closed-loop wing response math — longer windows, slower kernel sizing, explicitly framed as integrated aircraft response (servo + linkage + airframe + air), not isolated servo dynamics.
- FFT with windowing appropriate for sub-100 Hz signals.
- Axis decomposition respecting the PIDFS structure.
- Airspeed signal derivation (consumes M3 output).
- **Confidence scoring framework** — modules emitting CLI recommendations classify their output as green/yellow/red based on per-module data-adequacy criteria, returning `{ recommendation, confidence, criteria_met, criteria_failed }`.
- **Capability predicates** — predicate functions test whether a given module is runnable against a given log (e.g. "M3 needs `debug_mode == TPA` and GPS speed present"). Same predicates feed M1.6's runtime readiness display *and* the corpus regression suite's expected-capabilities checks.

**Module A — PIDFS term decomposition** *(M2)*
- Read per-axis `axisP/I/D/F/S[0..2]` from the main frame.
- Stacked-area plot showing each term's contribution per axis.
- Sum reproduces `pidData[axis].Sum = P + I + D + F + S`.
- Per-axis three-state field handling: field missing (term not decomposable), field present but always zero (term inactive in this log — flagged in legend), field present and nonzero (full decomposition).

**Module B — Airspeed estimation auto-tuner** *(M3)*
- Reads `tpa_speed_est` and `tpa_arg` signals via the registry (resolves to main-frame fields on 2026.6+ logs, falls back to `debug_mode = TPA` channels otherwise — same predicate either way).
- Fit BASIC airspeed estimation model against logged 3D GPS speed.
- Wind handling via GPS course-over-ground (mag-free by policy — BF doesn't force mag on users).
- Confidence-scored output: green (paste-ready), yellow (verify), red (analysis-only).
- Confidence criteria: speed range coverage, throttle transition density, dive/climb presence, GPS quality, opposite-direction-pass detection (wind contamination), samples-per-region, **voltage sag during calibration window** (large `vbatLatest` droop confounds throttle→thrust mapping → degrades confidence).

**Module C — Airspeed-binned analysis** *(M4)*
- Bin by estimated airspeed; per-bin closed-loop response, FFT, oscillation amplitude.
- Per-bin "insufficient samples" messaging.

**Module D — TPA curve fitter** *(M5)*
- Consumes M3's airspeed model + the same `tpa_arg` signal. Source resolution inherited from M3.
- Detect oscillation onset across airspeed bins; fit HYPERBOLIC TPA curve parameters.
- Confidence-scored output with same green/yellow/red structure as M3.

**Module E — SPA effectiveness analyzer** *(M6)*
- Reads `spa` (per axis) and `setpoint_adj` (per axis) via the registry. Resolves to main-frame `spa[0..2]`/`setpointAdj[0..2]` on 2026.6+ logs, falls back to `debug_mode = SPA` + `debug_mode = WING_SETPOINT` otherwise (the latter is debug-mode-exclusive pre-PR, so pre-PR users get partial coverage unless they fly two calibrations).
- Setpoint rate, SPA gate regions, I-term contribution overlay.
- Wind-up and bounce-back event detection.

**Module F — S-term TPA effectiveness viz** *(M7)*
- Reads `s_term_pre_tpa` (per axis) via the registry; post-TPA sTerm is already main-frame (`axisS[0..2]`).
- Pre-PR: needs `debug_mode = S_TERM`. Post-PR: works from any wing log with non-zero S gain.
- Diagnostic only — no CLI output, no confidence scoring needed.

### Layer 3 — Visualization

- **Vue 3 + Vite**, aligning with BF Configurator's active Vue 3 migration.
- **Pinia** for state management, `shallowRef` for typed-array log data.
- **uPlot** for the main scrubbable time-series view.
- **Plotly.js** for analysis plots.
- **Event/annotation track**: flight mode transitions, arm/disarm, RX loss, failsafe events, and any other discrete-event signals render as vertical flags on the timeline. Hover for label + timestamp. Sourced from the log's event frame stream (`blackbox-log` already exposes these).
- **CLI output panel** — gated by confidence score. Green renders copy button; yellow renders with caveat banner; red shows analysis only.
- **Per-module prerequisites view** — each recommendation module includes a "to gather data for this analysis, do X" panel showing required `debug_mode`, flight pattern, and data quality signals.
- **Tauri vs web differences**: web target uses file-drop and an open-dialog fallback; Tauri target opens via the native dialog or file association. Both share 100% of the Vue layer.

## Golden-log corpus

Acceptance matrix defining log classes WingTune supports, what each requires, and what modules they unlock. Lives in `tests/corpus/` with a metadata `manifest.yaml` describing each. Runs as a regression suite via `validate-parser`. The corpus exists to validate **capability predicates** — the predicates are what the runtime app uses to classify the user's actual log.

| Log class | Required fields | Firmware | Debug mode | Validates |
|---|---|---|---|---|
| **Basic wing** | `gyroADC`, `setpoint`, `servo[N]`, `motor[N]` | BF 4.6+ wing target | any | M1 loads, scrubs, labels correctly |
| **PIDFS-complete** | + `axisP/I/D/F/S[0..2]` on all axes | BF wing build, S gain ≠ 0 on all axes | any | M2 full PIDFS decomposition |
| **PIDFS-partial** | + `axisP/I/D/F[0..2]`, `axisS` on some axes only | BF wing build, S gain disabled on some axes | any | M2 adaptive rendering, "S disabled" annotation |
| **Airspeed calibration** | + GPS 3D speed | BF wing build | `DEBUG_TPA` | M3 fit runnable |
| **TPA curve probe** | wide airspeed coverage in stable conditions | BF wing build | `DEBUG_TPA` | M3 + M4 + M5 pipeline |
| **SPA test** | high-rate maneuvers covering setpoint range | BF wing build | any (SPA debug optional) | M6 effectiveness analysis |
| **S-term TPA validation** | covers airspeed range, S gain nonzero | BF wing build | `DEBUG_S_TERM` | M7 effectiveness viz |
| **Bad / incomplete** | missing critical fields or wrong `debug_mode` | any | wrong/none | M1.6 readiness report flags missing capabilities clearly |

Two uses for this matrix:

1. **Developer-side**: `validate-parser` walks every log in the corpus against `manifest.yaml`, confirms decode succeeds, and verifies expected capability predicates match actual capabilities. Regression test in CI.
2. **User-side**: M1.6 readiness report runs the same capability predicates against the user's loaded log and displays which analyses are available, partial, or blocked — without ever exposing the corpus class label.

### Corpus hygiene

`.bbl` logs can carry sensitive data: GPS coordinates, home location, flight paths near identifiable buildings, pilot behavior patterns, aircraft configuration that reveals builder identity, and unique target/build details. Anything that goes in the public corpus must be safe to ship.

Rules:
- Prefer logs from intentional test flights at non-sensitive locations (open fields, established RC clubs, public flying sites).
- Document GPS presence in `manifest.yaml` per log.
- For public corpus samples: crop GPS-bearing frames out, truncate to the relevant analysis window, or use logs where GPS was off entirely.
- Keep any log with home-location GPS, recognizable flight paths, or other identifying data **out of the public repo**. Personal regression-test corpus can live in a private directory excluded from `.gitignore`.
- Bundled in-app sample log (for "try it without uploading" UX) gets extra scrutiny — same rules, applied paranoidly.

## Milestones

(M1 sub-steps in the separate M1 execution doc.)

### M1 — Foundation *(~3–4 weeks)*

Load a log, scrub through traces. Header inspector. Readiness report. No analysis yet.

### M1.6 — Log readiness report *(~1 week, overlaps M1)*

Runtime "what can WingTune do with this log" view using capability predicates.

### M1.7 — Multi-log + session persistence *(~2–3 weeks)*

Multi-log support and named-session save/load. **Not a separate "campaign" UI** — earlier revs scoped this as a dedicated compare surface, but every concrete need is better expressed as additive features on existing surfaces plus a persistence layer:

- **Multi-log in the time-series view**: drop a second `.bbl` while a log is loaded → overlaid in paired colors, same scrub window.
- **Log picker** in the time-series toolbar when N ≥ 3 (per-log show/hide; hidden at N ≤ 2).
- **Time alignment toggle** with three modes: `absolute`, `first-arm`, `first-mode-change`. Event-track markers shift with alignment. The X-axis transform is the bulk of M1.7 implementation cost — not a one-line toggle.
- **Tuning diff side panel** opens from any view when ≥ 2 logs are loaded. Shows a curated set (~30 main tuning parameters — P/I/D/F/S per axis, TPA mode/curve/speed, SPA mode/center/width per axis, rates, filter cutoffs) with diffs highlighted. **Not** a 200-row dump of every header field; the full matrix is post-M7 backlog ("Tuning history matrix").
- **Session save/load**: a session is a named bundle (list of loaded logs + active workspace + alignment mode), serialized as `<name>.session.json`. Tauri writes to disk; web persists to IndexedDB + prompts user to re-drop logs on reload.
- **Unioned readiness**: when N ≥ 2 logs are loaded, the readiness report renders per-module coverage across logs ("M3 runnable on 2 of 3 logs; via debug on flight 1, via main-frame on flight 2"). Single-log rendering unchanged at N = 1.

No dedicated `CompareView.vue` or `/compare` route. No modal shift between "log mode" and "campaign mode" — logs just exist, optionally bundled into a named session.

### M2 — PIDFS quick decomposition *(~2–3 weeks)*

Per-axis stacked-area showing P/I/D/F/S contributions.

### M3 — Airspeed estimation auto-tuner *(~3–5 weeks)*

Confidence-scored fit of `tpa_speed_*` from `debug_mode = TPA` calibration flights.

### M4 — Airspeed-binned analysis *(~4–6 weeks)*

Per-speed-bin closed-loop response, FFT, oscillation amplitude.

### M5 — TPA curve fitter *(~3–4 weeks)*

Confidence-scored fit of HYPERBOLIC TPA curve.

### M6 — SPA effectiveness analyzer *(~2–3 weeks)*

Setpoint rate, gate regions, I-term contribution overlay.

### M7 — S-term TPA effectiveness viz *(~2 weeks)*

Pre/post-TPA S-term overlay from `debug_mode = S_TERM` logs.

## Future module candidates (post-M7 backlog)

- **Tuning history matrix** — sortable, scannable table of `parameter × flight` covering the full ~200-row header set (not just the M1.7 diff panel's curated ~30). Lets a tuner scan a 5-flight progression and see "p_roll climbed 38 → 42 → 46 → 46 → 44, d_roll stayed at 23 the whole time." Deferred deliberately: build this *after* M1 has been used on a real tuning sequence, when the right column/row controls become obvious from use — design-by-imagination before that is wasted work.
- **Coupled-axis diagnostics** — adverse yaw, roll-yaw cross-coupling, pitch-airspeed coupling.
- **Differential thrust analysis** — for wing setups using yaw via differential thrust.
- **Live MSP telemetry** (PIDscope-equivalent) — real-time view during bench testing.
- **Public hosted corpus** — shareable anonymized logs for community-wide regression testing.

## Tech stack decisions

| Concern | Choice | Why |
|---|---|---|
| Framework | Vue 3 + Vite | Alignment with active BF Configurator Vue migration |
| State | Pinia | Vue-native, `shallowRef` for large typed arrays |
| Workers | Web Workers, plain `postMessage` | No need for Comlink at v1 scale |
| Parser | `blackbox-log` (Rust) → WASM | Embeddable, format-current |
| **Desktop shell** | **Tauri 2.x** | **Rust-native (already in our toolchain), no Chromium bundle, WebView2 on Win10/11, native file access bypasses browser memory caps** |
| **Web demo target** | **Static Vite build of the same code** | **"Try it" share URL without making users install anything; runs entirely client-side** |
| Component library | TBD — plain Vue SFCs + Tailwind to start | Defer until Configurator's conventions stabilize |
| Time-series plot | uPlot | Framework-agnostic, fast scrubbing on 100k+ samples |
| Analysis plots | Plotly.js | Interactive zoom/pan |
| FFT | `fft.js` | Pure JS, no extra WASM module |
| Curve fitting | `ml-levenberg-marquardt` or hand-rolled NLS | Small, JS-native |
| Confidence framework | Structured `{ recommendation, confidence, criteria_met, criteria_failed }` per module | Forces explicit criteria-based scoring |
| Memory dtypes | Float32 throughout; time-since-start as Float32 (relative to log start), not Float64 absolute | Halves peak memory vs default Float64; BBL precision doesn't justify Float64 |
| **JS unit tests** | **Vitest** | **Predicates, wing detection, confidence scoring, dtype/decode helpers all deserve unit coverage** |
| **E2E smoke** | **Playwright** | **Post-M1.6: drop log → render chart → readiness shown. Three tests, big regression net** |
| Styling | Tailwind | Matches Configurator direction |
| License | GPL-3.0-or-later | Ecosystem alignment; works for both web and desktop targets — no change needed for Tauri |
| **Dependency policy** | **Track current stable for Vue, Vite, Pinia, Tailwind unless WASM/Worker compat forces a pin. Document any pin with rationale in README.** | **Reduces drift risk; pinning is a deliberate decision, not a default** |

## What to lift from existing tools

| Source | Lift | Why |
|---|---|---|
| [`blackbox-log/blackbox-log`](https://github.com/blackbox-log/blackbox-log) | Parser, as a Rust dependency | Built for embedding |
| [`betaflight/betaflight-configurator`](https://github.com/betaflight/betaflight-configurator) | Vue component patterns, Pinia conventions, Tailwind setup | Strategic alignment |
| [`betaflight/blackbox-log-viewer`](https://github.com/betaflight/blackbox-log-viewer) | UX patterns for log scrubbing | Reference for how pilots expect this to feel |
| [Plasmatree PID Analyzer](https://github.com/Plasmatree/PID-Analyzer) | Conceptual reference for response analysis; reimplement wing-specific math from first principles with attribution | Avoid license-compatibility surprises |
| ArduPilot MissionPlanner log analysis | UI patterns for fixed-wing log review | Best-in-class fixed-wing tooling reference |
| PIDtoolbox | Run on a wing log, document where it fails | Reveals what to build differently |

## Risk register

Architectural:

1. ~~**PIDFS decomposition needs firmware support.**~~ **CLOSED** (v0.2).
2. **Web Worker memory on large logs.** Multi-megabyte BBLs decompressed to typed arrays can blow past 512 MB. Mitigation: streaming progress + end-of-decode commit (not progressive rendering in M1); large-log exit-criterion test catches this before M1 ships.
3. **`blackbox-log` upstream BF coverage.** The crate's last release (0.4.3, April 2024) documents support up to Betaflight 4.5.x. BF 4.6+ wing logs (with `USE_WING`, the new debug modes, `axisS[0..2]`, etc.) likely fail at the firmware-version check — the parser explicitly errors on unsupported firmware, it does not silently decode wrong. **Mitigation (the path is not a gate):**
   - **Fork** to `Bskimp/blackbox-log` on a `wing-support` branch. Add BF 4.6 / 2025.x / 2026.x firmware version coverage, new debug-mode enum values, and any new event-frame types.
   - **Open a PR upstream** from that branch in parallel. Likely accepted given the maintainer's README explicitly invites log-based contributions, but the PR is not on WingTune's critical path.
   - **Point WingTune at the fork** via Cargo patch override (`[patch.crates-io] blackbox-log = { git = "https://github.com/Bskimp/blackbox-log", branch = "wing-support" }`). The whole project builds against the fork transparently.
   - **When (if) upstream merges**: bump the dep to the new crates.io version, delete the patch override. One-line change, no architectural disruption.
   - **If upstream doesn't merge**: nothing changes for WingTune. The fork is the long-term dep. Maintain it as new BF versions ship.
   - Corpus regression in CI catches drift in either direction (upstream-driven or fork-driven). See "Parser support track" in M1.0 (M1 execution doc) for operational details.
   - Last-resort fallback if the fork strategy ever falls apart: switch to wrapping `betaflight/blackbox-tools` (C) via Emscripten. ~2 weeks of contained Layer 1 work — see [`wingtune-architecture` skill] for why this stays bounded.
4. **Vue reactivity overhead on large data.** Mitigation: `shallowRef` for any decoded time-series data.

Methodological:

5. **Closed-loop response math doesn't transfer cleanly from quad tools.** Mitigation: explicit framing in module docs; prototype against known-good wing logs in M4.
6. **GPS 3D speed is not true airspeed.** Wind contamination makes GPS-3D-speed an unreliable proxy. Mitigation: M3 requires opposite-direction passes for confidence; "calm day" toggle; no green CLI emission if wind contamination is likely.
7. **Servo output is command, not surface truth.** Mitigation: response analysis labeled as closed-loop integrated response.
8. **Tuning recommendations can make aircraft worse if over-trusted.** Mitigation: confidence framework gates CLI output; bounded deltas; current-vs-suggested values shown side-by-side.

Operational:

9. **Debug-mode exclusivity forces multi-flight tuning sequences (pre-PR).** Mitigation: source-agnostic signal registry resolves whichever path is present; M1.7 multi-log + session-persistence features let the user keep N flights loaded with unioned readiness; M1.6 readiness report shows what's resolvable and via which path; per-module prerequisites view guides the next flight if a signal is missing; firmware companion PR eliminates most exclusivity for 2026.6+ without invalidating pre-PR logs.
10. **Some modules still need a specific debug_mode pre-PR.** Mitigation: M1.6 readiness report flags; per-module prerequisites view shows required CLI commands; falls away per-signal as the firmware PR (or its split variants) lands. Predicate code itself does not need to change when 2026.6 ships.
11. **Bin populations may be sparse.** Mitigation: clear "insufficient samples" messaging per bin.

Drift:

12. **Field-naming, format, and dependency drift.** BF firmware evolves the field set, debug-mode enums, header schema. Vue/Vite/Pinia ship breaking changes between majors. Mitigation: corpus includes logs from each supported BF version; parser version-compatibility tests in CI; dependency policy keeps stable line tracked deliberately; explicit BF-version compatibility table in README.

External:

13. **Maintenance burden vs upstream Configurator.** Acceptable risk — WingTune accelerates that work as a proving ground, and Vue alignment makes any future merge cheap.

Distribution:

14. **Code signing + per-platform distribution (Tauri).** Windows wants signed binaries to avoid SmartScreen; macOS wants notarization; Linux distribution wants AppImage/deb. Mitigation: ship unsigned + clear install instructions for v1, add signing once revenue/donations make a cert worthwhile. Hosted demo covers the "try before installing" use case.
15. **`vbatLatest` voltage sag is a confound, not a signal, by default.** Heavy ESC current draw during TPA calibration looks like a tuning issue. Mitigation: M3 confidence criterion downgrades when sag exceeds a threshold; per-module prerequisites view explicitly asks for a charged pack.

## Open questions

- Component library: Nuxt UI standalone, or match Configurator's custom SFC conventions? *(Still deferred — eyeball Configurator's Vue tabs at scaffold time.)*
- Should v1 ship with a built-in sample log per corpus class? *(Lean: yes, at minimum one PIDFS-complete log with all sensitive data scrubbed.)*
- "Diff two logs" mode in v1, or backlog? *(Resolved v0.8: multi-log overlay is a feature of the time-series view in M1.7; tuning-parameter diff is an M1.7 side panel; full `parameter × flight` matrix is post-M7 backlog ("Tuning history matrix").)*
- Devcontainer config? *(Lean: yes — dual toolchain plus Vite version churn make it more valuable than usual.)*
- Hosted demo + Tauri? *(Resolved v0.6: both. Static demo for "try it" sharing, Tauri for serious work.)*
- Signing certs for Tauri? *(Defer to v1 release time.)*
- Whether to bundle a sample *session* (multi-log set + saved view state) for first-run UX. *(Lean: yes once M1.7 lands — shows the multi-log + diff-panel features off without requiring the user to load three files manually.)*

## Firmware companion work

To eliminate debug-mode exclusivity for wing tuning, promote the signals that today live only in `DEBUG_TPA`, `DEBUG_S_TERM`, `DEBUG_SPA`, and `DEBUG_WING_SETPOINT` to first-class **main-frame fields gated under `USE_WING`**. Same pattern that `axisS[0..2]` already follows in `master`.

**Target release**: BF 2026.6 (next major). VERIFY: 2026.6 freeze date isn't published yet; check Discussions / `RN: MAJOR FEATURE`-labeled PRs (e.g. open PR #15124 `MSP2_WING_TUNING`) for the live timeline.

### Fields to promote

| Proposed field | Source-of-truth in firmware | Condition gate |
|---|---|---|
| `tpaSpeedEst` | `pidRuntime.tpaSpeed.speed` (m/s, scaled ×10 like the debug channel) | `ALWAYS` (wing-only build) |
| `tpaArg` | `tpaArgument` from `calcWingTpaArgument()` (×1000) | `ALWAYS` |
| `axisSpreTpa[0..2]` | pre-TPA sTerm (currently emitted only via `DEBUG_S_TERM[2*axis]`) | reuse `NONZERO_WING_S_n` |
| `spa[0..2]` | `pidRuntime.spa[axis]` (×1000) | new `NONZERO_SPA_n` (or `ALWAYS` if simpler to land) |
| `setpointAdj[0..2]` | post-SPA adjusted setpoint (currently `DEBUG_WING_SETPOINT[2*axis+1]`) | `CONDITION(SETPOINT)` reuse |

Post-TPA `axisS` is already on the main frame, so the pre-TPA companion is what's missing.

### Files to edit (model on `axisS` PR)

- `src/main/blackbox/blackbox.c`:
  1. Extend `blackboxMainState_t` struct with `USE_WING`-gated members for each new field.
  2. Extend `blackboxMainFields[]` table with `SIGNED_VB` entries and the matching `CONDITION(...)`.
  3. Extend `loadMainState()` to copy from `pidRuntime`/PID accessors into the struct.
  4. `writeIntraframe()` / `writeInterframe()` need new `testBlackboxCondition()` calls + `blackboxWriteSignedVB(...)` emissions — identical shape to `axisS`/`axisD`.
- `src/main/blackbox/blackbox_fielddefs.h`: add `FLIGHT_LOG_FIELD_CONDITION_*` enum entries (e.g. `NONZERO_SPA_0/1/2`) inside the `#ifdef USE_WING` block.
- `src/main/flight/pid.c` / `pid.h`: pre-TPA sTerm and `adjustedSetpoint` aren't currently exposed outside their compute sites — shadow them into `pidRuntime.sTermPreTpa[3]` and `pidRuntime.adjustedSetpoint[3]` so `loadMainState()` can read them. `pidRuntime.spa[]` and `tpaSpeed.speed` are already addressable.
- **No** changes needed in `blackbox_encoding.c` — `SIGNED_VB` is reused.
- **No** new CLI variable. Gating is compile-time (`USE_WING`) plus per-axis NONZERO suppression.

### Cost analysis

- ~14 new fields (2 scalars + 4 axis-triples) at `SIGNED_VB` encoding, typical ~2 bytes/field.
- At `blackbox_sample_rate = 1/4` (BF default for wings ≈ 125 Hz logged from a 500 Hz PID): ~14 × 2 B × 125 Hz ≈ **3.5 KB/s overhead**. Comfortable for SD logging.
- NONZERO conditions strip emission when the gain is disabled, same way `axisD`/`axisS` already work.

### Splitability

Could be split into (a) TPA family, (b) S-term pre-TPA, (c) SPA + adjusted setpoint as three smaller PRs. But the pattern is so uniform after `axisS` landed that one PR reviewed against one diff is likely cleaner. Suggest opening as a single PR; offer to split if a reviewer asks.

### Verification still needed before opening the PR

- `git log -S "axisPID_S" -- src/main/blackbox/blackbox.c` locally to pin the `axisS` PR/SHA and confirm the exact pattern used.
- Confirm `DEBUG_TPA[0]` is actually unset (or is throttle raw) — agent didn't see the assignment in the snippet captured.
- Confirm `DEBUG_WING_SETPOINT` is the current name (not renamed in master).
- Sanity-check that `pidRuntime.tpaSpeed.speed` and `pidRuntime.spa[]` are populated every PID loop (not gated behind a separate `#ifdef`).
- Check 2026.6 freeze date and aim PR open ≥3 weeks ahead of freeze.

### How this unblocks WingTune (and how WingTune works *without* it)

WingTune is **not** gated on this PR. The signal registry (`lib/signalRegistry.ts`) resolves each wing-tuning signal independently — main-frame field if present, debug-mode channel otherwise — so M3/M5/M6/M7 work on existing 2025.x debug-mode logs today. When the PR ships, the same predicate code runs against the new logs without modification; the only change users see is that `set debug_mode = ...` is no longer needed before a calibration flight. A partial-PR scenario (e.g. only the TPA family lands) also Just Works — TPA-dependent modules switch to main-frame resolution while SPA-dependent modules stay on debug fallback until their fields land too.

## Reference projects

- https://github.com/blackbox-log/blackbox-log — the parser dependency
- https://github.com/betaflight/betaflight — firmware (companion-PR target)
- https://github.com/betaflight/betaflight-configurator — Vue 3 migration reference
- https://github.com/betaflight/blackbox-log-viewer — log-scrubbing UX reference
- https://github.com/Plasmatree/PID-Analyzer — conceptual reference for response analysis (GPL-2.0 — reimplement from first principles, do not port)
- https://github.com/ArduPilot/MissionPlanner — fixed-wing log analysis reference
- https://tauri.app — desktop shell
- Discussion #14032 — Limon's wing tuning guide
- PRs #13679, #13719, #13805, #13895, #14009, #14010 — wing tuning feature PRs
- PR #15124 — `MSP2_WING_TUNING` (active wing tooling work, watch for timing signals)

---

*Document owner: Brian. v0.9 — Risk #3 rewritten as a unified fork+PR+patch-override path; WingTune does not gate on the upstream `blackbox-log` merge. Parser support track lives in M1.0.*
