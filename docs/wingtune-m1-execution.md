# WingTune M1 — Execution plan (rev 13)

> Foundation milestone. Desktop-first (Tauri) + hosted-demo log analysis tool for Betaflight wings. Load a wing blackbox log, scan it off the main thread via a Rust parser compiled to WASM, build a capability report + frame index, lazily hydrate fields per workspace, render scrubbable time-series with event annotations, and classify the log's analysis readiness using a **source-agnostic signal registry** that resolves each wing-tuning signal against either the new main-frame `USE_WING` fields (BF 2026.6+) or the pre-PR debug-mode channels. Multi-log support (M1.7) folds into existing surfaces — no separate "campaign" UI. No analysis modules yet — those start at M2.

## Changes from rev 12 → rev 13

**Shipped (M1.3.4 through M2 emission loop):**

- **M1.3.4-5 entry-page surface landed.** `FileDropZone` (empty / staged / decoding / rejected states wired to `useLogStore().loadFile`), `FlightStrip`, `FieldTable`, `CapabilitySummary`, `AppHeader`, plus atom set (icons, `ConfidenceStamp`, `DataDivider`). `tests/wasm-binding/entry-flow.test.ts` exercises the full drop → store → CapabilitySummary loop end-to-end against `LOG00113.BFL` via happy-dom + @vue/test-utils + Node WASM bindings. Brian's locked visual direction: Direction C · Hangar Logbook on the Blueprint palette (`@theme` tokens in `tailwind.css`).
- **M1.4 charts + tabs landed.** Tab shell (Summary / Tracking / Servos / Spectrum / Step / Recommend-when-populated) driven by `useViewStore().activeTab`. Shared cursor (cursorTime, cursorPinned, set/pin/clear actions) with TimeBar (click-to-pin anchor) and CursorReadout (aggregated per-panel sample rows via `useCursorSamples` composable, hover tooltips via `hint` field). `useUPlot` lifecycle composable + `useChartPinnedCursor` for cross-chart overlay. Two real chart panels: `SetpointTrackingPanel` (gyro vs setpoint per axis, RMS/peak stats, drag-to-zoom) and `ServoPanel` (multi-trace `servo[i]` + `motor[i]` with per-channel toggle via `view.hiddenSeries`, dead-channel range filter). Spectrum + Step render `TabPlaceholder` honest "module pending" surfaces.
- **M1.6 readiness report landed.** `src/lib/confidence.ts` (ConfidenceLevel + ConfidenceResult<T> + aggregateConfidence per skill rule). `src/lib/capabilityPredicates.ts` (ModuleReport + four-state Capability + `presenceOf` three-state field helper + per-module predicates). `src/lib/signalRegistry.ts` (multi-source abstraction, predicates call `resolveSignal()` not raw debug_mode strings). `ReadinessCard.vue` renders the 12-module slot list at the top of Summary with four-state icons (✓ available / ⚠ partial / ⚠ inactive / ✗ blocked) + standardized "set `debug_mode = X` in BF to log ..." reason language + `via` source suffix.
- **Parser debug-mode coverage caught up to BF master.** `Bskimp/blackbox-log:wing-support` gains TPA=90 / S_TERM=91 / SPA=92 / WING_SETPOINT=95 alongside the existing WING_LAUNCH=101 (commit `4dd54b5`). Channel layouts ground-truthed against the merged BF PRs: DEBUG_SPA channel = axis × 1000 (PR #13719); DEBUG_WING_SETPOINT channel = 2×axis (pre-TPA) / 2×axis+1 (post-TPA) (PR #14010); DEBUG_S_TERM same pairing for s-term pre/post (PR #14010); DEBUG_TPA channel = airspeed estimate (PR #13895, channel TODO-verify). WingTune's signal registry consumes those mappings.
- **M2 emission loop landed (slices 1 + 2).** Slice 1: `src/lib/pidfs.ts` (`meanAbs` + `pidfsShares`, single-pass typed-array reducers); `PIDContributionPanel.vue` (per-axis P/I/D/F/S traces, chip toggle with shift-click solo, mean-abs share strip + dominant-term indicator, present-terms-only rendering when D/S missing on yaw). Slice 2: `src/lib/recommendations.ts` (Recommendation shape + sortBySeverity + gatherRecommendations); `src/lib/recommenders/debugMode.ts` (first concrete recommender — green-confidence "set debug_mode = X" CLI recs emitted when readiness shows a wing-tuning module blocked specifically by missing debug coverage). Recommend tab UI (RecommendCard with cardinal-rule-#5 copy-removed-on-red gate, RecommendList severity-sorted, RecommendTab with must/should/could/ok score header). TabBar auto-shows Recommend tab when rec count > 0.

**Open M1 tails:** M1.0 corpus assembly (not started). M1.5 inspector — Summary's FieldTable + ReadinessCard cover most of the original M1.5 scope; a deeper CLI-parameter-dump browser remains. M1.7 multi-log + session persistence not started. Scan-progress streaming UX (indeterminate striped bar today). LRU eviction policy on hydrated-field cache. Tauri `openSource(path)` + native file picker. Upstream `blackbox-log` PR (held by Brian).

**Open M2+ tails surfaced this rev:** evidence-chip cursor-pin wiring on RecommendCard (data shape supports it; UI deferred). Filter chips + group-by toggle on Recommend tab. Dismiss / mark-applied persistence. The DEBUG_TPA channel index for the airspeed estimate needs verification from BF source (currently best-guess channel 0).

## Changes from rev 11 → rev 12

- **Servos are first-class actuators, not motors.** The biggest single difference between wing and quad tuning. BF wing builds repurpose `motor[i]` to carry servo PWM (mixer config in headers gives the channel mapping). Several M1 surfaces become servo-aware:
  - M1.4 third workspace renamed to **"Servo outputs"** (was effectively "Motor outputs"), using `motor[0..N]` as servo PWM traces labeled by mixer assignment (`Elevon-L`, `Elevon-R`, `Rudder`, `Throttle`).
  - Per-axis (R/P/Y) plots gain **servo saturation strips** — translucent red whenever any contributing servo hit endpoint deflection.
  - Filter delay budget panel (lands with M4) gains a **`Mechanical chain` row** alongside the electronic filter chain (servo response time as its own line summing into the OVER BUDGET check). Wing tuning is often gated by servo lag rather than filter lag.
  - Header strip gets a **mixer badge** (`DELTA · 2 elevons + throttle`, etc.) next to CONTROLLER.
  - A future M-Servo analytics module (post-M1) will measure servo dead band, slew rate, lag, and airspeed-loaded response — emits its own confidence-scored CLI recs.
- **Recommend tab visual language locked in M1.3.4 design pass, infrastructure in M1.4, tab hidden until M2 first ships content.** Components built shell-only against a uniform `ConfidenceResult<T>` shape: `RecommendCard`, `RecommendList`, `ConfidenceStamp`, `EvidenceChip`. The `CursorProvider` shared-cursor mechanic (click an evidence chip → every plot pins to that moment) is implemented in M1.4 because it's cross-cutting (Tracking / Spectrum / Step / Recommend all use it), not Recommend-tab-only. Domain chips: `all / SPA / TPA / Filters / PID / Servo`. **The Recommend tab is hidden from the top tab bar until any M2+ module emits a single rec** — empty tabs read as broken; hidden reads as "feature doesn't exist yet."
- **First Claude Design pass (2026-05-16) produced mocks at `claude.ai/design/p/019e310e-a05e-7105-a26c-b2459f06da2f`** capturing the Tracking / Spectrum / Recommend tabs with the chip strip (CONTROLLER / TPA / SPA / DEBUG / PHASES), wing overlays (SPA factor, TPA factor, error), filter delay budget with OVER BUDGET badge, step-response panel, PID contribution with `-P -I D -F -S` chips, and 6 sample recommendation cards grounded in derivable BBL data. All six samples map to real M2-M7 modules — no aspirational content. See `docs/design-handoff.md` for the brief that produced this output.

## Changes from rev 10 → rev 11 (carried forward)

- **M1.0 expanded** to include a **Parser support track**: fork `blackbox-log` to `Bskimp/blackbox-log`, add BF 4.6+ firmware coverage on a `wing-support` branch, open an upstream PR in parallel, point WingTune at the fork via Cargo patch override. **Not a gate** — WingTune development against the fork starts at M1.1.
- Timing reframed: 4–6 weeks of WingTune work *plus* 1–2 weeks of parallel parser-support effort. Adds effort, not calendar time.
- New M1.0 subsection: concrete steps (scratch test → fork → PR → patch override → bump or maintain) and explicit framing of what this is NOT (a gate / a fork-vs-upstream binary / architectural lock-in).
- Last-resort fallback (wrapping `betaflight/blackbox-tools` via Emscripten) named but kept out of the default path. `wasmBridge.ts` keeps parser swaps as a Layer 1 change.

## Changes from rev 9 → rev 10 (carried forward)

- **M1.7 reframed**: "Campaign mode" surface is gone. Replaced by **multi-log + session persistence** — additive features on the existing time-series / readiness / header surfaces, plus a save/load mechanism for named sessions. No dedicated `CompareView.vue` or `/compare` route. Reasoning: every concrete need in the old campaign concept (multi-log overlay, time alignment, parameter diff, unioned readiness, save/load) lives better as a feature of an existing surface than as a separate modal view.
- `stores/campaign.ts` → `stores/session.ts`. Same underlying data (list of loaded logs + view state), no implied UI mode.
- New: `TuningDiffPanel.vue` (curated ~30-parameter diff across loaded logs, opens as a side panel from any view when ≥ 2 logs loaded), `LogPicker.vue` (per-log show/hide in the time-series toolbar at N ≥ 3), `lib/timeAlignment.ts` (X-axis offset transform for `absolute` / `first-arm` / `first-mode-change` modes), `lib/tuningParams.ts` (the curated parameter list).
- Time alignment is explicitly flagged as a non-trivial chunk of M1.7 — it's a transform on the X axis, not a one-line toggle. Bulk of M1.7 implementation cost.
- Tuning diff panel is intentionally a curated subset (~30 main tuning parameters), **not** a 200-row full-header dump. The full matrix view is deferred to post-M7 as "Tuning history matrix" — see roadmap backlog.
- Readiness report grows a unioned-coverage rendering for the multi-log case ("M3 runnable on 2 of 3 logs; via debug on flight 1, via main-frame on flight 2"). Single-log rendering unchanged.

## Changes from rev 8 → rev 9 (carried forward)

- **Reconciled with the project skills** (`.claude/skills/`):
  - Rust crate renamed `crates/parser-wasm/` → `crates/wingtune-parser/`. Per the `wingtune-architecture` skill, which is the source of truth for module layout.
  - Layer 1 boundary clarified: `src/workers/parser.worker.ts` (worker host) + `src/lib/wasmBridge.ts` (typed message protocol) — `wasmBridge.ts` is the *only* file outside Layer 1 that imports from the worker or knows the WASM contract. The earlier rev-8 `src/parser/client.ts` + `src/workers/protocol.ts` split has been collapsed into `wasmBridge.ts`.
  - WASM build output moves from `src/parser/pkg/` to `src/wasm/pkg/`.
- **Corpus manifest grows hygiene fields**, per the `wingtune-corpus-hygiene` skill (which is stricter than rev 8's prose):
  - `gps_location_class: public_field | stripped | cropped | synthetic` is **required** whenever `gps_present: true`.
  - `bundled: true` flags the single first-run sample log; bundled logs may only be `gps_present: false` OR `gps_location_class: synthetic`.
  - `public/samples/wing-sample.bbl` is now a build artifact, copied from the `bundled: true` corpus entry — not a hand-edited file.
- **Corpus hygiene section in this doc** replaced by a pointer to the skill. Skill is source of truth, prose was duplicating it and was the looser of the two — the skill won.

## Changes from rev 7 → rev 8 (carried forward)

- **Signal registry added** (`lib/signalRegistry.ts`): logical signal IDs resolve to either main-frame fields or debug-mode channels, ordered by preference. Predicates ask the registry instead of naming fields/modes directly. M3/M5/M6/M7 work on existing pre-PR logs *and* future BF 2026.6+ logs without code changes — analyses are not gated on the firmware companion PR.
- **Capability predicates rewritten** to call `resolveSignal()` per logical signal. Per-axis modules (SPA, S-term TPA) now report per-axis state rather than a single rollup.
- **Readiness report** surfaces the resolved source (`via: main_frame | debug | mixed`) informationally.
- **Corpus manifest format** expresses `signals_resolved: { id: { via: ... } }` rather than `fields_required: [...]`. Pre-PR and post-PR fixture logs coexist.

## Changes from rev 6 → rev 7 (carried forward)

- **Distribution model**: Tauri 2.x desktop shell is the primary build; static Vite build doubles as the hosted demo. Same Vue 3 frontend, two targets. `src-tauri/` scaffold added in M1.1.
- **Memory architecture overhaul (M1.3)**: switched from "single end-of-decode commit of all fields" to **fielded lazy decode + Float32 throughout**. Initial scan builds a frame index + capability report (no per-field arrays); workspaces declare required fields; switching a workspace hydrates just those. Time axis is Float32-since-log-start. Roughly halves peak memory and lets the large-log exit criterion actually pass.
- **Event/annotation track (M1.4)**: flight mode changes, arm/disarm, RX loss, failsafe events render as vertical flags on the timeline, sourced from `blackbox-log`'s event frame stream.
- **M1.7 added — campaign mode**: multi-log session for cross-flight tuning workflows. See roadmap.
- **Test surface expanded (M1.1)**: vitest configured from day one; WASM binding integration test invoked from Node; FFT correctness, curve-fit determinism, and confidence-property tests scoped for M3+; Playwright smoke deferred to post-M1.6.
- **Voltage sag**: added to capability report so M3 (later) can use it as a confidence input.

## Changes from rev 5 → rev 6 (carried forward)

- **Streaming semantics clarified**: M1 streams decode *progress* (not chart data) during the initial scan. Field arrays now hydrate lazily per workspace rather than committing all at end-of-decode — see rev 7 changelog.
- **M1.6 reframed as capability-predicate evaluation**, not corpus-class matching. Same predicates feed corpus regression and runtime readiness.
- **Three-state field handling**: missing / present-but-zero / present-and-active.
- **Manifest-driven corpus validation**: `validate-parser --manifest`.
- **Servo/wing detection with confidence levels**: multi-signal classification surfaced as high/medium/low.
- **CI workflow** in M1.1.
- **Large-log exit criterion**: 100–300 MB load without freezing UI / exhausting memory.
- **Dependency policy**: track current stable; pin deliberately with rationale.

## Changes from earlier revs (carried forward)

- Frontend: Vue 3 + Pinia (rev 4).
- `shallowRef` pattern for typed-array log data (rev 4).
- Golden-log corpus is the regression backbone (rev 5).
- Header inspector (M1.5) and readiness report (M1.6) are separate concerns (rev 5).
- `axisS[0..2]` is a first-class main-frame field; no firmware PR needed.

## Locked-in decisions

- **Scope**: Betaflight wing logs only.
- **Parser**: `blackbox-log` (Rust, Apache-2.0/MIT) → WASM via `wasm-pack`, hosted in a Web Worker.
- **App**: Vue 3 + Vite + TypeScript + Pinia + Tailwind. Built twice from the same source: as a static SPA (hosted demo) and as a Tauri 2.x desktop bundle (primary).
- **Memory model**: fielded lazy decode. Initial scan = capability report + frame index only. Workspaces declare required fields; switching hydrates. Float32 values + Float32 time-since-start.
- **JS tests**: vitest from day one.
- **License**: GPL-3.0-or-later (works for both web and desktop).

## Rust toolchain primer (for the C/JS-familiar)

`rustup` installs the toolchain. You get:

- `cargo` — build, test, format, lint, dependency manager (npm + webpack + jest combined).
- `wasm-pack` — installed separately via `cargo install wasm-pack`. Builds Rust to WASM with JS bindings.
- `rust-analyzer` — LSP for VS Code, inline type hints.

Mental model coming from C and JS:

| C concept | Rust equivalent |
|---|---|
| `malloc/free` | Ownership + RAII |
| Header files | `mod` + `pub use` |
| `enum` (sum type) | `enum` (real sum type with data per variant) |
| `void *` + casts | Generics + traits |
| Manual error codes | `Result<T, E>` + `?` operator |
| Null pointer | `Option<T>` |

For *this* project you'll write roughly:

```rust
let file = blackbox_log::File::new(&bytes);
for headers_result in file.iter() {
    let headers = headers_result?;
    let mut parser = headers.data_parser();
    while let Some(event) = parser.next() {
        // copy values into output buffers
    }
}
```

The borrow checker yells a few times. For wrapper code that moves bytes through, it rarely bites. Rust Book chapters 1–4 cover what you need.

## Critical path

```
M1.0  Parser validation + corpus assembly  (regression-driven via manifest)
      ↳ Parser support track               (fork blackbox-log → add BF 4.6+ → PR upstream in parallel)
M1.1  Project scaffold + CI                (Vite + Vue 3 + TS + Rust crate + Tauri + vitest + workflow)
M1.2  WASM wrapper + Worker                (capability report + frame index, no field hydration)
M1.3  File drop + scan progress + fielded lazy hydration (Float32 throughout)
M1.4  uPlot time-series + event/annotation track
M1.5  Header inspector                     (FC config view, wing detection with confidence)
M1.6  Log readiness report                 (capability predicates)
M1.7  Multi-log + session persistence     (additive features on existing surfaces; no separate compare view)
```

Estimated total: 4–6 weeks of WingTune-side work, **plus** 1–2 weeks of parallel parser-support effort (Rust work on the `blackbox-log` fork). Parser-support is a parallel track, not a gate — WingTune development proceeds against the fork via Cargo patch override starting at M1.1. The work adds effort but minimal calendar time provided you don't try to serialize it after M1.0.

## M1.0 — Parser validation + parser support + golden-log corpus

**Goal**: get `blackbox-log` decoding current Betaflight wing logs (the parser-support track), validate that decoding against every corpus class WingTune cares about, and capture those logs as a regression-test corpus.

The corpus is the durable artifact — `validate-parser` runs against it on every PR. Even after M1 ships, the corpus protects against `blackbox-log` upstream drift, BF firmware field changes, and our own regressions.

### Parser support track (load-bearing — see roadmap Risk #3)

`blackbox-log` 0.4.3 (April 2024) documents support up to BF 4.5.x. BF 4.6+ wing logs likely fail at the firmware-version check — explicit error, not silent-decode-with-wrong-fields. We don't gate WingTune development on the upstream merge; we fork, patch, and continue. **The PR is parallel work, not a critical path dependency.**

#### Steps

1. **Confirm the failure mode.** Before any fork work, run a 30-minute scratch test:
   ```bash
   cargo new bbl-test && cd bbl-test
   cargo add blackbox-log
   # In src/main.rs, decode one of your real BF 2025.x or 2026.x wing logs
   # via `blackbox_log::File::new(bytes).iter().next()`.
   ```
   Capture the exact error. Likely: `ParseError::UnsupportedFirmwareVersion`. Possibly: parses but `debug_mode` lookup returns unknown, or event-frame decode chokes on a new event type. The error scopes the PR.

2. **Fork `blackbox-log/blackbox-log` to `Bskimp/blackbox-log`.** Create branch `wing-support`. This branch contains ONLY the BF 4.6+ support — keep it PR-shaped (no unrelated changes). Other side experiments go on other branches.

3. **Add the missing version support.** Concretely:
   - Update the supported-firmware table to recognize BF 4.6, 4.7 (if any), 2025.x, 2026.x.
   - Add new `debug_mode` enum values (`DEBUG_S_TERM`, `DEBUG_WING_SETPOINT`, `DEBUG_SPA`, expanded `DEBUG_TPA` channel meanings).
   - Add any new event-frame types introduced since 4.5 (check `flightLogEvent_*_s` in [docs/firmware-reference/blackbox_fielddefs.h](firmware-reference/blackbox_fielddefs.h)).
   - Add fixture logs from your real BF 2025/2026 flights to the crate's `tests/` (scrubbed per `wingtune-corpus-hygiene` rules — these become public test data via the crate).
   - Bump MSRV only if a new BF version forces a Rust feature; otherwise keep MSRV unchanged.

4. **Open upstream PR.** The maintainer's README explicitly invites log-based contributions. Likely accepted. Include the fixture logs as PR evidence.

5. **Point WingTune at the fork.** Once `crates/wingtune-parser/Cargo.toml` exists (M1.1), use a workspace-level Cargo patch:
   ```toml
   # Cargo.toml (workspace root, added during M1.1 scaffold)
   [patch.crates-io]
   blackbox-log = { git = "https://github.com/Bskimp/blackbox-log", branch = "wing-support" }
   ```
   The whole project — `wingtune-parser`, `validate-parser`, any future crate — builds against the fork transparently. CI installs Rust toolchain and resolves the git dep without special configuration. `Cargo.lock` pins to a git SHA.

6. **When (if) upstream merges**: bump `wingtune-parser`'s dep to the new crates.io version (e.g. `blackbox-log = "0.5"`), delete the `[patch.crates-io]` block. One-line config change. Document the bump in the README's compatibility table.

7. **If upstream doesn't merge** (after a reasonable window — say 4–6 weeks): nothing changes for WingTune. The fork is now the long-term dep. Rebase `wing-support` on upstream `main` periodically so any non-conflicting upstream improvements still flow through.

#### What this is NOT

- **Not a gate.** WingTune scaffold, WASM wrapper, and Layer 1 work all proceed against the fork from day one. The only thing that *waits* for the parser-support work is "actually decoding a wing log end-to-end" — which doesn't happen until M1.2/M1.3 anyway.
- **Not a fork-vs-upstream binary.** It's one path with two possible endings. You always work on the fork branch; that branch always doubles as the PR's branch. The only thing that changes between the two endings is whether `blackbox-log = "..."` in `Cargo.toml` is a git URL or a crates.io version.
- **Not architectural lock-in.** If the fork strategy ever falls apart (upstream goes hostile, maintenance burden becomes onerous, parser API breaks too often), the last-resort fallback is wrapping `betaflight/blackbox-tools` (C) via Emscripten — ~2 weeks of contained Layer 1 work. See `wingtune-architecture` skill for why this stays bounded: `wasmBridge.ts` is the abstraction that makes parser swaps a Layer 1 change, not a project change.

#### Risk if you do NOT do this in M1.0

If you skip the parser-support track and try to build M1.2 against an unmodified `blackbox-log` 0.4.3, the WASM wrapper compiles fine but every real wing log fails to parse at runtime — meaning M1.3+ can never be tested against anything real. You'd discover the gap in M1.3 instead of M1.0, after weeks of Layer 1 work that you can't validate. Front-loading the parser-support work in M1.0 means everything downstream has something real to decode against.

### Corpus structure

```
tests/corpus/
├── README.md
├── manifest.yaml                 # Per-log: class, debug_mode, FW version, expectations
├── basic-wing-4.6.bbl
├── pidfs-complete-4.6.bbl
├── pidfs-partial-yaw-4.6.bbl
├── airspeed-calibration-tpa.bbl
├── tpa-curve-probe.bbl
├── spa-test.bbl
├── sterm-tpa-validation.bbl
└── bad-incomplete.bbl
```

### `manifest.yaml` example

The corpus expresses **signals** (logical IDs) and **modules runnable**, not source-specific field/debug paths — the resolver figures out the path at runtime. A log can be added to the corpus regardless of whether its signals come via main-frame or debug-mode channels.

**Hygiene fields are required** alongside the signal-resolution expectations — see `wingtune-corpus-hygiene` for the rules they enforce:

- `gps_present: true | false` — always.
- `gps_location_class: public_field | stripped | cropped | synthetic` — **required when `gps_present: true`**. Documents how the log was made safe to publish.
- `bundled: true` — flag on the single log shipped as the first-run sample. **Bundled logs must satisfy `gps_present: false` OR `gps_location_class: synthetic`** — `cropped`/`stripped` are not acceptable for the bundled sample (too many edge cases for paranoid comfort).

```yaml
logs:
  - file: basic-wing-4.6.bbl
    class: basic-wing
    firmware: betaflight/4.6.0
    debug_mode: none
    gps_present: false
    expected:
      decodes: true
      signals_resolved: []                # M1 needs no wing-tuning signals
      modules_runnable: [M1]

  - file: pidfs-complete-4.6.bbl
    class: pidfs-complete
    firmware: betaflight/4.6.0-wing
    debug_mode: none
    gps_present: false
    bundled: true                         # shipped to public/samples/wing-sample.bbl at build time
    expected:
      decodes: true
      signals_resolved: []                # axisS itself is checked via fields_present
      fields_present: [axisP, axisI, axisD, axisF, axisS]
      modules_runnable: [M1, M2]

  - file: airspeed-calibration-tpa.bbl   # pre-PR log — debug-mode path
    class: airspeed-calibration
    firmware: betaflight/4.6.0-wing
    debug_mode: TPA
    gps_present: true
    gps_location_class: cropped           # GPS frames truncated to the calibration window
    expected:
      decodes: true
      signals_resolved:
        tpa_speed_est: { via: debug }
        tpa_arg:       { via: debug }
      modules_runnable: [M1, M3]

  - file: airspeed-calibration-2026.6.bbl   # post-PR log — main-frame path
    class: airspeed-calibration
    firmware: betaflight/2026.6-wing
    debug_mode: none
    gps_present: true
    gps_location_class: public_field      # flown at an established RC site
    expected:
      decodes: true
      signals_resolved:
        tpa_speed_est: { via: main_frame }
        tpa_arg:       { via: main_frame }
      modules_runnable: [M1, M3]
```

Both `airspeed-calibration-*.bbl` entries satisfy the **same predicate** (M3 runnable) because predicates only care about resolution, not source. The `via:` annotation is a corpus-side cross-check that the resolver picked the expected path — useful for catching bugs where, say, a main-frame field accidentally takes precedence over a richer debug-mode channel.

Once the firmware companion PR ships, add `airspeed-calibration-2026.6.bbl` and any other dual-path logs alongside their pre-PR siblings — never replace them. The corpus needs to cover both regimes indefinitely so we don't break older logs.

The bundled sample log (`bundled: true`) is the canonical source-of-truth — at build time it gets copied to `public/samples/wing-sample.bbl` so the static demo and Tauri bundle ship with the same file. **`public/samples/wing-sample.bbl` is a build artifact, not an editable file**; edits live in `tests/corpus/` and propagate through the build.

### Corpus hygiene

The detailed hygiene rules — scrubbing checklist, `gps_location_class` definitions, public-vs-private corpus split, bundled-sample paranoia rules, no-escape-hatch policy — live in the **`wingtune-corpus-hygiene` skill**. This section is intentionally a pointer rather than a duplicate; the skill is the source of truth and admits no exceptions. Read it before adding or modifying any `.bbl` in the repo.

### Validate-parser manifest mode

The current `validate-parser` accepts path arguments. It needs to grow a `--manifest` flag that:
1. Reads `manifest.yaml`
2. For each log, decodes via `blackbox-log` and captures actual capabilities (fields present, debug mode, GPS, etc.)
3. Diffs against the `expected` block in the manifest
4. Exits non-zero on any mismatch

Additional Rust dep: `serde_yaml = "0.9"` for parsing.

This replaces the shell-glob form (`tests/corpus/*.bbl`) which doesn't expand portably on Windows. The npm script becomes:

```json
"corpus:validate": "cargo run --release --manifest-path crates/validate-parser/Cargo.toml -- --manifest tests/corpus/manifest.yaml"
```

The current path-argument mode stays for ad-hoc one-off testing — both modes coexist.

### Tasks

1. Assemble at least one log per corpus class. Use the hygiene rules above.
2. Write the `manifest.yaml` entries.
3. Extend `validate-parser` with `--manifest` mode (when needed; can also start with manual decoding).
4. Run end-to-end and confirm each log's actual capabilities match expectations.

### Pass criteria

- All corpus classes decode without panics or truncation.
- Predicate checks pass for every log (e.g. PIDFS-complete logs show `axisS[0..2]` present and nonzero; PIDFS-partial logs show the right subset).
- The "Bad / incomplete" log fails gracefully — clear "what's missing" rather than crash.

### Fail handling

- Missing field definitions in `blackbox-log` → file upstream PR with offending log + YAML entry.
- Format-level errors → fork-and-fix; architecture survives.

## M1.1 — Project scaffold + CI

```
wingtune/
├── package.json
├── vite.config.ts
├── vitest.config.ts              # NEW — JS unit tests
├── tsconfig.json
├── tailwind.config.ts
├── index.html
├── README.md
├── LICENSE                       # GPL-3.0-or-later
├── .github/
│   └── workflows/
│       └── ci.yml
├── src-tauri/                    # NEW — desktop shell
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/
│       └── main.rs               # thin: launch the webview pointing at the Vite build
├── crates/
│   ├── wingtune-parser/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── validate-parser/          # extend with --manifest mode in M1.0
│       ├── Cargo.toml
│       └── src/main.rs
├── tests/
│   ├── corpus/                   # golden-log corpus
│   │   ├── README.md
│   │   ├── manifest.yaml
│   │   └── *.bbl                 # public corpus only — sensitive logs stay private
│   ├── wasm-binding/             # NEW — Node-side integration test against the built WASM
│   │   └── decode-smoke.test.ts
│   └── unit/                     # NEW — vitest specs for src/lib/ logic
│       ├── capabilityPredicates.test.ts
│       ├── signalRegistry.test.ts
│       ├── wingDetection.test.ts
│       ├── confidence.test.ts
│       └── dtype-helpers.test.ts
├── public/
│   └── samples/
│       └── wing-sample.bbl       # build artifact — copied from the `bundled: true` corpus entry
└── src/
    ├── main.ts
    ├── App.vue
    ├── workers/
    │   └── parser.worker.ts          # worker host for the WASM module
    ├── wasm/
    │   └── pkg/                      # wasm-pack output — gitignored, regenerated by `npm run wasm:build`
    ├── stores/
    │   ├── log.ts                # capability report + frame index + lazily-hydrated fields (active focus log)
    │   ├── view.ts               # scrub window, active workspace, hydration state, time-alignment mode
    │   ├── readiness.ts          # M1.6 capability report (per-log + M1.7 unioned)
    │   └── session.ts            # M1.7 — multi-log container + save/load (named session)
    ├── components/
    │   ├── FileDrop.vue          # web target only
    │   ├── HeaderInspector.vue
    │   ├── ReadinessReport.vue
    │   ├── TimeSeriesPanel.vue
    │   ├── EventTrack.vue        # annotation flags on the timeline
    │   ├── LogPicker.vue         # M1.7 — per-log show/hide control in the time-series toolbar (visible at N ≥ 3)
    │   ├── TuningDiffPanel.vue   # M1.7 — curated tuning-parameter diff across loaded logs
    │   ├── FieldPicker.vue
    │   └── ProgressBar.vue
    ├── lib/
    │   ├── wasmBridge.ts             # typed message protocol main thread ↔ worker; the only place outside Layer 1 that knows the WASM contract
    │   ├── uplotConfig.ts
    │   ├── fieldRegistry.ts
    │   ├── debugModes.ts
    │   ├── signalRegistry.ts         # logical signal IDs resolved against (main-frame field | debug channel)
    │   ├── capabilityPredicates.ts   # M1.6 logic, source-agnostic via signalRegistry
    │   ├── wingDetection.ts          # multi-signal, confidence-scored
    │   ├── eventFrames.ts            # derive annotation flags from event-frame stream
    │   ├── timeAlignment.ts          # M1.7 — alignment-mode offsets for multi-log X axis
    │   ├── tuningParams.ts           # M1.7 — curated list of "main tuning parameters" the diff panel surfaces
    │   └── platform.ts               # runtime-detect Tauri vs web; gate file-open path
    └── assets/
        └── tailwind.css
```

### `package.json` essentials

```json
{
  "scripts": {
    "wasm:build": "wasm-pack build crates/wingtune-parser --target web --out-dir ../../src/wasm/pkg",
    "wasm:watch": "cargo watch -w crates/wingtune-parser -s 'npm run wasm:build'",
    "wasm:build:node": "wasm-pack build crates/wingtune-parser --target nodejs --out-dir ../../tests/wasm-binding/pkg",
    "dev": "npm run wasm:build && vite",
    "build": "npm run wasm:build && vue-tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "npm run wasm:build && tauri dev",
    "tauri:build": "npm run wasm:build && tauri build",
    "test:unit": "vitest run",
    "test:wasm": "npm run wasm:build:node && vitest run tests/wasm-binding",
    "corpus:validate": "cargo run --release --manifest-path crates/validate-parser/Cargo.toml -- --manifest tests/corpus/manifest.yaml"
  },
  "dependencies": {
    "vue": "*",
    "pinia": "*",
    "uplot": "*"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "*",
    "typescript": "*",
    "vue-tsc": "*",
    "vite": "*",
    "vite-plugin-wasm": "*",
    "vite-plugin-top-level-await": "*",
    "tailwindcss": "*",
    "@vue/tsconfig": "*",
    "vitest": "*",
    "@tauri-apps/cli": "*"
  }
}
```

Tauri itself adds the `src-tauri/` Rust crate (with its own `Cargo.toml` depending on `tauri = "2"`), which isn't part of `package.json`.

**Dependency policy**: track current stable when initially scaffolding. The `*` placeholders above are deliberate — use `npm install <pkg>@latest` at scaffold time to capture today's stable line, then commit the lockfile. If anything has to be pinned below latest (e.g. Vite major churn breaking the WASM plugin), pin it explicitly in package.json with a comment noting why, and add a README entry. Vite has had multiple breaking majors in the recent past; the devcontainer is valuable insurance.

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()],
  worker: { plugins: () => [wasm(), topLevelAwait()] },
});
```

### `src/main.ts`

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './assets/tailwind.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
```

