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

type ScanRequest = { id: number; type: 'scan'; bytes: Uint8Array };
type HydrateRequest = { id: number; type: 'hydrate'; fieldIds: string[] };
type InfoRequest = { id: number; type: 'info' };
type WorkerRequest = ScanRequest | HydrateRequest | InfoRequest;

// `Omit<WorkerRequest, 'id'>` on a discriminated union collapses to the
// intersection of common properties, losing the per-variant fields. We
// distribute the Omit manually so callers can still hand `call()` a typed
// request body without the id.
type WorkerRequestBody =
  | Omit<ScanRequest, 'id'>
  | Omit<HydrateRequest, 'id'>
  | Omit<InfoRequest, 'id'>;

type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: unknown };

// -- ParserClient ----------------------------------------------------------

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/parser.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const res = event.data;
    const slot = pending.get(res.id);
    if (!slot) return;
    pending.delete(res.id);
    if (res.ok) slot.resolve(res.payload);
    else slot.reject(res.error);
  });
  worker.addEventListener('error', (event) => {
    // Worker-level error (instantiation, uncaught exception in handler).
    // Reject every in-flight request so the UI doesn't hang forever.
    const error = new Error(event.message || 'parser worker error');
    for (const slot of pending.values()) slot.reject(error);
    pending.clear();
  });
  return worker;
}

function call<T>(req: WorkerRequestBody, transfer?: Transferable[]): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });
    const message = { ...req, id } as WorkerRequest;
    if (transfer && transfer.length > 0) {
      w.postMessage(message, transfer);
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
   *  per-field arrays. The bytes are transferred to the worker (caller
   *  loses access to `handle.bytes` after this returns). */
  async scan(handle: SourceHandle): Promise<ScanReport> {
    const bytes = handle.bytes;
    // Transfer the underlying ArrayBuffer so the worker doesn't copy. After
    // this call the caller's Uint8Array view is detached.
    const raw = await call<RawScanReport>(
      { type: 'scan', bytes },
      [bytes.buffer as ArrayBuffer],
    );
    // Convert at the Layer 1 boundary so Layer 2/3 never sees `number[]`
    // for typed-array-shaped data.
    return { ...raw, time_sec: Float32Array.from(raw.time_sec) };
  }

  /** Hydrate the named fields. Returns `{ fields, gpsTimesSec }`:
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
   *  follow-up. */
  async hydrate(fieldIds: string[]): Promise<HydrateResult> {
    const raw = await call<{
      fields: Array<[string, number[]]>;
      gps_times_sec: number[];
    }>({
      type: 'hydrate',
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
