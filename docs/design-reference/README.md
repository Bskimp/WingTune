# Handoff: WingTune · M1.3.4–5 design pass

Design reference for the **WingTune** blackbox-log analyzer for fixed-wing
aircraft. This bundle covers two surfaces:

1. **File-drop + Capability summary** — the entry screen, explored across
   three visual directions (A / B / C) plus palette and density studies
   for C.
2. **Analysis screen** — the main working view once a log is loaded.
   Four tabs: Tracking, Spectrum, Step response, Recommend.

---

## About these files

The HTML/JSX in `source/` is a **design reference**, not production code.
It's rendered in-browser with React via Babel-standalone and inline styles,
which is fine for review but not how you'd ship it. The task is to
recreate these designs in WingTune's actual codebase, using whatever stack
exists there (React + Tailwind, CSS modules, plain CSS, etc.). If no
target stack exists yet, pick what's appropriate — the inline-style
approach in this reference is just an artifact of the prototyping
environment.

The `design-canvas.jsx` file is a presentation harness only — it pans/zooms
the artboards for review. **Ignore it for production**; only the per-direction
and per-screen components matter.

---

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, and layout
are all decided in the reference. Hex codes, font stacks, and pixel
measurements should be transcribed exactly. Mock data is intentionally
realistic (real BF field names, real PID terminology) — replace with live
data, but keep the same shape and labelling.

The one open decision: **which of the three directions to ship.** See the
"Pick a direction" section below.

---

## Pick a direction

Three directions are explored end-to-end for the file-drop + capability
summary. The analysis screen is currently designed against direction **C
(Graphite & Cyan palette)** only — once a direction is picked the analysis
screen styling should be reconciled.

| Dir | Name | Vibe | Best for |
|---|---|---|---|
| A | Phosphor Scope | PIDtoolbox heritage — mono everywhere, bracket frames, ASCII bars, phosphor green | Hobbyist tuners who grew up on PIDtoolbox and want it to *feel* like instrumentation |
| B | Telemetry Console | Cleaner engineering instrument — hairline rules, micro-grid, sans labels + mono numbers, cool blue | Broadest appeal; reads as a serious modern tool without alienating non-pros |
| C | Hangar Logbook | Warm dark + ICAO data-block + slab heading + rubber-stamp confidence | Pilots / aviation-adjacent users; differentiated and memorable |

**C** is explored furthest: four palette variants (Brass on Walnut,
Graphite & Cyan, Carbon & Sodium, Blueprint, Forest & Phosphor) and an
"enriched density" variant that adds sparklines, a phase-detection
timeline strip, and a session-signature footer.

The analysis screen uses C's **Graphite & Cyan** palette — that's the
working assumption for the rest of the app. If a different direction
wins, the analysis screen needs a re-skin (the structure stays).

---

## Screens

### 1. File drop · all states + queue

One panel, four states, plus a queue list:

- **Empty / idle** — invitation to drop or pick a file. Shows accepted
  extensions (`.bfl` `.bbl` `.txt`), size limit (250 MB), firmware
  requirement (BF ≥ 4.5 for wing capability fields), and a "load sample
  log" affordance.
- **Hover** — file dragged over the zone. Visual confirmation: state
  label changes, accent color shifts, filename + size are read out so
  the user knows what'll be ingested.
- **Parsing** — progress bar + per-stage checklist (headers / field map
  / main frames / event index). Shows parsed-bytes and ms-elapsed.
- **Error** — `E_UNSUPPORTED_FIRMWARE` etc. Clearly states **what was
  expected vs. what was found**, with action chips ("inspect raw header",
  "report this log", "open as text"). Don't dump a stack trace; this is
  the user-facing error surface.

The queue list shows up to N pending files with: filename (truncated),
duration, firmware version, file size, and state (active / queued).
The active file streams parse progress inline.

**Screenshots:** `screenshots/01-A…`, `03-B…`, `05-C…`.

### 2. Capability summary

Shown immediately after a successful parse. Six "capability cards" plus
a main-frame field inventory:

- **Firmware** — version, target MCU, commit hash
- **Controller** — PIDFS / PID / D-Min, with the five gain values (P/I/D/F/S)
- **TPA** (Throttle PID Attenuation) — mode, estimator, delay, gravity,
  v_max, curve
- **SPA** (Setpoint PID Attenuation) — per-axis modes + center / width;
  freeform note when a setting deserves a callout (e.g. "Yaw is OFF")
- **Debug mode** — what's logged, what fields it unlocks
- **Log metadata** — duration, sample rate, dropped %, file size

Each card carries a **confidence stamp** (high / medium / low). High =
parsed from header directly. Medium = inferred. Low = couldn't resolve.
The user should never have to wonder whether they're reading parsed
truth or a guess.