### CI workflow (`.github/workflows/ci.yml`)

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: dtolnay/rust-toolchain@stable
      - name: Install wasm-pack
        run: cargo install wasm-pack
      - name: Install dependencies
        run: npm ci
      - name: Build app
        run: npm run build
      - name: Rust tests
        run: cargo test --workspace
      - name: JS unit tests
        run: npm run test:unit
      - name: WASM binding integration test
        run: npm run test:wasm
      - name: Validate corpus
        run: npm run corpus:validate

  tauri:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: dtolnay/rust-toolchain@stable
      - name: Install wasm-pack
        run: cargo install wasm-pack
      - name: Install dependencies
        run: npm ci
      - name: Tauri build (no signing)
        run: npm run tauri:build -- --ci
```

The `build` job is the gate; `tauri` is a smoke test to catch platform-specific breakage early. Signing is deferred to release-time. Even with a small initial corpus, CI locks the architecture from day one and catches breakage on any PR. The corpus validation step is what makes this a real regression suite rather than aspirational.

### Test surface (vitest + WASM-binding test)

- **`tests/unit/`** — pure-logic specs for `capabilityPredicates.ts`, `wingDetection.ts`, the confidence-scoring helpers, and dtype/concat helpers. These are the modules whose correctness drives every recommendation downstream — they get unit coverage from day one. Use vitest's snapshot mode sparingly; prefer table-driven asserts on the predicate outputs.
- **`tests/wasm-binding/`** — Node-target WASM build (`wasm-pack build --target nodejs`) gets loaded from a vitest spec that decodes a corpus log end-to-end via the same JS bindings the browser uses. Catches binding-boundary regressions that `cargo test` can't see.
- **FFT correctness** (added at M3, not M1) — synthetic sine waves at known frequencies, assert peak bin within ±1.
- **Curve-fit determinism** (M3+) — snapshot the LM fit output against fixed corpus logs.
- **Confidence property tests** (M3+) — degraded inputs (narrow speed range, low sample count, voltage sag) must never yield a green recommendation.
- **Playwright smoke** (deferred to post-M1.6) — drop log → render chart → readiness shown. Two or three tests, big regression net.

## M1.2 — Rust wrapper crate + Worker integration

Three files form the Layer 1 boundary (see `wingtune-architecture` skill):

- **`crates/wingtune-parser/src/lib.rs`** — Rust crate wrapping `blackbox-log`. Exposes `scan(bytes) -> CapabilityReport` and `hydrate(field_ids) -> Float32Array[]` to the JS layer via `wasm-bindgen`.
- **`src/workers/parser.worker.ts`** — Web Worker that hosts the WASM module. Receives `postMessage` requests, dispatches to the crate, posts results back.
- **`src/lib/wasmBridge.ts`** — typed message protocol. The only file outside Layer 1 that imports from the worker or knows the WASM contract. Stores call into `wasmBridge`; `wasmBridge` calls into the worker; worker calls WASM. Anything bypassing `wasmBridge` is a layer leak.

`crates/wingtune-parser/Cargo.toml`:

```toml
[package]
name = "wingtune-parser"
version = "0.1.0"
edition = "2021"
license = "GPL-3.0-or-later"

