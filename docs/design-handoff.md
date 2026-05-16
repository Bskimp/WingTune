# WingTune — Design handoff

> **Transient doc.** Originally the brief paste-into-Claude-Design used to
> seed the M1.3.4-5 design pass. Now also tracks the decisions made off
> the bundle that came back. Delete this file (and `design-reference/`)
> when the M1.3.4 components land and the visual language is locked in
> code.

## Direction decision (locked 2026-05-16)

**Direction C · Hangar Logbook, Blueprint palette.** Picked because (a)
the analysis screens in the bundle already use C-Blueprint, so the entry
page in the same palette avoids a visual whiplash; (b) the C structure
(slab serif headings, `VERIFIED` rubber stamps, `MANIFEST · N ENTRIES`
footer, signed-by-flight-signature) is the strongest identity for a
wing-pilot tool — distinct from every quad analyzer; (c) the Blueprint
palette swaps C's original warm walnut for cool dark navy, which reads
trace data far better.

Implementation reference for layout / tokens / panel structure lives at
[`docs/design-reference/`](design-reference/) (Claude Design bundle,
runnable JSX). Use the JSX as the source-of-truth for visual structure;
the chopped trace-density look in the mocks is a mock-rendering artifact
that resolves automatically when we wire uPlot (see the
`project-chart-rendering-fidelity` memory).

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

### Servo identification — three label states the SERVOS panel must handle

**The problem:** most wing pilots use `MIXER_CUSTOM_AIRPLANE` and wire servos to whichever channels they prefer. The `smix` table that maps `rcCommand → output channel` lives in EEPROM, **not in the BBL header**, so the log itself doesn't directly tell us which channel is the left elevon, the rudder, etc.

**Plan:** classify each `motor[i]` channel via (in order):

1. **Preset lookup** — for BF mixer presets (`MIXER_AIRPLANE`, `MIXER_FLYING_WING`, `MIXER_V_TAIL_TRI`, etc.), the channel-to-role mapping is hardcoded in BF source and can be looked up. High confidence.
2. **Correlation classifier** — for `MIXER_CUSTOM_AIRPLANE`, a Layer 2 module correlates each channel's PWM trajectory against `rcCommand[ROLL/PITCH/YAW]` and throttle to infer the role (high roll correlation + opposite-sign paired channel → Elevon-L / Elevon-R, etc.). Medium / low confidence based on correlation strength.
3. **User override** — clickable label on the SERVOS panel → dropdown to manually reassign. Override persists keyed by `craft_name` so re-loading another log from the same craft keeps the labels.

**Three label states to design for:**

| State | Example label | Treatment | Interaction |
|---|---|---|---|
| Confident | `Elevon-L` | Standard | None needed (but click-to-override always available) |
| Inferred low-confidence | `Elevon-L?` | Italic / dotted-underline indicator | Hover surfaces correlation evidence; click to confirm or reassign |
| Unclassified | `Servo 4 · unknown` | Muted / secondary text style | Click → manual assignment dropdown |

The SERVOS panel itself works in all three states — only the label changes. The traces, saturation strips, and rendering are role-agnostic.

**M-Servo recommendation cards consume the same classification** — so a high-confidence rec uses `Elevon-L` in its title, a low-confidence rec uses `Servo 4 (likely elevon?)` and notes the inference in the body. Worth sketching one mock card with a low-confidence-labeled servo rec to validate the visual language extends to the uncertainty case.

## Recommend tab — visual language locked now, tab hidden until M2

The first design pass produced a beautifully crafted Recommend tab with severity pills, confidence stamps, evidence-pinned cursor jumps, CLI copy blocks, and Dismiss / Mark applied actions. Walking through the six sample recommendations, all of them are derivable from BBL data the parser already exposes — none of it is aspirational. That tab is the right visual language for what M2-M7 will produce.

The plan for it:

