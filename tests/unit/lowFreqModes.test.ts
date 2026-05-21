import { describe, test, expect } from 'vitest';

import { detectLowFreqModes } from '@/lib/lowFreqModes';

/** Deterministic broadband noise via an LCG — keeps tests stable while
 *  giving the PSD a realistic floor (a pure sine has −∞ nulls that would
 *  read as spurious peaks). */
function noise(n: number, amp: number, seed = 0x9e3779b9): Float32Array {
  const a = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    a[i] = (s / 0xffffffff - 0.5) * 2 * amp;
  }
  return a;
}

/** A low-frequency sinusoid + a little broadband noise. */
function lowFreqTone(
  durationSec: number,
  sampleRateHz: number,
  freqHz: number,
  amp = 1,
  noiseAmp = 0.05,
): Float32Array {
  const n = Math.floor(durationSec * sampleRateHz);
  const ns = noise(n, noiseAmp);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRateHz) + ns[i];
  }
  return s;
}

describe('detectLowFreqModes', () => {
  test('detects a low-frequency tone — strongest peak sits on the tone', () => {
    const sig = lowFreqTone(120, 200, 0.5);
    const r = detectLowFreqModes(sig, 200, 'pitch');
    expect(r.tooShort).toBe(false);
    expect(r.peaks.length).toBeGreaterThanOrEqual(1);
    expect(r.peaks[0].freqHz).toBeGreaterThan(0.45);
    expect(r.peaks[0].freqHz).toBeLessThan(0.55);
    expect(r.peaks[0].prominenceDb).toBeGreaterThan(6);
  });

  test('classification follows the axis — same 0.5 Hz tone, different mode', () => {
    const sig = lowFreqTone(120, 200, 0.5);
    // 0.5 Hz on pitch → short-period band (0.4-3.0 Hz, pitch).
    expect(detectLowFreqModes(sig, 200, 'pitch').peaks[0].mode).toBe('short-period');
    // 0.5 Hz on yaw → dutch-roll band (0.15-1.2 Hz, roll/yaw).
    expect(detectLowFreqModes(sig, 200, 'yaw').peaks[0].mode).toBe('dutch-roll');
  });

  test('labels a slow pitch oscillation as the phugoid', () => {
    // 0.05 Hz needs ~100 s to resolve — 140 s log clears it.
    const sig = lowFreqTone(140, 200, 0.05);
    const r = detectLowFreqModes(sig, 200, 'pitch');
    expect(r.peaks[0].mode).toBe('phugoid');
    expect(r.peaks[0].freqHz).toBeGreaterThan(0.03);
    expect(r.peaks[0].freqHz).toBeLessThan(0.08);
    expect(r.peaks[0].bandResolved).toBe(true);
  });

  test('labels a 0.3 Hz roll oscillation as dutch roll', () => {
    const sig = lowFreqTone(120, 200, 0.3);
    const r = detectLowFreqModes(sig, 200, 'roll');
    expect(r.peaks[0].mode).toBe('dutch-roll');
  });

  test('a peak in a gap between named bands is unclassified', () => {
    // 0.25 Hz on pitch — above phugoid (≤0.12), below short-period (≥0.4),
    // and dutch roll is roll/yaw only. No named mode covers it.
    const sig = lowFreqTone(120, 200, 0.25);
    const r = detectLowFreqModes(sig, 200, 'pitch');
    expect(r.peaks[0].freqHz).toBeGreaterThan(0.2);
    expect(r.peaks[0].freqHz).toBeLessThan(0.3);
    expect(r.peaks[0].mode).toBe('unclassified');
  });

  test('a too-short log is flagged, with no peaks', () => {
    const r = detectLowFreqModes(lowFreqTone(1, 200, 0.5), 200, 'pitch');
    expect(r.tooShort).toBe(true);
    expect(r.peaks).toHaveLength(0);
    expect(r.psdDb).toHaveLength(0);
  });

  test('band resolved flags track the window length', () => {
    // 10 s: long enough for short-period (needs 5 s), too short for
    // dutch roll (13.3 s) and phugoid (100 s).
    const r = detectLowFreqModes(lowFreqTone(10, 200, 0.5), 200, 'pitch');
    expect(r.tooShort).toBe(false);
    const band = (name: string) => r.bands.find((b) => b.name === name)!;
    expect(band('short-period').resolved).toBe(true);
    expect(band('dutch-roll').resolved).toBe(false);
    expect(band('phugoid').resolved).toBe(false);
  });

  test('a peak in an unresolved band carries bandResolved=false', () => {
    // 0.3 Hz dutch-roll tone on an 11 s window — dutch roll needs 13.3 s.
    const r = detectLowFreqModes(lowFreqTone(11, 200, 0.3), 200, 'roll');
    expect(r.peaks.length).toBeGreaterThanOrEqual(1);
    expect(r.peaks[0].mode).toBe('dutch-roll');
    expect(r.peaks[0].bandResolved).toBe(false);
  });

  test('a flat signal yields no peaks', () => {
    const r = detectLowFreqModes(new Float32Array(200 * 60), 200, 'pitch');
    expect(r.tooShort).toBe(false);
    expect(r.peaks).toHaveLength(0);
  });

  test('frequency axis is bounded to the sub-3 Hz mode band', () => {
    const r = detectLowFreqModes(lowFreqTone(120, 200, 0.5), 200, 'pitch');
    expect(r.frequencies[0]).toBeGreaterThanOrEqual(0.015);
    expect(r.frequencies[r.frequencies.length - 1]).toBeLessThanOrEqual(3);
    expect(r.psdDb.length).toBe(r.frequencies.length);
    expect(r.windowSec).toBeGreaterThan(100);
  });

  test('reports at most one peak per named mode band', () => {
    // Three separate tones inside the dutch-roll band — physically one
    // mode region. Without the one-peak-per-band rule the noisy band
    // would over-report; an aircraft has a single dutch-roll mode.
    const n = 120 * 200;
    const ns = noise(n, 0.05);
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / 200;
      sig[i] =
        Math.sin(2 * Math.PI * 0.5 * t) +
        Math.sin(2 * Math.PI * 0.7 * t) +
        Math.sin(2 * Math.PI * 0.9 * t) +
        ns[i];
    }
    const r = detectLowFreqModes(sig, 200, 'roll');
    expect(r.peaks.filter((p) => p.mode === 'dutch-roll')).toHaveLength(1);
  });

  test('unclassified peaks are capped at one — the strongest survives', () => {
    // Two tones in the 0.12-0.4 Hz gap (no named pitch mode there).
    // Only the strongest unnamed peak earns a chip; the rest are noise.
    const n = 120 * 200;
    const ns = noise(n, 0.05);
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / 200;
      sig[i] =
        1.0 * Math.sin(2 * Math.PI * 0.2 * t) +
        0.6 * Math.sin(2 * Math.PI * 0.3 * t) +
        ns[i];
    }
    const r = detectLowFreqModes(sig, 200, 'pitch');
    expect(r.peaks.filter((p) => p.mode === 'unclassified').length).toBeLessThanOrEqual(1);
  });
});
