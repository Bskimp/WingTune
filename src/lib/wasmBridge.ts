// Layer 1 (Ingest) — typed message protocol between the main thread and the
// parser web worker. This is the ONLY file outside `src/workers/` that is
// allowed to know about the worker's existence or the WASM API. Layer 2
// (Analytics) and Layer 3 (Vue UI) call `ParserClient` and must not import
// from `../workers/` or `../wasm/` themselves.

// -- Shared types ----------------------------------------------------------
// Mirror the Rust shapes in `crates/wingtune-parser/src/{capability,event,scan}.rs`.
// Kept hand-written (not auto-generated) so the bridge can document the JS
// view of each field independently — wasm-bindgen's TS output types
// everything as `any` for serde-bridged structs.

export interface SampleCheck {
  all_zero: boolean;
  has_content: boolean;
  /** Minimum value observed across sampled frames. `null` when the
   *  field was absent from every sampled frame. Used by signalRegistry
   *  to flag `out_of_range` resolutions when values fall outside a
   *  registered `expected_range`. */
  value_min: number | null;
  /** Maximum value observed across sampled frames. Same null
   *  semantics as `value_min`. */
  value_max: number | null;
}

export interface FrameIndex {
  /** See Rust doc on `FrameIndex.offsets` — currently main-frame iteration counts. */
  offsets: number[];
  times_sec: number[];
}

export interface VoltageSagSummary {
  min_v: number;
  max_v: number;
  p99_v: number;
  pct_below_threshold: number;
}

export interface CapabilityReport {
  fields_present: string[];
  debug_mode: string | null;
  gps_present: boolean;
  sample_check: Record<string, SampleCheck>;
  frame_index: FrameIndex;
  total_frames: number;
  voltage_sag_summary: VoltageSagSummary | null;
  /** BF firmware revision string from the log header. Duplicated from
   *  ScanReport.firmware_revision so signalRegistry's `min_firmware`
   *  source-eligibility gate doesn't need a separate plumbing path. */
  firmware_revision: string | null;
}

export interface DynNotchConfig {
  count: number;
  min_hz: number;
  max_hz: number;
  /** BF logs Q × 100 — actual Q is `q / 100`. */
  q: number;
}

export interface LowPassConfig {
  /** Normalised: "PT1", "BIQUAD", "PT2", "PT3" (older BF integer types
   *  translated by scan.rs). Unknown types pass through verbatim. */
  filter_type: string;
  /** Static cutoff in Hz, or null when dynamic-only. */
  static_hz: number | null;
  /** Dynamic LP range — present when BF varies cutoff with throttle. */
  dyn_min_hz: number | null;
  dyn_max_hz: number | null;
}

export interface RpmFilterConfig {
  harmonics: number;
  lpf_hz:    number;
  min_hz:    number;
  /** BF Q × 100 — actual Q is `q / 100`. */
  q:         number;
}

export interface FilterConfig {
  dyn_notch:  DynNotchConfig | null;
  gyro_lpf1:  LowPassConfig | null;
  gyro_lpf2:  LowPassConfig | null;
  dterm_lpf1: LowPassConfig | null;
  dterm_lpf2: LowPassConfig | null;
  rpm_filter: RpmFilterConfig | null;
}

export type EventFrame =
  | { kind: 'flight_mode_change'; time_sec: number; flags: number }
  | { kind: 'arming'; time_sec: number }
  | { kind: 'disarming'; time_sec: number; reason: string | null }
  | { kind: 'rx_loss'; time_sec: number }
  | { kind: 'failsafe'; time_sec: number; phase: string }
  | { kind: 'other'; time_sec: number; name: string };

export interface ScanReport {
  capability: CapabilityReport;
  /** Log-time of each main frame, in seconds since the first frame. Always
   *  delivered as a real `Float32Array` to Layer 2/3 (the worker returns
   *  it as `number[]` via serde-wasm-bindgen; this bridge converts at the
   *  Layer 1 boundary). Never let typed-array-shaped data live as a
   *  plain `number[]` past this point. */
  time_sec: Float32Array;
  events: EventFrame[];
  firmware_revision: string | null;
  firmware_date: string | null;
  board_info: string | null;
  craft_name: string | null;
  filter_config: FilterConfig;
  /** All BBL header key/value pairs as raw strings (PID values, rates,
   *  mixer config, filter cutoffs, etc.). Sorted alphabetically by key
   *  on the Rust side via BTreeMap, so the UI can render directly.
   *  Includes keys that `filter_config` already typed — exposed raw so
   *  the inspector shows every CLI param BF wrote, not just the ones
   *  we recognise. */
  header_params: Record<string, string>;
}