[lib]
crate-type = ["cdylib"]

[dependencies]
blackbox-log = "0.4"
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde-wasm-bindgen = "0.6"

[profile.release]
opt-level = "s"
lto = true
```

The wrapper emits a structured **capability report** alongside header info: `{ fields_present, debug_mode, gps_present, sample_check, frame_index, total_frames, voltage_sag_summary }`. M1.6 consumes this; M1.3 stores the `frame_index` (byte offsets every ~N frames or every ~M seconds) so workspace-triggered hydration can re-decode a single field without rescanning the whole log. `voltage_sag_summary` is a low-cost summary (min/max/p99 of `vbatLatest`, percentage of frames below a threshold) — adding it now is essentially free because the scan touches every frame anyway, and M3 will use it as a confidence input. `sample_check` records `{ all_zero, has_content }` per known wing-relevant field by sampling N frames during the scan.

## M1.3 — File ingestion + scan + fielded lazy hydration

**Architectural choice (load-bearing — explicit):**

Loading a log has **two distinct phases**:

1. **Scan** — single pass over the bytes in the worker, emitting decode progress. Produces the capability report, frame index, event-frame list, and `vbatLatest` summary. **Does not** materialize per-field typed arrays. Commits to Pinia at end-of-scan.
2. **Hydrate** — workspaces declare a required field list. Switching to a workspace (or M2+ module) requests hydration for any not-yet-resident fields. The worker re-decodes those specific fields using the frame index for seek hints, emits a `Float32Array` per field, and the store assigns them in a single transaction.

This replaces rev-6's "single end-of-decode commit of every field." That model would have required ~800 MB+ for a 300 MB log with 40 fields, which is what motivated the rewrite. Fielded hydration keeps peak memory proportional to *what's on screen*, not *what was in the log*.

**Dtype rules (also load-bearing):**

- Values: `Float32Array`. BBL signal precision is 12–16 bits — Float64 buys nothing.
- Time axis: `Float32Array` of seconds since log start. NOT Float64 absolute timestamps. The relative form fits ~24 bits of precision for any flight under ~16,000 s = plenty.
- Helpers in `src/lib/dtype.ts` for `concatFloat32`, `secondsFromMicros`, etc. Unit-tested in `tests/unit/dtype-helpers.test.ts`.

**Trade-offs to accept:**

- Workspace switch incurs a re-decode for any field not already hydrated. On a 300 MB log this is order-of-seconds, not instant. UI shows a per-field hydration spinner.
- Cached fields stay in memory until evicted; cache eviction policy is "LRU on byte size, with a configurable cap" — defer the policy to a `view.ts` setting, defaults to 256 MB.

### Store sketch

```ts
import { defineStore } from 'pinia';
import { ref, shallowRef, shallowReactive } from 'vue';
import { ParserClient, type ScanReport, type EventFrame } from '../lib/wasmBridge';

