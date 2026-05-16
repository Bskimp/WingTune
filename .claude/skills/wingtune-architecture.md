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
- `src/analytics/` — one module per analysis (`pidfsDecomp/`, `airspeedFit/`, etc.)
- `src/lib/confidence.ts` — shared confidence-scoring framework
- `src/lib/capabilityPredicates.ts` — predicate functions shared with `validate-parser`
- `src/lib/closedLoopResponse.ts`, `src/lib/fft.ts` — shared math primitives

**Allowed:** pure functions over typed arrays, FFT, curve fitting, predicate
evaluation, confidence computation, signal derivation.

**Forbidden:**
- ❌ Direct WASM / worker calls — go through Layer 1's bridge
- ❌ Vue component imports — Layer 2 is UI-free
- ❌ Mutating input arrays — analytics is pure; allocate new arrays if needed
- ❌ Emitting a CLI recommendation without a confidence score — see `wingtune-confidence-scoring`

### Layer 3 — Presentation

**Responsibility:** render Vue components, manage Pinia stores, handle user
interaction, declare which fields the active workspace needs.

**Lives in:**
- `src/components/` — Vue 3 SFCs
- `src/stores/` — Pinia stores (one per concern: `log`, `workspace`, `session`, …)
- `src/views/` — top-level routes
- `src/composables/` — Vue composition functions

**Allowed:** anything UI. Workspace stores declare required fields and trigger
hydration via Layer 1. Components subscribe to stores. Composables wrap
recurring UI logic.

**Forbidden:**
- ❌ Calling Layer 2 analytics directly from a component — go through a store
- ❌ Owning typed arrays in component reactive state — use `shallowRef` in a store (see `wingtune-vue-conventions`)
- ❌ Importing from `crates/` or `src/workers/` directly — only `src/lib/wasmBridge.ts` crosses that boundary

## The "where does this go?" decision tree

When in doubt:

1. **Touches WASM, byte parsing, or `.bbl` structure?** → Layer 1.
2. **Pure math over already-decoded arrays?** → Layer 2.
3. **User sees it, clicks it, or it lives in a `.vue` file?** → Layer 3.

If a piece of code seems to belong in two layers, it's probably two pieces of
code that haven't been separated yet. Split it before writing.

## The shared foundation in Layer 2

A subset of Layer 2 is "shared foundation" — primitives every analysis module
uses. These live in `src/lib/` rather than `src/analytics/`:

- `closedLoopResponse.ts` — windowed wing response math (longer windows, slower kernel sizing than quad equivalents)
- `fft.ts` — sub-100 Hz FFT with appropriate windowing
- `confidence.ts` — green/yellow/red scoring (see `wingtune-confidence-scoring`)
- `capabilityPredicates.ts` — predicate functions (see `wingtune-confidence-scoring`)
- `airspeedSignal.ts` — airspeed-signal derivation, consumed by M3 and downstream

A new analysis module goes in `src/analytics/<module-name>/`; a new primitive
used by many modules goes in `src/lib/`.

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

- [ ] Did any file in `crates/` or `src/workers/` import from `src/components/` or `src/analytics/`?
- [ ] Did any file in `src/analytics/` import Vue, Pinia, or anything from `src/components/`?
- [ ] Did any `.vue` file import from `crates/`, `src/workers/`, or call analytics directly without going through a store?
- [ ] Did any new analysis module live somewhere other than `src/analytics/<name>/`?

If any answer is "yes" without a `LAYER-EXCEPTION:` comment explaining why, the
boundary is leaking — fix it before merging.