The **main-frame fields table** lists every field the parser tried to
resolve, marked present / absent. Helps users understand why a downstream
analysis tab might be empty (e.g. "amperage isn't logged → no current
draw plot").

**Screenshots:** `screenshots/02-A…`, `04-B…`, `06-C…`, plus
`07–10` palette studies and `11–13` enriched density.

### 3. Analysis screen — Tracking tab (default)

The main working view. Layout:

```
┌──────────────────────────────────────────────────────────┐
│ Header: logo · filename · duration · fw · tab nav        │
├──────────────────────────────────────────────────────────┤
│ Config strip (5 cards): controller · TPA · SPA · debug · phases │
├──────────────────────────────────────────────────────────┤
│ Time bar with phase shading + scrub cursor               │
├──────────────────────────────────────────────────────────┤
│ Cursor readout (instantaneous values at pinned t)        │
├────────────────────────────┬─────────────────────────────┤
│                            │ Filter delay budget         │
│ Log viewer (multi-signal,  ├─────────────────────────────┤
│  gyro / setpoint / output) │ PID contribution            │
└────────────────────────────┴─────────────────────────────┘
```

The time bar is **the global clock**. Clicking anywhere pins a cursor;
all plots in the layout snap their cursor readout to that t. Drag to
scrub. This is implemented via `CursorProvider` in
`src/analysis-cursor.jsx` — keep that pattern.

**Screenshot:** `screenshots/14-analysis-tracking.png`.

### 4. Analysis screen — Spectrum tab

Gyro power-spectral-density plots per axis, with filter response curves
(notch + lowpass) overlaid. Used to spot frame resonance and verify
filter placement.

**Screenshot:** `screenshots/15-analysis-spectrum.png`.

### 5. Analysis screen — Step response tab

Per-axis step response derived from setpoint changes. Scatter overlays
for peak height and rise-time latency. The classic "did the tune
overshoot / under-damp" view.

**Screenshot:** `screenshots/16-analysis-step-response.png`.

### 6. Analysis screen — Recommend tab

Pulls everything together into a prioritized list of suggested PID /
SPA / TPA / filter / servo adjustments. Each recommendation has:

- A grouping (servo / SPA / TPA / filter / PID)
- A severity / confidence stamp
- The current value, the suggested value, and a short reason
- A "filter" control to scope to one group

This is the only place in the app that should give opinionated advice.
Everywhere else just shows the data.

**Screenshot:** `screenshots/17-analysis-recommendations.png`.

---

## Design tokens

Every direction defines its own `*_TOKENS` object in its JSX file. The
exact hex values to copy:

### Direction A · Phosphor Scope
```
bg       #050807
surface  #0a1310
surface2 #0c1813
line     #1a3d2a
line2    #2d4d3e
dim      #3d6850
ink      #b9ffd5    (primary text)
ink2     #80c79c
ink3     #5b9170    (labels / muted)
phos     #6effa8    (signature accent)
amber    #ffcc4a
red      #ff6b66
blue     #7ec8ff
grid     rgba(110,255,168,0.045)
```
Type: **IBM Plex Mono** throughout (with JetBrains Mono fallback).

### Direction B · Telemetry Console
```
bg       #0b0d10
surface  #131720
surface2 #181d28
line     #232a36
line2    #2e3645
ink      #e6edf3
ink2     #b0bbcc
ink3     #8b97a7
dim      #5a6478
blue     #62b6ff    (signature accent)
blueDim  #3a6f99
amber    #f5b35a
green    #6ad57f
red      #ff7866
```
Type: **Inter** for labels, **JetBrains Mono** for numbers.

### Direction C · Hangar Logbook (Brass on Walnut, original)
```
bg       #1a1611
surface  #221d16
surface2 #2a241c
paper    #2f2820
line     #3a3024
line2    #50412f
rule     #705a3e
ink      #e9dcc7
ink2     #bda88a
ink3     #8c7c66
dim      #5d503e
brass    #c9a262    (signature accent)
brassDim #8d6f3f
stamp    #c3503b    (rubber-stamp red)
ok       #7fa86a
amber    #d99f54
```
Type: **IBM Plex Serif** for slab headings, **Inter** for labels,
**IBM Plex Mono** for data.

### Direction C — palette variants

Same DNA, different palette. All defined in
`src/direction-c-expanded.jsx`:

- **PAL_GRAPHITE** (Graphite & Cyan) — `#0e1216` bg, `#5ad1c8` accent
- **PAL_CARBON** (Carbon & Sodium) — `#070707` bg, `#ffa744` accent
- **PAL_BLUEPRINT** — `#0a1729` bg, `#7ec8ff` accent
- **PAL_FOREST** (Forest & Phosphor) — `#0a120e` bg, `#92e6a3` accent

The **analysis screen uses PAL_GRAPHITE**. If a different direction
ships, port the analysis screen to that palette.

---

## Typography

Three font families across all directions; pick per direction:

| Use | Family | Loaded from |
|---|---|---|
| Mono (numbers, code, telemetry) | IBM Plex Mono, JetBrains Mono | Google Fonts |
| Sans (labels, UI chrome) | Inter | Google Fonts |
| Slab (Direction C headings) | IBM Plex Serif | Google Fonts |

Common type sizes in use:

- **9–10px** — micro-labels, table headers, letter-spacing 0.18–0.22em uppercase
- **11–12px** — body labels, data values
- **13–14px** — panel titles
- **15–16px** — section titles
- **22–26px** — hero state labels (e.g. "DROP .BFL" empty state)

Letter-spacing is significant — A leans heavily on 0.14–0.22em tracking
for the telemetry feel; B and C are tighter (0.04–0.06em).

---

## Interactions & behavior

### File drop
- Drag-over a file changes state; drop ingests; non-`.bfl/.bbl/.txt`
  rejected before parse
- Parse runs in WASM (the badge in direction A reads "WASM READY") —
  this is design intent, not a hard constraint
- Multiple files queue; only one parses at a time
- "Load sample log" should ship a known-good file alongside the app

### Analysis screen
- Tab nav swaps the lower content block; header / config strip / time
  bar / cursor readout persist across tabs
- Time bar: click to pin cursor; drag to scrub; pin state changes
  cursor color (white = hovering, accent = pinned)
- Cursor is global — every plot reads `cursorT` from `CursorProvider`
  and renders its own readout
- "Swap log" in header opens the file drop / queue view
- Recommend tab: group filter pills; each rec is independently
  acknowledgeable / dismissible (not designed yet — current state shows
  static list)

### State management

- `cursorT: number | null` — fraction 0–1 along the log duration
- `pinned: boolean` — whether the cursor was clicked vs. hovered
- `tab: 'tracking' | 'spectrum' | 'step' | 'recommend'`
- `loadedLog: File | null` and a `queue: File[]`
- `parseProgress: { pct, stage, bytesParsed, msElapsed }`
- `capabilities: parsed capability tree` (see `WT_CAPS` in
  `src/data.jsx` for the shape)

---

## Mock data

`src/data.jsx` defines four globals used across all directions:

- `WT_FILE` — single active file metadata
- `WT_QUEUE` — array of files in the queue, each with `state`
  (`active`/`queued`)
- `WT_CAPS` — the capability tree shown on the capability-summary screen
- `WT_FIELDS` — main-frame field inventory

Use these shapes when wiring real data. Field names match Betaflight's
actual blackbox field names (`gyroADC`, `rcCommand`, `setpoint`, etc).

---

## File index

```
source/
├── index.html              ← entry, shows script load order
├── design-canvas.jsx       ← presentation harness only; ignore for prod
└── src/
    ├── data.jsx                       ← mock data (WT_FILE, WT_QUEUE, WT_CAPS, WT_FIELDS)
    ├── icons.jsx                      ← shared SVG icons
    │
    ├── direction-a.jsx                ← A · Phosphor Scope (file drop + caps)
    ├── direction-b.jsx                ← B · Telemetry Console
    ├── direction-c.jsx                ← C · Hangar Logbook
    ├── direction-c-expanded.jsx       ← C palette studies + enriched density
    │
    ├── analysis-screen.jsx            ← composed analysis screen (top-level)
    ├── analysis-base.jsx              ← AN tokens, AnPlot frame, AnAxes
    ├── analysis-cursor.jsx            ← CursorProvider (global scrub cursor)
    ├── analysis-data.jsx              ← single-signal plot
    ├── analysis-data-multi.jsx        ← multi-signal plot
    ├── analysis-filter.jsx            ← filter delay budget panel
    ├── analysis-logviewer.jsx         ← log viewer (Tracking tab main)
    ├── analysis-pid.jsx               ← PID contribution panel
    ├── analysis-recommend.jsx         ← Recommend tab
    ├── analysis-servos.jsx            ← servo trace panel
    ├── analysis-setpoint.jsx          ← setpoint / gyro overlay
    ├── analysis-spectrum.jsx          ← Spectrum tab
    └── analysis-step.jsx              ← Step response tab

screenshots/
├── 01–06   File-drop + capabilities · directions A / B / C
├── 07–10   Direction C palette studies
├── 11–13   Direction C enriched-density variants
└── 14–17   Analysis screen tabs (tracking / spectrum / step / recommend)
```

To view the reference live, open `source/index.html` in a browser. It
needs internet access for Google Fonts and the React/Babel CDNs.

---

## Open questions for the dev / PM

These didn't get nailed down in the design pass; flag them when you
start implementing:

1. **Which direction ships.** A, B, or C; if C, which palette.
2. **Light mode.** Everything is dark; is a light variant required?
3. **Recommend tab interactions.** Designed as a static list. Needs
   "accept this recommendation", "dismiss", "explain" interactions.
4. **Per-axis filter response.** Spectrum tab overlays a single filter
   curve; should it be per-axis if filters differ?
5. **Error catalog.** Only `E_UNSUPPORTED_FIRMWARE` is mocked. Full
   error-code list + per-error help copy still needed.
6. **Comparison view.** No design yet for comparing two logs side-by-side
   — likely a M1.4 ask.

Screenshots are reduced-resolution previews. For pixel-accurate
reference, open the HTML files directly — every artboard renders at its
declared `width × height` inside `index.html`.
