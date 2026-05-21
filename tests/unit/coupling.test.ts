import { describe, expect, test } from 'vitest';

import {
  analyzeCoupling,
  worstCoupling,
  MIN_WINDOWS_FOR_COUPLING,
} from '@/lib/coupling';
import type { ManeuverWindow } from '@/lib/maneuverDetect';

const SR = 1000;
const N = 4000;

function timeAxis(n: number): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = i / SR;
  return t;
}

/** Add a half-sine bump of the given peak into `g` over [lo, hi). The
 *  peak deviation from a zero baseline is exactly `peak` (at the mid-
 *  sample), with the sign of `peak`. */
function addBump(g: Float32Array, peak: number, lo: number, hi: number): void {
  const w = hi - lo;
  for (let i = lo; i < hi; i++) g[i] += peak * Math.sin((Math.PI * (i - lo)) / w);
}

function gyroWithBump(peak: number, lo: number, hi: number): Float32Array {
  const g = new Float32Array(N);
  addBump(g, peak, lo, hi);
  return g;
}

/** A single-axis maneuver window. The bump lives well inside it so the
 *  30 ms baseline lead-in sees flat pre-input flight. */
function maneuver(
  startIdx: number,
  endIdx: number,
  axis: 0 | 1 | 2,
  type?: ManeuverWindow['type'],
): ManeuverWindow {
  return {
    startIdx,
    endIdx,
    startSec: startIdx / SR,
    endSec: (endIdx - 1) / SR,
    dominantAxis: axis,
    type: type ?? (['roll', 'pitch', 'yaw'] as const)[axis],
    peakVelocityDegS2: 5000,
  };
}