export const useLogStore = defineStore('log', () => {
  const client = new ParserClient();

  const scanReport = ref<ScanReport | null>(null);
  const scanning = ref(false);
  const scanProgress = ref(0);              // frame count during scan

  // Time axis built once, shared across all hydrated fields.
  const time = shallowRef<Float32Array>(new Float32Array(0));

  // Per-field map of hydrated typed arrays. shallowReactive so adds/removes are
  // reactive but the typed arrays themselves don't get deep-wrapped.
  const fields = shallowReactive<Map<string, Float32Array>>(new Map());
  const hydrating = shallowReactive<Set<string>>(new Set());

  // Event frames — flight mode changes, RX events, etc. Drives the EventTrack.
  const events = shallowRef<EventFrame[]>([]);

  async function loadFile(input: File | string) {
    scanning.value = true;
    scanProgress.value = 0;

    const handle = await client.openSource(input); // File on web, path on Tauri
    scanReport.value = await client.scan(handle, (n) => { scanProgress.value = n; });

    time.value = scanReport.value.time;
    events.value = scanReport.value.events;
    scanning.value = false;
  }

  async function ensureFields(names: string[]) {
    const missing = names.filter((n) => !fields.has(n) && !hydrating.has(n));
    if (missing.length === 0) return;
    missing.forEach((n) => hydrating.add(n));
    const hydrated = await client.hydrate(missing);
    for (const [name, arr] of hydrated) {
      fields.set(name, arr);
      hydrating.delete(name);
    }
  }

  return { scanReport, scanning, scanProgress, time, fields, hydrating, events, loadFile, ensureFields };
});
```

`ensureFields` is what M1.4 workspaces and M2+ modules call. The progress bar binds to `scanProgress` during the scan; per-field spinners bind to `hydrating.has(name)` during hydration.

### File source: web vs Tauri

`platform.ts` detects the runtime. On web, `client.openSource(File)` reads via `arrayBuffer()` (current path). On Tauri, `client.openSource(string)` is a filesystem path and the worker reads via `@tauri-apps/api/fs` (no round-trip through `arrayBuffer`). The component layer doesn't know the difference.

## M1.4 — uPlot time-series + event track

### Time-series

Reads from `useLogStore.fields` (the lazily-hydrated map) and `useLogStore.time`. On workspace activation, the panel calls `logStore.ensureFields([...])` for its declared field set; once `hydrating.size === 0` for those, it builds `[time, field1, field2, ...]` arrays and calls `uPlot.setData()`. Per-field spinners overlay while hydration is in flight.

Three pre-configured workspaces (each declares its required fields):

- **Gyro + setpoint** — `gyroADC[0..2]`, `setpoint[0..2]`
- **PIDFS terms** — `axisP[0..2]`, `axisI[0..2]`, `axisD[0..2]`, `axisF[0..2]`, `axisS[0..2]`
- **Servo outputs** — `servo[0..N]`, plus `motor[0..1]` for diff thrust

Same scrub window stays locked across workspaces.

### Event track

A second uPlot row (or a thin overlay band) renders event-frame markers from `logStore.events`. Event types and visual treatment:

| Event type | Source | Visual |
|---|---|---|
| Arm / Disarm | event-frame stream | Vertical line, green/red |
| Flight mode change | event-frame stream (decoded by `blackbox-log`) | Tick + label ("ANGLE", "MANUAL", etc.) |
| RX loss / failsafe | event-frame stream | Red flag |
| Sync beep / logging start | event-frame stream | Faint tick |

Hover surfaces `{ type, timestamp_s, label }` in a tooltip. The event track shares the scrub-window X axis with the main time-series (`cursor: { sync: ... }` in uPlot). Implementation lives in `components/EventTrack.vue`, with the marker derivation in `lib/eventFrames.ts` (unit-tested via vitest — given a synthetic event-frame array, assert the marker list).

### Shared cursor + recommend-tab infrastructure (added during M1.4)

Two cross-cutting pieces land alongside the time-series so M2+ analytics modules and the eventual Recommend tab slot in cleanly:

- **`CursorProvider`** (in `stores/view.ts`) — holds `{ t: number | null, pinned: boolean, source: string | null }`. uPlot panels read it (sync cursor across all plots), event-chip clicks call `setCursorT(t) + setPinned(true)`, and navigating tabs preserves the pin. The Recommend tab's evidence chips (built later) use the same `setCursorT` to jump every other tab to the moment a recommendation is grounded in.
- **`RecommendCard` / `RecommendList` shell** (`components/RecommendCard.vue`, `components/RecommendList.vue`) — built shell-only against a uniform `ConfidenceResult<T>` shape: severity pill, confidence stamp, title + summary + delta badge, expandable details, CLI block with confidence-gated copy button, dismiss / mark-applied actions. No content wired in M1.4. M2+ modules emit recs into the list; the **`Recommend` tab is hidden from the top tab bar until the rec list is non-empty.**

Domain chip set on the Recommend list: `all / SPA / TPA / Filters / PID / Servo` (M-Servo gets its own domain peer, per the servo-first-class decision — recs there use mixer-channel labels like `Elevon-L` rather than axis indices).

## M1.5 — Header inspector + wing detection with confidence

Header inspector renders all CLI-set parameters from the FC as a searchable table — type `tpa` and filter to TPA-related parameters, etc. This is the **FC configuration view**.

### Wing detection — multi-signal with confidence

A boolean `isWing()` based on mixer name alone is too weak. Mixer string sometimes carries the wing flag clearly (`mixer_type = airplane`), sometimes ambiguously, sometimes not at all. Real classification combines multiple signals.

```ts
// lib/wingDetection.ts
export type WingDetection = {
  isWing: boolean;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];     // human-readable list of what we matched against
};

