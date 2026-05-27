---
name: wingtune-memory-model
description: WingTune's memory invariants — Float32 throughout, lazy hydration, workspace-declared fields, shallowRef for typed arrays. Use this skill whenever allocating typed arrays, decoding fields from the parser, writing or modifying a Pinia store that holds log data, adding a new workspace or field set, defining a new analysis module's field requirements, or touching any code path under crates/, src/workers/, src/lib/wasm*, or any store that owns hydrated field data. Use it even if the user doesn't mention memory — silently violating any of these invariants breaks the large-log exit criterion, and the failure mode is "browser tab crashes on a 200 MB log," not a small slowdown that gets caught in review.
---

# WingTune memory model

WingTune is built to scan 100–300 MB blackbox logs without freezing the UI or
hitting browser memory caps. Three invariants make that work. Each is
load-bearing — silently violating any of them means the largest real-world
wing logs stop loading.

## Invariant 1: Float32 throughout

All typed-array values are `Float32Array`. The time axis is `Float32Array`
storing seconds-since-log-start (not absolute timestamps, not `Date.now()`-style
millisecond integers).

**Why:** roughly halves peak memory vs Float64 for the same record count. With
100+ MB logs at 500 Hz PID rates, the difference between Float32 and Float64 is
the difference between loading on a 4 GB Chromebook and not loading at all.

**Float32 is precise enough for this domain:**
- Time-since-start: 24-bit mantissa gives ~16 ms resolution at 1 hour uptime,
  far below the 2 ms PID period
- Field values: gyro, setpoint, PIDFS terms, debug channels — all originate as
  16-bit ints or 24-bit fixed point in the firmware. Float32 has headroom.

**Don't use Float64 for:**
- Stored field arrays in any layer
- The time axis
- Intermediate buffers in the hot decode path

**OK to use Float64 for:**
- Scalar return values (a single fitted curve parameter, a confidence number)
- Math constants
- Anything that doesn't live in a typed array on the heap

```ts
// ✓ good
const time = new Float32Array(frameCount);
const gyroX = new Float32Array(frameCount);

// ✗ bad — defaults to Float64
const time = new Array(frameCount);
const gyroX = [];

// ✗ bad — explicit Float64
const time = new Float64Array(frameCount);
```

## Invariant 2: Lazy hydration

The initial scan does NOT materialize per-field typed arrays. It produces:

1. **Capability report** — field presence map, per-field `sample_check` flags
   (all-zero vs has-content), debug mode, GPS present, voltage-sag summary
2. **Frame index** — byte offsets per N frames for fast seeking
3. **Header metadata** — CLI parameter dump, target name, FW version

That's it. No `Float32Array` allocations for `axisP`, `gyroADC`, etc. until a
consumer asks for them.

**Hydration is triggered by:**
- A workspace becoming active and declaring its required fields
- A specific analysis module being run (analytics declares its field list)
- User scrubbing into a range that hasn't been hydrated yet (M2+ behavior)

