import { describe, expect, test } from 'vitest';

import { detectManeuvers } from '@/lib/maneuverDetect';

const SR = 1000;

function timeAxis(n: number): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = i / SR;
  return t;
}

/** Build a roll setpoint that is flat 0 except for a fast ramp from 0
 *  to `peak` deg/s over `rampSamples`, starting at `atIdx`, then held.
 *  The ramp's derivative is the maneuver signal. */
function rampSetpoint(
  n: number,
  atIdx: number,
  rampSamples: number,
  peak: number,
): Float32Array {
  const sp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i < atIdx) sp[i] = 0;
    else if (i < atIdx + rampSamples) sp[i] = (peak * (i - atIdx)) / rampSamples;
    else sp[i] = peak;
  }
  return sp;
}

describe('detectManeuvers', () => {
  test('flat setpoint produces no maneuvers', () => {
    const n = 4000;
    const flat = new Float32Array(n);
    const result = detectManeuvers([flat, flat, flat], timeAxis(n));
    expect(result).toHaveLength(0);
  });

  test('a single fast roll ramp is detected as a roll maneuver', () => {
    const n = 4000;
    // 0 → 300 deg/s over 50 samples = velocity ~6000 deg/s², well over
    // the 1500 enter threshold.
    const roll = rampSetpoint(n, 1000, 50, 300);
    const flat = new Float32Array(n);
    const result = detectManeuvers([roll, flat, flat], timeAxis(n));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('roll');
    expect(result[0].dominantAxis).toBe(0);
    // Window should bracket the ramp (1000..1050), padded by ~80 ms.
    expect(result[0].startIdx).toBeLessThan(1000);
    expect(result[0].endIdx).toBeGreaterThan(1050);
    expect(result[0].peakVelocityDegS2).toBeGreaterThan(1500);
  });

  test('slow ramp below threshold is NOT detected', () => {
    const n = 4000;
    // 0 → 300 deg/s over 2000 samples = velocity ~150 deg/s², far below
    // the 1500 enter threshold.
    const roll = rampSetpoint(n, 500, 2000, 300);
    const flat = new Float32Array(n);
    const result = detectManeuvers([roll, flat, flat], timeAxis(n));
    expect(result).toHaveLength(0);
  });

  test('simultaneous fast roll + pitch classifies as mixed', () => {
    const n = 4000;
    const roll  = rampSetpoint(n, 1000, 50, 300);
    const pitch = rampSetpoint(n, 1000, 50, 290); // within 30% of roll
    const flat  = new Float32Array(n);
    const result = detectManeuvers([roll, pitch, flat], timeAxis(n));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('mixed');
  });

  test('two separated fast inputs produce two windows', () => {
    const n = 8000;
    const roll = new Float32Array(n);
    // First ramp at 1000, second at 5000 — well past any merge gap.
    for (let i = 1000; i < 1050; i++) roll[i] = (300 * (i - 1000)) / 50;
    for (let i = 1050; i < 5000; i++) roll[i] = 300;
    for (let i = 5000; i < 5050; i++) roll[i] = 300 - (300 * (i - 5000)) / 50;
    // settle back to 0 after the second ramp.
    const flat = new Float32Array(n);
    const result = detectManeuvers([roll, flat, flat], timeAxis(n));
    expect(result.length).toBe(2);
  });

  test('returns empty for too-short input', () => {
    expect(detectManeuvers([new Float32Array(2)], timeAxis(2))).toHaveLength(0);
  });

  test('respects a custom enter threshold', () => {
    const n = 4000;
    const roll = rampSetpoint(n, 1000, 50, 300); // ~6000 deg/s²
    const flat = new Float32Array(n);
    // Threshold above the peak → no detection.
    const result = detectManeuvers([roll, flat, flat], timeAxis(n), {
      enterThreshold: 10000,
    });
    expect(result).toHaveLength(0);
  });
});
