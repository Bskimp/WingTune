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

## Servos are the actuators, not motors (load-bearing)

The biggest single difference between wing tuning and quad tuning isn't the loop frequency or the noise band — it's that **the actuators are servos, not motors**. Quads control rate by varying motor RPM with sub-3 ms electronic response. Wings control rate by deflecting control surfaces with PWM servos that have 10–30 ms response time, a mechanical dead band, a slew rate limit, and gear backlash. Throttle is *also* present (single tractor motor), but it isn't the rate actuator the way it is on a quad.

That means several places where a quad-tuning surface would render motor data, a wing-tuning surface needs to render servo data — and several diagnostics that don't even exist on quads (servo lag, servo saturation, airspeed-loaded servo response) are first-class concerns here.

### What the BBL data looks like

In Betaflight wing builds the mixer rewrites the `motor[i]` array — `motor[0..N]` actually carries **servo PWM values**, channel-mapped per the airframe mixer. Example:

- Delta wing (most common): `motor[0]` = left elevon servo PWM, `motor[1]` = right elevon servo PWM, `motor[2]` = main motor throttle
- Conventional: `motor[0..2]` = ail/ele/rud servos, `motor[3]` = throttle

The mixer config (`DELTA` / `V_TAIL` / `CONVENTIONAL` / etc.) is in the headers — Layer 1 already has everything needed; Layer 3 just needs to render and label it correctly.

### Quad vs wing differences worth designing around

| Concern | Quad assumption | Wing reality |
|---|---|---|
| Actuator | Motor RPM via DShot, ~1–3 ms response | Servo PWM 50–300 Hz, ~10–30 ms response, dead band, slew limit, backlash |
| Saturation | RPM clips at top of range | Servo PWM hits endpoint deflection (mechanical, not electronic) |
| Loading | ~constant per motor | Heavily airspeed-dependent — same servo deflection sees much higher aerodynamic force at 30 m/s than at 15 m/s |
| Mixing | Trivial X/H to 4 motors | Elevons / V-tail / conventional — mechanical mix is part of the control loop and needs UI visibility |
| Resonance | Motor/prop, 50–500 Hz | Airframe flex modes, 5–50 Hz |

### Specific surfaces to design for servos

1. **`SERVOS` panel** parallel to (or replacing) the THROTTLE panel — N traces, one per servo channel, labeled by mixer assignment (`Elevon-L`, `Elevon-R`, `Rudder`, `Throttle` if separate). Same time-cursor as the other panels.
2. **Servo saturation strip** on the per-axis (Roll / Pitch / Yaw) plots — translucent red band whenever any contributing servo hit endpoint. Pilots care about this far more than gyro/motor saturation does on quads.
3. **Filter delay budget gains a `Mechanical chain` row** alongside the electronic filter chain — e.g. `Servo response (PT1-ish, ~15 ms at 50 Hz)` as its own line, summing into the same OVER BUDGET check. Wing tuning is often gated by servo lag rather than filter lag, and the budget panel is the right place to surface that.
4. **Mixer badge on the header strip** — tiny "DELTA · 2 elevons + throttle" or "CONVENTIONAL · ail+ele+rud+thr" pill next to CONTROLLER. Surfaces what the mixer is doing without opening a separate view.
5. **Throttle stays present but secondary** — wing throttle is still a control input (climb/cruise/descent) so the THROTTLE panel keeps its place, but it's no longer the primary actuator story. Maybe a smaller / collapsed default.

### What design owns vs what M-Servo analytics owns later

- **This design pass:** the SERVOS panel layout, saturation strips, mixer badge, mechanical-chain row in the filter budget, the visual language for "actuator is mechanical and slow." Pure Layer 3 work — Layer 1 already has the data.
- **A later M2-class module (`M-Servo`):** measures dead band / slew rate / lag from rcCommand → motor[i] step responses, plots servo response degradation against airspeed, emits confidence-scored CLI recommendations ("right elevon shows 22 ms lag — consider lowering D-term by 15%"). Lives in Layer 2 / Layer 3 once the design language for servos is set.

## Questions worth thinking about

1. **What's the relationship between the loaded-log header (firmware/craft) and the analysis surfaces?** Always-on top strip? Collapsible? Sidebar?
2. **Dark mode by default?** I've been using dark-on-zinc for the smoke page. Wing pilots fly outdoors and want low-glare laptop screens.
3. **Confidence scoring visualization** — is green/yellow/red traffic-light enough, or do we want something richer (confidence bars, hover for reasoning, etc.)? This shows up everywhere M2+ recommendations land.
4. **Wing logs are long** (2–10 min typical). What's the timeline scrubbing UX — drag-select, zoom-and-pan, both?

## Repo

Private at https://github.com/Bskimp/WingTune (Brian's account). Key files for context:

- [CLAUDE.md](../CLAUDE.md) — project overview + cardinal rules
- [docs/wingtune-roadmap.md](wingtune-roadmap.md) — long-arc design doc, milestone graph
- [docs/wingtune-m1-execution.md](wingtune-m1-execution.md) — current M1 execution plan
- [src/lib/wasmBridge.ts](../src/lib/wasmBridge.ts) — TypeScript types for everything UI consumes (`ScanReport`, `CapabilityReport`, `EventFrame`, etc.)
- [src/stores/log.ts](../src/stores/log.ts) — Pinia store you'd wire components to
- [.claude/skills/](../.claude/skills/) — five skill files enforcing the cardinal rules
