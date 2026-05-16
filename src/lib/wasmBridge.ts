// Layer 1 (Ingest) — typed message protocol between the main thread and the
// parser web worker. This is the ONLY file outside `src/workers/` that is
// allowed to know about the worker's existence or the WASM API. Layer 2
// (Analytics) and Layer 3 (Vue UI) call the exported functions here and
// must not import from `../workers/` or `../wasm/` themselves.
//
// The contract grows as parser capabilities land. For M1.1.4 we only expose
// `getParserInfo()` as the smoke surface.

type WorkerRequest = { id: number; type: 'getInfo' };
type WorkerResponse =
  | { id: number; type: 'info'; payload: string }
  | { id: number; type: 'error'; error: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();

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
    if (res.type === 'error') slot.reject(new Error(res.error));
    else slot.resolve(res.payload);
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

function call(req: Omit<WorkerRequest, 'id'>): Promise<string> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...req, id });
  });
}

export function getParserInfo(): Promise<string> {
  return call({ type: 'getInfo' });
}
