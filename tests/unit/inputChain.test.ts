import { describe, test, expect } from 'vitest';

import {
  buildPerAxisServoAggregate,
  computeInputChain,
  type InputChainInputs,
} from '@/lib/inputChain';
import type { AxisCorrelations } from '@/lib/servoClassifier';

// Helper: build a Float32Array time axis at 1 kHz spanning `seconds`.
function buildTime(seconds: number, hz = 1000): Float32Array {
  const n = Math.floor(seconds * hz);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i / hz;
  return out;
}

// Synthesise a band-limited signal: low-frequency sine + amplitude.
// Wing setpoints / servo PWMs tend to have low-frequency dominant
// energy plus higher-frequency noise. We model the dominant motion
// only — the lag estimator should handle the realistic case fine.
function buildSine(n: number, hz: number, freqHz: number, amplitude: number): Float32Array {
  const out = new Float32Array(n);
  const w = 2 * Math.PI * freqHz / hz;
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(w * i);
  return out;
}

// Shift a signal by `samples` (positive = delay).
function shift(src: Float32Array, samples: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const j = i - samples;
    if (j >= 0 && j < src.length) out[i] = src[j];
  }
  return out;
}

// ---------------------------------------------------------------------------
// buildPerAxisServoAggregate
// ---------------------------------------------------------------------------

describe('buildPerAxisServoAggregate', () => {
  test('opposite-sign servos add together (true differential elevons)', () => {
    // Two servos: motor[0] = +roll-correlated, motor[1] = -roll-correlated.
    // Center = 1500. Servo 0 swings +50, Servo 1 swings -50.
    // After sign-alignment: both contribute +50 → aggregate = +100.
    const len = 16;
    const m0 = Float32Array.from({ length: len }, () => 1550);
    const m1 = Float32Array.from({ length: len }, () => 1450);
    const motors = new Map([['motor[0]', m0], ['motor[1]', m1]]);
    const axisCorrelations: AxisCorrelations[] = [
      { fieldName: 'motor[0]', roll:  0.95, pitch: 0, yaw: 0, dominantAxis: 0, dominantSigned:  0.95 },
      { fieldName: 'motor[1]', roll: -0.95, pitch: 0, yaw: 0, dominantAxis: 0, dominantSigned: -0.95 },
    ];
    const agg = buildPerAxisServoAggregate({ motors, axisCorrelations, length: len });
    expect(agg[0]).toBeDefined();
    expect(agg[1]).toBeUndefined();
    expect(agg[2]).toBeUndefined();
    for (let i = 0; i < len; i++) {
      expect(agg[0]![i]).toBeCloseTo(100, 2);
    }
  });

  test('paired-identical servos add (canonical wing setup)', () => {
    // BF mixer sends same PWM, both classify as +roll. Both at 1550 →
    // each contributes +50, aggregate = +100.
    const len = 16;
    const m0 = Float32Array.from({ length: len }, () => 1550);
    const m1 = Float32Array.from({ length: len }, () => 1550);
    const motors = new Map([['motor[0]', m0], ['motor[1]', m1]]);
    const axisCorrelations: AxisCorrelations[] = [
      { fieldName: 'motor[0]', roll: 0.95, pitch: 0, yaw: 0, dominantAxis: 0, dominantSigned: 0.95 },
      { fieldName: 'motor[1]', roll: 0.95, pitch: 0, yaw: 0, dominantAxis: 0, dominantSigned: 0.95 },
    ];
    const agg = buildPerAxisServoAggregate({ motors, axisCorrelations, length: len });
    for (let i = 0; i < len; i++) {
      expect(agg[0]![i]).toBeCloseTo(100, 2);
    }
  });

  test('axis with no contributors yields undefined', () => {
    const motors = new Map<string, Float32Array>();
    const agg = buildPerAxisServoAggregate({ motors, axisCorrelations: [], length: 16 });
    expect(agg[0]).toBeUndefined();
    expect(agg[1]).toBeUndefined();
    expect(agg[2]).toBeUndefined();
  });

  test('per-axis fan-out: roll + pitch contributors land in separate slots', () => {
    const len = 8;
    const m0 = Float32Array.from({ length: len }, () => 1550); // roll
    const m1 = Float32Array.from({ length: len }, () => 1530); // pitch
    const motors = new Map([['motor[0]', m0], ['motor[1]', m1]]);
    const axisCorrelations: AxisCorrelations[] = [
      { fieldName: 'motor[0]', roll: 0.9, pitch: 0,   yaw: 0, dominantAxis: 0, dominantSigned: 0.9 },
      { fieldName: 'motor[1]', roll: 0,   pitch: 0.9, yaw: 0, dominantAxis: 1, dominantSigned: 0.9 },
    ];
    const agg = buildPerAxisServoAggregate({ motors, axisCorrelations, length: len });
    expect(agg[0]).toBeDefined();
    expect(agg[1]).toBeDefined();
    expect(agg[2]).toBeUndefined();
    expect(agg[0]![0]).toBeCloseTo(50, 2);  // 1550 - 1500
    expect(agg[1]![0]).toBeCloseTo(30, 2);  // 1530 - 1500
  });
});

// ---------------------------------------------------------------------------
// computeInputChain
// ---------------------------------------------------------------------------

