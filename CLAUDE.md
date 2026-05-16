# WingTune

> Desktop-first (Tauri 2.x) + hosted-demo blackbox log analysis tool for the
> fixed-wing side of Betaflight. Vue 3 + Vite + TypeScript + Pinia + Tailwind
> frontend; Rust parser (`blackbox-log`) compiled to WASM in a Web Worker.
> GPL-3.0-or-later. See `docs/wingtune-roadmap.md` for the long arc.

## Status

Pre-code. Design docs are reviewed and locked through v0.9 (roadmap) /
rev 11 (M1 execution). No source code yet — no `package.json`, no
`crates/`, no `src/`. The repo currently contains design docs, project
skills, firmware-PR artifacts, and tooling configs only.

**Immediate next step when resuming work:** the M1.0 **parser-support
scratch test** — a 30-minute `cargo new bbl-test` + decode a real
BF 2025/2026 wing log via `blackbox-log::File::new(bytes).iter().next()`
to confirm the failure mode. The result scopes the upstream PR work.
See `docs/wingtune-m1-execution.md` → "M1.0 → Parser support track" for
the full operational plan.

**Order of work after the scratch test:**

1. Fork `blackbox-log/blackbox-log` to `Bskimp/blackbox-log`, branch
   `wing-support`. Add BF 4.6+ firmware coverage.
2. Open the upstream PR in parallel (not a gate).
3. Scaffold M1.1 with `[patch.crates-io]` pointing at the fork branch.
4. Proceed M1.1 → M1.2 → M1.3 → M1.4 → M1.5 → M1.6 → M1.7 normally.
5. When (if) the PR merges: bump dep to the new crates.io version, delete
   the patch override.

See `docs/wingtune-m1-execution.md` for the full M1 plan.

## Cardinal rules

These are non-negotiable. Each maps to a skill that goes into depth.

1. **Float32 everywhere.** No `Float64Array` on the hot path. No `new Array()`
   for field-shaped allocations. The time axis is `Float32Array` of
   seconds-since-log-start.
2. **Lazy hydration only.** The initial scan produces a capability report and
   a frame index — NOT materialized field arrays. Hydration happens on
   workspace or analysis-module demand, never speculatively.
3. **Three layers, no leakage.** Layer 1 (Ingest / WASM / Worker) →
   Layer 2 (Analytics) → Layer 3 (Vue UI). Layer 1 never imports Vue.
   Layer 2 never imports Vue. Components never call WASM directly.
4. **`shallowRef` for typed-array data.** Never `ref(typedArray)` — Vue's
   deep proxy will catastrophically wrap every element.
5. **Confidence scoring on every CLI recommendation.** Modules that emit
   paste-ready CLI return `ConfidenceResult<T>` with green/yellow/red. On
   `red`, the copy button is removed, not just disabled.
6. **Corpus hygiene is non-negotiable.** No `.bbl` files with home GPS
   coordinates in the public repo, ever. There is no exception hatch on this
   rule.

When in doubt about any of these, read the relevant skill BEFORE writing
code.

## Project structure

```
crates/wingtune-parser/   Rust crate wrapping blackbox-log; compiles to WASM
src/workers/              Web Worker host for the WASM module
src/lib/                  Shared primitives — wasmBridge, fft, confidence, predicates
src/analytics/            Per-module analysis code (one folder per module)
src/components/           Vue 3 SFCs
src/composables/          Vue composition functions (use*)
src/stores/               Pinia stores (one per concern)
src/views/                Route-level components
src-tauri/                Tauri 2.x desktop shell
tests/corpus/             Public, scrubbed regression corpus (manifest.yaml)
tests/corpus-private/     Personal regression corpus (gitignored)
docs/                     Planning docs (roadmap, M1 execution plan)
.claude/skills/           Project skills — read these before writing code
```

## Skills index

Located in `.claude/skills/`. Skills auto-trigger based on their descriptions;
the table below is for human navigation.

