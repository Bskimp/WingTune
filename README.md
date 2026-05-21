# WingTune

A desktop-first (Tauri 2.x) log analysis tool for the fixed-wing side of Betaflight, with a no-install browser demo from the same source.

**Status:** M1 functionally complete + the full wing analytics suite shipped (M2 PIDFS decomp / M3 BASIC airspeed fit / M4 spectrum + filter delay / M5 HYPERBOLIC TPA curve fit / M6 SPA effectiveness / M7 S-term TPA viz). M-Servo MVP + M1.7 multi-log compare + M1.7.1/.2 time-alignment & signal-registry work all landed, followed by the post-M7 analytics batch — M-FF feedforward, M-Coupling cross-axis matrix, M-FilterSim per-stage filter sim, S2 airspeed-resolved spectra, M-Style tune-style profiles, and M-Servo-2 servo hunt + airframe transfer function. Mostly threshold calibration (waiting on purpose-built calibration flights) + Brian-blocked (upstream PRs) from here. See [CLAUDE.md](CLAUDE.md) for the authoritative status snapshot.

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
- **M-FF feedforward + maneuver detection** — per-axis FF coverage inside detected aggressive-input windows + leading-edge overshoot detection; the maneuver detector is shared infrastructure for the analytics that follow.
- **M-Coupling cross-axis matrix** — 3×3 signed matrix of how hard each control axis disturbs the other two, measured only inside single-axis snap windows so a banked turn's natural trade isn't read as a fault.
- **M-FilterSim per-stage filter sim** (Spectrum-roadmap S1) — replays Betaflight's gyro filter chain (RPM / dynamic LPF / dynamic notch) on the logged raw gyro so each stage becomes a toggle; carries a `simFidelity` honesty metric.
- **S2 airspeed-resolved spectra** — gyro STFT binned by airspeed (an airspeed×frequency heatmap) + sub-3 Hz airframe-mode detection (phugoid / dutch-roll / short-period).
- **M-Style tune-style profiles** — a global Cruise / Sport / 3D dial that reweights recommender + panel thresholds; Sport equals today's constants, so the default profile is a behavioural no-op.
- **M-Servo-2 servo hunt + airframe transfer function** — Welch cross-spectral `H(f)` + coherence → an airframe-bandwidth Bode panel, plus a per-servo hunt score for uncommanded high-frequency PWM motion. Diagnostic-only.
- **Regression corpus** — the 4 limonspb PR #13895 reference logs plus Brian's 3 real-flight USE_WING logs (7 total) in `tests/corpus-private/`, all validating cleanly via `npm run corpus:validate:private`.
- **`blackbox-log:wing-support` fork** — adds BF 2026.6 + BF 4.6 YAML coverage, the eight wing debug modes (TPA / S_TERM / SPA / WING_SETPOINT / WING_LAUNCH / GPS_RESCUE_WING / SERVO_AUTOTRIM / AUTOLAND), and the regenerated source. Upstream PR not yet opened — held on Brian's call.

**Held / pending:**

- Threshold calibration across the suite — M-Coupling, M-FilterSim, S2, M-Style, the Step recommender, and M-Servo-2 all carry first-guess `TODO calibrate` constants that become real numbers once the purpose-built sorties in [docs/wingtune-calibration-flights.md](docs/wingtune-calibration-flights.md) are flown
- M3 / M5 / M6 / M7 visual validation — wants throttle-varying cruise + GPS lock
- Upstream `blackbox-log` + firmware writer-order PRs — held on Brian's call
- Next milestone: M-Pilot (input-style classification)

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
- [docs/wingtune-analytics-plan.md](docs/wingtune-analytics-plan.md) — the live "what's the next milestone" doc (post-M7 analytics: M-FF, M-Coupling, M-Servo-2, M-Pilot, …)
- [docs/wingtune-m1-execution.md](docs/wingtune-m1-execution.md) — the M1 execution plan (M1 is complete; kept as a frozen historical record)
- [docs/wingtune-calibration-flights.md](docs/wingtune-calibration-flights.md) — the purpose-built sorties that turn first-guess thresholds into calibrated values
- [docs/firmware-pr/](docs/firmware-pr/) — companion Betaflight firmware PR (promotes wing-tuning signals to first-class main-frame fields)
- [docs/firmware-reference/](docs/firmware-reference/) — verbatim snapshots of key BF firmware headers for offline reverse-lookup
- [.claude/skills/](.claude/skills/) — coding-rule skills enforced project-wide (architecture, memory model, corpus hygiene, confidence scoring, Vue conventions, recommender safety)

## Contributing

Not yet open to outside contributions — the public surface is still moving, and the upstream `blackbox-log` + firmware companion PRs aren't open yet. When those land + the API stabilises, this section will point at a `CONTRIBUTING.md`.

In the meantime, see [.claude/skills/](.claude/skills/) for the in-repo coding conventions and [CLAUDE.md](CLAUDE.md) for the per-slice status. Discussion via GitHub Issues is welcome.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for the full text.
