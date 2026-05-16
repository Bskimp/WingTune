// Layer 1 (Ingest) — Web Worker host for the wingtune-parser WASM module.
//
// This file and `src/lib/wasmBridge.ts` are the only places in the JS/TS
// codebase that import from `src/wasm/pkg/`. Layer 2 (Analytics) and
// Layer 3 (Vue UI) talk to the worker only via the typed message protocol
// defined in `wasmBridge.ts`. See the `wingtune-architecture` skill.

import init, { parser_info } from '../wasm/pkg/wingtune_parser';

// WASM init is async (fetches the .wasm, instantiates). We do it once and
// cache the promise so subsequent requests await the same init.
let ready: Promise<unknown> | null = null;
function ensureReady(): Promise<unknown> {
  if (!ready) ready = init();
  return ready;
}

type WorkerRequest = { id: number; type: 'getInfo' };
type WorkerResponse =
  | { id: number; type: 'info'; payload: string }
  | { id: number; type: 'error'; error: string };

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    await ensureReady();
    switch (req.type) {
      case 'getInfo': {
        const info = parser_info();
        const res: WorkerResponse = { id: req.id, type: 'info', payload: info };
        self.postMessage(res);
        break;
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const res: WorkerResponse = { id: req.id, type: 'error', error };
    self.postMessage(res);
  }
});