**Hydration produces only the fields requested.** Convenience expansion ("while
we're at it, decode the sibling axes too") is forbidden — declared fields are
declared, period.

```ts
// ✓ good — workspace declares need, hydration responds
workspace.requiredFields = ['gyroADC[0]', 'gyroADC[1]', 'setpoint[0]', 'setpoint[1]'];
await logStore.hydrate(workspace.requiredFields);

// ✗ bad — eagerly decoding everything at end of scan
function onScanComplete() {
  for (const field of allFields) {
    hydratedFields[field] = decodeField(field);
  }
}

// ✗ bad — silently expanding the declared set
function hydrate(fields: string[]) {
  for (const f of fields) {
    decodeField(f);
    // "helpful" siblings
    if (f.startsWith('axisP[')) decodeField(f.replace('axisP', 'axisI'));
  }
}
```

## Invariant 3: Panels declare fields, AnalysisView eager-pins the recommender set

The original M1 design had a `workspace.ts` store with named workspaces;
that concept got rolled into a simpler two-level pattern during M1.3 +
M1.7:

1. **Per-panel `onMounted` declaration.** Every analysis panel calls
   `logStore.ensureFields([...])` in `onMounted` for the fields it needs
   to render. Hydration is async; the panel renders a pending state
   (`hydrating.value.has(field)`) until the typed arrays arrive.
2. **Recommender-required fields pinned at log load.**
   `src/views/AnalysisView.vue` runs a `watchEffect` over
   `session.logs`; for every freshly-scanned log, it pins the
   `ALL_RECOMMENDER_REQUIRED_FIELDS` set on that log's id, then calls
   `ensureFields(...)` once. The recommender pipeline can fire as soon
   as scan completes, without waiting on any particular panel to mount.

```ts
// In every analysis panel
const REQUIRED_FIELDS = ['rcCommand[0]', 'rcCommand[1]', 'rcCommand[2]'];

onMounted(() => { logStore.ensureFields(REQUIRED_FIELDS); });
```

```ts
// src/views/AnalysisView.vue — eager hydrate for the recommender set
watchEffect(() => {
  for (const log of session.logs.values()) {
    const report = log.scanReport;
    if (!report || eagerlyHydrated.has(log.id)) continue;
    eagerlyHydrated.add(log.id);
    const present = new Set(report.capability.fields_present);
    const wanted = ALL_RECOMMENDER_REQUIRED_FIELDS.filter((f) => present.has(f));
    session.pinFields(log.id, wanted);   // PIN BEFORE HYDRATE — see below
    session.ensureFields(log.id, wanted).catch(() => { /* tolerated */ });
  }
});
```

Convenience expansion ("while we're at it, decode the sibling axes too")
is still forbidden — declared fields are declared, period. The two-level
shape (per-panel + recommender eager-pin) is the *only* extension of the
lazy-hydration cardinal rule.

### `pinFields` MUST run before `ensureFields` for the eager set

The session store's LRU sweep at end-of-`ensureFields` evicts in
insertion order until under the cache cap. If `pinFields(id, set)` runs
*after* `ensureFields(id, set)`, the freshly-hydrated arrays are
evictable during their own first sweep — a thrash window the recommender
pipeline can hit. Pin first, hydrate second. There is one canonical
caller of this pair (AnalysisView's eager loop above); future eager
loaders MUST follow the same order.

## Reactivity: `shallowRef` for typed arrays, `shallowReactive` for the per-log state object

Vue 3's default `ref` and `reactive` deeply proxy their contents. For a
50 MB `Float32Array` this is catastrophic — Vue will try to wrap every
element in a Proxy. The tab will hang and may crash.

Two patterns, each load-bearing for a different shape:

### `shallowRef` for individual typed-array values

```ts
// ✓ good
import { shallowRef } from 'vue';
const gyroX = shallowRef<Float32Array | null>(null);
gyroX.value = new Float32Array(frameCount); // single reactive write

// ✗ catastrophic — Vue tries to deeply proxy a 50 MB array
import { ref } from 'vue';
const gyroX = ref<Float32Array | null>(null);
gyroX.value = new Float32Array(frameCount);
```

### `shallowReactive` for the per-log container object

The session store holds one `LogState` per loaded log — an object whose
fields are a mix of small primitives (id, name, scanProgress,
timeOffsetSec) and typed-array maps (`fields: Map<string, Float32Array>`).
The container itself must be `shallowReactive`, NOT `reactive`:

```ts
// ✓ good
import { shallowReactive } from 'vue';
const log = shallowReactive<LogState>({
  id, name, scanReport: null, time: new Float32Array(0),
  fields: new Map(), hydrating: new Set(),
  timeOffsetSec: 0, /* … */
});
// Post-construction writes fire reactivity:
log.scanReport = report;
log.timeOffsetSec = -0.42;
```

This was a load-bearing latent bug found during M1.7: with `reactive(...)`,
post-construction property writes (`log.scanReport = ...`) didn't fire
reactivity for nested consumers because the proxy was only set up for
properties present at construction time. `shallowReactive` proxies the
container shallowly — every property write fires, the deep typed-array
values stay un-proxied. See `project-m17-multi-log-architecture` memory.

Same applies to anything else with the "container of typed arrays +
status flags" shape — when in doubt, `shallowReactive`.

See `wingtune-vue-conventions` for the broader store-layout patterns.

## Multi-tenant worker: one byte cache per log id

The parser worker is multi-tenant — it holds one
`Map<logId, Uint8Array>` keyed by the session store's per-log id, and
every scan/hydrate/closeLog message carries the id. The session store
calls `closeLog(id)` when a log is removed from the session so the
worker drops its byte buffer; otherwise removed logs would pin their
bytes in worker memory indefinitely.

Two rules fall out:

1. **`logId` is the worker's only addressing.** Any new worker message
   that touches per-log data carries the id. Worker-level shared state
   (filter configs, registry resolutions) is per-id, not global.
2. **`closeLog(id)` is the only cleanup path.** Don't add a "clear all"
   or "reset" message — log lifecycles are independent, the session
   store owns the removal decisions, and a global reset on a multi-log
   session is never the right move.

There is one canonical multi-tenant site (the parser worker) — this is
not an n-of-many pattern, it's a single-location convention. Future
multi-tenant work (e.g. an analysis worker pool, when it lands) must
follow the same `Map<logId, …>` shape unless there's a documented reason
not to.

## Float32 cardinal-rule named exception: aligned time arrays

The cardinal rule is "no `Float64Array` on the hot path." There is one
documented escape: `src/lib/sessionTime.ts`'s `alignedTimeFor()` returns
`Float64Array`. The exception exists because:

```
sessionTime = logTime (Float32) + timeOffsetSec (number)
```

Round-tripping that addition through `Float32Array` makes
`localT = ref[0] - offset` land at e.g. `−2.4e-8` instead of exactly 0
when `offset === −0.60s`. That falls below the log-local axis's `t0 = 0`,
which drops sample 0, which cascades into a blank uPlot chart with no
y-axis labels (uPlot's autorange chokes when sample 0 disappears).

Mitigation: aligned-time arrays are computed in `Float64Array` and
consumed by panels that build per-log aligned x-axes; everything else
(the underlying field data, the per-log raw time axis) stays Float32.

**The exception is named in code** at `src/lib/sessionTime.ts` and pinned
to the alignment path only — DON'T propagate `Float64Array` into anything
else. Any new code that needs the cardinal-rule escape requires a
`// MEMORY-EXCEPTION:` comment with similar rationale, and an update to
this skill in the same commit.

## Rust→JS serialization boundary: `serialize_maps_as_objects(true)`

When the parser returns a Rust map (e.g. `header_params: BTreeMap<String, String>`)
to JS via serde-wasm-bindgen, the default serialization emits a JS `Map`
(not a plain object). That breaks `obj[key]` access and
`Object.entries(obj)` — both silently iterate empty or return undefined.

`crates/wingtune-parser/src/lib.rs` uses a `js_serializer()` helper that
forces `.serialize_maps_as_objects(true)` for both scan + hydrate
outputs. Any new return shape that contains a map must go through the
same helper, not a bare `serde_wasm_bindgen::to_value`.

The failure mode here is silent — there's no type error, just empty data
on the JS side. Caught a real latent bug at M1.5 (HeaderParamsPanel
appeared to load empty); the helper is the canonical fix.

## Cache cap (soft)

Hydrated fields live per-log in `LogState.fields: Map<string, Float32Array>`.
The session store enforces a soft cap (`DEFAULT_FIELD_CACHE_BYTES`,
currently 256 MB) via an LRU sweep at end-of-`ensureFields()`:

1. Sum byte length across every `LogState.fields` map for every loaded log.
2. If over cap, evict in Map insertion order (oldest first) **except** any
   field that's in the per-log pinned set.
3. If still over cap after evicting everything evictable, stop — the
   pinned set is sacred. Pinned fields are typically the
   `ALL_RECOMMENDER_REQUIRED_FIELDS` set installed by `AnalysisView`.

Eviction is a hint, not a correctness mechanism. A re-mounted panel
calls `ensureFields(...)` again and re-hydrates from the parser using
the byte cache in the worker — no data loss, only a brief pending
state.

The pin-before-hydrate ordering (above) is what prevents the LRU sweep
from evicting freshly-hydrated fields during their own first sweep.

## What Claude Code might want to do but should not

- **"While we're decoding `axisP[0]`, may as well decode `axisP[1]` and `axisP[2]` too."** No. Hydrate exactly what's declared. Multi-axis grouping decisions belong in the panel's `REQUIRED_FIELDS` list (or `ALL_RECOMMENDER_REQUIRED_FIELDS` for the eager-hydrate set), not in the hydration path.
- **"Convert this `Number[]` to `Float32Array` at the end."** No. Allocate the `Float32Array` up front, write into it during decode. The intermediate `Number[]` is itself the memory blowup we're avoiding.
- **"Cache all hydrated fields forever to avoid re-decoding."** No. The cap exists for a reason; eviction is cheap (re-decode from frame index), exhaustion is not.
- **"Use absolute Unix timestamps for the time axis."** No. Seconds-since-log-start as `Float32Array`. Absolute timestamps lose sub-millisecond precision in Float32 within an hour of uptime.
- **"This component just needs the raw array, let's put it in a `ref`."** No. `shallowRef`, always, for typed-array log data.
- **"Let me cache the decoded field in a module-level variable so it persists across imports."** No. Hydrated state belongs in a Pinia store, where the cache policy can see and manage it.

## Quick self-check before committing

- [ ] Any `new Float64Array(` or bare `new Array(` for a field-shaped
      allocation outside the named `sessionTime.ts` exception? Replace
      with `Float32Array`.
- [ ] Any field decode happening at end-of-scan rather than via
      `ensureFields(...)` on demand? Move to lazy hydration.
- [ ] Any new panel that doesn't declare its required fields via
      `ensureFields(...)` in `onMounted`? Add it.
- [ ] Any new eager-hydrate loader that calls `ensureFields(...)` before
      `pinFields(...)` for the same set? Swap the order — pin first.
- [ ] Any `ref(typedArray)` in a store or component? Change to `shallowRef`.
- [ ] Any new `LogState`-shaped object (container of typed-array fields
      + status flags) using `reactive(...)` instead of `shallowReactive(...)`?
- [ ] Any new worker message that touches per-log data without carrying
      a `logId`? Add it.
- [ ] Any new Rust→JS return type containing a map that bypasses the
      `js_serializer()` helper? Route it through.
- [ ] Any new field cache outside the session store? Either fold it in
      or document why it can't be.
- [ ] Time axis stored as anything other than `Float32Array` of
      seconds-since-start? Change it.

If any answer is "yes" without a `// MEMORY-EXCEPTION:` comment explaining why,
the memory model is leaking — fix it before merging. The M1 large-log exit
criterion (100–300 MB scans without freezing) depends on every one of these
holding.
