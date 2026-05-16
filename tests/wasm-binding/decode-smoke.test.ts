import { describe, expect, it } from 'vitest';

// `tests/wasm-binding/pkg/` is gitignored and populated by
// `npm run wasm:build:node` (the `test:wasm` script chains them). When
// this file is opened in an editor before `wasm:build:node` has run, the
// import below will look unresolved — that's expected.
import { hydrate, parser_info, scanLog } from './pkg/wingtune_parser';

describe('wingtune-parser WASM (Node binding)', () => {
  it('parser_info() returns the crate identifier string', () => {
    const info = parser_info();
    expect(typeof info).toBe('string');
    expect(info).toMatch(/^wingtune-parser/);
  });

  it('scanLog(empty) throws a ScanError with kind = "no_logs"', () => {
    let thrown: unknown;
    try {
      scanLog(new Uint8Array());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { kind?: string }).kind).toBe('no_logs');
  });

  it('hydrate() rejects with the M1.3-not-implemented message', () => {
    let thrown: unknown;
    try {
      hydrate(['axisP[0]']);
    } catch (e) {
      thrown = e;
    }
    // wasm-bindgen throws either the serialized JsValue or a string. The
    // stub uses `JsValue::from_str(...)` so we get a plain string here.
    expect(String(thrown)).toMatch(/not yet implemented/);
  });
});
