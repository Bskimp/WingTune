import { describe, test, expect } from 'vitest';

import { computeServoHunt } from '@/lib/servoHunt';
import type { AxisCorrelations } from '@/lib/servoClassifier';

const FS = 1000;

// --- signal helpers -------------------------------------------------

function timeAxis(n: number): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = i / FS;
  return t;
}

/** Pure sine of `freqHz`, amplitude `amp`. */
function sine(n: number, freqHz: number, amp: number, phase = 0): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / FS + phase);
  }
  return s;
}

/** Element-wise sum of equal-length arrays. */
function add(...arrs: Float32Array[]): Float32Array {
  const n = arrs[0].length;
  const out = new Float32Array(n);
  for (const a of arrs) for (let i = 0; i < n; i++) out[i] += a[i];
  return out;
}

/** servo PWM = 1500 µs trim + `gain` × a command signal. */
function servoFrom(command: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(command.length);
  for (let i = 0; i < command.length; i++) out[i] = 1500 + gain * command[i];
  return out;
}

function corr(fieldName: string, axis: 0 | 1 | 2 | null): AxisCorrelations {
  return {
    fieldName,
    roll: 0,
    pitch: 0,
    yaw: 0,
    dominantAxis: axis,
    dominantSigned: axis === null ? 0 : 0.85,
  };
}

// --- tests ----------------------------------------------------------

