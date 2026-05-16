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

// Bytes are transferred from the main thread on `scan` and cached here so
// `hydrate` can re-iterate the same log without a second main-thread →
// worker copy. Replaced on every new scan.
let logBytes: Uint8Array | null = null;

// Request / response shapes — these MUST stay in sync with the matching
// types in `src/lib/wasmBridge.ts`. The shared shapes live in the bridge
// so Layer 2/3 has a single import surface; this file just dispatches
// against them.

type ScanRequest = { id: number; type: 'scan'; bytes: Uint8Array };
type HydrateRequest = { id: number; type: 'hydrate'; fieldIds: string[] };
type InfoRequest = { id: number; type: 'info' };
type WorkerRequest = ScanRequest | HydrateRequest | InfoRequest;

type WorkerResponse =
  | { id: number; ok: true; payload: unknown }
  | { id: number; ok: false; error: unknown };

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
    case 'scan':
      // Stash the bytes for subsequent hydrate calls. After
      // `postMessage`'s transfer the main thread no longer owns this
      // buffer; the worker is now the source of truth for the log.
      logBytes = req.bytes;
      return scanLog(req.bytes);
    case 'hydrate':
      if (!logBytes) {
        throw new Error('hydrate: no log loaded — call scan() first');
      }
      return wasmHydrate(logBytes, req.fieldIds);
    case 'info':
      return parser_info();
  }
}
