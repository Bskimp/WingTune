// M1.7 slice 1: multi-log session store. Each loaded log is a peer LogState
// keyed by a stable logId; the worker is multi-tenant and routes scan /
// hydrate / close by logId. There is intentionally no "primary" / "focus"
// log concept — panels iterate `logs.values()` and render every log.
//
// Memory model rules from `wingtune-memory-model`:
//   · `logs` is `shallowReactive` — Map insertion/removal is reactive,
//     but the LogState objects inside are NOT deep-proxied (each carries
//     typed-array fields that must stay raw).
//   · Per-log `fields` / `hydrating` are `shallowReactive` Maps/Sets for
//     the same reason: panels need add/remove reactivity without the
//     contained Float32Arrays getting wrapped.
//   · Hydration is lazy per the cardinal rule; AnalysisView pins
//     recommender-required fields per log on add so the LRU pass can't
//     evict them.
//
// Panels that don't yet do multi-log rendering read through the
// `useActiveLog()` composable (src/composables/useActiveLog.ts), which
// projects this store's first log as a flat bag of refs — same surface
// the deleted single-log `useLogStore` had. When a panel adopts true
// `session.logs.values()` iteration (Push 3 — Servos / Spectrum / Step
// with per-log color tinting), it drops the composable.

import { defineStore } from 'pinia';
import { ref, shallowReactive } from 'vue';

import {
  ParserClient,
  type EventFrame,
  type ScanReport,
  type SourceHandle,
} from '../lib/wasmBridge';
import { DEFAULT_FIELD_CACHE_BYTES } from './view';

/** State of a single loaded log. Peers in `session.logs` — there is no
 *  primary/focus log. All time-domain quantities are seconds since the
 *  log's own start; `timeOffsetSec` is the M1.7.1 alignment hook
 *  (default 0 = no alignment). Panels reading across logs should pull
 *  `time[i] + timeOffsetSec` when rendering on a shared (session-level)
 *  cursor axis — see `useAlignedTime`. */
export interface LogState {
  id: string;
  name: string;
  fileSize: number | null;
  scanReport: ScanReport | null;
  time: Float32Array;
  gpsTimeSec: Float32Array;
  /** shallowReactive — add/remove triggers reactivity; contained
   *  Float32Arrays are NOT deep-proxied. */
  fields: Map<string, Float32Array>;
  /** shallowReactive — same reasoning. */
  hydrating: Set<string>;
  /** Never-evict allowlist. Recommender-required fields are pinned at
   *  log load so the LRU sweep can't thrash them. NOT reactive — only
   *  the eviction logic reads it. */
  pinnedFields: Set<string>;
  events: EventFrame[];
  firmwareRevision: string | null;
  firmwareDate: string | null;
  boardInfo: string | null;
  craftName: string | null;
  scanProgress: number;
  scanError: unknown;
  parseTimeMs: number | null;
  /** Insertion timestamp for roster ordering. */
  loadedAt: number;
  /** M1.7.1 alignment offset — applied as `t + timeOffsetSec` when
   *  projecting this log's per-frame time axis onto the shared
   *  session cursor axis. Default 0 = no alignment. */
  timeOffsetSec: number;
}

/** Typical bytes per main frame on a BF wing log. Used to estimate
 *  expected total frames from file size for the progress percent.
 *  Mirrors the constant in the legacy `log.ts` — same logic, just
 *  per-log now. */
const TYPICAL_BYTES_PER_FRAME = 70;

function createEmptyLogState(
  id: string,
  name: string,
  fileSize: number | null,
): LogState {
  // `shallowReactive` on the LogState itself so top-level property
  // mutations (scanReport, time, scanProgress, etc.) fire reactivity.
  // Without this, the LogState lives as a plain object inside a
  // `shallowReactive<Map>` — the Map tracks set/delete but NOT
  // property changes on the contained objects, so async population
  // post-scan would never propagate to watchers. The contained
  // `fields` / `hydrating` collections are already shallowReactive
  // themselves; shallowReactive at the top is one-level-deep so it
  // doesn't double-wrap them.
  return shallowReactive({
    id,
    name,
    fileSize,
    scanReport: null,
    time: new Float32Array(0),
    gpsTimeSec: new Float32Array(0),
    fields: shallowReactive(new Map()) as Map<string, Float32Array>,
    hydrating: shallowReactive(new Set()) as Set<string>,
    pinnedFields: new Set(),
    events: [],
    firmwareRevision: null,
    firmwareDate: null,
    boardInfo: null,
    craftName: null,
    scanProgress: 0,
    scanError: null,
    parseTimeMs: null,
    loadedAt: Date.now(),
    timeOffsetSec: 0,
  }) as LogState;
}

