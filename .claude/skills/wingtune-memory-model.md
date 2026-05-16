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

## Invariant 3: Workspaces declare fields

A workspace (PIDFS view, servo view, gyro+setpoint view, etc.) is the unit of
"what the user is currently looking at." Each workspace **declares its field
list** as part of its definition. The log store hydrates exactly that list
when the workspace activates.

```ts
// src/stores/workspace.ts
const workspaces: Record<string, Workspace> = {
  gyroSetpoint: {
    label: 'Gyro + setpoint',
    requiredFields: [
      'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]',
      'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
    ],
  },
  pidfsTerms: {
    label: 'PIDFS term decomposition',
    requiredFields: [
      'axisP[0]', 'axisI[0]', 'axisD[0]', 'axisF[0]', 'axisS[0]',
      'axisP[1]', 'axisI[1]', 'axisD[1]', 'axisF[1]', 'axisS[1]',
      'axisP[2]', 'axisI[2]', 'axisD[2]', 'axisF[2]', 'axisS[2]',
    ],
  },
  // …
};
```

When the user switches workspaces, the log store:
1. Computes the set difference — fields needed but not yet hydrated
2. Hydrates only those (visible spinner during this)
3. Optionally evicts fields no longer needed if total hydrated size is over cap

Analysis modules in Layer 2 follow the same contract: each module exports its
`requiredFields` list, the runner hydrates those before invoking the analysis.

## Reactivity: shallowRef for typed arrays

Vue 3's default `ref` deeply proxies the contained value. For a 50 MB
`Float32Array`, this is catastrophic — Vue will try to wrap every element in a
Proxy. The tab will hang and may crash.

Always use `shallowRef` for stores holding typed-array log data:

```ts
// ✓ good
import { shallowRef } from 'vue';
const gyroX = shallowRef<Float32Array | null>(null);
gyroX.value = new Float32Array(frameCount); // single reactive write

// ✗ catastrophic — Vue will try to deeply proxy a 50 MB array
import { ref } from 'vue';
const gyroX = ref<Float32Array | null>(null);
gyroX.value = new Float32Array(frameCount);
```

Same applies to the time axis, hydrated field maps, byte buffers, and any
non-trivial structure held in store state. When in doubt, prefer `shallowRef`
and reassign the whole value rather than mutating in place — uPlot redraws on
reassignment cleanly.

See `wingtune-vue-conventions` for the broader store-layout patterns.

## Cache cap (soft)

Hydrated fields live in a Map keyed by field name. Total bytes across the Map
has a soft cap, defaulting to **256 MB**, exposed as a setting in
`src/stores/view.ts`. When a workspace activates and total hydrated size would
exceed the cap:

1. Identify fields not required by any currently-active workspace (in multi-log
   sessions this means "any loaded log's active workspace")
2. Evict them in LRU order until under the cap
3. If still over cap after evicting all evictable fields, warn the user but
   proceed — the active workspace's declared fields are sacred and never
   evicted

Eviction is a hint, not a correctness mechanism. A re-activated workspace just
re-hydrates from the parser using the frame index — no data loss, only a
spinner.

> Note: cache eviction is an M1.3 deliverable. Early prototypes can defer the
> eviction policy and rely on the cap as a warning only. Don't ship the M1
> exit criteria without the eviction path working, though — large logs need
> it.

## What Claude Code might want to do but should not

- **"While we're decoding `axisP[0]`, may as well decode `axisP[1]` and `axisP[2]` too."** No. Hydrate exactly what's declared. Multi-axis grouping decisions belong in the workspace's `requiredFields` list, not in the hydration path.
- **"Convert this `Number[]` to `Float32Array` at the end."** No. Allocate the `Float32Array` up front, write into it during decode. The intermediate `Number[]` is itself the memory blowup we're avoiding.
- **"Cache all hydrated fields forever to avoid re-decoding."** No. The cap exists for a reason; eviction is cheap (re-decode from frame index), exhaustion is not.
- **"Use absolute Unix timestamps for the time axis."** No. Seconds-since-log-start as `Float32Array`. Absolute timestamps lose sub-millisecond precision in Float32 within an hour of uptime.
- **"This component just needs the raw array, let's put it in a `ref`."** No. `shallowRef`, always, for typed-array log data.
- **"Let me cache the decoded field in a module-level variable so it persists across imports."** No. Hydrated state belongs in a Pinia store, where the cache policy can see and manage it.

## Quick self-check before committing

- [ ] Any `new Float64Array(` or bare `new Array(` for a field-shaped allocation? Replace with `Float32Array`.
- [ ] Any field decode happening at end-of-scan rather than on workspace demand? Move to lazy hydration.
- [ ] Any workspace or analysis module that doesn't declare its `requiredFields`? Add the declaration.
- [ ] Any `ref(typedArray)` in a store or component? Change to `shallowRef`.
- [ ] Any new field cache outside the central store? Either fold it in or document why it can't be.
- [ ] Time axis stored as anything other than `Float32Array` of seconds-since-start? Change it.

If any answer is "yes" without a `// MEMORY-EXCEPTION:` comment explaining why,
the memory model is leaking — fix it before merging. The M1 large-log exit
criterion (100–300 MB scans without freezing) depends on every one of these
holding.