export function detectWing(
  headers: Record<string, string>,
  fieldNames: string[],
): WingDetection {
  const signals: string[] = [];
  let score = 0;

  // Signal 1: explicit mixer type
  const mixer = (headers['mixer_type'] || headers['mixer'] || '').toLowerCase();
  if (/wing|airplane|plane|flying_wing/.test(mixer)) {
    signals.push(`mixer_type="${mixer}"`);
    score += 3;
  }

  // Signal 2: USE_WING-only fields present
  if (fieldNames.some(n => /^axisS\[\d\]$/.test(n))) {
    signals.push('axisS fields present (USE_WING firmware)');
    score += 3;
  }

  // Signal 3: TPA airspeed parameters set
  if (headers['tpa_curve_type'] || headers['tpa_speed_basic']) {
    signals.push('TPA airspeed parameters configured');
    score += 2;
  }

  // Signal 4: servo-related smix entries
  const smixCount = Object.keys(headers).filter(k => k.startsWith('smix')).length;
  if (smixCount > 0) {
    signals.push(`${smixCount} smix entries`);
    score += 1;
  }

  // Signal 5: typical wing-relevant features enabled
  const features = (headers['features'] || '').toLowerCase();
  if (features.includes('servo_tilt') || features.includes('channel_forwarding')) {
    signals.push('servo-related features enabled');
    score += 1;
  }

  const isWing = score >= 3;
  const confidence: WingDetection['confidence'] =
    score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';

  return { isWing, confidence, signals };
}
```

When `confidence === 'low'`, the UI shows the field-relabel decision with a "verify mapping" warning. When `'high'`, it labels confidently. Honest output beats fake certainty.

### Servo channel labeling

Once wing is detected, `lib/fieldRegistry.ts` maps motor/servo array positions to surface names. The right inputs are:
1. `smix` entries from the header (mixer rules — most authoritative)
2. Resource mapping headers where present
3. Field-name conventions in the decoded frame
4. Fallback heuristic (legacy: `motor[2]+` becomes `servo[0]+`)

Each labeling carries a confidence level surfaced in the UI. A high-confidence relabel doesn't need annotation; a low-confidence one does.

## M1.6 — Log readiness report

**Goal**: classify the loaded log using capability predicates and display which analyses are available, partial, or blocked.

The corpus exists to validate these predicates. The runtime app uses the predicates directly. Corpus class labels never leak into user-facing output.

### Signal registry — source-agnostic resolution

Wing-tuning signals (TPA speed estimate, TPA argument, pre-TPA sTerm, SPA, adjusted setpoint) come from **two possible sources**: the new main-frame `USE_WING` fields shipped in the firmware companion PR (BF 2026.6+) **or** the corresponding pre-PR debug-mode channels. WingTune does **not** gate on the PR landing — each signal is resolved independently against whatever the log actually contains. A user with a BF 2025.x DEBUG_TPA log gets the airspeed auto-tuner; a user with a BF 2026.6+ log gets it without setting a debug mode; a user mid-migration with a partial firmware version still gets every signal that resolved.

```ts
// lib/signalRegistry.ts
export type SignalSource =
  | { kind: 'main_frame'; field: string }
  | { kind: 'debug'; mode: string; channel: number };

