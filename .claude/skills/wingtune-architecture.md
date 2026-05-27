---
name: wingtune-architecture
description: WingTune's three-layer architecture rules. Use this skill whenever modifying any file under src/, src-tauri/, or crates/, whenever adding a new feature or analysis module, whenever reviewing a diff, whenever answering "where should X live?", or whenever a code change crosses a folder boundary. Use it even if the user doesn't mention architecture explicitly — silent layer leakage is the single biggest long-term risk in this project, and this skill exists to catch it before it lands.
---

# WingTune architecture

WingTune is structured as three narrow layers. Each layer has a single
responsibility. Cross-layer leakage is the project's biggest long-term risk —
this skill exists to keep the boundaries clean.

## The layers

### Layer 1 — Ingest

**Responsibility:** turn `.bbl` bytes into a capability report, a frame index,
and (on demand) hydrated typed arrays.

**Lives in:**
- `crates/wingtune-parser/` — Rust crate wrapping `blackbox-log`
- `src/workers/parser.worker.ts` — Web Worker host for the WASM module
- `src/lib/wasmBridge.ts` — typed message protocol between main thread and worker

**Allowed:** decode, frame indexing, `sample_check` computation, field hydration
on request, event-frame extraction, Tauri filesystem reads (when `__TAURI__` is
present).

**Forbidden:**
- ❌ Any analysis math (FFT, curve fits, confidence scoring) — those belong in Layer 2
- ❌ Any Vue / Pinia / component imports — Layer 1 is UI-free
- ❌ `Float64Array` allocations on the hot path — see `wingtune-memory-model`
- ❌ Eagerly materializing all field arrays at end-of-decode — lazy hydration only

### Layer 2 — Analytics

**Responsibility:** consume hydrated fields, run wing-specific math, emit
structured results (and, where applicable, confidence-scored CLI
recommendations).

**Lives in:**
- `src/lib/<module>.ts` — one Layer-2 file per analysis (`coupling.ts`,
  `airspeedFit.ts`, `pilotStyle.ts`, `transferFunction.ts`, …). The earlier
  `src/analytics/<name>/` folder convention was rolled into `src/lib/` once
  it became clear most analyses are a single file + a tests file, not a
  multi-file module.
- `src/lib/recommenders/<module>.ts` — per-recommender file in its own
  subdirectory (see `wingtune-recommender`).
- `src/lib/confidence.ts` — shared confidence-scoring framework.
- `src/lib/capabilityPredicates.ts` — predicate functions shared with
  `validate-parser`.
- `src/lib/signalRegistry.ts` — source-agnostic signal resolution
  (`resolveSignal()`); the registry hides whether a signal came from a
  main-frame `wing*` field or a DEBUG_ multiplexed channel. Predicates and
  analytics route through it; they never name `debug_mode` strings or
  main-frame field names directly. See `wingtune-confidence-scoring`.
- `src/lib/spectrum.ts`, `src/lib/stft.ts`, `src/lib/nelderMead.ts` —
  shared math primitives reused across multiple analyses.

**Allowed:** pure functions over typed arrays, FFT, curve fitting, predicate
evaluation, confidence computation, signal derivation.

**Forbidden:**
- ❌ Direct WASM / worker calls — go through Layer 1's bridge
- ❌ Vue component imports — Layer 2 is UI-free
- ❌ Mutating input arrays — analytics is pure; allocate new arrays if needed
- ❌ Emitting a CLI recommendation without a confidence score — see `wingtune-confidence-scoring`
- ❌ Naming a `debug_mode` string or a specific main-frame field directly in
  a predicate or analysis (e.g. `if (debug_mode === 'TPA')`) — route through
  `resolveSignal()`. The whole point of the registry is that the firmware
  companion PR can land (or land partially) without analytics code changing.

### Layer 3 — Presentation

**Responsibility:** render Vue components, manage Pinia stores, handle user
interaction, drive field hydration on demand.

**Lives in:**
- `src/components/` — Vue 3 SFCs. Analysis panels live in
  `src/components/analysis/` and follow the diagnostic-panel template
  (see `wingtune-vue-conventions`).