/** Pre-conversion shape of `ScanReport` as it comes out of
 *  serde-wasm-bindgen. Only `wasmBridge.scan()` should ever see this. */
type RawScanReport = Omit<ScanReport, 'time_sec'> & { time_sec: number[] };

export type ScanError =
  | { kind: 'no_logs' }
  | { kind: 'invalid_headers'; reason: string };

/** Opaque handle returned by `openSource`. The bytes live here while the
 *  bridge owns them; pass back to `scan(handle, …)` to consume. */
export type SourceHandle = { bytes: Uint8Array };

// -- Worker protocol (must match parser.worker.ts) -------------------------
//
// Multi-tenant as of M1.7 slice 1: the worker holds a `Map<logId, bytes>`
// so N logs can coexist for the multi-log compare workflow. Every
// scan/hydrate/close carries a `logId` so the worker can route to the
// right cached bytes. `info` is global and carries no logId. The session
// store assigns logIds at addLog time; the bridge is logId-agnostic and
// just forwards.

type ScanRequest = {
  id: number;
  type: 'scan';
  logId: string;
  bytes: Uint8Array;
};
type HydrateRequest = {
  id: number;
  type: 'hydrate';
  logId: string;
  fieldIds: string[];
};
type CloseRequest = { id: number; type: 'close'; logId: string };
type InfoRequest = { id: number; type: 'info' };
type WorkerRequest =
  | ScanRequest
  | HydrateRequest
  | CloseRequest
  | InfoRequest;

// `Omit<WorkerRequest, 'id'>` on a discriminated union collapses to the
// intersection of common properties, losing the per-variant fields. We
// distribute the Omit manually so callers can still hand `call()` a typed
// request body without the id.
type WorkerRequestBody =
  | Omit<ScanRequest, 'id'>
  | Omit<HydrateRequest, 'id'>
  | Omit<CloseRequest, 'id'>
  | Omit<InfoRequest, 'id'>;

type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: unknown }
  /** Progress event — emitted multiple times per scan. Not a terminal
   *  response; pending entry stays open until the eventual ok/error. */
  | { id: number; type: 'progress'; frames: number };

function isProgress(
  res: WorkerResponse,
): res is { id: number; type: 'progress'; frames: number } {
  return 'type' in res && res.type === 'progress';
}

// -- ParserClient ----------------------------------------------------------

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();
/** Per-request progress callbacks, indexed by request id. Set when a
 *  call passes `onProgress`, cleared when the call resolves/rejects. */
const progressCallbacks = new Map<number, (frames: number) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/parser.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const res = event.data;
    if (isProgress(res)) {
      progressCallbacks.get(res.id)?.(res.frames);
      return;
    }
    const slot = pending.get(res.id);
    if (!slot) return;
    pending.delete(res.id);
    progressCallbacks.delete(res.id);
    if (res.ok) slot.resolve(res.payload);
    else slot.reject(res.error);
  });
  worker.addEventListener('error', (event) => {
    // Worker-level error (instantiation, uncaught exception in handler).
    // Reject every in-flight request so the UI doesn't hang forever.
    const error = new Error(event.message || 'parser worker error');
    for (const slot of pending.values()) slot.reject(error);
    pending.clear();
    progressCallbacks.clear();
  });
  return worker;
}

interface CallOptions {
  transfer?: Transferable[];
  onProgress?: (frames: number) => void;
}

function call<T>(req: WorkerRequestBody, options: CallOptions = {}): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });
    if (options.onProgress) progressCallbacks.set(id, options.onProgress);
    const message = { ...req, id } as WorkerRequest;
    if (options.transfer && options.transfer.length > 0) {
      w.postMessage(message, options.transfer);
    } else {
      w.postMessage(message);
    }
  });
}

export class ParserClient {
  /** Diagnostic — returns the underlying parser identifier. M1.1 smoke. */
  async getInfo(): Promise<string> {
    return call<string>({ type: 'info' });
  }

