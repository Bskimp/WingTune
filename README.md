# WingTune

A browser-first log analysis tool for the fixed-wing side of Betaflight.

**Status:** Early development. Design complete; no code yet.

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

Pre-code. Design docs are reviewed and locked; M1.0 has not started. The immediate first step is the parser-support scratch test — see [docs/wingtune-m1-execution.md](docs/wingtune-m1-execution.md) section "M1.0 → Parser support track."

## Where to start reading

- [docs/wingtune-roadmap.md](docs/wingtune-roadmap.md) — vision, three-layer architecture, milestones M1–M7, risk register, firmware companion PR scope
- [docs/wingtune-m1-execution.md](docs/wingtune-m1-execution.md) — current detailed M1 execution plan
- [docs/firmware-pr/](docs/firmware-pr/) — companion Betaflight firmware PR (promotes wing-tuning signals to first-class main-frame fields)
- [docs/firmware-reference/](docs/firmware-reference/) — verbatim snapshots of key BF firmware headers for offline reverse-lookup
- [.claude/skills/](.claude/skills/) — coding-rule skills enforced project-wide (architecture, memory model, corpus hygiene, confidence scoring, Vue conventions)

## Contributing

Not yet open to contributions — pre-code, design is still firming up. When that changes, this section will point at a `CONTRIBUTING.md`.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for the full text.
