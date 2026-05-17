import { describe, test, expect } from 'vitest';

import { detectSaturation } from '@/lib/servoAnalysis';

function fill(n: number, v: number): Float32Array {
  const a = new Float32Array(n);
  a.fill(v);
  return a;
}

describe('detectSaturation', () => {
  test('empty input returns zeroed result', () => {
    const r = detectSaturation(new Float32Array(0));
    expect(r.saturatedFraction).toBe(0);
    expect(r.episodes).toBe(0);
    expect(r.episodeList).toHaveLength(0);
    expect(r.states).toHaveLength(0);
  });

  test('mid-range PWM never saturated', () => {
    const r = detectSaturation(fill(100, 1500));
    expect(r.saturatedFraction).toBe(0);
    expect(r.episodes).toBe(0);
    expect(r.lowHits).toBe(0);
    expect(r.highHits).toBe(0);
  });

  test('constant low PWM counts as a single low episode 100% saturated', () => {
    const r = detectSaturation(fill(100, 1000));
    expect(r.saturatedFraction).toBe(1);
    expect(r.episodes).toBe(1);
    expect(r.lowHits).toBe(1);
    expect(r.highHits).toBe(0);
    expect(r.episodeList[0].kind).toBe('low');
    expect(r.episodeList[0].startIdx).toBe(0);
    expect(r.episodeList[0].endIdx).toBe(99);
  });

  test('constant high PWM counts as a single high episode 100% saturated', () => {
    const r = detectSaturation(fill(100, 2000));
    expect(r.saturatedFraction).toBe(1);
    expect(r.episodes).toBe(1);
    expect(r.lowHits).toBe(0);
    expect(r.highHits).toBe(1);
    expect(r.episodeList[0].kind).toBe('high');
  });

  test('within-margin counts as saturated (default 25 µs)', () => {
    // 1024 is within 25 of 1000 → low. 1976 is within 25 of 2000 → high.
    const arr = new Float32Array([1500, 1024, 1500, 1976, 1500]);
    const r = detectSaturation(arr);
    expect(r.episodes).toBe(2);
    expect(r.lowHits).toBe(1);
    expect(r.highHits).toBe(1);
    expect(r.episodeList[0]).toMatchObject({ startIdx: 1, endIdx: 1, kind: 'low' });
    expect(r.episodeList[1]).toMatchObject({ startIdx: 3, endIdx: 3, kind: 'high' });
  });

  test('observed min/max tracked accurately', () => {
    const arr = new Float32Array([1200, 1500, 1800, 1100, 1900]);
    const r = detectSaturation(arr);
    expect(r.observedMin).toBe(1100);
    expect(r.observedMax).toBe(1900);
  });

  test('runs of low + high are counted separately', () => {
    // Low for samples 0-3, mid for 4-7, high for 8-11.
    const arr = new Float32Array(12);
    for (let i = 0; i < 4;  i++) arr[i] = 1000;
    for (let i = 4; i < 8;  i++) arr[i] = 1500;
    for (let i = 8; i < 12; i++) arr[i] = 2000;
    const r = detectSaturation(arr);
    expect(r.episodes).toBe(2);
    expect(r.lowHits).toBe(1);
    expect(r.highHits).toBe(1);
    expect(r.saturatedFraction).toBeCloseTo(8 / 12, 5);
  });

  test('longestRunMs uses configured sample rate', () => {
    const r = detectSaturation(fill(100, 1000), { sampleRateHz: 500 });
    // 100 samples at 500 Hz = 200 ms total.
    expect(r.longestRunMs).toBeCloseTo(200, 5);
  });

  test('custom marginUs tightens detection', () => {
    // 1010 is within 25 of 1000 but NOT within 5 of 1000.
    const arr = new Float32Array([1010, 1500]);
    const wide = detectSaturation(arr);
    const tight = detectSaturation(arr, { marginUs: 5 });
    expect(wide.episodes).toBe(1);
    expect(tight.episodes).toBe(0);
  });

  test('per-sample state array uses 1 (low) / 2 (high) / 0 (none)', () => {
    const r = detectSaturation(new Float32Array([1000, 1500, 2000]));
    expect(r.states[0]).toBe(1);
    expect(r.states[1]).toBe(0);
    expect(r.states[2]).toBe(2);
  });
});