  /** Read source bytes into an opaque handle.
   *  - `File` (web): reads into a Uint8Array.
   *  - `string` (Tauri): path — NOT YET WIRED. M1.3 adds the Tauri command. */
  async openSource(input: File | string): Promise<SourceHandle> {
    if (typeof input === 'string') {
      throw new Error(
        'openSource(path) requires the Tauri side, wired in M1.3',
      );
    }
    const buf = await input.arrayBuffer();
    return { bytes: new Uint8Array(buf) };
  }

  /** Single-pass scan: capability report + time axis + event list, no
   *  per-field arrays. The bytes are transferred to the worker, which
   *  caches them under `logId` for subsequent `hydrate(logId, …)` calls.
   *  Caller loses access to `handle.bytes` after this returns (the
   *  ArrayBuffer is detached).
   *
   *  `logId` is assigned by the session store (one per loaded log) and
   *  is opaque to the bridge — anything stable + unique works. Re-using
   *  a logId silently overwrites the worker's cached bytes for that id.
   *
   *  `onProgress` (optional) is called multiple times during scan with
   *  the running frame count. Caller estimates a percent against an
   *  expected-total derived from file size. Callback errors are not
   *  caught here — keep the callback simple (just update a ref). */
  async scan(
    logId: string,
    handle: SourceHandle,
    options: { onProgress?: (frames: number) => void } = {},
  ): Promise<ScanReport> {
    const bytes = handle.bytes;
    // Transfer the underlying ArrayBuffer so the worker doesn't copy. After
    // this call the caller's Uint8Array view is detached.
    const raw = await call<RawScanReport>(
      { type: 'scan', logId, bytes },
      {
        transfer: [bytes.buffer as ArrayBuffer],
        onProgress: options.onProgress,
      },
    );
    // Convert at the Layer 1 boundary so Layer 2/3 never sees `number[]`
    // for typed-array-shaped data.
    return { ...raw, time_sec: Float32Array.from(raw.time_sec) };
  }

  /** Hydrate the named fields for a previously-scanned log. Returns
   *  `{ fields, gpsTimesSec }`:
   *
   *   - `fields` — `Map<name, Float32Array>` of one value-per-frame per
   *     requested id. Main-frame fields align with `scanReport.time_sec`.
   *     GPS fields (caller passes a `gps:`-prefixed name, matching how
   *     `scanReport.capability.fields_present` surfaces them) align with
   *     `gpsTimesSec` — main and GPS frames fire at different rates.
   *   - `gpsTimesSec` — per-GPS-frame timestamps in seconds since the
   *     first main frame. Empty when no `gps:` field was hydrated.
   *
   *  Fields not present in the log come back as empty `Float32Array`s
   *  (callers should check `.length === 0` to distinguish from "field
   *  exists but had no samples"). The implementation re-iterates the
   *  full log per call; the `FrameIndex` seek-skip optimization is a
   *  follow-up.
   *
   *  Rejects if `logId` was never scanned (or was closed) — the worker
   *  has no cached bytes to iterate. */
  async hydrate(logId: string, fieldIds: string[]): Promise<HydrateResult> {
    const raw = await call<{
      fields: Array<[string, number[]]>;
      gps_times_sec: number[];
    }>({
      type: 'hydrate',
      logId,
      fieldIds,
    });
    // serde-wasm-bindgen renders Vec<(String, Vec<f32>)> as an array of
    // [name, array] pairs. Convert each value array to Float32Array at
    // the Layer 1 boundary so Layer 2/3 never sees plain `number[]`.
    const fields = new Map<string, Float32Array>();
    for (const [name, values] of raw.fields) {
      fields.set(name, Float32Array.from(values));
    }
    return { fields, gpsTimesSec: Float32Array.from(raw.gps_times_sec) };
  }

  /** Release the worker's cached bytes for a log. Call when removing a
   *  log from the session so its bytes don't sit in worker memory
   *  forever. Idempotent: closing an unknown logId is not an error. */
  async closeLog(logId: string): Promise<void> {
    await call<void>({ type: 'close', logId });
  }
}

export interface HydrateResult {
  /** field name → typed array of one value per frame. Names without
   *  the `gps:` prefix align with the scan report's `time_sec` axis;
   *  GPS-prefixed names align with `gpsTimesSec`. */
  fields: Map<string, Float32Array>;
  /** Per-GPS-frame timestamps in seconds since the first main frame.
   *  Empty when no `gps:` field was requested. */
  gpsTimesSec: Float32Array;
}