describe('computeInputChain', () => {
  test('recovers a known lag within ±2ms across each stage (roll axis)', () => {
    // Build a 6-second sine input at 0.8 Hz. Lag each stage by a known
    // amount. The estimator should recover each one independently to
    // within one sample (1ms at 1kHz).
    const hz = 1000;
    const seconds = 6;
    const n = seconds * hz;
    const time = buildTime(seconds, hz);
    const rc       = buildSine(n, hz, 0.8, 100);
    const setp     = shift(rc,   5);    // stage A: 5ms
    const servo    = shift(setp, 20);   // stage B: 20ms
    const gyro     = shift(servo, 30);  // stage C: 30ms

    const inputs: InputChainInputs = {
      time,
      rcCommand: [rc, undefined, undefined],
      setpoint:  [setp, undefined, undefined],
      servoAgg:  [servo, undefined, undefined],
      gyro:      [gyro, undefined, undefined],
    };
    const result = computeInputChain(inputs);
    const roll = result.axes[0];
    expect(roll.hasData).toBe(true);
    expect(roll.stages.A.lagMs).toBeGreaterThanOrEqual(3);
    expect(roll.stages.A.lagMs).toBeLessThanOrEqual(7);
    expect(roll.stages.B.lagMs).toBeGreaterThanOrEqual(18);
    expect(roll.stages.B.lagMs).toBeLessThanOrEqual(22);
    expect(roll.stages.C.lagMs).toBeGreaterThanOrEqual(28);
    expect(roll.stages.C.lagMs).toBeLessThanOrEqual(32);
    // Total = sum of stages → 5 + 20 + 30 = 55 ms.
    expect(roll.totalLagMs).toBeGreaterThanOrEqual(50);
    expect(roll.totalLagMs).toBeLessThanOrEqual(60);
  });

  test('missing axis → NaN stages + hasData false', () => {
    const time = buildTime(6, 1000);
    const inputs: InputChainInputs = {
      time,
      rcCommand: [undefined, undefined, undefined],
      setpoint:  [undefined, undefined, undefined],
      servoAgg:  [undefined, undefined, undefined],
      gyro:      [undefined, undefined, undefined],
    };
    const result = computeInputChain(inputs);
    for (const ax of result.axes) {
      expect(ax.hasData).toBe(false);
      expect(Number.isNaN(ax.stages.A.lagMs)).toBe(true);
      expect(Number.isNaN(ax.stages.B.lagMs)).toBe(true);
      expect(Number.isNaN(ax.stages.C.lagMs)).toBe(true);
    }
  });

  test('idle servo (zero variance input) skipped → no estimate', () => {
    const hz = 1000;
    const seconds = 6;
    const n = seconds * hz;
    const time = buildTime(seconds, hz);
    const idle = new Float32Array(n);  // all zeros
    const gyro = buildSine(n, hz, 0.8, 50);  // gyro has motion but input doesn't
    const inputs: InputChainInputs = {
      time,
      rcCommand: [idle, undefined, undefined],
      setpoint:  [idle, undefined, undefined],
      servoAgg:  [idle, undefined, undefined],
      gyro:      [gyro, undefined, undefined],
    };
    const result = computeInputChain(inputs);
    // Idle input means stage A (rc→setpoint) skips all windows → NaN.
    expect(Number.isNaN(result.axes[0].stages.A.lagMs)).toBe(true);
    expect(result.axes[0].stages.A.windowCount).toBe(0);
  });

  test('three axes processed independently', () => {
    const hz = 1000;
    const seconds = 6;
    const n = seconds * hz;
    const time = buildTime(seconds, hz);
    const rcR  = buildSine(n, hz, 0.8, 100);
    const rcP  = buildSine(n, hz, 1.2, 100);
    const rcY  = buildSine(n, hz, 0.5, 100);
    const setR = shift(rcR, 4);
    const setP = shift(rcP, 8);
    const setY = shift(rcY, 2);
    const inputs: InputChainInputs = {
      time,
      rcCommand: [rcR,  rcP,  rcY],
      setpoint:  [setR, setP, setY],
      servoAgg:  [setR, setP, setY],  // tie servo = setpoint → stage B == 0
      gyro:      [setR, setP, setY],  // tie gyro  = servo    → stage C == 0
    };
    const result = computeInputChain(inputs);
    expect(result.axes[0].stages.A.lagMs).toBeCloseTo(4, 0);
    expect(result.axes[1].stages.A.lagMs).toBeCloseTo(8, 0);
    expect(result.axes[2].stages.A.lagMs).toBeCloseTo(2, 0);
    expect(result.axes[0].stages.B.lagMs).toBeCloseTo(0, 0);
    expect(result.axes[1].stages.B.lagMs).toBeCloseTo(0, 0);
  });

  test('sample-rate estimation works at 2 kHz', () => {
    const hz = 2000;
    const seconds = 6;
    const n = seconds * hz;
    const time = buildTime(seconds, hz);
    const rc   = buildSine(n, hz, 0.8, 100);
    const setp = shift(rc, 10);  // 10 samples @ 2 kHz = 5 ms
    const inputs: InputChainInputs = {
      time,
      rcCommand: [rc,   undefined, undefined],
      setpoint:  [setp, undefined, undefined],
      servoAgg:  [undefined, undefined, undefined],
      gyro:      [undefined, undefined, undefined],
    };
    const result = computeInputChain(inputs);
    expect(result.sampleRateHz).toBeCloseTo(2000, -1);
    // 5ms (10 samples @ 2 kHz) — should land between 4-6 ms.
    expect(result.axes[0].stages.A.lagMs).toBeGreaterThanOrEqual(4);
    expect(result.axes[0].stages.A.lagMs).toBeLessThanOrEqual(6);
  });
});
