import { describe, test, expect } from 'vitest';

import { resampleToTimeAxis } from '@/lib/timeAlign';

describe('resampleToTimeAxis', () => {
  test('identical time axes return identical values', () => {
    const t = new Float32Array([0, 1, 2, 3, 4]);
    const v = new Float32Array([10, 20, 30, 40, 50]);
    const out = resampleToTimeAxis(t, v, t);
    expect(Array.from(out)).toEqual(Array.from(v));
  });

  test('linear interpolation between samples', () => {
    const srcT = new Float32Array([0, 2]);
    const srcV = new Float32Array([10, 30]);
    const dstT = new Float32Array([0, 0.5, 1, 1.5, 2]);
    const out = resampleToTimeAxis(srcT, srcV, dstT);
    expect(out[0]).toBeCloseTo(10);
    expect(out[1]).toBeCloseTo(15);
    expect(out[2]).toBeCloseTo(20);
    expect(out[3]).toBeCloseTo(25);
    expect(out[4]).toBeCloseTo(30);
  });

  test('clamps to first value when dst is before src start', () => {
    const srcT = new Float32Array([2, 4]);
    const srcV = new Float32Array([10, 20]);
    const dstT = new Float32Array([0, 1, 2]);
    const out = resampleToTimeAxis(srcT, srcV, dstT);
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(10);
    expect(out[2]).toBe(10);
  });

  test('clamps to last value when dst is after src end', () => {
    const srcT = new Float32Array([0, 2]);
    const srcV = new Float32Array([10, 20]);
    const dstT = new Float32Array([2, 3, 4]);
    const out = resampleToTimeAxis(srcT, srcV, dstT);
    expect(out[0]).toBe(20);
    expect(out[1]).toBe(20);
    expect(out[2]).toBe(20);
  });

  test('5 Hz GPS upsampled to 100 Hz main-frame axis preserves ramp slope', () => {
    const gpsT = new Float32Array(50);
    const gpsV = new Float32Array(50);
    for (let i = 0; i < 50; i++) {
      gpsT[i] = i * 0.2;
      gpsV[i] = i * 0.4;
    }
    const mainT = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) mainT[i] = i * 0.01;

    const out = resampleToTimeAxis(gpsT, gpsV, mainT);
    expect(out.length).toBe(1000);
    // At t=5.0 the ramp is at value 10.0; interpolation should land there.
    expect(out[500]).toBeCloseTo(10, 1);
    // Slope between any two adjacent points stays linear-with-noise.
    const slopeSamples = [100, 300, 500, 700, 900];
    for (const idx of slopeSamples) {
      const dy = out[idx + 1] - out[idx];
      // Expected slope: 0.4 (gps) per 0.2s = 2.0 per second; at 100 Hz that's 0.02 per step.
      expect(dy).toBeCloseTo(0.02, 3);
    }
  });

  test('empty dst returns empty', () => {
    const out = resampleToTimeAxis(
      new Float32Array([0, 1]),
      new Float32Array([10, 20]),
      new Float32Array(0),
    );
    expect(out.length).toBe(0);
  });

  test('empty src returns zero-filled dst-length array', () => {
    const out = resampleToTimeAxis(
      new Float32Array(0),
      new Float32Array(0),
      new Float32Array([0, 1, 2]),
    );
    expect(out.length).toBe(3);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  test('throws on src length mismatch', () => {
    expect(() =>
      resampleToTimeAxis(
        new Float32Array([0, 1]),
        new Float32Array([10]),
        new Float32Array([0]),
      ),
    ).toThrow(/length mismatch/);
  });

  test('handles repeated src timestamps without dividing by zero', () => {
    const srcT = new Float32Array([0, 1, 1, 2]);
    const srcV = new Float32Array([0, 10, 20, 30]);
    const dstT = new Float32Array([0, 0.5, 1, 1.5, 2]);
    const out = resampleToTimeAxis(srcT, srcV, dstT);
    expect(Number.isFinite(out[2])).toBe(true);
    expect(Number.isFinite(out[3])).toBe(true);
  });
});
