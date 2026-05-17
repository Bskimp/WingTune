import { describe, test, expect } from 'vitest';

import {
  classifyServos,
  correlateServosToAxes,
  pearsonCorrelation,
} from '@/lib/servoClassifier';

function f32(values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe('pearsonCorrelation', () => {
  test('returns 1.0 for perfectly correlated series', () => {
    const x = f32([1, 2, 3, 4, 5]);
    const y = f32([2, 4, 6, 8, 10]);
    expect(pearsonCorrelation(x, y)).toBeCloseTo(1.0, 5);
  });

  test('returns -1.0 for perfectly anti-correlated series', () => {
    const x = f32([1, 2, 3, 4, 5]);
    const y = f32([5, 4, 3, 2, 1]);
    expect(pearsonCorrelation(x, y)).toBeCloseTo(-1.0, 5);
  });

  test('returns 0 when one series is constant (zero variance)', () => {
    const x = f32([1, 2, 3, 4, 5]);
    const y = f32([3, 3, 3, 3, 3]);
    expect(pearsonCorrelation(x, y)).toBe(0);
  });

  test('returns 0 for orthogonal-ish series', () => {
    const x = f32([1, -1, 1, -1, 1, -1, 1, -1]);
    const y = f32([1, 1, -1, -1, 1, 1, -1, -1]);
    expect(Math.abs(pearsonCorrelation(x, y))).toBeLessThan(0.5);
  });

  test('returns 0 for empty inputs', () => {
    expect(pearsonCorrelation(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});

describe('correlateServosToAxes', () => {
  test('servo tracking roll setpoint resolves to roll-dominant', () => {
    const setpointRoll  = f32([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const setpointPitch = f32([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const setpointYaw   = f32([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const servoArr      = f32([1500, 1520, 1540, 1560, 1580, 1600, 1620, 1640, 1660, 1680]);
    const servos = new Map([['servo[0]', servoArr]]);
    const result = correlateServosToAxes(servos, setpointRoll, setpointPitch, setpointYaw);
    expect(result).toHaveLength(1);
    expect(result[0].dominantAxis).toBe(0);
    expect(result[0].dominantSigned).toBeGreaterThan(0.9);
  });

  test('uncorrelated noise reports null dominant axis', () => {
    const n = 100;
    const setpointRoll  = f32(Array.from({ length: n }, () => Math.random()));
    const setpointPitch = f32(Array.from({ length: n }, () => Math.random()));
    const setpointYaw   = f32(Array.from({ length: n }, () => Math.random()));
    const servoArr      = f32(Array.from({ length: n }, () => Math.random()));
    const servos = new Map([['servo[0]', servoArr]]);
    const result = correlateServosToAxes(servos, setpointRoll, setpointPitch, setpointYaw);
    // Random vs random → likely below the 0.25 threshold.
    expect(result[0].dominantAxis).toBe(null);
  });

  test('signed correlation preserves sign for L/R split', () => {
    const setpointRoll  = f32([0, 1, 2, 3, 4, 5]);
    const setpointPitch = f32([0, 0, 0, 0, 0, 0]);
    const setpointYaw   = f32([0, 0, 0, 0, 0, 0]);
    const elevonR = f32([1500, 1520, 1540, 1560, 1580, 1600]);  // tracks roll +
    const elevonL = f32([1500, 1480, 1460, 1440, 1420, 1400]);  // tracks roll -
    const servos = new Map([['servo[0]', elevonR], ['servo[1]', elevonL]]);
    const result = correlateServosToAxes(servos, setpointRoll, setpointPitch, setpointYaw);
    const right = result.find((r) => r.fieldName === 'servo[0]')!;
    const left  = result.find((r) => r.fieldName === 'servo[1]')!;
    expect(right.dominantAxis).toBe(0);
    expect(left.dominantAxis).toBe(0);
    expect(right.dominantSigned).toBeGreaterThan(0);
    expect(left.dominantSigned).toBeLessThan(0);
  });
});

describe('classifyServos', () => {
  test('two roll-dominant servos with opposite signs → Elevon-L + Elevon-R (delta wing)', () => {
    const setpointRoll  = f32([0, 1, 2, 3, 4, 5]);
    const setpointPitch = f32([0, 0, 0, 0, 0, 0]);
    const setpointYaw   = f32([0, 0, 0, 0, 0, 0]);
    const servoPos = f32([1500, 1520, 1540, 1560, 1580, 1600]);
    const servoNeg = f32([1500, 1480, 1460, 1440, 1420, 1400]);
    const servos = new Map([['servo[0]', servoPos], ['servo[1]', servoNeg]]);
    const out = classifyServos({
      mixerName: null,
      servos,
      setpointRoll,
      setpointPitch,
      setpointYaw,
    });
    const roles = new Map(out.map((c) => [c.fieldName, c.role]));
    // One should be elevon-l, the other elevon-r. Sign convention is
    // up to the classifier; we just assert the L/R split happened.
    expect(roles.size).toBe(2);
    const roleSet = new Set(roles.values());
    expect(roleSet.has('elevon-l') && roleSet.has('elevon-r')).toBe(true);
  });

  test('conventional craft (roll + pitch + yaw surfaces) → aileron-l/r + elevator + rudder', () => {
    const setpointRoll  = f32([0, 1, 2, 3, 4, 5, 6, 7]);
    const setpointPitch = f32([0, 0, 1, 1, 2, 2, 3, 3]);
    const setpointYaw   = f32([0, 0, 0, 1, 0, 1, 0, 1]);
    const aileronR  = f32([1500, 1520, 1540, 1560, 1580, 1600, 1620, 1640]);  // +roll
    const aileronL  = f32([1500, 1480, 1460, 1440, 1420, 1400, 1380, 1360]);  // -roll
    const elevator  = f32([1500, 1500, 1520, 1520, 1540, 1540, 1560, 1560]);  // tracks pitch
    const rudder    = f32([1500, 1500, 1500, 1540, 1500, 1540, 1500, 1540]);  // tracks yaw
    const servos = new Map([
      ['servo[0]', aileronR],
      ['servo[1]', aileronL],
      ['servo[2]', elevator],
      ['servo[3]', rudder],
    ]);
    const out = classifyServos({
      mixerName: null,
      servos,
      setpointRoll,
      setpointPitch,
      setpointYaw,
    });
    const roles = new Map(out.map((c) => [c.fieldName, c.role]));
    expect(roles.get('servo[2]')).toBe('elevator');
    expect(roles.get('servo[3]')).toBe('rudder');
    const rollRoles = new Set([roles.get('servo[0]'), roles.get('servo[1]')]);
    expect(rollRoles.has('aileron-l') && rollRoles.has('aileron-r')).toBe(true);
  });

  test('uncorrelated servo → unknown / unclassified', () => {
    const setpointRoll  = f32([0, 1, 2, 3, 4, 5]);
    const setpointPitch = f32([0, 0, 0, 0, 0, 0]);
    const setpointYaw   = f32([0, 0, 0, 0, 0, 0]);
    const idleServo = f32([1500, 1500, 1500, 1500, 1500, 1500]);  // never moves
    const servos = new Map([['servo[7]', idleServo]]);
    const out = classifyServos({
      mixerName: null,
      servos,
      setpointRoll, setpointPitch, setpointYaw,
    });
    expect(out[0].role).toBe('unknown');
    expect(out[0].confidence).toBe('unclassified');
  });

  test('confidence + correlation score reported on inferred channels', () => {
    const setpointRoll  = f32([0, 1, 2, 3, 4, 5, 6, 7]);
    const setpointPitch = f32([0, 0, 0, 0, 0, 0, 0, 0]);
    const setpointYaw   = f32([0, 0, 0, 0, 0, 0, 0, 0]);
    const servoR = f32([1500, 1520, 1540, 1560, 1580, 1600, 1620, 1640]);
    const servoL = f32([1500, 1480, 1460, 1440, 1420, 1400, 1380, 1360]);
    const servos = new Map([['servo[0]', servoR], ['servo[1]', servoL]]);
    const out = classifyServos({
      mixerName: null,
      servos,
      setpointRoll, setpointPitch, setpointYaw,
    });
    for (const c of out) {
      expect(c.confidence).toBe('inferred');
      expect(c.correlationScore).toBeGreaterThan(0.9);
    }
  });
});