- `src/stores/` — Pinia stores. Current set: `session.ts` (multi-tenant
  log container — the canonical state holder; replaced the earlier
  `log.ts` shim during M1.7), `view.ts` (UI settings + per-(log×series)
  visibility + tune-style profile).
- `src/views/` — top-level routes (currently `AnalysisView.vue`, which
  also drives the eager-hydrate pass against `ALL_RECOMMENDER_REQUIRED_FIELDS`).
- `src/composables/` — Vue composition functions
  (`useActiveLog`, `useAlignedTime`, `useUPlot`, `useFileDrop`, …).

**Allowed:** anything UI. Components subscribe to stores. Panels call
`ensureFields(...)` in `onMounted` to drive hydration for their declared
field set (the workspace-store concept was rolled into this per-panel
declaration pattern during M1.3 — there is no separate workspace store).
Composables wrap recurring UI logic.

**Forbidden:**
- ❌ Calling Layer 2 analytics directly from a component is fine — analytics
  functions are pure; what's forbidden is owning Layer-2 *state* in a
  component (caches, hydrated arrays, fit results) instead of in a store.
- ❌ Owning typed arrays in component reactive state — use `shallowRef` in a
  store, or use the session store's per-log field map (see
  `wingtune-vue-conventions` + `wingtune-memory-model`).
- ❌ Importing from `crates/` or `src/workers/` directly — only
  `src/lib/wasmBridge.ts` crosses that boundary.

### Per-tab wrapper component pattern

Every multi-panel tab is a thin `*Tab.vue` wrapper that stacks its panels
vertically with a uniform gap; `AnalysisView` routes to it by `activeTab`:

```
src/components/analysis/
  SummaryTab.vue      → CapabilitySummary + PilotStylePanel
  TrackingTab.vue     → SetpointTrackingPanel + CouplingPanel + TrimDiagnosticsPanel
  ServosTab.vue       → ServoPanel + ServoAsymmetryPanel + ServoHuntPanel +
                        AirframeBandwidthPanel + InputChainPanel
  SpectrumTab.vue     → SpectrumPanel + FilterSimPanel + AirspeedSpectrogramPanel +
                        LowFreqModePanel
  StepTab.vue         → StepResponsePanel + AirspeedStepResponsePanel + FFPanel
  RecommendTab.vue    → RecommendList + per-log pager (its own shape)
```

A new panel goes IN the relevant `*Tab.vue` wrapper, not directly into
`AnalysisView` (which only routes by `activeTab` — never renders panels
itself). When a new tab is added, `AnalysisView` gets one new `v-else-if`
branch and one new wrapper file, nothing else.

## The "where does this go?" decision tree

When in doubt:

1. **Touches WASM, byte parsing, or `.bbl` structure?** → Layer 1.
2. **Pure math over already-decoded arrays?** → Layer 2.
3. **User sees it, clicks it, or it lives in a `.vue` file?** → Layer 3.

If a piece of code seems to belong in two layers, it's probably two pieces of
code that haven't been separated yet. Split it before writing.

## The shared foundation in Layer 2

A subset of Layer 2 is "shared foundation" — primitives every analysis
module uses, all under `src/lib/`:

- `spectrum.ts` — hand-rolled Welch PSD over a radix-2 Cooley-Tukey FFT;
  shared spectral primitive for SpectrumPanel + M-FilterSim + S2 +
  M-Servo-2 transfer-function estimation.
- `stft.ts` — short-time FFT over the same FFT, reused by S2 +
  M-FilterSim's dynamic-notch tracker.
- `nelderMead.ts` — generic simplex optimiser; used by airspeed fit + TPA
  curve fit. `initialStep` accepts per-axis absolute steps for params at
  wildly different scales.
- `signalRegistry.ts` — source-agnostic signal resolution (see
  `wingtune-confidence-scoring`).
- `confidence.ts`, `capabilityPredicates.ts` — predicate + confidence
  framework.
- `maneuverDetect.ts` — shared maneuver-window detector that feeds M-FF,
  M-Coupling, and M-Servo-2's airframe-bandwidth estimation.