describe('computeServoHunt', () => {
  const N = 30_000; // 30 s

  test('pure commanded response — high HF energy but ~0 hunt score', () => {
    // The pilot setpoint itself carries fast content; the servo is an
    // exact scaled copy of it. HF energy is large, yet every bit of it
    // tracks the command → hunt score must collapse to ~0.
    const setpoint = add(sine(N, 1, 200), sine(N, 35, 100));
    const servo = servoFrom(setpoint, 0.5);
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map([['servo[0]', servo]]),
      axisCorrelations: [corr('servo[0]', 0)],
      setpoint: [setpoint, undefined, undefined],
    });

    expect(r.channels).toHaveLength(1);
    const ch = r.channels[0];
    expect(ch.hfRmsPwm).toBeGreaterThan(10);          // real HF energy
    expect(ch.commandCorrelation).toBeGreaterThan(0.98);
    expect(ch.huntScore).toBeLessThan(0.5);            // but it's commanded
    expect(ch.severity).toBe('ok');
  });

  test('injected uncommanded oscillation — high hunt score', () => {
    // The servo carries a fast oscillation that is in NO command —
    // the setpoint is a slow turn only.
    const setpoint = sine(N, 1, 200);
    const servo = add(servoFrom(setpoint, 0.5), sine(N, 45, 30));
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map([['servo[0]', servo]]),
      axisCorrelations: [corr('servo[0]', 0)],
      setpoint: [setpoint, undefined, undefined],
    });

    const ch = r.channels[0];
    expect(ch.commandCorrelation).toBeLessThan(0.3);
    expect(ch.huntScore).toBeGreaterThan(8);
    expect(ch.severity).toBe('hunt');
  });

  test('clean low-frequency servo — ~0 hunt score', () => {
    // Only a slow commanded turn — nothing in the hunt band.
    const setpoint = sine(N, 1, 300);
    const servo = servoFrom(setpoint, 0.5);
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map([['servo[0]', servo]]),
      axisCorrelations: [corr('servo[0]', 0)],
      setpoint: [setpoint, undefined, undefined],
    });

    const ch = r.channels[0];
    expect(ch.hfRmsPwm).toBeLessThan(1);
    expect(ch.huntScore).toBeLessThan(1);
    expect(ch.severity).toBe('ok');
  });

  test('moderate uncommanded oscillation lands in the watch band', () => {
    const setpoint = sine(N, 1, 200);
    const servo = add(servoFrom(setpoint, 0.5), sine(N, 45, 10));
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map([['servo[0]', servo]]),
      axisCorrelations: [corr('servo[0]', 0)],
      setpoint: [setpoint, undefined, undefined],
    });

    const ch = r.channels[0];
    expect(ch.huntScore).toBeGreaterThan(3);
    expect(ch.huntScore).toBeLessThan(8);
    expect(ch.severity).toBe('watch');
  });

  test('multiple channels are scored + routed to their own axis', () => {
    const setRoll = sine(N, 1, 200);
    const setPitch = sine(N, 1, 200, Math.PI / 3);
    const huntingRoll = add(servoFrom(setRoll, 0.5), sine(N, 45, 30));
    const cleanPitch = servoFrom(setPitch, 0.5);
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map([
        ['servo[0]', huntingRoll],
        ['servo[1]', cleanPitch],
      ]),
      axisCorrelations: [corr('servo[0]', 0), corr('servo[1]', 1)],
      setpoint: [setRoll, setPitch, undefined],
    });

    expect(r.channels).toHaveLength(2);
    const roll = r.channels.find((c) => c.fieldName === 'servo[0]')!;
    const pitch = r.channels.find((c) => c.fieldName === 'servo[1]')!;
    expect(roll.axis).toBe(0);
    expect(roll.severity).toBe('hunt');
    expect(pitch.axis).toBe(1);
    expect(pitch.severity).toBe('ok');
  });

  test('missing setpoint reference — HF energy reported, severity unknown', () => {
    const servo = add(servoFrom(sine(N, 1, 200), 0.5), sine(N, 45, 30));
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map([['servo[0]', servo]]),
      axisCorrelations: [corr('servo[0]', 0)],
      setpoint: [undefined, undefined, undefined],
    });

    const ch = r.channels[0];
    expect(ch.hasReference).toBe(false);
    expect(ch.hfRmsPwm).toBeGreaterThan(0);          // still measurable
    expect(Number.isNaN(ch.commandCorrelation)).toBe(true);
    expect(Number.isNaN(ch.huntScore)).toBe(true);
    expect(ch.severity).toBe('unknown');
  });

  test('log too short to score — severity unknown', () => {
    const n = 100; // below MIN_SAMPLES
    const setpoint = sine(n, 1, 200);
    const r = computeServoHunt({
      time: timeAxis(n),
      servos: new Map([['servo[0]', servoFrom(setpoint, 0.5)]]),
      axisCorrelations: [corr('servo[0]', 0)],
      setpoint: [setpoint, undefined, undefined],
    });
    expect(r.channels[0].severity).toBe('unknown');
    expect(Number.isNaN(r.channels[0].huntScore)).toBe(true);
  });

  test('unclassified channels (dominantAxis null) are skipped', () => {
    const setpoint = sine(N, 1, 200);
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map([
        ['servo[0]', servoFrom(setpoint, 0.5)],
        ['motor[0]', sine(N, 1, 50)],
      ]),
      axisCorrelations: [corr('servo[0]', 0), corr('motor[0]', null)],
      setpoint: [setpoint, undefined, undefined],
    });
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0].fieldName).toBe('servo[0]');
  });

  test('no servo channels — empty result', () => {
    const r = computeServoHunt({
      time: timeAxis(N),
      servos: new Map(),
      axisCorrelations: [],
      setpoint: [sine(N, 1, 200), undefined, undefined],
    });
    expect(r.channels).toHaveLength(0);
    expect(r.sampleRateHz).toBeGreaterThan(0);
  });

  test('custom thresholds reclassify the same score', () => {
    const setpoint = sine(N, 1, 200);
    const servo = add(servoFrom(setpoint, 0.5), sine(N, 45, 30));
    const inputs = {
      time: timeAxis(N),
      servos: new Map([['servo[0]', servo]]),
      axisCorrelations: [corr('servo[0]', 0)],
      setpoint: [setpoint, undefined, undefined] as (Float32Array | undefined)[],
    };
    // Default thresholds → 'hunt'. Raised well above the score → 'ok'.
    expect(computeServoHunt(inputs).channels[0].severity).toBe('hunt');
    expect(
      computeServoHunt(inputs, { watchThreshold: 100, huntThreshold: 200 })
        .channels[0].severity,
    ).toBe('ok');
  });

  test('echoes the HF cutoff actually used', () => {
    const r = computeServoHunt(
      {
        time: timeAxis(N),
        servos: new Map(),
        axisCorrelations: [],
        setpoint: [undefined, undefined, undefined],
      },
      { hfCutoffHz: 25 },
    );
    expect(r.hfCutoffHz).toBe(25);
  });
});