| Skill                         | Triggers on                                                          | What it enforces                                          |
|-------------------------------|----------------------------------------------------------------------|-----------------------------------------------------------|
| `wingtune-architecture`       | Any file change under `src/`, `src-tauri/`, `crates/`                | Three-layer separation, where things live                 |
| `wingtune-memory-model`       | Allocating typed arrays, decoding fields, store changes              | Float32, lazy hydration, shallowRef                       |
| `wingtune-corpus-hygiene`     | Any change touching `tests/corpus/` or a `.bbl` file                 | GPS scrubbing, public/private split, no escape hatch      |
| `wingtune-confidence-scoring` | New analysis module, capability predicates, readiness report changes | Two-layer trust model, green/yellow/red                   |
| `wingtune-vue-conventions`    | Any `.vue`, store, or composable change                              | Vue 3 + setup-style Pinia + Tailwind discipline           |

Each skill includes a "Quick self-check before committing" section that
serves as a built-in review checklist.

## Planning docs

- `docs/wingtune-roadmap.md` — long-arc design doc. Vision, three-layer
  architecture, all milestones (M1–M7), risk register, firmware companion PR
  scope. Read for "why does the project look this way?"
- `docs/wingtune-m1-execution.md` — current detailed execution plan for M1.
  Read for "what's the actual next step?" Includes critical path,
  sub-milestones M1.0 through M1.7, exit criteria, and TypeScript stubs for
  the load-bearing pieces.

M2's execution plan does not exist yet by design — it'll be written when
M1.3 lands and the hydration API contract is real. Don't preemptively spec
M2 details against assumptions M1 may violate.

## Common commands

```bash
npm install                     # install JS dependencies
npm run dev                     # web target dev server (Vite)
npm run tauri:dev               # Tauri desktop dev shell
npm run build                   # web target production build
npm run tauri:build             # Tauri desktop bundle (per-OS)
npm run test:unit               # vitest unit tests
npm run test:wasm               # WASM binding integration tests
npm run corpus:validate         # validate-parser against tests/corpus/manifest.yaml
npm run corpus:validate:private # against tests/corpus-private/manifest.yaml (local only)
```

Rust toolchain (one-time setup):

```bash
rustup install stable           # Rust toolchain
cargo install wasm-pack         # WASM build tooling
```

## How to work in this project

When starting a task on this codebase:

1. **Read the relevant skill(s) first.** Skill descriptions are the auto-trigger
   mechanism, but for any task touching code under `src/`, at minimum
   `wingtune-architecture` and `wingtune-memory-model` are likely relevant.
2. **Check status in the M1 execution doc.** The status section at the top of
   `docs/wingtune-m1-execution.md` tracks what's landed and what's next.
3. **For non-trivial tasks, sketch a brief plan before coding.** What files
   change, what tests validate, which skills apply. Surface the plan for
   review before implementation when scope is non-trivial.
4. **Run the per-skill self-check before committing.** Each skill has a
   "Quick self-check" section near the bottom — use it as a literal
   pre-commit checklist for the change.
5. **Exceptions are named and documented.** If a rule needs to be bypassed
   for a legitimate reason, use the named exception comment
   (`// LAYER-EXCEPTION:`, `// MEMORY-EXCEPTION:`, `// CONFIDENCE-EXCEPTION:`,
   `// VUE-EXCEPTION:`) with rationale, and update the relevant skill in the
   same PR. The corpus-hygiene skill has no exception hatch — its rules are
   absolute.
6. **Surface uncertainty.** If a decision sits in an "Open questions" section
   of a skill (component library, i18n, etc.) and the current task forces
   resolution, raise the question rather than picking silently.

## Out of scope (for now)

To keep M1 from becoming M-everything:

- M2+ analysis modules (PIDFS decomp, airspeed fit, TPA fit, SPA, S-term viz)
- The Betaflight firmware companion PR (parallel track, not gating M1)
- Code signing for Tauri bundles (deferred to v1 release time)
- Migration into / out of the BF Configurator (separate project, deliberately)

These have entries in the roadmap; they're acknowledged as future work, not
forgotten.
