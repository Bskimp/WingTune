# WingTune

A browser-first log analysis tool for the fixed-wing side of Betaflight.

**Status:** M1 functionally complete + the full wing analytics suite shipped (M2 PIDFS decomp / M3 BASIC airspeed fit / M4 spectrum + filter delay / M5 HYPERBOLIC TPA curve fit / M6 SPA effectiveness / M7 S-term TPA viz). M-Servo MVP (input-chain lag breakdown) + M1.7 multi-log compare + M1.7.1 time alignment + M1.7.2 signal registry guards all landed. Initial regression corpus pulled. Mostly polish + Brian-blocked (calibration flights, upstream PR) from here. See [CLAUDE.md](CLAUDE.md) for the authoritative status snapshot.

## Why this exists

Betaflight's existing blackbox tools — PIDtoolbox, PIDscope, Plasmatree, Blackbox Log Viewer — were built around multirotor dynamics. Their math, windowing, FFT bands, and response assumptions are calibrated for ~20 ms motor responses and 50–500 Hz prop noise.

Fixed wing flies in a different regime:

- Closed-loop response: 200–500 ms, not 20 ms
- Interesting noise band: sub-50 Hz, not 50–500 Hz
- Controller: PIDFS, not PIDF (S-term drives maneuver authority)
- Attenuation: airspeed-scheduled (TPA airspeed), not throttle-scheduled
- I-term gating: setpoint-rate-driven (SPA), not throttle-driven
- Tuning decisions can put aircraft in trees — recommendations must be confidence-scored, not magical

