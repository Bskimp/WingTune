import { describe, test, expect } from 'vitest';

import { analyzeSTermAxis } from '@/lib/sTermAnalysis';

function fill(n: number, value: number): Float32Array {
  const a = new Float32Array(n);
  a.fill(value);
  return a;
}

describe('analyzeSTermAxis', () => {
  test('empty input returns safe defaults', () => {
    const r = analyzeSTermAxis(0, new Float32Array(0), new Float32Array(0));
    expect(r.activeSamples).toBe(0);
    expect(r.activePct).toBe(0);
    expect(r.meanAttenuation).toBe(0);
    expect(r.minTpaFactor).toBe(1);
    expect(r.tpaFactorSeries).toHaveLength(0);
  });

  test('no S-term activity (all pre below threshold) → no active samples', () => {
    const pre = fill(100, 0.1);  // below default 1.0 threshold
    const post = fill(100, 0.1);
    const r = analyzeSTermAxis(0, pre, post);
    expect(r.activeSamples).toBe(0);
    expect(r.activePct).toBe(0);
    // All factor entries should be NaN.
    for (let i = 0; i < r.tpaFactorSeries.length; i++) {
      expect(Number.isNaN(r.tpaFactorSeries[i])).toBe(true);
    }
  });

  test('no attenuation (post = pre) gives factor 1.0 and atten 0', () => {
    const pre = fill(100, 10);
    const post = fill(100, 10);
    const r = analyzeSTermAxis(0, pre, post);
    expect(r.activeSamples).toBe(100);
    expect(r.meanTpaFactor).toBeCloseTo(1.0, 5);
    expect(r.meanAttenuation).toBeCloseTo(0, 5);
    expect(r.minTpaFactor).toBeCloseTo(1.0, 5);
  });

  test('half attenuation (post = 0.5 × pre) gives factor 0.5 and atten 0.5', () => {
    const pre = fill(100, 10);
    const post = fill(100, 5);
    const r = analyzeSTermAxis(0, pre, post);
    expect(r.activeSamples).toBe(100);
    expect(r.meanTpaFactor).toBeCloseTo(0.5, 5);
    expect(r.meanAttenuation).toBeCloseTo(0.5, 5);
    expect(r.minTpaFactor).toBeCloseTo(0.5, 5);
  });

  test('full attenuation (post = 0) gives factor 0 and atten 1.0', () => {
    const pre = fill(100, 10);
    const post = fill(100, 0);
    const r = analyzeSTermAxis(0, pre, post);
    expect(r.activeSamples).toBe(100);
    expect(r.meanTpaFactor).toBeCloseTo(0, 5);
    expect(r.meanAttenuation).toBeCloseTo(1.0, 5);
    expect(r.minTpaFactor).toBeCloseTo(0, 5);
  });

  test('sign-mismatch samples count as factor 0 (cancelled)', () => {
    const pre = fill(100, 10);
    const post = fill(100, -5);  // opposite sign — TPA shouldn't flip sign
    const r = analyzeSTermAxis(0, pre, post);
    expect(r.activeSamples).toBe(100);
    expect(r.meanTpaFactor).toBeCloseTo(0, 5);
    expect(r.meanAttenuation).toBeCloseTo(1.0, 5);
  });

  test('factor is clamped at factorMax against noisy small denominators', () => {
    // Mix of two regions: active (pre = 10) and noisy (pre = 1.5 right at
    // the threshold but post way bigger → ratio > 3).
    const pre = new Float32Array(100);
    const post = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      if (i < 50) { pre[i] = 10; post[i] = 5; }
      else        { pre[i] = 1.5; post[i] = 100; }  // ratio = ~67, must clamp
    }
    const r = analyzeSTermAxis(0, pre, post);
    expect(r.activeSamples).toBe(100);
    // Max value in series should be the clamp.
    let max = -Infinity;
    for (let i = 0; i < r.tpaFactorSeries.length; i++) {
      const v = r.tpaFactorSeries[i];
      if (!Number.isNaN(v) && v > max) max = v;
    }
    expect(max).toBeLessThanOrEqual(3.0);
  });

  test('partial activity (50% below threshold) reflected in activePct', () => {
    const pre = new Float32Array(100);
    const post = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      if (i < 50) { pre[i] = 10; post[i] = 7; }
      else        { pre[i] = 0.2; post[i] = 0.1; }  // below activeThreshold
    }
    const r = analyzeSTermAxis(0, pre, post);
    expect(r.activeSamples).toBe(50);
    expect(r.activePct).toBe(50);
    expect(r.meanTpaFactor).toBeCloseTo(0.7, 2);
  });
});
