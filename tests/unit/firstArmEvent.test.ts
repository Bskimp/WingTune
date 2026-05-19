import { describe, expect, test } from 'vitest';

import {
  alignByFirstThrottle,
  findFirstThrottleUpSec,
} from '@/lib/firstArmEvent';
import type { LogState } from '@/stores/session';

/** Minimal LogState shape the firstArmEvent helpers actually read. The
 *  real shape is much wider but the module only touches `time` and
 *  `fields.get('rcCommand[3]')`. */
function makeLog(
  id: string,
  throttleSeries: number[],
  sampleRateHz: number = 1000,
): LogState {
  const fields = new Map<string, Float32Array>();
  fields.set('rcCommand[3]', new Float32Array(throttleSeries));
  const time = new Float32Array(throttleSeries.length);
  for (let i = 0; i < throttleSeries.length; i++) time[i] = i / sampleRateHz;
  return {
    id,
    name: id,
    scanReport: null,
    time,
    fields,
    timeOffsetSec: 0,
  } as unknown as LogState;
}

describe('findFirstThrottleUpSec', () => {
  test('detects clean rising edge across the 1100 threshold', () => {
    // Throttle holds at 1000 for 100 samples, then jumps to 1500.
    const series = new Array(100).fill(1000).concat(new Array(100).fill(1500));
    const log = makeLog('a', series);
    const r = findFirstThrottleUpSec(log);
    expect(r.detected).toBe(true);
    // Crossing happens at index 100 (1000→1500). Sample 100 is at 0.100 s.
    expect(r.timeSec).toBeCloseTo(0.100, 5);
  });

  test('returns null when throttle never reaches threshold', () => {
    const series = new Array(200).fill(1050);
    const log = makeLog('a', series);
    const r = findFirstThrottleUpSec(log);
    expect(r.detected).toBe(false);
    expect(r.timeSec).toBeNull();
  });

  test('returns null when throttle starts above threshold (no rising edge in log)', () => {
    const series = new Array(200).fill(1500);
    const log = makeLog('a', series);
    const r = findFirstThrottleUpSec(log);
    expect(r.detected).toBe(false);
    expect(r.timeSec).toBeNull();
  });

  test('returns null when rcCommand[3] field is missing', () => {
    const log = makeLog('a', [1000, 1500]);
    log.fields.delete('rcCommand[3]');
    const r = findFirstThrottleUpSec(log);
    expect(r.detected).toBe(false);
    expect(r.timeSec).toBeNull();
  });

  test('finds the FIRST crossing, not subsequent ones', () => {
    // 1000 → 1500 at idx 50 → 800 at idx 100 → 1500 at idx 150.
    const series = new Array(50).fill(1000)
      .concat(new Array(50).fill(1500))
      .concat(new Array(50).fill(800))
      .concat(new Array(50).fill(1500));
    const log = makeLog('a', series);
    const r = findFirstThrottleUpSec(log);
    expect(r.detected).toBe(true);
    expect(r.timeSec).toBeCloseTo(0.050, 5);
  });
});

describe('alignByFirstThrottle', () => {
  test('returns offset = refTime - otherTime when both detect', () => {
    // Ref: throttle-up at 0.100 s. Other: throttle-up at 0.300 s.
    const ref = makeLog('ref',
      new Array(100).fill(1000).concat(new Array(100).fill(1500)),
    );
    const other = makeLog('other',
      new Array(300).fill(1000).concat(new Array(100).fill(1500)),
    );
    const r = alignByFirstThrottle(ref, other);
    expect(r.signal).toBe('throttle');
    // offset = 0.100 - 0.300 = -0.200. Other's throttle-up was 200 ms
    // later in its own time → must shift LEFT by 200 ms to align.
    expect(r.offsetSec).toBeCloseTo(-0.200, 5);
  });

  test('returns signal none when either log lacks crossing', () => {
    const refDetected = makeLog('ref',
      new Array(50).fill(1000).concat(new Array(50).fill(1500)),
    );
    const otherFlat = makeLog('other', new Array(200).fill(1050));
    expect(alignByFirstThrottle(refDetected, otherFlat).signal).toBe('none');
    expect(alignByFirstThrottle(otherFlat, refDetected).signal).toBe('none');
  });

  test('offset = 0 when both logs throttle up at the same in-log time', () => {
    const a = makeLog('a',
      new Array(75).fill(1000).concat(new Array(75).fill(1500)),
    );
    const b = makeLog('b',
      new Array(75).fill(1000).concat(new Array(75).fill(1500)),
    );
    const r = alignByFirstThrottle(a, b);
    expect(r.signal).toBe('throttle');
    expect(r.offsetSec).toBeCloseTo(0, 5);
  });
});
