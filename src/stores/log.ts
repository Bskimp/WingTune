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
import { DEFAULT_FIELD_CACHE_BYTES } from './view';

export const useLogStore = defineStore('log', () => {
  const client = new ParserClient();

  const scanReport = shallowRef<ScanReport | null>(null);
  const scanning = ref(false);
  const scanError = ref<unknown>(null);
  /** Scan progress, 0..100. Real byte-level progress now: the WASM
   *  `scanLog` fires a callback every 256 main frames with the running
   *  frame count, and we estimate percent against an expected total
   *  derived from file size / typical-bytes-per-frame. Clamps at 95%
   *  until the scan resolves (then snaps to 100%) so we don't over-
   *  report when the estimate undershoots. */
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
  //
  // Eviction policy: Map preserves insertion order, so iterating
  // forward yields oldest-hydrated first. When cumulative cached
  // bytes exceed the cap (`view.fieldCacheBytesCap`), evict from the
  // front, SKIPPING entries listed in `pinnedFields` (those are
  // hot-set fields that recommenders re-need every render and are
  // pre-hydrated eagerly at log load — evicting them would cause
  // thrashing). This is write-order LRU (insertion timestamps only,
  // no read-on-access tracking) — simpler than maintaining a
  // touch-on-read counter, and sufficient because the panel/recommender
  // usage pattern is "hydrate once when shown, read many times."
  const fields = shallowReactive<Map<string, Float32Array>>(new Map());
  const hydrating = shallowReactive<Set<string>>(new Set());
  const pinnedFields = new Set<string>();

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
    pinnedFields.clear();
    events.value = [];
    firmwareRevision.value = null;
    firmwareDate.value = null;
    boardInfo.value = null;
    craftName.value = null;
    fileName.value = null;
    fileSize.value = null;
    parseTimeMs.value = null;
  }

  /** Mark these field names as never-evict. Recommender-required fields
   *  are pinned at log load (by AnalysisView) so the LRU pass can't
   *  thrash them. */
  function pinFields(names: readonly string[]) {
    for (const n of names) pinnedFields.add(n);
  }

  /** Total bytes currently held in the field cache. Float32Array
   *  byteLength is 4 × length — exact memory footprint. */
  function totalCachedBytes(): number {
    let total = 0;
    for (const arr of fields.values()) total += arr.byteLength;
    return total;
  }

  /** If the field cache is over the cap, evict from insertion order
   *  (oldest hydrations first), skipping pinned entries. Called after
   *  each successful hydrate; cheap because the eviction sweep
   *  short-circuits as soon as we're under the cap. */
  function maybeEvict(capBytes: number = DEFAULT_FIELD_CACHE_BYTES): void {
    if (totalCachedBytes() <= capBytes) return;
    for (const name of fields.keys()) {
      if (pinnedFields.has(name)) continue;
      fields.delete(name);
      if (totalCachedBytes() <= capBytes) return;
    }
    // All non-pinned entries evicted and we're still over cap → the
    // pinned set alone exceeds the cap. Don't evict pinned items;
    // accept the overage. (Surface to telemetry someday; for now,
    // not loud — a 256 MB pinned set means the recommender's
    // ALL_RECOMMENDER_REQUIRED_FIELDS is on a 60 MB+ log, which is
    // both unusual and out of our reach to fix here.)
  }

  /** Typical bytes per main frame on a BF wing log. Used to estimate
   *  expected total frames from file size for the progress percent.
   *  Real per-log values vary 40-100 bytes depending on field set +
   *  debug mode; 70 is a sane middle that keeps the bar reasonably
   *  paced on both small and large logs. Estimate plateaus at 95%
   *  if it underestimates; snaps to 100% on actual completion. */
  const TYPICAL_BYTES_PER_FRAME = 70;

  async function loadFile(input: File | string): Promise<void> {
    reset();
    scanning.value = true;
    if (typeof input !== 'string') {
      fileName.value = input.name;
      fileSize.value = input.size;
    }

    // Real progress: WASM scan_log fires onProgress(framesSoFar)
    // every 256 main frames. We estimate expected total from file
    // size / typical bytes-per-frame, derive percent, clamp at 95%
    // until scan actually resolves. Estimate undershoot (slow log
    // with lots of fields) → bar plateaus at 95%. Overshoot
    // (sparse log) → bar hits 95% early. Either way honest, beats
    // the prior animated estimate.
    const expectedFrames = Math.max(
      1000,  // floor so even tiny logs show some progress motion
      (fileSize.value ?? 1_000_000) / TYPICAL_BYTES_PER_FRAME,
    );
    const onProgress = (frames: number) => {
      scanProgress.value = Math.min(95, (frames / expectedFrames) * 100);
    };

    try {
      const handle: SourceHandle = await client.openSource(input);
      const startedAt = performance.now();
      const report = await client.scan(handle, { onProgress });
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
      scanning.value = false;
    }
  }

  /** Exposed so the Tauri file-picker path can surface fs.readFile
   *  failures through the same UI affordance as scan failures
   *  (DECODING → REJECTED transition in FileDropZone). */
  function setScanError(err: unknown) {
    scanError.value = err;
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
      // Sweep eviction after every successful hydrate. Cheap (short-
      // circuits as soon as we're under the cap) and idempotent.
      maybeEvict();
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
    setScanError,
    pinFields,
  };
});
