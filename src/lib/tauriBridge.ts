// Layer 1 (Ingest) — Tauri runtime bridge.
//
// Web build and Tauri build share 100% of the Vue/Pinia/wasmBridge
// code. This module is the *only* place that imports from
// `@tauri-apps/*` packages, so the rest of the app stays
// platform-agnostic. Components call `isTauri()` to gate Tauri-only
// UI affordances (e.g. the native "Open file…" button) and call
// `pickAndOpenLogFile()` to invoke the native picker.
//
// When the web build hits these paths, `isTauri()` returns false and
// the gated UI is never rendered — the dynamic imports below are
// inside conditional code paths so Vite's tree-shaker can drop them.
//
// The chosen-file flow wraps Tauri's fs `readFile` bytes in a real
// browser File object so the rest of the load pipeline
// (`useLogStore.loadFile(file)`) doesn't need to branch on platform.

/** True when running inside a Tauri webview (desktop shell), false in
 *  a plain browser. Tauri 2.x injects `__TAURI_INTERNALS__` onto
 *  window at startup before user JS runs. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' &&
    // @ts-expect-error — Tauri's runtime global, not in lib.dom
    typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

/** Open the native file dialog filtered to BF log extensions, then
 *  read the chosen file's bytes via Tauri's fs plugin and wrap them
 *  in a browser `File` so callers can treat it identically to a
 *  drag-and-drop or `<input type="file">` File.
 *
 *  Returns `null` when the user cancels the dialog. Throws on read
 *  failure (caller should surface via the existing scanError path). */
export async function pickAndOpenLogFile(): Promise<File | null> {
  if (!isTauri()) {
    throw new Error('pickAndOpenLogFile called outside Tauri runtime');
  }

  // Dynamic imports so the web bundle doesn't pull these packages in
  // when isTauri() is false. Vite tree-shakes the unreachable branch.
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readFile } = await import('@tauri-apps/plugin-fs');

  const chosen = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: 'Betaflight blackbox log',
        extensions: ['bbl', 'BBL', 'bfl', 'BFL', 'txt'],
      },
    ],
  });

  // `open()` returns string | string[] | null. Single-file mode → string | null.
  if (chosen === null || Array.isArray(chosen)) return null;

  const path = chosen as string;
  const bytes = await readFile(path);

  // Derive a base filename for the File constructor — Tauri uses '/'
  // on macOS/Linux and '\\' on Windows; split on whichever appears
  // last. (path.basename equivalent without pulling a node polyfill.)
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const baseName = lastSep >= 0 ? path.slice(lastSep + 1) : path;

  // Wrap in a real File so the rest of the load pipeline (file-drop
  // path) sees an identical input shape. application/octet-stream
  // matches what the OS would report for a .bbl from a file dialog.
  return new File([bytes], baseName, { type: 'application/octet-stream' });
}