WingTune is a from-scratch analytics and visualization layer for that regime. Reuses [`blackbox-log`](https://github.com/blackbox-log/blackbox-log) for decoding; everything above the parser is wing-specific.

## Stack

- **Frontend:** Vue 3 + Vite + TypeScript + Pinia + Tailwind
- **Parser:** Rust ([`blackbox-log`](https://github.com/blackbox-log/blackbox-log)) → WebAssembly, hosted in a Web Worker
- **Desktop shell:** Tauri 2.x (primary build target)
- **Web demo:** static Vite build from the same source, no install
- **License:** GPL-3.0-or-later

## Status

**Shipped (all decode + render against real wing logs):**

- **M1 stack** — Cargo workspace + Rust `blackbox-log` → WASM Web Worker, Float32-everywhere lazy hydration, Pinia stores with `shallowRef`/`shallowReactive` discipline, Tauri 2.x desktop shell, file drop + CapabilitySummary + FieldTable + HeaderParamsPanel + ReadinessCard with the multi-source signal registry + capability predicates.
- **M2 PIDFS decomp** — per-axis P/I/D/F/S contribution traces + mean-abs share strip + dominant-term indicator.
- **M3 BASIC airspeed fit** — physical integrator (BF CLI-tunable delay/gravity/max-voltage params), Nelder-Mead solver, GPS-window-trimmed comparison chart, 7-criteria recommender with paste-ready `set tpa_speed_basic_*` CLI.
- **M4 spectrum + filter delay** — Welch-PSD FFT, dyn-notch coverage overlay, per-stage filter group-delay budget badge, raw/filt gyro overlay.
- **M5 HYPERBOLIC TPA curve fit** — port of BF's `tpaCurveHyperbolicFunction` + 4-param Nelder-Mead fit + paste-ready `set tpa_curve_*` CLI.
- **M6 SPA effectiveness** — per-axis SPA multiplier overlay with gate-active bands + wind-up / bounce-back event markers.
- **M7 S-term TPA viz** — pre/post-TPA S contribution overlay + TPA factor on secondary axis.
- **M-Servo MVP** — input-chain lag breakdown (rcCommand → setpoint → servo agg → gyro), per-axis traces with stage-health colored chips.
- **M1.7 multi-log compare** — multi-tenant Web Worker, session store (`shallowReactive<LogState>`), LogRoster strip with family-tinted chips, every time-domain compare panel iterates `session.logs.values()` with HSL-tinted per-(log×series) traces on a shared session-time axis.
- **M1.7.1 time-alignment UI** — drag handle per chip with shift=fine / alt=coarse scaling, auto-align via gyro cross-correlation.
- **M1.7.2 signal registry guards** — `expected_range` + `min_firmware` per source, new `out_of_range` resolution state, main-frame `wing*` field bindings (10 SignalDefs prefer modern USE_WING paths over DEBUG_ fallbacks). Caught + fixed a silent firmware data-loss bug (writer-order mismatch with header def in `betaflight-wing-msp`) along the way.
- **Initial regression corpus** — 4 limonspb PR #13895 reference logs landed in `tests/corpus-private/`, validating cleanly via `npm run corpus:validate:private`.
- **`blackbox-log:wing-support` fork** — adds BF 2026.6 + BF 4.6 YAML coverage, the eight wing debug modes (TPA / S_TERM / SPA / WING_SETPOINT / WING_LAUNCH / GPS_RESCUE_WING / SERVO_AUTOTRIM / AUTOLAND), and the regenerated source. Upstream PR not yet opened — held on Brian's call.

**Held / pending:**

- M3 / M5 visual validation flights (corpus unblocks much of it; throttle-varying cruise + GPS lock still wanted)
- M4 raw-gyro overlay calibration flight (`debug_mode = GYRO_RAW`)
- Step-response amplitude calibration vs PIDscope (held on multi-tool side-by-side)
- Upstream `blackbox-log` + firmware companion PRs

See [CLAUDE.md](CLAUDE.md) for the per-slice authoritative status with file paths + commit hashes.

## Local dev

One-time setup:

```bash
rustup install stable             # Rust toolchain (matches rust-toolchain.toml)
cargo install wasm-pack --locked  # compiles wingtune-parser to WASM
npm install                       # JS deps
```

Common commands:

```bash
npm run dev               # Vite dev server (browser target) → http://localhost:5173
npm run tauri:dev         # same app inside a Tauri 2.x desktop window
npm run build             # vue-tsc + production build → dist/
npm run tauri:build       # desktop bundle (per-OS)
npm run test:unit         # vitest unit specs
npm run test:wasm         # rebuilds Node-target WASM, runs binding smoke
npm run corpus:validate         # validate-parser against tests/corpus/manifest.yaml (public)
npm run corpus:validate:private # same against tests/corpus-private/manifest.yaml (gitignored)
```

A VS Code devcontainer is provided at [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) for the web-target stack (Rust + Node + wasm-pack). Tauri desktop-shell dev requires host system deps (webkit2gtk-4.1 on Linux, WebView2 on Windows) and is intentionally not bundled into the container.

## Where to start reading

- [docs/wingtune-roadmap.md](docs/wingtune-roadmap.md) — vision, three-layer architecture, milestones M1–M7, risk register, firmware companion PR scope
- [docs/wingtune-m1-execution.md](docs/wingtune-m1-execution.md) — current detailed M1 execution plan
- [docs/firmware-pr/](docs/firmware-pr/) — companion Betaflight firmware PR (promotes wing-tuning signals to first-class main-frame fields)
- [docs/firmware-reference/](docs/firmware-reference/) — verbatim snapshots of key BF firmware headers for offline reverse-lookup
- [.claude/skills/](.claude/skills/) — coding-rule skills enforced project-wide (architecture, memory model, corpus hygiene, confidence scoring, Vue conventions, recommender safety)

## Contributing

Not yet open to outside contributions — the public surface is still moving, and the upstream `blackbox-log` + firmware companion PRs aren't open yet. When those land + the API stabilises, this section will point at a `CONTRIBUTING.md`.

In the meantime, see [.claude/skills/](.claude/skills/) for the in-repo coding conventions and [CLAUDE.md](CLAUDE.md) for the per-slice status. Discussion via GitHub Issues is welcome.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for the full text.
