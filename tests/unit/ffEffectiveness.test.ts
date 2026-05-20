import { describe, expect, test } from 'vitest';

import { analyzeFFAxis } from '@/lib/ffEffectiveness';
import type { ManeuverWindow } from '@/lib/maneuverDetect';

const SR = 1000;
const N = 4000;

function timeAxis(n: number): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = i / SR;
  return t;
}

/** Roll setpoint: flat 0, fast ramp 0→peak over `ramp` samples at
 *  `atIdx`, then held. Ramp derivative ~ peak/ramp/dt deg/s². */
function rampSetpoint(atIdx: number, ramp: number, peak: number): Float32Array {
  const sp = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (i < atIdx) sp[i] = 0;
    else if (i < atIdx + ramp) sp[i] = (peak * (i - atIdx)) / ramp;
    else sp[i] = peak;
  }
  return sp;
}

/** A maneuver window bracketing the ramp at [atIdx, atIdx+ramp],
 *  padded, on the given axis. */
function window(atIdx: number, ramp: number, axis: 0 | 1 | 2): ManeuverWindow {
  const startIdx = atIdx - 80;
  const endIdx = atIdx + ramp + 200;
  return {
    startIdx,
    endIdx,
    startSec: startIdx / SR,
    endSec: endIdx / SR,
    dominantAxis: axis,
    type: axis === 0 ? 'roll' : axis === 1 ? 'pitch' : 'yaw',
    peakVelocityDegS2: 6000,
  };
}

/** Constant-fill an array except inside [lo,hi) where it gets `inside`. */
function spanFill(inside: number, lo: number, hi: number, outside = 0): Float32Array {
  const a = new Float32Array(N).fill(outside);
  for (let i = lo; i < hi; i++) a[i] = inside;
  return a;
}

describe('analyzeFFAxis', () => {
  test('well-tuned FF (big F, small P during move) → healthy + high coverage', () => {
    const setpoint = rampSetpoint(1000, 50, 300);
    const axisF = spanFill(100, 1000, 1050); // F large during the move
    const axisP = spanFill(10, 1000, 1050);  // P small
    const gyro = setpoint;                    // perfect tracking, no overshoot
    const result = analyzeFFAxis({
      axis: 0, setpoint, axisF, axisP, gyro, time: timeAxis(N),
      maneuvers: [window(1000, 50, 0)],
    });
    expect(result.windowCount).toBe(1);
    expect(result.meanFFCoverage).toBeGreaterThan(0.8);
    expect(result.overshootCount).toBe(0);
    expect(result.verdict).toBe('healthy');
  });

  test('undergained FF (small F, big P during move) → undergained verdict', () => {
    const setpoint = rampSetpoint(1000, 50, 300);
    const axisF = spanFill(10, 1000, 1050);   // F tiny
    const axisP = spanFill(100, 1000, 1050);  // P carrying the move
    const gyro = setpoint;
    const result = analyzeFFAxis({
      axis: 0, setpoint, axisF, axisP, gyro, time: timeAxis(N),
      maneuvers: [window(1000, 50, 0)],
    });
    expect(result.meanFFCoverage).toBeLessThan(0.3);
    expect(result.verdict).toBe('undergained');
  });

  test('overgained FF (gyro overshoots setpoint on leading edge) → overgained', () => {
    const setpoint = rampSetpoint(1000, 50, 300);
    const axisF = spanFill(100, 1000, 1050);
    const axisP = spanFill(10, 1000, 1050);
    // Gyro punches 30% past the setpoint everywhere — clear overshoot.
    const gyro = new Float32Array(N);
    for (let i = 0; i < N; i++) gyro[i] = setpoint[i] * 1.3;
    const result = analyzeFFAxis({
      axis: 0, setpoint, axisF, axisP, gyro, time: timeAxis(N),
      maneuvers: [window(1000, 50, 0)],
    });
    expect(result.overshootCount).toBe(1);
    expect(result.windows[0].leadingEdgeOvershoot).toBeGreaterThan(0.15);
    expect(result.verdict).toBe('overgained');
  });

  test('no maneuvers → no-data verdict', () => {
    const flat = new Float32Array(N);
    const result = analyzeFFAxis({
      axis: 0, setpoint: flat, axisF: flat, axisP: flat, gyro: flat,
      time: timeAxis(N), maneuvers: [],
    });
    expect(result.windowCount).toBe(0);
    expect(result.verdict).toBe('no-data');
  });

  test('windows for a different axis are skipped', () => {
    const setpoint = rampSetpoint(1000, 50, 300);
    const axisF = spanFill(100, 1000, 1050);
    const axisP = spanFill(10, 1000, 1050);
    const result = analyzeFFAxis({
      axis: 0, setpoint, axisF, axisP, gyro: setpoint, time: timeAxis(N),
      maneuvers: [window(1000, 50, 1)], // pitch-dominant window
    });
    expect(result.windowCount).toBe(0);
    expect(result.verdict).toBe('no-data');
  });

  test('mixed-type windows are included for any axis', () => {
    const setpoint = rampSetpoint(1000, 50, 300);
    const axisF = spanFill(100, 1000, 1050);
    const axisP = spanFill(10, 1000, 1050);
    const mixed: ManeuverWindow = { ...window(1000, 50, 1), type: 'mixed' };
    const result = analyzeFFAxis({
      axis: 0, setpoint, axisF, axisP, gyro: setpoint, time: timeAxis(N),
      maneuvers: [mixed],
    });
    expect(result.windowCount).toBe(1);
  });

  test('clean F-term envelope reads low noise, noisy=false', () => {
    const setpoint = rampSetpoint(1000, 50, 300);
    const axisP = spanFill(10, 1000, 1050);
    // F = smooth half-sine bump across the window [920, 1250).
    const axisF = new Float32Array(N);
    for (let i = 920; i < 1250; i++) {
      axisF[i] = 100 * Math.sin((Math.PI * (i - 920)) / 330);
    }
    const result = analyzeFFAxis({
      axis: 0, setpoint, axisF, axisP, gyro: setpoint, time: timeAxis(N),
      maneuvers: [window(1000, 50, 0)],
    });
    expect(result.windows[0].ffNoiseRatio).toBeLessThan(0.15);
    expect(result.noisy).toBe(false);
  });

  test('jittery F-term reads high noise, noisy=true', () => {
    const setpoint = rampSetpoint(1000, 50, 300);
    const axisP = spanFill(10, 1000, 1050);
    // F = smooth bump + fast (6-sample period) jitter.
    const axisF = new Float32Array(N);
    for (let i = 920; i < 1250; i++) {
      const envelope = 100 * Math.sin((Math.PI * (i - 920)) / 330);
      const jitter = 50 * Math.sin((2 * Math.PI * (i - 920)) / 6);
      axisF[i] = envelope + jitter;
    }
    const result = analyzeFFAxis({
      axis: 0, setpoint, axisF, axisP, gyro: setpoint, time: timeAxis(N),
      maneuvers: [window(1000, 50, 0)],
    });
    expect(result.windows[0].ffNoiseRatio).toBeGreaterThan(0.35);
    expect(result.noisy).toBe(true);
  });
});