describe('analyzeCoupling', () => {
  test('no cross-axis motion → off-diagonal ~zero, diagonal 1', () => {
    const roll = gyroWithBump(200, 1000, 1300);
    const flat = new Float32Array(N);
    const result = analyzeCoupling({
      gyro: [roll, flat, flat],
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0)],
    });
    expect(result.matrix[0][0]).toBe(1); // commanded axis vs itself
    expect(result.matrix[0][1]).toBeCloseTo(0, 5);
    expect(result.matrix[0][2]).toBeCloseTo(0, 5);
    expect(result.sampleCount).toEqual([1, 0, 0]);
  });

  test('recovers an injected roll→pitch coupling ratio', () => {
    const roll = gyroWithBump(200, 1000, 1300);
    const pitch = gyroWithBump(40, 1000, 1300); // 40 / 200 = 0.20
    const yaw = new Float32Array(N);
    const result = analyzeCoupling({
      gyro: [roll, pitch, yaw],
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0)],
    });
    expect(result.matrix[0][1]).toBeCloseTo(0.2, 3);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].commandedAxis).toBe(0);
    expect(result.windows[0].ratios[1]).toBeCloseTo(0.2, 3);
  });

  test("'mixed' windows are excluded — no single commanded axis", () => {
    const roll = gyroWithBump(200, 1000, 1300);
    const pitch = gyroWithBump(40, 1000, 1300);
    const yaw = new Float32Array(N);
    const result = analyzeCoupling({
      gyro: [roll, pitch, yaw],
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0, 'mixed')],
    });
    expect(result.sampleCount).toEqual([0, 0, 0]);
    expect(result.windows).toHaveLength(0);
    expect(result.matrix[0][1]).toBeNaN();
  });

  test('an absent responding axis yields a NaN matrix column', () => {
    const roll = gyroWithBump(200, 1000, 1300);
    const pitch = gyroWithBump(40, 1000, 1300);
    const result = analyzeCoupling({
      gyro: [roll, pitch, undefined], // yaw not logged
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0)],
    });
    expect(result.matrix[0][1]).toBeCloseTo(0.2, 3);
    expect(result.matrix[0][2]).toBeNaN();
  });

  test('sampleCount tracks single-axis windows per commanded axis', () => {
    const roll = new Float32Array(N);
    addBump(roll, 200, 1000, 1300);
    addBump(roll, 200, 1600, 1900);
    addBump(roll, 200, 2200, 2500);
    const pitch = gyroWithBump(200, 2800, 3100);
    const yaw = new Float32Array(N);
    const result = analyzeCoupling({
      gyro: [roll, pitch, yaw],
      time: timeAxis(N),
      maneuvers: [
        maneuver(900, 1400, 0),
        maneuver(1500, 2000, 0),
        maneuver(2100, 2600, 0),
        maneuver(2700, 3200, 1),
      ],
    });
    expect(result.sampleCount).toEqual([3, 1, 0]);
  });

  test('systematic coupling reinforces across opposite-direction snaps', () => {
    // Window A: roll right (+), pitch follows up (+).
    // Window B: roll left (−), pitch follows down (−).
    // Same physical coupling → both ratios sign-align to +0.2.
    const roll = new Float32Array(N);
    addBump(roll, 200, 1000, 1300);
    addBump(roll, -200, 2000, 2300);
    const pitch = new Float32Array(N);
    addBump(pitch, 40, 1000, 1300);
    addBump(pitch, -40, 2000, 2300);
    const result = analyzeCoupling({
      gyro: [roll, pitch, new Float32Array(N)],
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0), maneuver(1900, 2400, 0)],
    });
    expect(result.matrix[0][1]).toBeCloseTo(0.2, 3);
  });

  test('inconsistent coupling averages toward zero', () => {
    // Window A: roll +, pitch +.  Window B: roll −, pitch + (does NOT
    // follow the roll direction) → ratios +0.2 and −0.2 → mean ~0.
    const roll = new Float32Array(N);
    addBump(roll, 200, 1000, 1300);
    addBump(roll, -200, 2000, 2300);
    const pitch = new Float32Array(N);
    addBump(pitch, 40, 1000, 1300);
    addBump(pitch, 40, 2000, 2300);
    const result = analyzeCoupling({
      gyro: [roll, pitch, new Float32Array(N)],
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0), maneuver(1900, 2400, 0)],
    });
    expect(result.matrix[0][1]).toBeCloseTo(0, 3);
  });

  test('a window where the plane barely rotated is skipped', () => {
    // Commanded roll response of 10 deg/s is below MIN_CMD_RESPONSE
    // (20 deg/s) — the ratio denominator would explode, so skip it.
    const roll = gyroWithBump(10, 1000, 1300);
    const pitch = gyroWithBump(40, 1000, 1300);
    const result = analyzeCoupling({
      gyro: [roll, pitch, new Float32Array(N)],
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0)],
    });
    expect(result.sampleCount).toEqual([0, 0, 0]);
    expect(result.matrix[0][1]).toBeNaN();
  });

  test('lagged coupling in the response tail is still captured', () => {
    // Roll input ends at the window's endIdx (1400); the pitch wobble
    // onsets after, inside the 150 ms response tail.
    const roll = gyroWithBump(200, 1100, 1380);
    const pitch = gyroWithBump(50, 1410, 1540); // entirely past endIdx
    const result = analyzeCoupling({
      gyro: [roll, pitch, new Float32Array(N)],
      time: timeAxis(N),
      maneuvers: [maneuver(1000, 1400, 0)],
    });
    expect(result.matrix[0][1]).toBeCloseTo(0.25, 2); // 50 / 200
  });

  test('no maneuvers → all-NaN matrix, empty result', () => {
    const result = analyzeCoupling({
      gyro: [new Float32Array(N), new Float32Array(N), new Float32Array(N)],
      time: timeAxis(N),
      maneuvers: [],
    });
    expect(result.sampleCount).toEqual([0, 0, 0]);
    expect(result.windows).toHaveLength(0);
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) expect(result.matrix[c][r]).toBeNaN();
    }
  });
});

describe('worstCoupling', () => {
  test('picks the largest-magnitude off-diagonal cell', () => {
    const roll = gyroWithBump(200, 1000, 1300);
    const pitch = gyroWithBump(40, 1000, 1300); // roll→pitch 0.20
    const yaw = gyroWithBump(70, 1000, 1300); // roll→yaw 0.35
    const result = analyzeCoupling({
      gyro: [roll, pitch, yaw],
      time: timeAxis(N),
      maneuvers: [maneuver(900, 1400, 0)],
    });
    const worst = worstCoupling(result);
    expect(worst).not.toBeNull();
    expect(worst!.commandedAxis).toBe(0);
    expect(worst!.respondingAxis).toBe(2);
    expect(worst!.value).toBeCloseTo(0.35, 2);
  });

  test('returns null when the matrix has no finite off-diagonal cell', () => {
    const result = analyzeCoupling({
      gyro: [new Float32Array(N), new Float32Array(N), new Float32Array(N)],
      time: timeAxis(N),
      maneuvers: [],
    });
    expect(worstCoupling(result)).toBeNull();
  });
});

describe('module constants', () => {
  test('trust threshold is a sane positive integer', () => {
    expect(MIN_WINDOWS_FOR_COUPLING).toBeGreaterThan(0);
    expect(Number.isInteger(MIN_WINDOWS_FOR_COUPLING)).toBe(true);
  });
});
