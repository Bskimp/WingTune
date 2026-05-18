// Layer 1 (Ingest) — Web Worker host for the wingtune-parser WASM module.
//
// This file and `src/lib/wasmBridge.ts` are the only places in the JS/TS
// codebase that import from `src/wasm/pkg/`. Layer 2 (Analytics) and
// Layer 3 (Vue UI) talk to the worker only via the typed protocol defined
// in `wasmBridge.ts`. See the `wingtune-architecture` skill.

import init, {
  hydrate as wasmHydrate,
  parser_info,
  scanLog,
} from '../wasm/pkg/wingtune_parser';

// WASM init is async (fetches the .wasm, instantiates). Done once, the
// promise cached so subsequent requests await the same init.
let ready: Promise<unknown> | null = null;
function ensureReady(): Promise<unknown> {
  if (!ready) ready = init();
  return ready;
}

// Multi-tenant byte cache as of M1.7 slice 1: bytes are transferred from
// the main thread on `scan` and cached here keyed by `logId` so the same
// worker can serve N loaded logs (the multi-log compare workflow). A
// `hydrate` call re-iterates the cached bytes for its logId without a
// second main → worker copy. `close` evicts a single log; new scans for
// an already-known logId silently overwrite. Memory grows linearly with
// loaded logs — the session store is expected to call `close(logId)` on
// removeLog so this map stays bounded.
const logBytes = new Map<string, Uint8Array>();

// Request / response shapes — these MUST stay in sync with the matching
// types in `src/lib/wasmBridge.ts`. The shared shapes live in the bridge
// so Layer 2/3 has a single import surface; this file just dispatches
// against them.

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

type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: unknown }
  | { id: number; type: 'progress'; frames: number };

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    await ensureReady();
    const payload = dispatch(req);
    const res: WorkerResponse = { id: req.id, ok: true, payload };
    self.postMessage(res);
  } catch (err) {
    // `scanLog` / `hydrate` reject with structured ScanError objects when
    // serialization succeeded on the Rust side; preserve those as-is so
    // the caller can dispatch on `error.kind`. Real JS exceptions are
    // normalized to `{ message }` for consistent rendering.
    const error =
      err instanceof Error ? { message: err.message } : (err as unknown);
    const res: WorkerResponse = { id: req.id, ok: false, error };
    self.postMessage(res);
  }
});

function dispatch(req: WorkerRequest): unknown {
  switch (req.type) {
    case 'scan': {
      // Cache bytes under this logId for subsequent hydrate calls. After
      // `postMessage`'s transfer the main thread no longer owns this
      // buffer; the worker is now the source of truth for the log.
      // Re-using a logId overwrites silently — the session store relies
      // on this for the future "reload-in-place" path.
      logBytes.set(req.logId, req.bytes);
      // Progress callback: forward to main thread tagged with the
      // request id so the bridge can dispatch per pending scan.
      const onProgress = (frames: number) => {
        const msg: WorkerResponse = { id: req.id, type: 'progress', frames };
        self.postMessage(msg);
      };
      return scanLog(req.bytes, onProgress);
    }
    case 'hydrate': {
      const bytes = logBytes.get(req.logId);
      if (!bytes) {
        throw new Error(
          `hydrate: no log with id "${req.logId}" — call scan() first or check the log was not closed`,
        );
      }
      return wasmHydrate(bytes, req.fieldIds);
    }
    case 'close':
      // Idempotent: deleting an unknown logId is not an error. Session
      // store may close a log that was never successfully scanned (e.g.
      // load failure) and the worker just no-ops in that case.
      logBytes.delete(req.logId);
      return undefined;
    case 'info':
      return parser_info();
  }
}
