import { describe, test, expect } from 'vitest';

import { computeAirspeedStepResponse } from '@/lib/airspeedStepResponse';

const FS = 1000;

/** Closed-loop plant: gyro = first-order lag of the setpoint. A clean
 *  tracker, so the deconvolution settles near 1.0 and passes tail QC. */
function simulateFirstOrder(setpoint: Float32Array, tauSec: number): Float32Array {
  const out = new Float32Array(setpoint.length);
  const dt = 1 / FS;
  const alpha = dt / (tauSec + dt);
  let y = 0;
  for (let i = 0; i < setpoint.length; i++) {
    y += alpha * (setpoint[i] - y);
    out[i] = y;
  }
  return out;
}

/** Square-wave setpoint ±amp flipping every `halfPeriod` samples, only
 *  up to `activeUntil` (flat 0 afterward). */
function squareSetpoint(
  n: number,
  halfPeriod: number,
  amp: number,
  activeUntil = n,
): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < Math.min(n, activeUntil); i++) {
    s[i] = Math.floor(i / halfPeriod) % 2 === 0 ? amp : -amp;
  }
  return s;
}

function ramp(n: number, v0: number, v1: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = v0 + ((v1 - v0) * i) / (n - 1);
  return a;
}

describe('computeAirspeedStepResponse', () => {
  test('bins the airspeed range into contiguous ascending bins', () => {
    const n = 24_576;
    const setpoint = squareSetpoint(n, 200, 100);
    const gyro = simulateFirstOrder(setpoint, 0.08);
    const airspeed = ramp(n, 10, 40);

    const r = computeAirspeedStepResponse(setpoint, gyro, airspeed, FS, { binCount: 3 });

    expect(r.hasAirspeed).toBe(true);
    expect(r.bins).toHaveLength(3);
    // Bins are contiguous + ascending.
    expect(r.bins[0].hiSpeed).toBeCloseTo(r.bins[1].loSpeed, 5);
    expect(r.bins[1].hiSpeed).toBeCloseTo(r.bins[2].loSpeed, 5);
    expect(r.bins[0].midSpeed).toBeLessThan(r.bins[1].midSpeed);
    expect(r.bins[1].midSpeed).toBeLessThan(r.bins[2].midSpeed);
    // 5th-percentile clip keeps the low edge a little above the 10 m/s min.
    expect(r.bins[0].loSpeed).toBeGreaterThan(10);
    expect(r.bins[0].loSpeed).toBeLessThan(14);
  });

  test('shares one impulse-relative time axis across every bin', () => {
    const n = 24_576;
    const setpoint = squareSetpoint(n, 200, 100);
    const gyro = simulateFirstOrder(setpoint, 0.08);
    const r = computeAirspeedStepResponse(setpoint, gyro, ramp(n, 10, 40), FS, {
      binCount: 3,
    });
    expect(r.time.length).toBeGreaterThan(0);
    for (const b of r.bins) {
      expect(b.response.time.length).toBe(r.time.length);
    }
  });

  test('airspeed bins restrict the deconvolution — steps only at low speed', () => {
    const n = 24_576;
    // Steps live only in the first third → low-airspeed end of the ramp.
    const setpoint = squareSetpoint(n, 200, 100, 8192);
    const gyro = simulateFirstOrder(setpoint, 0.08);
    const airspeed = ramp(n, 10, 40);

    const r = computeAirspeedStepResponse(setpoint, gyro, airspeed, FS, { binCount: 3 });

    // The low bin caught real steps; the high bin saw only flat cruise.
    expect(r.bins[0].response.numSegments).toBeGreaterThan(0);
    expect(r.bins[2].response.numSegments).toBe(0);
  });

  test('all-NaN airspeed → hasAirspeed false', () => {
    const n = 24_576;
    const setpoint = squareSetpoint(n, 200, 100);
    const gyro = simulateFirstOrder(setpoint, 0.08);
    const r = computeAirspeedStepResponse(
      setpoint, gyro, new Float32Array(n).fill(NaN), FS,
    );
    expect(r.hasAirspeed).toBe(false);
    expect(r.bins).toHaveLength(0);
  });

  test('constant airspeed (no spread) → hasAirspeed false', () => {
    const n = 24_576;
    const setpoint = squareSetpoint(n, 200, 100);
    const gyro = simulateFirstOrder(setpoint, 0.08);
    const r = computeAirspeedStepResponse(
      setpoint, gyro, new Float32Array(n).fill(22), FS,
    );
    expect(r.hasAirspeed).toBe(false);
  });

  test('signal shorter than one segment → graceful empty result', () => {
    const n = 1000; // below the default 2048 segment length
    const r = computeAirspeedStepResponse(
      squareSetpoint(n, 100, 100),
      new Float32Array(n),
      ramp(n, 10, 40),
      FS,
    );
    expect(r.hasAirspeed).toBe(false);
    expect(r.bins).toHaveLength(0);
    expect(r.time.length).toBe(0);
  });
});
