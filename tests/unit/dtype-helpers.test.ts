import { describe, expect, it } from 'vitest';

// M1.1.6 vitest smoke. Real specs for typed-array helpers, signal
// resolution, capability predicates, etc. land alongside the modules they
// cover. This file exists so `npm run test:unit` runs ≥ 1 test today and
// fails CI loudly if vitest itself breaks.

describe('Float32 sanity', () => {
  it('typed-array constructor preserves length and integer values exactly', () => {
    const src = [0, 1, -1, 65535];
    const arr = Float32Array.from(src);
    expect(arr.length).toBe(src.length);
    expect(arr[0]).toBe(0);
    expect(arr[1]).toBe(1);
    expect(arr[2]).toBe(-1);
    expect(arr[3]).toBe(65535);
  });

  it('Math.PI in f32 differs from f64 by less than 1e-6', () => {
    const arr = Float32Array.from([Math.PI]);
    expect(Math.abs(arr[0] - Math.PI)).toBeLessThan(1e-6);
  });
});
