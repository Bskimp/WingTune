import { describe, expect, test } from 'vitest';

import { smoothTrace, SMOOTHING_WIDTHS } from '@/lib/displaySmooth';

describe('smoothTrace', () => {
  test('strength 0 returns the input array unchanged (no copy)', () => {
    const arr = new Float32Array([1, 2, 3, 4, 5]);
    expect(smoothTrace(arr, 0)).toBe(arr); // same reference
  });

  test('a constant signal stays constant after smoothing', () => {
    const arr = new Float32Array(50).fill(7);
    const out = smoothTrace(arr, 2);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(7, 5);
  });

  test('smoothing reduces the variance of a noisy signal', () => {
    const n = 400;
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // smooth envelope + alternating jitter
      arr[i] = Math.sin(i * 0.05) * 10 + (i % 2 === 0 ? 5 : -5);
    }
    const out = smoothTrace(arr, 3);
    const variance = (a: Float32Array) => {
      let mean = 0;
      for (let i = 0; i < a.length; i++) mean += a[i];
      mean /= a.length;
      let v = 0;
      for (let i = 0; i < a.length; i++) v += (a[i] - mean) ** 2;
      return v / a.length;
    };
    expect(variance(out)).toBeLessThan(variance(arr));
  });

  test('NaN samples are skipped; an all-NaN window stays NaN', () => {
    const arr = new Float32Array(40);
    for (let i = 0; i < 40; i++) arr[i] = i < 20 ? 10 : NaN;
    const out = smoothTrace(arr, 1); // width 7
    // Early samples (well inside the finite region) average to ~10.
    expect(out[3]).toBeCloseTo(10, 5);
    // Deep in the all-NaN region the window is entirely NaN → NaN.
    expect(Number.isNaN(out[39])).toBe(true);
  });

  test('clamps out-of-range strength', () => {
    const arr = new Float32Array(20).fill(3);
    // Strength above the max index clamps to the widest boxcar.
    const hi = smoothTrace(arr, 99);
    for (let i = 0; i < hi.length; i++) expect(hi[i]).toBeCloseTo(3, 5);
    // Negative clamps to 0 → unchanged reference.
    expect(smoothTrace(arr, -5)).toBe(arr);
  });

  test('empty array is returned as-is', () => {
    const empty = new Float32Array(0);
    expect(smoothTrace(empty, 3)).toBe(empty);
  });

  test('SMOOTHING_WIDTHS are odd and ascending', () => {
    for (const w of SMOOTHING_WIDTHS) expect(w % 2).toBe(1);
    for (let i = 1; i < SMOOTHING_WIDTHS.length; i++) {
      expect(SMOOTHING_WIDTHS[i]).toBeGreaterThan(SMOOTHING_WIDTHS[i - 1]);
    }
  });
});
