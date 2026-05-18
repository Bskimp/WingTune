// Tests for cross-correlation auto-align. The sign convention is the
// most important thing to lock down — alignment math that's off by a
// sign produces a chart that LOOKS plausible (traces shift) but lands
// the events at the wrong session times.
//
// Strategy: build a synthetic LogState with a known gaussian-bump
// signal in gyroADC, then build a second log with the same bump
// shifted by a known number of samples. Run alignLogToReference and
// check the recovered offset.

import { describe, it, expect } from 'vitest';

import {
  alignLogToReference,
  computeGyroMagnitude,
  downsampleToRate,
  normalizedCrossCorrelate,
} from '../../src/lib/autoAlign';
import type { LogState } from '../../src/stores/session';

// Build a minimal LogState-shaped object. autoAlign only touches
// `log.time` and `log.fields`; the rest stays at sensible defaults.
// Plain object (no shallowReactive) — the math layer doesn't need
// Vue reactivity and the test runner doesn't have a Vue app context.
function makeLog(opts: {
  id: string;
  dt: number;
  length: number;
  bumpCenter: number; // sample index of bump peak
  bumpSigma?: number; // sample-units stddev
  timeOffsetSec?: number;
}): LogState {
  const dt = opts.dt;
  const N = opts.length;
  const time = new Float32Array(N);
  for (let i = 0; i < N; i++) time[i] = i * dt;

  const sigma = opts.bumpSigma ?? 30;
  const center = opts.bumpCenter;
  const bumpX = new Float32Array(N);
  const bumpY = new Float32Array(N);
  const bumpZ = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const d = i - center;
    const g = Math.exp(-(d * d) / (2 * sigma * sigma));
    // Distribute across axes so RMS magnitude has a clean peak.
    bumpX[i] = g * 100;
    bumpY[i] = g * 50;
    bumpZ[i] = g * 25;
  }

  const fields = new Map<string, Float32Array>([
    ['gyroADC[0]', bumpX],
    ['gyroADC[1]', bumpY],
    ['gyroADC[2]', bumpZ],
  ]);

  return {
    id: opts.id,
    name: opts.id,
    fileSize: 0,
    scanReport: null,
    scanError: null,
    scanProgress: 1,
    parseTimeMs: 0,
    loadedAt: 0,
    firmwareRevision: null,
    firmwareDate: null,
    boardInfo: null,
    craftName: null,
    time,
    gpsTimeSec: new Float32Array(0),
    fields,
    hydrating: new Set<string>(),
    pinnedFields: new Set<string>(),
    events: [],
    timeOffsetSec: opts.timeOffsetSec ?? 0,
  } as unknown as LogState;
}

