# WingTune — Design handoff

> **Transient doc.** Paste this into a Claude Design conversation to brief
> it on the project. Delete this file when the M1.3.4 components land so
> it doesn't go stale once the visual language is implemented.

I'm building **WingTune**, a browser-first log analysis tool for the fixed-wing side of Betaflight (open-source flight controller firmware). Looking for help mocking up the first real UI surfaces before I commit to component code.

## Why this exists

Betaflight's existing log analyzers — PIDtoolbox, PIDscope, Plasmatree, Blackbox Log Viewer — were built for multirotor dynamics. Their math, FFT bands, and tuning recommendations assume ~20 ms motor responses, 50–500 Hz prop noise, and PIDF control. Fixed-wing flies in a different regime entirely: 200–500 ms closed-loop response, sub-50 Hz noise band, PIDFS control with S-term driving maneuver authority, airspeed-scheduled (not throttle-scheduled) attenuation. Running quad-targeted tools on wing logs gives wrong answers — sometimes dangerously wrong, since "the analyzer told me to lower D" can put a plane in a tree. There's no good fixed-wing log analyzer; WingTune is from-scratch built for that regime.

I'm a Betaflight contributor focused on the wing side (PR #15121 adds the autolaunch mode whose logs drive WingTune's test data). This is a pre-alpha personal project but designed for eventual public release as both a hosted web demo and a Tauri desktop app.

## Stack (locked, please don't propose changing)

- **Vue 3.5 + Vite 8 + TypeScript 6 + Pinia 3 + Tailwind 4** (CSS-first config)
- **Tauri 2.x desktop shell** (primary build) + **static Vite build** (hosted demo) from the same source
- **Rust parser** (`blackbox-log`) compiled to WASM, hosted in a Web Worker
- **uPlot** for time-series charts (committed dependency; chosen for performance on 100k+ point arrays)
- **License:** GPL-3.0-or-later
- No component library yet — intentional. This design pass is part of deciding the visual language.

## Hard architectural rules (non-negotiable)

1. **Float32 everywhere.** Log signals live in `Float32Array`. Time axis is `Float32Array` of seconds-since-log-start. Charts must accept typed arrays, no `number[]` on the hot path.
2. **shallowRef for typed-array data.** Vue's deep proxy would wrap every sample — never `ref(typedArray)`.
3. **Three layers, no leakage.** Layer 1 (Ingest/WASM/Worker) → Layer 2 (Analytics) → Layer 3 (Vue UI). Components never touch WASM directly.
4. **Confidence scoring on every CLI recommendation.** Tuning recommendations come with green/yellow/red confidence; on red, the "copy CLI" button is **removed**, not just disabled. Bad tuning can crash planes.
5. **Lazy hydration.** Initial scan produces a capability report + frame index only. Per-field arrays are loaded on demand when a chart/module needs them.

## What I need designed first (M1.3.4)

Three component shapes plus an app restructure. The data layer is already built and populated with real reactive Pinia state — you can prototype against it in browser dev tools.

### 1. `FileDropZone.vue`

Drag-and-drop area for `.bbl`/`.BFL` log files (up to ~300 MB), with a file-picker fallback button. Drag-hover state, drag-reject for non-log files, loading state while the file is being read into bytes. Calls `useLogStore().loadFile(file)`.

### 2. `CapabilitySummary.vue`

Once a log is scanned, show:

- Firmware revision (e.g. `"Betaflight 2026.6.0-alpha (norevision) STM32F7X2"`)
- Frame count (e.g. `134,307`) and log duration (e.g. `2m 44s`)
- Debug mode (e.g. `"WingLaunch"` or `null`)
- Field count (e.g. `64 fields available`) and GPS presence
- Event count (e.g. `3 events`)
- Board / craft name if present
- "Loaded log" header strip with a way to drop a different one

### 3. `App.vue` restructure

- Empty state → just the drop zone, centered
- Loaded state → capability summary at top, placeholder for the M1.4 charts below
- Error banner if scan fails (e.g. "invalid firmware version")
- Loading state during scan (currently spinner-only; streaming progress is a later improvement)

## Real example: what a scanned log produces

From a real flight log (BF 2026.6.0-alpha wing autolaunch, 2m 44s):

```ts
{
  capability: {
    fields_present: ["loopIteration", "axisP[0]", "axisP[1]", "axisP[2]",
                     "axisI[0]", …,  "axisS[0]", "axisS[1]", "axisS[2]",
                     "gyroADC[0]", …, "vbatLatest", … (64 total)],
    debug_mode: "WingLaunch",
    gps_present: false,
    total_frames: 134307,
    voltage_sag_summary: null,  // future
  },
  time_sec: Float32Array,         // length 134307, seconds since first frame
  events: [
    { kind: "flight_mode_change", time_sec: 1.2, flags: 0x101 },
    { kind: "disarming",          time_sec: 164.0, reason: "code:0" },
  ],
  firmware_revision: "Betaflight 2026.6.0-alpha (norevision) STM32F7X2",
  craft_name: "wing01",
  board_info: "SPEEDYBEEF405WING",
}
```

## What's coming after (so the visual language can be coherent)

- **M1.4** — uPlot multi-pane time series with event flags on the timeline, field-picker side panel for choosing what to chart
- **M1.5** — Header inspector view (FC config summary, wing-detection with confidence)
- **M1.6** — Readiness report (which analysis modules can run on which capabilities; e.g. "M2 PIDFS decomp: runnable ✓" / "M3 airspeed TPA fit: needs `airspeedRaw` field — not present")
- **M1.7** — Multi-log session (load 2–3 flights, compare PID tunes side by side, save/load sessions)
- **M2–M7** — Analytics modules (PIDFS decomposition, airspeed-scheduled TPA fit, S-term visualization, etc.) — each emits paste-ready CLI recommendations with confidence scores

## Questions worth thinking about

1. **What's the relationship between the loaded-log header (firmware/craft) and the analysis surfaces?** Always-on top strip? Collapsible? Sidebar?
2. **Dark mode by default?** I've been using dark-on-zinc for the smoke page. Wing pilots fly outdoors and want low-glare laptop screens.
3. **Confidence scoring visualization** — is green/yellow/red traffic-light enough, or do we want something richer (confidence bars, hover for reasoning, etc.)? This shows up everywhere M2+ recommendations land.
4. **Wing logs are long** (2–10 min typical). What's the timeline scrubbing UX — drag-select, zoom-and-pan, both?

## Repo

Local at `c:\Users\Sista\Downloads\WangLogger\`. Not pushed to a public remote yet. Key files for context:

- [CLAUDE.md](../CLAUDE.md) — project overview + cardinal rules
- [docs/wingtune-roadmap.md](wingtune-roadmap.md) — long-arc design doc, milestone graph
- [docs/wingtune-m1-execution.md](wingtune-m1-execution.md) — current M1 execution plan
- [src/lib/wasmBridge.ts](../src/lib/wasmBridge.ts) — TypeScript types for everything UI consumes (`ScanReport`, `CapabilityReport`, `EventFrame`, etc.)
- [src/stores/log.ts](../src/stores/log.ts) — Pinia store you'd wire components to
- [.claude/skills/](../.claude/skills/) — five skill files enforcing the cardinal rules
