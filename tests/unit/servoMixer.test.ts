import { describe, test, expect } from 'vitest';

import {
  parseSmixRules,
  parseServoParams,
  parseServoConfig,
  smixInputAxis,
} from '@/lib/servoMixer';

// Header lines as the parser surfaces them in `header_params` — the
// btfl_002 reference config: servo3/4 ailerons (roll ±), servo2
// elevator (pitch).
const SMIX_HEADER = {
  smix0: '3,0,100,0,0,100,0',
  smix1: '4,0,-100,0,0,100,0',
  smix2: '2,1,100,0,0,100,0',
};

const SERVOPARAM_HEADER = {
  servoParam0: '100,1000,2000,1500,0',
  servoParam2: '-100,1000,2000,1500,0',
  servoParam3: '-100,1000,2000,1500,0',
};

describe('parseSmixRules', () => {
  test('decodes every smix line, ignoring non-smix keys', () => {
    const rules = parseSmixRules({ ...SMIX_HEADER, mixer: 'CUSTOMAIRPLANE', servoCount: '8' });
    expect(rules).toHaveLength(3);
    expect(rules[0]).toEqual({
      ruleIndex: 0, targetChannel: 3, inputSource: 0,
      rate: 100, speed: 0, min: 0, max: 100, box: 0,
    });
  });

  test('preserves the signed rate (differential split depends on it)', () => {
    const rules = parseSmixRules(SMIX_HEADER);
    expect(rules.find((r) => r.targetChannel === 4)!.rate).toBe(-100);
  });

  test('sorts rules by ruleIndex regardless of header key order', () => {
    const rules = parseSmixRules({
      smix2: '2,1,100,0,0,100,0',
      smix0: '3,0,100,0,0,100,0',
      smix1: '4,0,-100,0,0,100,0',
    });
    expect(rules.map((r) => r.ruleIndex)).toEqual([0, 1, 2]);
  });

  test('drops a malformed line (too few fields) rather than half-decoding', () => {
    expect(parseSmixRules({ smix0: '3,0,100' })).toEqual([]);
  });

  test('drops a line with a non-numeric field', () => {
    expect(parseSmixRules({ smix0: '3,x,100,0,0,100,0' })).toEqual([]);
  });

  test('returns [] for undefined or smix-free header params', () => {
    expect(parseSmixRules(undefined)).toEqual([]);
    expect(parseSmixRules({ mixer: 'CUSTOMAIRPLANE' })).toEqual([]);
  });
});

describe('parseServoParams', () => {
  test('decodes every servoParam line', () => {
    const params = parseServoParams(SERVOPARAM_HEADER);
    expect(params).toHaveLength(3);
    expect(params[0]).toEqual({
      servoIndex: 0, rate: 100, min: 1000, max: 2000,
      middle: 1500, forwardFromChannel: 0,
    });
  });

  test('a negative rate marks a physically reversed servo', () => {
    const params = parseServoParams(SERVOPARAM_HEADER);
    expect(params.find((p) => p.servoIndex === 2)!.rate).toBe(-100);
    expect(params.find((p) => p.servoIndex === 0)!.rate).toBeGreaterThan(0);
  });

  test('sorts by servoIndex', () => {
    const params = parseServoParams(SERVOPARAM_HEADER);
    expect(params.map((p) => p.servoIndex)).toEqual([0, 2, 3]);
  });

  test('drops a malformed line and returns [] for empty input', () => {
    expect(parseServoParams({ servoParam0: '100,1000' })).toEqual([]);
    expect(parseServoParams(undefined)).toEqual([]);
  });
});

describe('smixInputAxis', () => {
  test('maps stabilized roll/pitch/yaw/throttle sources', () => {
    expect(smixInputAxis(0)).toBe('roll');
    expect(smixInputAxis(1)).toBe('pitch');
    expect(smixInputAxis(2)).toBe('yaw');
    expect(smixInputAxis(3)).toBe('throttle');
  });

  test('maps RC-direct sources to rc and unknowns to other', () => {
    expect(smixInputAxis(5)).toBe('rc');
    expect(smixInputAxis(8)).toBe('rc');
    expect(smixInputAxis(-1)).toBe('other');
  });
});

describe('parseServoConfig', () => {
  test('decodes smix + servoParam together', () => {
    const cfg = parseServoConfig({ ...SMIX_HEADER, ...SERVOPARAM_HEADER });
    expect(cfg.smixRules).toHaveLength(3);
    expect(cfg.servoParams).toHaveLength(3);
  });

  test('returns empty lists for a log with no servo-config header', () => {
    const cfg = parseServoConfig(undefined);
    expect(cfg.smixRules).toEqual([]);
    expect(cfg.servoParams).toEqual([]);
  });
});