- `tuneProfile.ts` — `ProfileThresholds` per Cruise / Sport / 3D profile;
  analytics + recommenders that have style-sensitive thresholds read
  through it.

A new analysis module is a single file (plus tests) at `src/lib/<module>.ts`.
A new primitive used by multiple analyses also goes at `src/lib/`. The earlier
`src/analytics/<name>/` subdirectory shape was dropped once it became clear
most analyses fit a single file cleanly.

## Per-milestone execution doc rhythm

Each milestone bigger than a polish slice gets a written execution doc:

```
docs/wingtune-m1-execution.md           (M1 — frozen historical record)
docs/wingtune-m1.7-execution.md         (multi-log compare)
docs/wingtune-m-coupling-execution.md   (M-Coupling)
docs/wingtune-m-filtersim-execution.md  (Spectrum-roadmap S1)
docs/wingtune-m-style-execution.md      (M-Style)
docs/wingtune-m-servo-2-execution.md    (M-Servo-2)
docs/wingtune-m-pilot-execution.md      (M-Pilot)
…
```

Lifecycle: **write the doc first** (slice-by-slice breakdown, scope
in/out, open questions) → ship the slices → mark COMPLETE at the top once
all slices land. The doc is then a frozen record — don't track post-ship
refinements in it; those go to CLAUDE.md's Done list. Same rhythm applies
to multi-slice audits / passes (e.g. `docs/wingtune-skills-audit-plan.md`).

## Direct-to-main workflow

This is a solo personal project — no feature branches, no PRs. Commit
straight to `main` and push. Per the project's `feedback-direct-to-main`
memory: branches + PRs are noise here; the cost of a bad commit is bounded
to "Brian noticed and you'll fix the next commit." When in doubt
whether work is committable, the answer is "make a commit; that's the
unit of progress."

## Cross-cutting concerns

A few things touch every layer and have their own skills:

- **Memory model** — `Float32Array` only, lazy hydration. See `wingtune-memory-model`.
- **Confidence scoring** — any module that emits a CLI recommendation MUST return a confidence-scored result. See `wingtune-confidence-scoring`.
- **Corpus hygiene** — never commit a log with GPS data to the public repo. See `wingtune-corpus-hygiene`.
- **Vue conventions** — Pinia store layout, `shallowRef` for typed arrays. See `wingtune-vue-conventions`.

## Tauri vs web target

WingTune builds the same Vue 3 codebase as both a static SPA (hosted demo) and a
Tauri 2.x desktop bundle (primary). Layer rules apply equally to both targets.
The only legitimate target-specific divergence is in Layer 1's file-access
path:

- **Web target:** file drop → `File.arrayBuffer()` → worker
- **Tauri target:** file dialog → `tauri::fs::read` → direct byte buffer → worker (no `arrayBuffer()` round-trip)

Both paths converge at the worker boundary. Code below the worker is
target-agnostic.

## When this skill is wrong

If a real implementation reason forces a layer crossing (e.g. a Tauri-specific
optimization that needs to skip the worker, or a perf-critical inner loop that
genuinely needs Layer 1 to call Layer 2), document the exception in a
`// LAYER-EXCEPTION:` comment with rationale, and update this skill in the same
PR. Exceptions should be rare and named, not silent.

## Quick self-check before committing

- [ ] Did any file in `crates/` or `src/workers/` import from `src/components/` or `src/lib/`?
- [ ] Did any file in `src/lib/` import Vue, Pinia, or anything from `src/components/`?
- [ ] Did any `.vue` file import from `crates/` or `src/workers/` directly?
- [ ] Did any new analysis live somewhere other than `src/lib/<module>.ts`?
- [ ] Did any new panel get rendered directly from `AnalysisView` instead
      of from a `*Tab.vue` wrapper?
- [ ] Does any predicate or analysis name a `debug_mode` string or a
      specific main-frame field directly, instead of routing through
      `resolveSignal()`?
- [ ] Does the milestone have an execution doc at `docs/wingtune-m-X-execution.md`,
      or — for a polish slice — does it have a Done-list entry in CLAUDE.md?

If any answer is "yes" without a `LAYER-EXCEPTION:` comment explaining why, the
boundary is leaking — fix it before merging.
