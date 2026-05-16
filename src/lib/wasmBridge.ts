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

export type EventFrame =
  | { kind: 'flight_mode_change'; time_sec: number; flags: number }
  | { kind: 'arming'; time_sec: number }
  | { kind: 'disarming'; time_sec: number; reason: string | null }
  | { kind: 'rx_loss'; time_sec: number }
  | { kind: 'failsafe'; time_sec: number; phase: string }
  | { kind: 'other'; time_sec: number; name: string };

export interface ScanReport {
  capability: CapabilityReport;
  time_sec: number[];
  events: EventFrame[];
  firmware_revision: string | null;
  firmware_date: string | null;
  board_info: string | null;
  craft_name: string | null;
}

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
    return call<ScanReport>(
      { type: 'scan', bytes },
      [bytes.buffer as ArrayBuffer],
    );
  }

  /** Hydrate the named fields (M1.3). Currently rejects with the Rust-side
   *  "not yet implemented" error; landing the impl is its own commit. */
  async hydrate(fieldIds: string[]): Promise<Map<string, Float32Array>> {
    return call<Map<string, Float32Array>>({ type: 'hydrate', fieldIds });
  }
}
