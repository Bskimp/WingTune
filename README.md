# WingTune

A browser-first log analysis tool for the fixed-wing side of Betaflight.

**Status:** Early development. M1.1 scaffold + M1.2 WASM wrapper + M1.3.1-3 data layer landed; M1.3.4-5 (file drop + capability summary components) paused for a Claude Design pass.

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

- **M1.0 parser-support track:** firmware-version fix + speculative `WING_LAUNCH` debug-mode YAML landed on the `Bskimp/blackbox-log:wing-support` fork. Real BF 2026.6.0-alpha wing logs decode end-to-end through the WingTune parser. Upstream PR drafted, not yet opened.
- **M1.0 corpus assembly track:** not started.
- **M1.1 scaffold:** complete (Cargo workspace, WASM pipeline, Vue + Vite + Tailwind 4, Layer 1 worker + wasmBridge, Tauri 2.x shell, vitest + WASM-binding tests, GitHub Actions CI, devcontainer).
- **M1.2 WASM wrapper + Worker:** complete. `ParserClient.scan()` returns a populated `ScanReport` from real wing logs (capability report, Float32 time axis, event list).
- **M1.3.1-3 (non-UI data layer):** complete. `src/lib/dtype.ts` helpers, Float32 conversion at the wasmBridge boundary, real Rust `hydrate(bytes, field_ids)`, `useLogStore()` + `useViewStore()` Pinia stores following `shallowRef`/`shallowReactive` discipline. Verified end-to-end on a real wing log.
- **M1.3.4-5 (file drop + capability summary components):** *paused for a Claude Design pass*. Pinia stores are populated with real reactive state from `loadFile()`; the visible app is still the M1.2 smoke page until the design pass returns.

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
npm run corpus:validate   # validate-parser CLI against tests/corpus/manifest.yaml
```

A VS Code devcontainer is provided at [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) for the web-target stack (Rust + Node + wasm-pack). Tauri desktop-shell dev requires host system deps (webkit2gtk-4.1 on Linux, WebView2 on Windows) and is intentionally not bundled into the container.

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
