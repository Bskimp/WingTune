import { describe, test, expect } from 'vitest';

import { computePilotStyle } from '@/lib/pilotStyle';

const FS = 1000;

function timeAxis(n: number): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = i / FS;
  return t;
}

function zeros(n: number): Float32Array {
  return new Float32Array(n);
}

/** Small zero-mean noise — sample-to-sample, can leap up to 2*amp. */
function jitter(n: number, amp = 8, seed = 1): Float32Array {
  const out = new Float32Array(n);
  // Mulberry32
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    out[i] = r * amp;
  }
  return out;
}

/** A smooth low-frequency sine — peak-to-trough span = 2*amp. Used as
 *  a "calm pilot" stand-in: when 2*amp < reversalDeadband the running
 *  extremum can never retrace far enough to confirm a turning point. */
function slowSine(n: number, amp: number, freqHz: number, phase = 0): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = amp * Math.sin(2 * Math.PI * freqHz * (i / FS) + phase);
  }
  return s;
}

/** Square-wave rcCommand ±amp flipping every `halfPeriod` samples.
 *  K full cycles = (n / (2 * halfPeriod)) flips, each flip = one
 *  turning point in the M-Pilot hysteresis algorithm. */
function squareWave(n: number, halfPeriod: number, amp: number): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = Math.floor(i / halfPeriod) % 2 === 0 ? amp : -amp;
  }
  return s;
}

describe('computePilotStyle', () => {
  test('calm flight — tiny inputs → cruise + calm + no reversals', () => {
    const n = 30_000; // 30 s
    // Smooth low-frequency stick inputs at amp 10 (peak-to-trough span
    // = 20 < 25 deadband) — visible activity (RMS ~7, above the 5-unit
    // verdict floor) without ever confirming a turning point.
    const roll = slowSine(n, 10, 0.15, 0);
    const pitch = slowSine(n, 8, 0.20, 1);
    const r = computePilotStyle([roll, pitch, zeros(n)], timeAxis(n));

    expect(r.axes[0].reversalCount).toBe(0);
    expect(r.axes[1].reversalCount).toBe(0);
    expect(r.suggestedProfile).toBe('cruise');
    expect(r.correctionCharacter).toBe('calm');
  });

  test('aggressive flight — large deliberate strokes → 3d', () => {
    const n = 30_000;
    // ±400 strokes, ~1.67 reversals/s (flip every 600 samples = 0.6 s)
    // — solidly in the 'active' band (0.5 ≤ rate < 2.0).
    const roll = squareWave(n, 600, 400);
    const pitch = jitter(n, 5, 3);
    const r = computePilotStyle([roll, pitch, zeros(n)], timeAxis(n));

    expect(r.axes[0].strokeP90).toBeGreaterThan(350);
    expect(r.suggestedProfile).toBe('3d');
    // Rate sits in the 'active' band — large but not frantic.
    expect(r.correctionCharacter).toBe('active');
  });

  test('fighting flight — rapid small reversals → busy', () => {
    const n = 30_000;
    // ±60 strokes (above 25-unit deadband, below 80-unit cruise cap),
    // flipping every 80 samples → 12.5 reversals/s. Solidly 'busy'.
    const roll = squareWave(n, 80, 60);
    const pitch = squareWave(n, 80, 60);
    const r = computePilotStyle([roll, pitch, zeros(n)], timeAxis(n));

    expect(r.axes[0].reversalRatePerSec).toBeGreaterThan(5);
    expect(r.correctionCharacter).toBe('busy');
    // Strokes are small → cruise amplitude band.
    expect(r.suggestedProfile).toBe('cruise');
  });

  test('clean K-cycle square wave → exactly (2K - 1) confirmed reversals', () => {
    // 10 full cycles = 20 turning points in the signal; the first one
    // primes direction without counting → 19 reversals.
    const halfPeriod = 200;
    const cycles = 10;
    const n = halfPeriod * 2 * cycles;
    const roll = squareWave(n, halfPeriod, 200);
    const r = computePilotStyle([roll, undefined, undefined], timeAxis(n));
    expect(r.axes[0].reversalCount).toBe(2 * cycles - 1);
    // Median stroke amplitude should equal the wave amplitude.
    expect(r.axes[0].strokeMedian).toBeCloseTo(200, 0);
  });

  test('sub-deadband jitter only → zero reversals on every axis', () => {
    const n = 30_000;
    const r = computePilotStyle(
      [jitter(n, 8, 1), jitter(n, 8, 2), jitter(n, 8, 3)],
      timeAxis(n),
    );
    for (const ax of r.axes) {
      expect(ax.reversalCount).toBe(0);
      expect(Number.isNaN(ax.strokeP90) || ax.strokeP90 <= 10).toBe(true);
    }
  });

  test('mid-amplitude strokes (≈150) land in Sport', () => {
    const n = 30_000;
    const roll = squareWave(n, 300, 150);
    const r = computePilotStyle([roll, undefined, undefined], timeAxis(n));
    expect(r.axes[0].strokeP90).toBeCloseTo(150, 0);
    expect(r.suggestedProfile).toBe('sport');
  });

  test('yaw-only activity does NOT drive the verdict', () => {
    // Pilot only worked the rudder hard — verdict comes from the
    // (centred) roll+pitch sticks, so the suggestion lands on Cruise.
    const n = 30_000;
    const yaw = squareWave(n, 300, 400);
    const r = computePilotStyle([zeros(n), zeros(n), yaw], timeAxis(n));
    // Yaw axis recorded the activity itself …
    expect(r.axes[2].strokeP90).toBeGreaterThan(350);
    // … but the aggregate dominantAmplitude is roll+pitch only, which
    // is ~0 here, so the gate falls to "no stick motion" → null.
    expect(r.suggestedProfile).toBe(null);
    expect(r.correctionCharacter).toBe(null);
  });

  test('flight shorter than minDurationSec → honest null verdict', () => {
    const n = 1500; // 1.5 s, below default 3 s floor
    const roll = squareWave(n, 200, 400);
    const r = computePilotStyle([roll, undefined, undefined], timeAxis(n));
    expect(r.suggestedProfile).toBe(null);
    expect(r.correctionCharacter).toBe(null);
    // Per-axis stats are still populated — only the verdict is gated.
    expect(r.axes[0].strokeP90).toBeGreaterThan(350);
  });

  test('absent axis → zeroed entry, no NaN spread to the verdict', () => {
    const n = 30_000;
    const roll = squareWave(n, 300, 250);
    const r = computePilotStyle([roll, undefined, undefined], timeAxis(n));
    expect(r.axes[1].sampleCount).toBe(0);
    expect(r.axes[1].activityRms).toBe(0);
    expect(r.suggestedProfile).toBe('3d');
  });

  test('empty input → graceful null verdict', () => {
    const r = computePilotStyle(
      [undefined, undefined, undefined],
      new Float32Array(0),
    );
    expect(r.durationSec).toBe(0);
    expect(r.suggestedProfile).toBe(null);
    expect(r.correctionCharacter).toBe(null);
  });
});
