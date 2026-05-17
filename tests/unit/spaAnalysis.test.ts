import { describe, test, expect } from 'vitest';

import {
  analyzeSpaAxis,
  debugSpaToMultiplier,
  setpointRate,
} from '@/lib/spaAnalysis';

function constantArr(n: number, value: number): Float32Array {
  const a = new Float32Array(n);
  a.fill(value);
  return a;
}

function linspace(n: number, start: number, end: number): Float32Array {
  const a = new Float32Array(n);
  const step = (end - start) / (n - 1);
  for (let i = 0; i < n; i++) a[i] = start + i * step;
  return a;
}

describe('debugSpaToMultiplier', () => {
  test('divides raw values by 1000', () => {
    const raw = new Float32Array([0, 250, 500, 750, 1000]);
    const out = debugSpaToMultiplier(raw);
    expect(Array.from(out)).toEqual([0, 0.25, 0.5, 0.75, 1.0]);
  });
});

describe('setpointRate', () => {
  test('linear ramp gives constant derivative', () => {
    const time = linspace(100, 0, 1); // 0..1s, 100 samples → dt = ~0.0101
    const setpoint = linspace(100, 0, 50); // 0..50 deg/s
    const rate = setpointRate(setpoint, time);
    // First sample is 0 (no previous); rest should be ~constant 50 deg/s²
    expect(rate[0]).toBe(0);
    for (let i = 1; i < rate.length; i++) {
      expect(rate[i]).toBeCloseTo(50, 0); // within 1
    }
  });
});

describe('analyzeSpaAxis', () => {
  test('empty input returns safe defaults', () => {
    const r = analyzeSpaAxis(0, new Float32Array(0), new Float32Array(0), new Float32Array(0));
    expect(r.gateActiveSamples).toBe(0);
    expect(r.gateActivePct).toBe(0);
    expect(r.events).toHaveLength(0);
  });

  test('SPA always at 1.0 → no gate activity, no events', () => {
    const n = 1000;
    const spa = constantArr(n, 1.0);
    const iTerm = constantArr(n, 5.0);
    const time = linspace(n, 0, 10);
    const r = analyzeSpaAxis(0, spa, iTerm, time);
    expect(r.gateActiveSamples).toBe(0);
    expect(r.gateActivePct).toBe(0);
    expect(r.minSpa).toBe(1.0);
    expect(r.meanSpa).toBeCloseTo(1.0, 5);
    expect(r.events).toHaveLength(0);
  });

  test('SPA always at 0 → 100% gate active, but no events when I-term is flat', () => {
    const n = 1000;
    const spa = constantArr(n, 0.0);
    const iTerm = constantArr(n, 0.0);
    const time = linspace(n, 0, 10);
    const r = analyzeSpaAxis(0, spa, iTerm, time);
    expect(r.gateActiveSamples).toBe(n);
    expect(r.gateActivePct).toBeCloseTo(100, 5);
    // No event because run never ends (no release boundary).
    expect(r.events).toHaveLength(0);
  });

  test('wind-up event detected when I-term grows during sustained gate-floor', () => {
    // 1000 samples, SPA at 0 from sample 100..500, then back to 1.
    // I-term ramps from 0 to 10 during the gated window, then holds.
    const n = 1000;
    const spa = new Float32Array(n);
    const iTerm = new Float32Array(n);
    const time = linspace(n, 0, 10);
    for (let i = 0; i < n; i++) {
      if (i >= 100 && i < 500) {
        spa[i] = 0.0;
        iTerm[i] = ((i - 100) / 400) * 10;  // 0..10 across gate
      } else if (i >= 500) {
        spa[i] = 1.0;
        iTerm[i] = 10;
      } else {
        spa[i] = 1.0;
        iTerm[i] = 0;
      }
    }
    const r = analyzeSpaAxis(0, spa, iTerm, time);
    const windups = r.events.filter((e) => e.kind === 'wind_up');
    expect(windups.length).toBeGreaterThan(0);
    // First wind-up should be at the start of the gated window (~time 1.0s).
    expect(windups[0].timeSec).toBeCloseTo(1.0, 1);
    // Severity should be high (full I-term range traversed during gate).
    expect(windups[0].severity).toBeGreaterThan(0.5);
  });

  test('bounce-back event detected when I-term peaks immediately after release', () => {
    // SPA at 0 from sample 100..200, then 1. I-term flat 0 until release,
    // then jumps to 8 (full-range peak relative to overall range 0..10).
    const n = 1000;
    const spa = new Float32Array(n);
    const iTerm = new Float32Array(n);
    const time = linspace(n, 0, 10);
    for (let i = 0; i < n; i++) {
      if (i >= 100 && i < 200) {
        spa[i] = 0.0;
        iTerm[i] = 0;
      } else if (i >= 200 && i < 220) {
        spa[i] = 1.0;
        iTerm[i] = 8;  // big post-release bounce
      } else if (i >= 220 && i < 800) {
        spa[i] = 1.0;
        iTerm[i] = 8;
      } else {
        spa[i] = 1.0;
        iTerm[i] = 10;  // sets overall iMax for severity normalization
      }
    }
    const r = analyzeSpaAxis(0, spa, iTerm, time);
    const bounces = r.events.filter((e) => e.kind === 'bounce_back');
    expect(bounces.length).toBeGreaterThan(0);
    // First bounce should be at gate release (~time 2.0s).
    expect(bounces[0].timeSec).toBeCloseTo(2.0, 1);
  });

  test('short gate-active blip below minEventSamples produces no events', () => {
    const n = 1000;
    const spa = constantArr(n, 1.0);
    const iTerm = new Float32Array(n);
    // Briefly drop SPA to 0 for only 4 samples (below default
    // minEventSamples = 16) at index 500.
    for (let i = 500; i < 504; i++) { spa[i] = 0.0; iTerm[i] = 5; }
    const time = linspace(n, 0, 10);
    const r = analyzeSpaAxis(0, spa, iTerm, time);
    expect(r.events).toHaveLength(0);
    // Gate-active samples still counted in the percentage even though no event.
    expect(r.gateActiveSamples).toBe(4);
  });
});
