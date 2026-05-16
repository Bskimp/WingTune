import { describe, expect, it } from 'vitest';

// `tests/wasm-binding/pkg/` is gitignored and populated by
// `npm run wasm:build:node` (the `test:wasm` script chains them). When
// this file is opened in an editor before `wasm:build:node` has run, the
// import below will look unresolved — that's expected.
import { parser_info } from './pkg/wingtune_parser';

describe('wingtune-parser WASM (Node binding)', () => {
  it('parser_info() returns the crate identifier string', () => {
    const info = parser_info();
    expect(typeof info).toBe('string');
    expect(info).toMatch(/^wingtune-parser/);
  });
});