describe('autoAlign', () => {
  describe('computeGyroMagnitude', () => {
    it('returns RMS sqrt(x² + y² + z²) per sample', () => {
      const log = makeLog({ id: 'L', dt: 0.01, length: 10, bumpCenter: 5 });
      const mag = computeGyroMagnitude(log);
      expect(mag).not.toBeNull();
      expect(mag!.length).toBe(10);
      // At index 5 the bump is at peak. Magnitude = sqrt(100² + 50² + 25²)
      //   ≈ sqrt(10000 + 2500 + 625) = sqrt(13125) ≈ 114.56
      expect(mag![5]).toBeCloseTo(114.56, 1);
    });

    it('returns null when no gyro fields are hydrated', () => {
      const log = makeLog({ id: 'L', dt: 0.01, length: 10, bumpCenter: 5 });
      log.fields.delete('gyroADC[0]');
      log.fields.delete('gyroADC[1]');
      log.fields.delete('gyroADC[2]');
      expect(computeGyroMagnitude(log)).toBeNull();
    });
  });

  describe('downsampleToRate', () => {
    it('returns input unchanged when source rate ≤ target', () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const out = downsampleToRate(a, 0.1, 50); // 10 Hz → 50 Hz target
      expect(out).toBe(a);
    });

    it('boxcar-averages to target rate', () => {
      // Source: 100 samples at 1000 Hz = 0.1 s of signal.
      // Target: 100 Hz → ratio 10:1 → 10 output samples.
      const a = new Float32Array(100);
      for (let i = 0; i < 100; i++) a[i] = i;
      const out = downsampleToRate(a, 0.001, 100);
      expect(out.length).toBe(10);
      // First output = mean of [0..9] = 4.5
      expect(out[0]).toBeCloseTo(4.5, 5);
      // Last output = mean of [90..99] = 94.5
      expect(out[9]).toBeCloseTo(94.5, 5);
    });
  });

  describe('normalizedCrossCorrelate', () => {
    it('peaks at lag = +shift when b is a right-shifted copy of a', () => {
      // a: bump at index 20. b: same bump at index 30 (b's event is
      // 10 samples LATER than a's). NCC(a, b, lag) should peak at
      // lag = +10.
      const N = 100;
      const a = new Float32Array(N);
      const b = new Float32Array(N);
      const sigma = 5;
      for (let i = 0; i < N; i++) {
        const da = i - 20;
        const db = i - 30;
        a[i] = Math.exp(-(da * da) / (2 * sigma * sigma));
        b[i] = Math.exp(-(db * db) / (2 * sigma * sigma));
      }
      const maxLag = 30;
      const ncc = normalizedCrossCorrelate(a, b, maxLag);
      // Find the peak index, convert to lag.
      let bestIdx = 0;
      let bestVal = -Infinity;
      for (let i = 0; i < ncc.length; i++) {
        if (ncc[i] > bestVal) { bestVal = ncc[i]; bestIdx = i; }
      }
      const bestLag = bestIdx - maxLag;
      expect(bestLag).toBe(10);
      expect(bestVal).toBeGreaterThan(0.9); // near-perfect match
    });

    it('returns zeros when either input is constant (zero norm)', () => {
      const a = new Float32Array([5, 5, 5, 5]);
      const b = new Float32Array([1, 2, 3, 4]);
      const ncc = normalizedCrossCorrelate(a, b, 2);
      for (let i = 0; i < ncc.length; i++) expect(ncc[i]).toBe(0);
    });
  });

  describe('alignLogToReference', () => {
    it('recovers a positive shift (other delayed → negative offset)', () => {
      // dt = 0.01 s (100 Hz raw). 1000-sample log = 10 s.
      // Bump in ref at sample 200 (= 2 s).
      // Bump in other at sample 300 (= 3 s).
      // Other's event is 1 s LATER in its own log time → to align with
      // ref (offset 0), other needs offset = -1 s (shift left).
      const ref   = makeLog({ id: 'ref',   dt: 0.01, length: 1000, bumpCenter: 200 });
      const other = makeLog({ id: 'other', dt: 0.01, length: 1000, bumpCenter: 300 });
      const result = alignLogToReference(ref, other, { maxLagSec: 5, targetRateHz: 100 });
      expect(result.signal).toBe('gyro');
      // Tolerate ~1 sample (0.01 s) of slop from downsample / discretization.
      expect(result.offsetSec).toBeCloseTo(-1.0, 1);
      expect(result.ncc).toBeGreaterThan(0.9);
      expect(result.peakRatio).toBeGreaterThan(2.0); // clean unique peak
    });

    it('recovers a negative shift (other earlier → positive offset)', () => {
      // Bump in ref at sample 500 (= 5 s).
      // Bump in other at sample 400 (= 4 s, EARLIER).
      // Other needs offset = +1 s to push its event to session t=5 s.
      const ref   = makeLog({ id: 'ref',   dt: 0.01, length: 1000, bumpCenter: 500 });
      const other = makeLog({ id: 'other', dt: 0.01, length: 1000, bumpCenter: 400 });
      const result = alignLogToReference(ref, other, { maxLagSec: 5, targetRateHz: 100 });
      expect(result.offsetSec).toBeCloseTo(+1.0, 1);
      expect(result.ncc).toBeGreaterThan(0.9);
    });

    it('returns zero offset when both logs are already aligned', () => {
      const ref   = makeLog({ id: 'ref',   dt: 0.01, length: 1000, bumpCenter: 500 });
      const other = makeLog({ id: 'other', dt: 0.01, length: 1000, bumpCenter: 500 });
      const result = alignLogToReference(ref, other, { maxLagSec: 5, targetRateHz: 100 });
      expect(result.offsetSec).toBeCloseTo(0, 1);
      expect(result.ncc).toBeGreaterThan(0.95);
    });

    it('returns signal=none when gyro is missing on either log', () => {
      const ref   = makeLog({ id: 'ref',   dt: 0.01, length: 1000, bumpCenter: 500 });
      const other = makeLog({ id: 'other', dt: 0.01, length: 1000, bumpCenter: 500 });
      other.fields.delete('gyroADC[0]');
      other.fields.delete('gyroADC[1]');
      other.fields.delete('gyroADC[2]');
      const result = alignLogToReference(ref, other);
      expect(result.signal).toBe('none');
      expect(result.offsetSec).toBe(0);
    });
  });
});
