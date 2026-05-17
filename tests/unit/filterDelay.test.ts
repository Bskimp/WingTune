import { describe, test, expect } from 'vitest';

import { computeDelayBudget } from '@/lib/filterDelay';
import type { FilterConfig } from '@/lib/wasmBridge';

function emptyConfig(): FilterConfig {
  return {
    dyn_notch: null,
    gyro_lpf1: null,
    gyro_lpf2: null,
    dterm_lpf1: null,
    dterm_lpf2: null,
    rpm_filter: null,
  };
}

describe('computeDelayBudget', () => {
  test('empty config returns zero stages and zero total', () => {
    const b = computeDelayBudget(emptyConfig());
    expect(b.stages).toHaveLength(0);
    expect(b.totalMs).toBe(0);
  });

  test('PT1 at 100 Hz gives ~1.59 ms delay', () => {
    const c = emptyConfig();
    c.gyro_lpf1 = { filter_type: 'PT1', static_hz: 100, dyn_min_hz: null, dyn_max_hz: null };
    const b = computeDelayBudget(c);
    expect(b.stages).toHaveLength(1);
    expect(b.stages[0].delayMs).toBeCloseTo(1.592, 2);
    expect(b.totalMs).toBeCloseTo(1.592, 2);
  });

  test('PT2 is 2× PT1 at same cutoff', () => {
    const c = emptyConfig();
    c.gyro_lpf1 = { filter_type: 'PT2', static_hz: 100, dyn_min_hz: null, dyn_max_hz: null };
    const b = computeDelayBudget(c);
    expect(b.stages[0].delayMs).toBeCloseTo(3.183, 2);
  });

  test('BIQUAD is 1.5× PT1', () => {
    const c = emptyConfig();
    c.gyro_lpf1 = { filter_type: 'BIQUAD', static_hz: 100, dyn_min_hz: null, dyn_max_hz: null };
    const b = computeDelayBudget(c);
    expect(b.stages[0].delayMs).toBeCloseTo(2.387, 2);
  });

  test('dynamic LPF uses dyn_min_hz (worst-case lowest cutoff)', () => {
    const c = emptyConfig();
    c.gyro_lpf1 = { filter_type: 'PT1', static_hz: 250, dyn_min_hz: 100, dyn_max_hz: 500 };
    const b = computeDelayBudget(c);
    // Should use 100 Hz (dyn_min), not 250 Hz (static).
    expect(b.stages[0].cutoffHz).toBe(100);
    expect(b.stages[0].delayMs).toBeCloseTo(1.592, 2);
  });

  test('dyn notch contributes Q/(π·fc) per notch summed across count', () => {
    const c = emptyConfig();
    c.dyn_notch = { count: 3, min_hz: 100, max_hz: 600, q: 300 }; // Q_actual = 3.0
    const b = computeDelayBudget(c);
    expect(b.stages).toHaveLength(1);
    // perNotch = 3 / (π · 100) s = ~9.55 ms; × 3 notches = ~28.65 ms
    expect(b.stages[0].delayMs).toBeCloseTo(28.65, 1);
  });

  test('full chain sums all configured stages', () => {
    const c: FilterConfig = {
      dyn_notch: { count: 3, min_hz: 100, max_hz: 600, q: 300 },
      gyro_lpf1: { filter_type: 'PT1', static_hz: 250, dyn_min_hz: 250, dyn_max_hz: 500 },
      gyro_lpf2: { filter_type: 'PT1', static_hz: 500, dyn_min_hz: null, dyn_max_hz: null },
      dterm_lpf1: { filter_type: 'PT1', static_hz: 75, dyn_min_hz: 75, dyn_max_hz: 150 },
      dterm_lpf2: { filter_type: 'PT1', static_hz: 150, dyn_min_hz: null, dyn_max_hz: null },
    };
    const b = computeDelayBudget(c);
    expect(b.stages).toHaveLength(5);
    // Each stage is positive and total equals the sum.
    let manualTotal = 0;
    for (const s of b.stages) {
      expect(s.delayMs).toBeGreaterThan(0);
      manualTotal += s.delayMs;
    }
    expect(b.totalMs).toBeCloseTo(manualTotal, 5);
  });

  test('LPF with zero cutoff is dropped', () => {
    const c = emptyConfig();
    c.gyro_lpf1 = { filter_type: 'PT1', static_hz: 0, dyn_min_hz: null, dyn_max_hz: null };
    const b = computeDelayBudget(c);
    expect(b.stages).toHaveLength(0);
  });

  test('unknown filter type falls back to PT1-equivalent delay', () => {
    const c = emptyConfig();
    c.gyro_lpf1 = { filter_type: 'SOMETHING_NEW', static_hz: 100, dyn_min_hz: null, dyn_max_hz: null };
    const b = computeDelayBudget(c);
    expect(b.stages[0].delayMs).toBeCloseTo(1.592, 2);
  });

  test('rpm filter contributes Q/(π·min_hz) per harmonic', () => {
    const c = emptyConfig();
    c.rpm_filter = { harmonics: 3, lpf_hz: 150, min_hz: 100, q: 500 }; // Q_actual = 5.0
    const b = computeDelayBudget(c);
    expect(b.stages).toHaveLength(1);
    // perNotch = 5 / (π · 100) s = ~15.92 ms; × 3 harmonics = ~47.75 ms
    expect(b.stages[0].delayMs).toBeCloseTo(47.75, 1);
  });

  test('rpm filter with zero harmonics is dropped', () => {
    const c = emptyConfig();
    c.rpm_filter = { harmonics: 0, lpf_hz: 150, min_hz: 100, q: 500 };
    const b = computeDelayBudget(c);
    expect(b.stages).toHaveLength(0);
  });
});
