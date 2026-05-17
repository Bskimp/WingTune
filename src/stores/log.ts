// Pinia store for the active log: scan report + Float32 time axis + the
// lazily-hydrated field map. Follows the M1 doc's `wingtune-memory-model`
// rules: `shallowRef` for typed-array data, `shallowReactive` for the
// add/remove-but-don't-deep-proxy field map.

import { defineStore } from 'pinia';
import { ref, shallowReactive, shallowRef } from 'vue';

import {
  ParserClient,
  type EventFrame,
  type ScanReport,
  type SourceHandle,
} from '../lib/wasmBridge';

export const useLogStore = defineStore('log', () => {
  const client = new ParserClient();

  const scanReport = shallowRef<ScanReport | null>(null);
  const scanning = ref(false);
  const scanError = ref<unknown>(null);
  /** Estimated scan progress, 0..100. NOT true byte-level progress —
   *  the Rust scan_log is currently one-shot and doesn't expose a
   *  per-frame callback. This is an animated estimate based on file
   *  size and an empirical ~5 MB/s throughput baseline. Ramps to 95%
   *  over expected duration, then snaps to 100% on actual completion.
   *  Real streaming progress = a future slice (needs Rust callback
   *  threading + WASM rebuild). */
  const scanProgress = ref(0);

  // Float32Array — built by the bridge from the worker's `time_sec`
  // payload at scan time and assigned in one transaction. Per the memory
  // model rule, NEVER `ref(typedArray)` — Vue's deep proxy would wrap
  // every sample.
  const time = shallowRef<Float32Array>(new Float32Array(0));

  // GPS-frame time axis (seconds since first main frame). Populated when
  // a `gps:`-prefixed field is hydrated; stays at length-0 otherwise.
  // GPS fields align to THIS axis, not `time` — analytics modules use
  // `lib/timeAlign.ts:resampleToTimeAxis` to project onto `time`.
  const gpsTimeSec = shallowRef<Float32Array>(new Float32Array(0));

  // Hydrated fields keyed by name. `shallowReactive` so add/remove triggers
  // reactivity without deep-wrapping the typed arrays themselves.
  const fields = shallowReactive<Map<string, Float32Array>>(new Map());
  const hydrating = shallowReactive<Set<string>>(new Set());

  const events = shallowRef<EventFrame[]>([]);

  // Header strings the M1.5 inspector renders. Cheap to keep alongside.
  const firmwareRevision = ref<string | null>(null);
  const firmwareDate = ref<string | null>(null);
  const boardInfo = ref<string | null>(null);
  const craftName = ref<string | null>(null);

  // Source-file metadata the entry-page flight strip renders. `fileName`
  // is the raw `File.name`; `fileSize` is in bytes. `parseTimeMs` is the
  // wall-clock duration of the most recent `scan()` call — surfaced as
  // "parse 824 ms" in the flight strip.
  const fileName = ref<string | null>(null);
  const fileSize = ref<number | null>(null);
  const parseTimeMs = ref<number | null>(null);

  function reset() {
    scanReport.value = null;
    scanError.value = null;
    scanProgress.value = 0;
    time.value = new Float32Array(0);
    gpsTimeSec.value = new Float32Array(0);
    fields.clear();
    hydrating.clear();
    events.value = [];
    firmwareRevision.value = null;
    firmwareDate.value = null;
    boardInfo.value = null;
    craftName.value = null;
    fileName.value = null;
    fileSize.value = null;
    parseTimeMs.value = null;
  }

  /** Empirical scan throughput baseline. Calibrated against btfl_002 +
   *  LOG00113 on a mid-range laptop; real-world variance is wide
   *  enough that the bar will sometimes plateau at 95% before the
   *  real scan finishes (large logs / slower hardware) or hit 95%
   *  early (small logs / fast hardware). Either way it beats
   *  indeterminate. */
  const SCAN_BYTES_PER_MS = 5_120; // ≈ 5 MB/s

  async function loadFile(input: File | string): Promise<void> {
    reset();
    scanning.value = true;
    if (typeof input !== 'string') {
      fileName.value = input.name;
      fileSize.value = input.size;
    }

    // Kick the estimated-progress animation. Ramps 0 → 95% across
    // expectedMs (file size / empirical throughput); the snap to 100%
    // happens in the success branch below. requestAnimationFrame
    // smoothness, cleaned up in the finally regardless of outcome.
    const expectedMs = Math.max(
      120,  // floor for tiny files so the animation is visible at all
      (fileSize.value ?? 1_000_000) / SCAN_BYTES_PER_MS,
    );
    const animStart = performance.now();
    let animFrame: number | null = null;
    const tick = () => {
      const elapsed = performance.now() - animStart;
      scanProgress.value = Math.min(95, (elapsed / expectedMs) * 95);
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);

    try {
      const handle: SourceHandle = await client.openSource(input);
      const startedAt = performance.now();
      const report = await client.scan(handle);
      parseTimeMs.value = performance.now() - startedAt;
      scanReport.value = report;
      time.value = report.time_sec;
      events.value = report.events;
      firmwareRevision.value = report.firmware_revision;
      firmwareDate.value = report.firmware_date;
      boardInfo.value = report.board_info;
      craftName.value = report.craft_name;
      scanProgress.value = 100;
    } catch (err) {
      scanError.value = err;
      throw err;
    } finally {
      if (animFrame !== null) cancelAnimationFrame(animFrame);
      scanning.value = false;
    }
  }

  /** Ensure each named field is present in `fields`. Already-resident or
   *  currently-hydrating fields are skipped. Returns when every requested
   *  field has either landed in `fields` or failed (failures throw). */
  async function ensureFields(names: string[]): Promise<void> {
    const missing = names.filter(
      (n) => !fields.has(n) && !hydrating.has(n),
    );
    if (missing.length === 0) return;
    for (const n of missing) hydrating.add(n);
    try {
      const hydrated = await client.hydrate(missing);
      for (const [name, arr] of hydrated.fields) {
        fields.set(name, arr);
      }
      // Capture the GPS time axis whenever a hydrate call requested any
      // gps: field. Subsequent hydrate calls for other gps: fields would
      // re-produce identical axis values, so overwriting is safe.
      if (hydrated.gpsTimesSec.length > 0) {
        gpsTimeSec.value = hydrated.gpsTimesSec;
      }
    } finally {
      for (const n of missing) hydrating.delete(n);
    }
  }

  return {
    scanReport,
    scanning,
    scanError,
    scanProgress,
    time,
    gpsTimeSec,
    fields,
    hydrating,
    events,
    firmwareRevision,
    firmwareDate,
    boardInfo,
    craftName,
    fileName,
    fileSize,
    parseTimeMs,
    loadFile,
    ensureFields,
    reset,
  };
});
