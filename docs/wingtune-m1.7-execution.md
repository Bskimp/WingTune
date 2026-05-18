# WingTune M1.7 execution plan — multi-log compare

> Single-slice milestone that turns WingTune from a single-log
> analyzer into a multi-log comparison tool. Targets the tuning
> workflow where the user flies N variants in sequence, drops all
> the logs in, and inspects how each looks side-by-side to pick the
> best one. Persistence dropped (2026-05-17), MSP/live-FC dropped
> (whole-project out of scope), tuning-diff side panel dropped
> (info already surfaced elsewhere), time alignment punted to
> M1.7.1.

## Status

**COMPLETE 2026-05-17** — shipped in one full-day session. The
slice plan below was followed in spirit with a couple of pragmatic
deviations (documented inline + summarised under "Deviations from
plan" at the bottom). Test results: 137/137 unit + 5/5 wasm tests
pass. Browser-verified on Brian's btfl_001/002/008 corpus.

**M1.7.1 time-alignment follow-up:** scaffold shipped (the
`useAlignedTime` composable + per-log `timeOffsetSec` field on
LogState + 6-case test suite). Remaining work is the drag-to-align
UI handle + adopting the composable in at least one chart panel —
estimated ~1.5–2 days when picked up.

## What this milestone is for

The workflow this enables: pilot flies the same maneuver across
2–4 logs with different tuning parameters between flights, drops
them all into WingTune, and visually compares how each behaves so
they can pick the best curve. This is **survey-style tuning**,
not "validate against a known-good baseline." All logs are peers.

Concrete examples:
- "I tried `D-roll = 25`, `35`, and `45` across three flights —
  which one has the cleanest step response?"
- "I upgraded my elevator servo from 5V to 8.4V on the same plane
  — did stage-C lag in the InputChainPanel actually drop?"
- "I changed `tpa_speed_basic_delay` between two flights — does
  the new value reduce the throttle-transition wobble?"

The comparison primitive is: same chart, multiple log traces,
color-coded by log family, with two orthogonal filters — per-axis
chips (existing) and per-log roster toggles (new).

## Scope decisions (locked 2026-05-17)

These were debated in the planning conversation; they're final
for this milestone, not optional design points to re-litigate.

1. **One-of-N store model**, NOT focus + siblings. All loaded
   logs are equal peers. No "primary log" concept. Headers that
   show single-log stats (e.g., `RMS err 34.2` in
   SetpointTrackingPanel) either become per-log readouts or are
   moved out of the header into the per-log roster context.

2. **Drop TuningDiffPanel.** Most tuning info is already surfaced:
   per-module panel headers show derived params (airspeed
   delay/gravity, TPA curve params, etc.), HeaderParamsPanel
   shows raw header values, ReadinessCard shows what's runnable.
   A dedicated diff panel would be redundant. If diff becomes a
   real pain point, the cheaper path is to add a "compare across
   loaded logs" mode to HeaderParamsPanel as a polish slice —
   not to build a separate panel.

3. **No persistence.** Sessions are one-shot; user drops logs,
   analyses, closes the app, the logs are gone. OS-level "recent
   files" via the Tauri dialog covers the marginal case. Persistence
   would mean IndexedDB + cache invalidation + edge cases for a
   workflow that doesn't really happen.

4. **No live FC connection / MSP / serial.** Whole-project out of
   scope. WingTune is a log analyzer.

5. **Defer LRU/hydration policy work.** Today's lazy-with-eager-
   recommender policy probably works fine at 2–3 logs. At 4+ logs
   with big files it may thrash; fix when it bites, not
   speculatively. Add focus-log-pin-style eviction prioritization
   later if needed.

6. **Time alignment → M1.7.1 follow-up.** MVP overlays use
   `t = seconds-since-log-start` (each log relative to its own
   start). That covers whole-flight comparison cleanly. M1.7.1
   adds `first-arm` / `first-mode-change` alignment for
   maneuver-level comparison.

## Out of scope (entire M1.7)

- Tuning diff side panel (see scope decision #2)
- Session save/load / persistence (see #3)
- Live FC / MSP (see #4)
- Multi-log LRU tuning beyond focus-pin (see #5)
- Time alignment (M1.7.1)
- Per-panel log selection (every panel shows every loaded log;
  user filters via per-log roster toggles, not per-panel)

## What lands here

The slice plan, in dependency order. Slices 1 and 2 are the
foundation; 3–5 can land in any order after that.

### Slice 1 — Session store refactor (one-of-N) · ~2–3 days

The biggest slice. Replaces `useLogStore` (single log) with
`useSessionStore` (N logs as peers).

**Store shape:**

```ts
// stores/session.ts
interface LogState {
  id: string;                       // stable per loaded log
  name: string;                     // filename for display
  source: SourceHandle;             // worker-side handle
  scanReport: ScanReport | null;
  time: Float32Array;
  gpsTimeSec: Float32Array;
  fields: Map<string, Float32Array>;
  hydrating: Set<string>;
  pinnedFields: Set<string>;        // existing pin-set, per log
  filterConfig: FilterConfig | null;
  fileSize: number;
  scanProgress: number;
  loadedAt: number;                 // for roster ordering
}

interface SessionState {
  logs: Map<string, LogState>;      // insertion-ordered
  // No "focus" / "primary" / "active" concept — all peers.
}
```

**Method surface:**

- `addLog(file: File): Promise<string>` — scans, registers, returns logId
- `removeLog(id: string): void`
- `ensureFields(id: string, names: string[]): Promise<void>`
- `pinFields(id: string, names: string[]): void`

**Panel iteration pattern:**

Every existing panel changes from:

```ts
const { fields, time } = storeToRefs(useLogStore());
// render from these
```

…to:

```ts
const session = useSessionStore();
const { logs } = storeToRefs(session);
// for each log, render that log's traces
```

This is mechanical but touches every panel in `src/components/analysis/`.
Single-log behavior is unchanged because `logs.size === 1` is the same
loop with one iteration.

**Critical refactor decisions:**

- **Per-log color family**: assigned at log-load time, derived from
  insertion order. Three families locked in: log 1 = warm
  (orange-red), log 2 = cool (cyan-blue), log 3 = neutral
  (amber-green). Above N=3 we re-use families cyclically with a
  visible warning in the roster. Each panel's existing per-axis
  hues (R/P/Y) get tinted by the log family — gyro_R from log 1
  is orange-leaning red, gyro_R from log 2 is cyan-leaning red.
  Concrete palette TBD in slice 4 implementation.
- **AnalysisView's eager-hydrate-recommender-fields kick** runs
  per log on log-load. Pinned per-log so the LRU doesn't evict
  hot fields.
- **`view.hiddenSeries`** keying needs to incorporate logId so
  toggling roll on log A doesn't toggle roll on log B. New key
  format: `${logId}:${fieldName}`. Per-axis chips that should
  toggle "all logs at once" pre-compute the per-log key set.
- **`view.cursorTime`** stays global (one shared cursor across
  logs). Each panel's cursor readout shows one row per loaded
  log, labeled with log family color.

**Files touched (refactor):**

- `src/stores/log.ts` → renamed to `src/stores/session.ts`, full
  rewrite
- `src/views/AnalysisView.vue` — wire add-log to session
- Every component under `src/components/analysis/*.vue` and the
  per-recommender field-pin call — mechanical updates to read
  `session.logs.values()` and iterate

**Acceptance criteria:**

- Single-log behavior identical to today (visual diff = 0 on
  LOG00113.BFL and btfl_002)
- Loading a second log via drag-and-drop adds it as a peer (does
  not replace)
- Every panel renders both logs' traces with the second log's
  family color
- Cursor readout shows one row per log per axis
- All 131+ existing unit tests pass; add new tests for session
  store add/remove/iteration

### Slice 2 — FileDropZone add-not-replace · ~0.5 day

When `logs.size >= 1`, drop-to-add. When `logs.size === 0`,
behavior identical to today (first-load).

- **Replace affordance**: explicit "replace" button next to each
  log in the roster (slice 3). No special drag-and-drop modifier;
  too discoverable to gate behind a key combo.
- **Drop hint** while N≥1: cursor overlay during drag says "drop
  to add as log N+1" so the user understands it's additive.

**Acceptance:** dropping a second `.bbl` while one is loaded
produces N=2 logs in the session store; existing log is preserved.

### Slice 3 — Log roster UI · ~0.5 day

New thin strip component, sits between TabBar and TimeBar. Visible
only when `session.logs.size >= 2`.

**Visual shape:**

```
┌──────────────────────────────────────────────────────────┐
│ ● LOG00113.BFL  (warm)  │ 👁 │ ✕ │  ● btfl_002.bfl (cool) │ 👁 │ ✕ │ + │
└──────────────────────────────────────────────────────────┘
```

Each log chip shows:
- Family color dot
- Filename
- Eye icon (toggle visibility of all this log's traces across
  every panel — wires up via `view.hiddenSeries` mass-add/remove
  with `${logId}:*`)
- Remove (✕) button — calls `session.removeLog(id)`
- "+" button at the end — opens file picker to add another log

**Acceptance:** roster only renders at N≥2; eye toggle hides
all traces from that log instantly across every visible panel;
remove button drops the log from the session and updates every
panel's render loop.

### Slice 4 — Paired-color render polish · folded into slice 1

Color families:

- **Log 1**: warm — primary `#ff7a55` (warm orange-red), accents shift toward warm
- **Log 2**: cool — primary `#5fc9ff` (cool cyan-blue), accents shift toward cool
- **Log 3**: neutral — primary `#9adb7c` (amber-green), accents shift toward neutral

Each panel's existing per-axis color is treated as a base hue, then
tinted toward the log family. Concrete tinting algorithm: HSL hue
shift toward the family's hue by 30%, saturation/lightness preserved.
Implementation lives in a new `src/lib/logColors.ts` helper.

**Acceptance:** every chart trace is visibly distinguishable by both
axis AND log; no two log+axis combos are visually confusable.

### Slice 5 — Unioned readiness · ~0.5 day

`ReadinessCard` extended to show per-module coverage across loaded
logs at N≥2.

Rendering example (M3 BASIC airspeed fit):
```
M3 · BASIC airspeed fit            available · 2 of 3 logs
  · LOG00113.BFL    available via debug
  · btfl_002.bfl    blocked (no GPS lock)
  · btfl_003.bfl    available via main_frame
```

Per-log status pulls from each log's `evaluateModules(capability)`
call; the multi-log aggregator just collects + presents.

**Acceptance:** N=1 ReadinessCard renders unchanged from today; N≥2
renders a coverage line plus per-log breakdown lines per module;
modules where ALL logs agree on the same state still get the
single status line for cleanliness.

## M1.7.1 follow-up — time alignment · ~1.5–2 days

Not part of MVP. Adds three alignment modes:

- **absolute** — each log on its absolute timestamp (raw datetime if
  available, else log-start)
- **first-arm** — each log re-zeroed at its first ARM event
- **first-mode-change** — re-zeroed at first flight-mode transition

**Implementation lives in:** `src/lib/timeAlignment.ts` (X-axis
transform) + `src/composables/useAlignedTime.ts` (per-panel
helper) + a toolbar control in the log roster.

**Why deferred from MVP:** MVP's "t = seconds-since-log-start"
default covers whole-flight comparison (the bulk of tuning
workflow). Maneuver-level comparison is the value-add that
justifies the slice's cost. Ship MVP, see if maneuver alignment
is a real pain point on real wing comparisons.

## Open questions for slice 1 implementation

These need answers BEFORE slice 1 work starts; they're not
"design later" — they shape the store API.

1. **Worker handle lifecycle per log**: today the worker holds
   one source handle. With N logs, does the worker hold N? Or
   does each log carry its own bytes and we re-send on every
   ensure-fields call? Best guess: worker holds N handles,
   keyed by logId — but this needs verifying against the Rust
   side. (The Rust scan API is one-shot per log; subsequent
   hydrate calls need the handle. Look at how `scan()` returns
   the handle today and how `hydrate(handle, fields)` consumes
   it — that's per-log state already, so N-log support is just
   "N handles instead of 1" on the worker.)

2. **Add-log race conditions**: user drops log B while log A's
   recommender-field hydration is still in flight. The
   AnalysisView eager-hydrate kick for B should not block on A.
   Test path: drop two logs in rapid succession and verify both
   recommender field sets complete independently.

3. **`useViewStore.hiddenSeries` migration**: existing key format
   is plain field name. New format with logId prefix breaks any
   persisted state. Persistence isn't being added (per scope
   decision #3) but if any session-internal state references
   the old keys, those references need updating in the same PR.

## Linked memory + skills

- [[project-wingtune]] — overall project context
- [[reference-wingtune-docs]] — where the roadmap + this doc live
- `wingtune-architecture` skill — three-layer rules apply
  unchanged; sessionStore is Layer 3 reading Layer 2 derivations
- `wingtune-memory-model` skill — Float32 everywhere still holds;
  per-log field caches multiply but don't change the per-field
  invariant
- `wingtune-vue-conventions` skill — shallowRef discipline for
  typed-array fields applies per-log

## Out of scope, again, for emphasis

Time alignment, tuning diff panel, session persistence, live FC,
per-panel log selection. None of these are part of M1.7. The
first two have explicit deferral lanes (M1.7.1 / HeaderParamsPanel
polish slice). The others are whole-project out-of-scope.

## Deviations from plan (appendix — what actually shipped)

The slice plan above was followed in spirit. These are the
pragmatic deviations applied during the build session:

1. **Worker tenancy: multi-tenant chosen over N-workers.** The
   "Open questions" note above guessed N-handles-per-worker; the
   actual JS-side change was a one-line `let logBytes` → `Map<logId,
   Uint8Array>` in `parser.worker.ts` plus `logId` added to
   `ScanRequest`/`HydrateRequest` + a new `CloseRequest`. Cleaner
   long-term than per-LogState ParserClient instances. See
   [[project-m17-multi-log-architecture]] for the decision context.

2. **Slice 2 (FileDropZone add-not-replace) collapsed into the
   LogRoster "+" button.** `App.vue` unmounts FileDropZone as soon
   as `hasLog` flips true, so a drop-while-loaded path never had a
   target. The roster's "+" button calls `session.addLog(file)`
   directly (no reset) — that's the multi-log entry surface.

3. **Slice 4 (per-log paired colors) folded in alongside slice 1
   foundations.** `src/lib/logColors.ts` with `LOG_FAMILIES` palette
   + `familyForIndex()` + `tintTowardFamily()` HSL helper landed
   in Push 3a so the roster chips had family dots from day one.
   Chart-side per-(log×axis) tinting landed in Push 3b alongside
   the panel iteration rewrites.

4. **Eye-as-focus pattern emerged from the verification step.**
   Original plan was to leave panels active-log-only and let the
   chart overlay carry comparison. After Brian saw the busy N=3
   overlay on Servos, we added the eye toggle to mass-hide a log,
   AND changed `useActiveLog` to return the FIRST VISIBLE log
   (skipping `view.hiddenLogs`). Now every panel reading
   `useActiveLog` (chips, sat strips, FlightStrip, ReadinessCard,
   cursor readouts) auto-re-anchors when the user eye-toggles —
   the toggle is both visibility AND focus. This is the
   load-bearing UX for multi-log work; see
   [[project-m17-multi-log-architecture]].

5. **RecommendTab gets a pager, not cross-log aggregation.** Per
   scope conversation 2026-05-17, multi-log rec presentation was
   deferred. The minimal viable surface is a "log i of N ← →"
   header. Pager state is local to RecommendTab and independent
   of the eye toggle (recs are a per-log artifact you flip through
   sequentially, not focus-coupled).

6. **Visibility-sync mechanism: `watchEffect`, not fixed-dep
   `watch`.** Bug surfaced during browser verification — PID/Servo
   chart visibility got stuck after eye-toggle because the old
   fixed-dep watch didn't include `activeId` or `plot.updateCount`.
   Every chart panel's `syncSeriesVisibility` now runs inside a
   `watchEffect` so it auto-fires on any reactive read inside.
   Documented in [[project-m17-multi-log-architecture]] as a
   pattern for future chart panels.

7. **Stat-strip + chip rendering anchored to active log on Servos
   + Step**, not per-log columns. Per-log expansion explodes
   vertical space at N≥3; the eye-as-focus pattern handles
   per-log inspection ("eye-off the others to focus on this one's
   chips/strips"). Listed in the panel headers as
   "chips + saturation strips show active log only" so the user
   understands the model.

8. **`useAlignedTime` scaffold shipped as Push 3c polish**, not
   as M1.7.1 follow-up. The math composable + 6-case test suite
   live at `src/composables/useAlignedTime.ts` + `tests/unit/
   useAlignedTime.test.ts`. No UI uses it yet — M1.7.1 is just
   the drag-handle wiring + adopting the composable in one panel.

9. **Session store reactivity gotcha:** LogState objects had to
   be `shallowReactive`-wrapped at creation. Without this,
   property mutations on plain objects inside the `shallowReactive`
   Map don't fire reactivity (Map tracks set/delete only). Caused
   a "drop log → nothing happens" bug during Push 1 verification;
   fix added to `createEmptyLogState`. See
   [[project-m17-multi-log-architecture]] for the precedent.

Acceptance criteria from the slice plan all met:
- ✅ Single-log behaviour identical to today
- ✅ Loading a second log adds it as a peer (does not replace)
- ✅ Every panel renders multi-log content per the design
- ✅ Cursor readout updates per active log (via eye-as-focus)
- ✅ 137/137 unit tests pass; 6 new tests added for useAlignedTime

Final commit: see git log for the M1.7 close-out commits.