export const useSessionStore = defineStore('session', () => {
  const client = new ParserClient();

  /** Loaded logs, keyed by logId. Insertion-ordered (Map preserves
   *  insertion order) so the roster renders in load order. */
  const logs = shallowReactive(new Map<string, LogState>());

  /** True while ANY log scan is in flight. FileDropZone gates UI on
   *  this so the user can't drop a 4th log while the 3rd is still
   *  scanning. */
  const scanning = ref(false);

  /** Most recent scan error — surfaced by FileDropZone when no log
   *  has loaded yet (during initial drop). Per-log scan errors live
   *  on `LogState.scanError`. */
  const lastScanError = ref<unknown>(null);

  function generateLogId(): string {
    // crypto.randomUUID is available in modern Node + every target
    // browser; no polyfill needed.
    return crypto.randomUUID();
  }

  /** Scan a new log and register it as a peer in the session. Returns
   *  the new logId. Throws (and removes the placeholder entry) on
   *  scan failure. */
  async function addLog(input: File | string): Promise<string> {
    const id = generateLogId();
    const name =
      typeof input === 'string'
        ? (input.split(/[\\/]/).pop() ?? 'log')
        : input.name;
    const fileSize = typeof input === 'string' ? null : input.size;

    const log = createEmptyLogState(id, name, fileSize);
    // Register the placeholder up-front so the roster can show a
    // "scanning…" entry while the worker round-trip is in flight.
    logs.set(id, log);

    scanning.value = true;
    lastScanError.value = null;

    const expectedFrames = Math.max(
      1000,
      (fileSize ?? 1_000_000) / TYPICAL_BYTES_PER_FRAME,
    );
    const onProgress = (frames: number) => {
      log.scanProgress = Math.min(95, (frames / expectedFrames) * 100);
    };

    try {
      const handle: SourceHandle = await client.openSource(input);
      const startedAt = performance.now();
      const report = await client.scan(id, handle, { onProgress });
      log.parseTimeMs = performance.now() - startedAt;
      log.scanReport = report;
      log.time = report.time_sec;
      log.events = report.events;
      log.firmwareRevision = report.firmware_revision;
      log.firmwareDate = report.firmware_date;
      log.boardInfo = report.board_info;
      log.craftName = report.craft_name;
      log.scanProgress = 100;
      return id;
    } catch (err) {
      log.scanError = err;
      lastScanError.value = err;
      // Remove the placeholder so the roster doesn't show a broken
      // entry. Worker-side close is idempotent — a never-cached id
      // is safe to close.
      logs.delete(id);
      await client.closeLog(id).catch(() => {
        // Already-cleared / never-scanned — ignore.
      });
      throw err;
    } finally {
      scanning.value = false;
    }
  }

  /** Remove a log from the session and release its worker-side bytes.
   *  No-op if the logId isn't loaded. */
  async function removeLog(id: string): Promise<void> {
    if (!logs.has(id)) return;
    logs.delete(id);
    await client.closeLog(id).catch(() => {
      // Worker close is idempotent and best-effort — failures here
      // would leak worker memory but not break the UI; the session
      // store has already moved on.
    });
  }

  /** Ensure each named field is present in the given log's `fields` map.
   *  Already-resident or in-flight fields are skipped. No-op if logId
   *  isn't loaded (callers may race log removal). */
  async function ensureFields(id: string, names: string[]): Promise<void> {
    const log = logs.get(id);
    if (!log) return;
    const missing = names.filter(
      (n) => !log.fields.has(n) && !log.hydrating.has(n),
    );
    if (missing.length === 0) return;
    for (const n of missing) log.hydrating.add(n);
    try {
      const hydrated = await client.hydrate(id, missing);
      for (const [name, arr] of hydrated.fields) {
        log.fields.set(name, arr);
      }
      if (hydrated.gpsTimesSec.length > 0) {
        log.gpsTimeSec = hydrated.gpsTimesSec;
      }
      maybeEvictLog(log);
    } catch (err) {
      // The worker can lose its byte cache for a log between scan and
      // hydrate — most commonly when Vite HMR rebuilds the worker
      // module during dev, but also possible if the worker was
      // restarted for any reason while the session store kept the log
      // metadata. Surface as a soft warning rather than an unhandled
      // promise rejection (which read as a scary red console error
      // even though the user's flow isn't actually broken — they just
      // need to re-drop the log). Real hydrate errors with different
      // shapes still propagate.
      const message = err instanceof Error ? err.message
        : (err as { message?: string } | undefined)?.message;
      if (typeof message === 'string' && message.includes('no log with id')) {
        console.warn(
          `[wingtune] hydrate dropped for log "${id}" — worker lost the byte cache (HMR or worker restart). Re-drop the log to recover.`,
        );
        return;
      }
      throw err;
    } finally {
      for (const n of missing) log.hydrating.delete(n);
    }
  }

  /** Mark these field names as never-evict for this log. AnalysisView
   *  calls this on log-add for the recommender-required set. */
  function pinFields(id: string, names: readonly string[]): void {
    const log = logs.get(id);
    if (!log) return;
    for (const n of names) log.pinnedFields.add(n);
  }

  /** Set the per-log time alignment offset. M1.7.1 follow-up wires
   *  the UI; the store-side surface is here now so the field is
   *  always settable. */
  function setTimeOffset(id: string, offsetSec: number): void {
    const log = logs.get(id);
    if (!log) return;
    log.timeOffsetSec = offsetSec;
  }

  /** Per-log eviction: the global cache cap is divided evenly across
   *  loaded logs (naive but bounded — per scope decision #5, smarter
   *  policy waits until it bites). Evicts from insertion order,
   *  skipping pinned entries. */
  function maybeEvictLog(log: LogState): void {
    const perLogCap =
      DEFAULT_FIELD_CACHE_BYTES / Math.max(1, logs.size);
    let total = 0;
    for (const arr of log.fields.values()) total += arr.byteLength;
    if (total <= perLogCap) return;
    for (const name of Array.from(log.fields.keys())) {
      if (log.pinnedFields.has(name)) continue;
      const arr = log.fields.get(name);
      if (!arr) continue;
      log.fields.delete(name);
      total -= arr.byteLength;
      if (total <= perLogCap) return;
    }
  }

  /** Reset the entire session: remove every log + release worker
   *  bytes. The legacy shim calls this when a single-log user hits
   *  "Swap" / "Try another file". */
  function reset(): void {
    for (const id of Array.from(logs.keys())) {
      logs.delete(id);
      client.closeLog(id).catch(() => {
        // ignore
      });
    }
    scanning.value = false;
    lastScanError.value = null;
  }

  /** TEST-ONLY: seed a pre-formed log into the session without
   *  routing through the worker. Used by happy-dom integration
   *  tests that bypass the Web Worker boundary (Node has no Worker).
   *  Production code MUST go through `addLog()`. */
  function __test_seedLog(
    seed: Partial<LogState> & { name: string },
  ): string {
    const id = seed.id ?? generateLogId();
    const log = createEmptyLogState(id, seed.name, seed.fileSize ?? null);
    // Copy each writable LogState field from the seed. Avoid blanket
    // Object.assign because that would replace the shallowReactive
    // fields/hydrating maps if the seed didn't provide them.
    if (seed.scanReport !== undefined) log.scanReport = seed.scanReport;
    if (seed.time !== undefined) log.time = seed.time;
    if (seed.gpsTimeSec !== undefined) log.gpsTimeSec = seed.gpsTimeSec;
    if (seed.events !== undefined) log.events = seed.events;
    if (seed.firmwareRevision !== undefined) log.firmwareRevision = seed.firmwareRevision;
    if (seed.firmwareDate !== undefined) log.firmwareDate = seed.firmwareDate;
    if (seed.boardInfo !== undefined) log.boardInfo = seed.boardInfo;
    if (seed.craftName !== undefined) log.craftName = seed.craftName;
    if (seed.scanProgress !== undefined) log.scanProgress = seed.scanProgress;
    if (seed.parseTimeMs !== undefined) log.parseTimeMs = seed.parseTimeMs;
    if (seed.timeOffsetSec !== undefined) log.timeOffsetSec = seed.timeOffsetSec;
    if (seed.fields) {
      for (const [k, v] of seed.fields) log.fields.set(k, v);
    }
    logs.set(id, log);
    return id;
  }

  return {
    logs,
    scanning,
    lastScanError,
    addLog,
    removeLog,
    ensureFields,
    pinFields,
    setTimeOffset,
    reset,
    __test_seedLog,
  };
});