export type SignalDef = {
  id: string;                  // logical name, stable across firmware versions
  sources: SignalSource[];     // ordered by preference — first present wins
  scaling: number;             // multiplier applied at hydration to normalize units
  unit: string;
  perAxis?: boolean;           // if true, three logical sub-signals: id+'.0', id+'.1', id+'.2'
};

export const SIGNALS: SignalDef[] = [
  {
    id: 'tpa_speed_est',
    sources: [
      { kind: 'main_frame', field: 'tpaSpeedEst' },         // BF 2026.6+
      { kind: 'debug',      mode: 'TPA', channel: 4 },      // pre-PR
    ],
    scaling: 0.1,                  // both sources scale m/s by ×10 — divide on hydration
    unit: 'm/s',
  },
  {
    id: 'tpa_arg',
    sources: [
      { kind: 'main_frame', field: 'tpaArg' },
      { kind: 'debug',      mode: 'TPA', channel: 5 },
    ],
    scaling: 0.001,
    unit: 'factor',
  },
  {
    id: 's_term_pre_tpa',
    perAxis: true,
    sources: [
      { kind: 'main_frame', field: 'axisSpreTpa' },         // per-axis array
      { kind: 'debug',      mode: 'S_TERM', channel: 0 },   // 0,2,4 — see resolver
    ],
    scaling: 1,
    unit: 'pid units',
  },
  {
    id: 'spa',
    perAxis: true,
    sources: [
      { kind: 'main_frame', field: 'spa' },
      { kind: 'debug',      mode: 'SPA', channel: 0 },      // 0,1,2 — per axis directly
    ],
    scaling: 0.001,
    unit: 'factor',
  },
  {
    id: 'setpoint_adj',
    perAxis: true,
    sources: [
      { kind: 'main_frame', field: 'setpointAdj' },
      { kind: 'debug',      mode: 'WING_SETPOINT', channel: 1 }, // 1,3,5 — odd channels
    ],
    scaling: 1,
    unit: 'deg/s',
  },
];