1. **Lock the visual language now in M1.3.4 / M1.4.** Components: `RecommendCard` (severity pill + confidence stamp + title + summary + delta badge + expand/details + CLI copy block + dismiss/applied), `RecommendList` (filter by severity bucket / by domain chip / sorted by severity), `ConfidenceStamp`, `EvidenceChip`. These are reusable infrastructure — every M2+ module's output slots into them.
2. **Implement the evidence-pinned cursor mechanic as cross-cutting infrastructure in M1.4** (alongside the charts). `CursorProvider` state holds `{ t: number, pinned: boolean, source: string }`. Charts, the Recommend tab, the Step tab, the Spectrum tab all read from it. Clicking an evidence chip anywhere calls `setCursorT(t) + setPinned(true)`; navigating to another tab keeps the pin. This is not a Recommend-tab-only feature — it's how the user navigates a flight forensically.
3. **Hide the Recommend tab entirely until M2 ships the first analytics module.** No empty-state placeholder, no "coming soon" — the tab simply doesn't appear in the top tab bar. Empty tabs read as a broken feature; a hidden tab reads as "this feature doesn't exist yet, the app you do see works." The tab appears the moment any M2+ module emits a single rec.
4. **Domain chip set:** `all / SPA / TPA / Filters / PID / Servo`. The mock has SPA/TPA/Filters/PID — add `Servo` as a peer (M-Servo module will be a major rec producer, see the servos section above).

### Sample-rec → analytics-module mapping (for grounding)

Each sample on the mock corresponds to a real M-class module. Listing the mapping so the design isn't designing in the abstract:

| Sample rec on the mock | Maps to module | Data it consumes |
|---|---|---|
| "Enable SPA on yaw" (rudder kicks + I-windup) | M3 SPA fit | `rcCommand[2]`, `gyroADC[2]`, `axisI[2]` |
| "Increase TPA speed-est delay" (throttle ↔ osc cross-corr) | M3 TPA fit | throttle, `gyroADC`, airspeed (if sensor present) |
| "Dynamic notch missing 47 Hz airframe peak" | M4 spectrum / dyn-notch tracker analysis | `gyroADC` FFT, `DEBUG_DYN_NOTCH` |
| "Loosen D-term LPF1" (saves 0.7 ms) | M4 filter delay budget | filter config from headers, D-spectrum |
| "Roll D on low side" (step-response overshoot) | M2 PIDFS decomposition | setpoint, gyro, step detection |
| "Filter chain inside wing budget" | M4 filter delay budget | filter config |

A future rec like "right elevon dead band > 4°" maps to M-Servo (see servos section). The visual card shape is the same for all of them.

### Design questions to resolve in this pass

1. **Tab visibility binary or count-bubbled?** Plan above hides tab until first rec exists. Alternative: tab always present with a count bubble (`Recommend ·  0` → `Recommend · 6`). The hidden-until-ready path is what the doc currently calls for, but it's worth a design opinion.
2. **Per-axis grouping toggle** — mock currently sorts by severity. Adding a "group by axis" toggle is cheap; design-pass call on whether it earns the chrome.
3. **Confidence stamp placement** — the rotated stamp on the card is striking; check it scales gracefully on narrow widths (Tauri windows on small laptops).
4. **Servo recs need a card variant** — same component, but with mixer-channel labeling (`Elevon-L`, not `axis R`) and possibly an inline servo trace mini-chart. Worth sketching one mock card with a servo rec to validate the visual language extends cleanly.

### Things deliberately not in scope for design

- **Apply-via-CLI auto-stage** (writing a staged-changes file the user dumps into BF Configurator) — that's a real-app feature with Tauri-side file system involvement, lands post-M1 alongside the actual M2+ module that produces the recs.
- **Persist dismissed via localStorage + undo** — yes, in the real Vue app. Keyed by log SHA so dismissals are per-log, not global. M1.6 or M1.7 alongside session persistence.
- **The actual recommendation generation** — that's M2 (PIDFS) → M3 (SPA/TPA) → M4 (filters) → eventual M-Servo. The design's sample content is predictive of what those modules will produce, not stubs to be wired into the M1 UI.

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