export type Resolved =
  | { state: 'resolved'; via: 'main_frame' | 'debug'; source: SignalSource }
  | { state: 'inactive'; via: 'main_frame'; source: SignalSource } // field present, sample_check says all-zero
  | { state: 'missing' };

export function resolveSignal(
  signalId: string,
  axis: number | null,
  capability: CapabilityReport,
): Resolved {
  const def = SIGNALS.find(s => s.id === signalId);
  if (!def) throw new Error(`unknown signal ${signalId}`);

  for (const src of def.sources) {
    if (src.kind === 'main_frame') {
      const fieldName = def.perAxis
        ? `${src.field}[${axis}]`     // e.g. axisSpreTpa[0]
        : src.field;
      if (!capability.fieldsPresent.includes(fieldName)) continue;
      if (capability.sampleChecks[fieldName]?.allZero) {
        return { state: 'inactive', via: 'main_frame', source: src };
      }
      return { state: 'resolved', via: 'main_frame', source: src };
    } else {
      if (capability.debugMode !== src.mode) continue;
      const channel = def.perAxis && axis !== null
        ? src.channel + axis * channelStrideFor(src.mode)
        : src.channel;
      if (!capability.fieldsPresent.includes(`debug[${channel}]`)) continue;
      return { state: 'resolved', via: 'debug', source: { ...src, channel } };
    }
  }
  return { state: 'missing' };
}
```

The resolver walks `sources` in order — main-frame first, debug-mode fallback second. `channelStrideFor` knows the per-axis layout of each debug mode (`S_TERM` strides by 2, `SPA` by 1, `WING_SETPOINT` by 2).

Predicates **never** name a debug mode or field directly — they ask the registry. This is the load-bearing invariant: when the firmware PR lands, predicate code does not change. Only the corpus grows to include new main-frame-sourced fixtures.

### Three-state field handling

Field presence alone isn't enough. We need:

| State | Meaning | UI message |
|---|---|---|
| **Missing** | Field not in main frame definition | "✗ Yaw PIDFS unavailable (axisS[2] missing)" |
| **Present, all zero** | Field logged but always 0 across the log | "⚠ Yaw S-term inactive in this log (axisS[2] always 0 — S gain likely disabled)" |
| **Present, nonzero** | Field logged with content | "✓ Yaw PIDFS available" |

This distinction matters: `axisS[2]` missing means the firmware doesn't log it; `axisS[2] === 0` everywhere means it's logged but unused. Different messages.

The parser's `sample_check` capability metadata helps here — when the WASM wrapper builds the capability report, it samples N frames per field and records `all_zero` / `has_content` flags.

### `lib/capabilityPredicates.ts`

```ts
import { resolveSignal } from './signalRegistry';

export type CapabilityState = 'available' | 'partial' | 'inactive' | 'blocked';

export type Capability = {
  state: CapabilityState;
  reason?: string;
  via?: 'main_frame' | 'debug' | 'mixed';   // informational, surfaced in UI
};

export type ModuleReport = {
  basicViewing: Capability;
  pidfsDecomp: { roll: Capability; pitch: Capability; yaw: Capability };
  airspeedAutoTune: Capability;
  tpaCurveFit: Capability;
  spaEffectiveness: { roll: Capability; pitch: Capability; yaw: Capability };
  sTermTpaViz: { roll: Capability; pitch: Capability; yaw: Capability };
};

export function checkPidfs(axis: number, capability: CapabilityReport): Capability {
  // axisS post-TPA is already a main-frame field in current master — no fallback.
  const fieldName = `axisS[${axis}]`;
  if (!capability.fieldsPresent.includes(fieldName)) {
    return { state: 'partial', reason: `axisS[${axis}] not logged — PIDF decomposition only` };
  }
  if (capability.sampleChecks[fieldName]?.allZero) {
    return { state: 'inactive', reason: `axisS[${axis}] always 0 — S gain likely disabled` };
  }
  return { state: 'available', via: 'main_frame' };
}

export function checkAirspeedAutoTune(capability: CapabilityReport): Capability {
  const speed = resolveSignal('tpa_speed_est', null, capability);
  const arg   = resolveSignal('tpa_arg',       null, capability);

  if (speed.state === 'missing' || arg.state === 'missing') {
    return {
      state: 'blocked',
      reason: 'TPA signals not present. Need main-frame `tpaSpeedEst`/`tpaArg` (BF 2026.6+) or `debug_mode = TPA`.',
    };
  }
  if (!capability.gpsPresent) {
    return { state: 'blocked', reason: 'GPS data not present in log' };
  }
  return {
    state: 'available',
    via: speed.via === arg.via ? speed.via : 'mixed',
  };
}

export function checkSpa(axis: number, capability: CapabilityReport): Capability {
  const spa = resolveSignal('spa', axis, capability);
  const adj = resolveSignal('setpoint_adj', axis, capability);

  if (spa.state === 'missing' && adj.state === 'missing') {
    return { state: 'blocked', reason: `axis ${axis}: no SPA signals via main-frame or debug` };
  }
  if (spa.state === 'inactive') {
    return { state: 'inactive', reason: `axis ${axis}: SPA disabled (spa_mode off)` };
  }
  if (spa.state === 'resolved' && adj.state === 'resolved') {
    return { state: 'available', via: spa.via === adj.via ? spa.via : 'mixed' };
  }
  return { state: 'partial', reason: `axis ${axis}: only one of (spa, setpoint_adj) is resolvable` };
}

// sTermTpaViz, tpaCurveFit similar — all route through resolveSignal.
```

The same predicate functions get called from `validate-parser` against the corpus (verifying each log's expectations match) and from `ReadinessReport.vue` against the user's loaded log. **Note that predicates never name a debug mode or main-frame field directly** — that knowledge lives in `signalRegistry.ts`. When the firmware companion PR lands, predicate code doesn't change.

### Render

```
This log supports:
  ✓ Basic time-series viewing
  ✓ PIDFS decomposition: roll
  ✓ PIDFS decomposition: pitch
  ⚠ PIDFS decomposition: yaw (axisS[2] always 0 — S gain likely disabled)
  ✓ Airspeed auto-tune                    (via main-frame fields)
  ✓ SPA effectiveness: roll               (via debug_mode = SPA)
  ⚠ SPA effectiveness: pitch              (only spa[1] resolvable, setpoint_adj missing)
  ✓ S-term TPA effectiveness: all axes    (via debug_mode = S_TERM)
  ✗ TPA curve fit                         (need TPA signals — none resolved)
```

The four states (`available`, `partial`, `inactive`, `blocked`) get four icons (✓ ⚠ ⚠ ✗) — partial and inactive both warn but for different reasons, blocked is hard-stop. The trailing `(via ...)` note shows which source resolved (main-frame, debug, or `mixed` when sub-signals resolved differently). The user can also expand each row to see a "what would unlock this" hint (e.g. "fly with `set debug_mode = TPA` and a GPS-equipped airframe" for the blocked case).

The same log on BF 2026.6+ firmware would render identically except the `(via ...)` notes shift to `main-frame fields` — no flight pattern change required.

## M1.7 — Multi-log + session persistence

Multi-log support and named-session save/load. Earlier revs framed this as a separate "campaign mode" UI; that's gone — there is no modal `CompareView.vue`, no separate campaign route. The needs are real but better expressed as **additive features on existing surfaces** plus a persistence layer.

### What lands here

1. **Multi-log loading in the existing time-series view.** Drop a second `.bbl` while a log is loaded → it appears alongside, not in place of. Paired color scheme per log (warm family for log A, cool for log B, distinct hues per axis within each).
2. **Log picker.** When N ≥ 3, paired-colors alone gets unreadable — the time-series toolbar grows a per-log show/hide control (checkboxes or tabs). Below N = 3 it's hidden.
3. **Time alignment toggle.** A toolbar control with three options: `absolute` (each log on its own t=0), `first-arm` (each log re-zeroed at its first ARM event), `first-mode-change` (re-zeroed at first flight-mode transition). **Not a one-line toggle** — it's a transform on the X axis: scrub window in aligned space, tooltips show both aligned and absolute timestamps, event-track markers shift with the alignment. Implementation cost is the bulk of M1.7.
4. **Tuning diff side panel.** Opens from any view when ≥ 2 logs are loaded. Shows a curated set of **main tuning parameters** (P/I/D/F/S per axis, TPA mode + curve + speed params, SPA mode + center/width per axis, rates, filter cutoffs — order of ~30 parameters) across all loaded logs, with diffs highlighted. **Not** a 200-row dump of every header field; the full-matrix view is post-M7 (see roadmap backlog: "Tuning history matrix"). Lives in `components/TuningDiffPanel.vue`.
5. **Session save/load.** A session is a named bundle: a list of loaded logs (by path on Tauri, by stored `File` reference on web) plus active workspace + time-alignment state. Saved as `<name>.session.json`.
   - **Tauri target**: written to disk via the standard save dialog, defaulting next to the most recently loaded `.bbl`. Reloading via open dialog or file association.
   - **Web target**: serialized into IndexedDB keyed by session name. Logs themselves aren't persisted — on reload the user gets a prompt to re-drop the files referenced in the session.
6. **Unioned readiness in the report.** When multiple logs are loaded, the readiness report shows per-module coverage across logs ("M3 runnable on 2 of 3 logs; via debug on flight 1, via main-frame on flight 2"). When only one log is loaded, the report renders unchanged from M1.6.

### What does NOT land here

- A dedicated `CompareView.vue` or `/compare` route. **There is no separate compare surface.**
- A full parameter-matrix view (parameters × flights as a sortable table with N logs). Tracked as post-M7 backlog item "Tuning history matrix" — defer until M1 is actually being used on a real tuning sequence and the right column/row controls become obvious from use.

### Store sketch

```ts
// stores/session.ts
//
// "Session" is the persistence concept — a named bundle of loaded logs plus
// view state. Replaces the earlier `campaign.ts` concept; same underlying
// data, no implied UI mode.
export const useSessionStore = defineStore('session', () => {
  const logs = shallowReactive<Map<string, LogHandle>>(new Map());
  const sessionName = ref<string | null>(null);
  const dirty = ref(false);

  function addLog(handle: LogHandle) { logs.set(handle.id, handle); dirty.value = true; }
  function removeLog(id: string) { logs.delete(id); dirty.value = true; }

  // Unioned readiness across all loaded logs — drives the multi-log readiness report.
  // Returns per-module coverage: { resolvedCount, totalLogs, perLog: [{ id, capability }] }
  function unionedReadiness(): MultiLogReport { /* … */ }

  async function save(path: string) { /* serialize logs[].id + view state */ dirty.value = false; }
  async function load(path: string) { /* hydrate handles, prompt for missing files on web */ }
  return { logs, sessionName, dirty, addLog, removeLog, unionedReadiness, save, load };
});
```

The existing `log.ts` store remains the active-log focus (single log under primary scrub). `session.ts` is the multi-log container; the time-series view reads from both — `log.ts` for the focus log, `session.ts` for any siblings overlaid.

### Time-alignment implementation note

The alignment transform lives in `src/lib/timeAlignment.ts`:

```ts
export type AlignmentMode = 'absolute' | 'first-arm' | 'first-mode-change';

// Returns the offset to subtract from a log's native time axis to place it in
// the aligned coordinate system. For 'absolute' returns 0. For event-based
// alignments returns the event's seconds-since-log-start.
export function alignmentOffset(log: LogHandle, mode: AlignmentMode): number;
```

uPlot consumes `time - offset` rather than `time` when rendering in aligned mode. Event-track markers do the same. The store holds the mode; the chart components apply the offset on each draw.

### Persistence file format (sketch)

```json
{
  "version": 1,
  "name": "p-roll tuning 2026-05-12",
  "logs": [
    { "id": "abc123", "path": "/path/to/flight-1.bbl", "label": "stock" },
    { "id": "def456", "path": "/path/to/flight-2.bbl", "label": "P+10%" },
    { "id": "ghi789", "path": "/path/to/flight-3.bbl", "label": "P+10%, D+15%" }
  ],
  "activeLogId": "ghi789",
  "activeWorkspaceId": "pidfsTerms",
  "alignmentMode": "first-arm"
}
```

`label` is user-editable per log — the diff panel renders these as column headers. Path is absolute on Tauri, opaque ID on web (user re-drops on reload).

## Exit criteria for M1

- [ ] M1.0 corpus has at least one log per class, all decode cleanly via `npm run corpus:validate`
- [ ] `axisS[0..2]` confirmed present in PIDFS-complete corpus logs
- [ ] `npm run dev` brings up a working app from a clean checkout (web target)
- [ ] **`npm run tauri:dev` brings up the desktop app from the same source**
- [ ] Drop a `.BBL` (web) or open via dialog (Tauri), see scan progress within a second
- [ ] **A large log (100–300 MB, or your largest real-world wing log) scans without freezing the UI; first workspace renders within ~2 s of scan completion; switching workspaces hydrates the new fields with a visible spinner and finishes in order-of-seconds**
- [ ] **Time-series uses `Float32Array` values and `Float32Array` time-since-start; no `Float64Array` allocations on the hot path** (assert via heap snapshot or a `npm run test:unit` perf test)
- [ ] **Event track renders ARM/DISARM, flight-mode changes, and any RX events present in the log**
- [ ] Header inspector shows all CLI parameters, searchable
- [ ] Wing detection surfaces confidence level alongside the detection result
- [ ] Readiness report classifies the loaded log with three-state field handling
- [ ] Three workspace presets work (gyro+setpoint, PIDFS terms, servo outputs)
- [ ] App deploys as a static site **and** Tauri produces unsigned bundles on all three platforms (CI smoke)
- [ ] Bundled sample log loads on first run (GPS-scrubbed)
- [ ] **Multi-log (M1.7): dropping a second `.bbl` while a log is loaded adds it alongside (not in place of), with paired colors in the time-series view**
- [ ] **Log picker visible when N ≥ 3 loaded; hidden when N ≤ 2**
- [ ] **Time alignment toggle works for all three modes (`absolute`, `first-arm`, `first-mode-change`); event-track markers shift with alignment**
- [ ] **Tuning diff side panel opens from any view when ≥ 2 logs loaded; renders the curated main-parameter set with diffs highlighted; does NOT render the long-tail of every header field (that's the post-M7 matrix view)**
- [ ] **Session save/load round-trips: save a 3-log session, close the app, reload it, get back to the same view state. Tauri target writes to disk; web target uses IndexedDB + re-drop prompt**
- [ ] **Readiness report unions correctly across multiple loaded logs ("M3 runnable on 2 of 3 logs"); falls back to single-log rendering when N = 1**
- [ ] **`npm run test:unit` and `npm run test:wasm` both green in CI**
- [ ] **CI workflow runs build + Rust tests + JS unit tests + WASM binding test + corpus validation on every push, plus a Tauri build smoke on the 3-OS matrix**

Once those are checked, M2 (PIDFS quick decomposition) is the next milestone. The **firmware companion PR** (see roadmap) is a parallel track — landing it for BF 2026.6 doesn't gate M2, but it does materially expand the corpus of "runnable" logs once it ships.

## Open M1 decisions

- **Component library**: Nuxt UI standalone vs Configurator-style custom Vue SFCs? Defer until you've eyeballed Configurator's current Vue tabs.
- **Devcontainer?** Lean: yes — dual toolchain (Rust + Node) plus Tauri's per-OS native deps plus Vite version churn make it more valuable than usual.
- **Hosted demo + Tauri?** Resolved: both, from the same source.
- **Field aliases for servos**: dynamic from header `smix` entries, with confidence levels per the wing-detection pattern above.
- **`justfile` or `npm scripts`?** Lean: npm scripts for now.
- **Hydration cache size cap**: defaults to 256 MB; expose as a setting in `view.ts`.
- **Event-track placement**: separate uPlot row vs overlay band on the time-series? Lean: separate row, easier to make hover-tooltips work reliably.

## Reference links

- `blackbox-log` docs: https://docs.rs/blackbox-log
- `blackbox-log` repo: https://github.com/blackbox-log/blackbox-log
- `wasm-pack` book: https://rustwasm.github.io/wasm-pack/book/
- `wasm-bindgen` guide: https://rustwasm.github.io/wasm-bindgen/
- Vite WASM plugin: https://github.com/Menci/vite-plugin-wasm
- Vue 3 Composition API: https://vuejs.org/guide/extras/composition-api-faq.html
- Pinia docs: https://pinia.vuejs.org/
- `shallowRef` reference: https://vuejs.org/api/reactivity-advanced.html#shallowref
- uPlot demos: https://leeoniya.github.io/uPlot/demos/
- Tauri docs: https://tauri.app/v2/
- Vitest: https://vitest.dev/
- BF Configurator Vue tabs: https://github.com/betaflight/betaflight-configurator/tree/master/src/components/tabs

---

*Owner: Brian. rev 11 — M1.0 adds a Parser support track: fork blackbox-log, patch override at the workspace root, parallel upstream PR. WingTune development does not gate on the upstream merge.*
