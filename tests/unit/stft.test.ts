import { describe, test, expect } from 'vitest';

import { computeStft } from '@/lib/stft';

/** Index of the largest-power bin in a column. */
function peakBin(col: Float32Array): number {
  let peak = -Infinity;
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    if (col[i] > peak) { peak = col[i]; idx = i; }
  }
  return idx;
}

describe('computeStft', () => {
  test('steady tone — every column peaks at the tone bin', () => {
    const windowSize = 256;
    const k = 16; // a continuous sin at k cycles / windowSize sits on bin k
    const n = 4096;
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[i] = Math.sin((2 * Math.PI * k * i) / windowSize);
    }
    const r = computeStft(signal, 1000, windowSize, 128);
    expect(r.columns.length).toBeGreaterThan(10);
    for (const col of r.columns) {
      expect(peakBin(col)).toBe(k);
    }
  });

  test('chirp — the peak bin migrates from low to high across columns', () => {
    // This is the property Welch averaging destroys: time localisation.
    const windowSize = 256;
    const n = 16384;
    const signal = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const kInst = 8 + (i / (n - 1)) * 92; // instantaneous bin sweeps 8 -> 100
      phase += (2 * Math.PI * kInst) / windowSize;
      signal[i] = Math.sin(phase);
    }
    const r = computeStft(signal, 1000, windowSize, 128);
    const first = peakBin(r.columns[0]);
    const last = peakBin(r.columns[r.columns.length - 1]);
    expect(first).toBeLessThan(last);
    expect(first).toBeLessThan(30);
    expect(last).toBeGreaterThan(70);
  });

  test('column count and centre times follow windowSize / hopSize', () => {
    const windowSize = 256;
    const hop = 128;
    const n = 4096;
    const r = computeStft(new Float32Array(n), 1000, windowSize, hop);
    const expectedCols = Math.floor((n - windowSize) / hop) + 1;
    expect(r.columns.length).toBe(expectedCols);
    expect(r.centreTimeSec.length).toBe(expectedCols);
    // First column centred (windowSize-1)/2 samples in, at 1000 Hz.
    expect(r.centreTimeSec[0]).toBeCloseTo(((windowSize - 1) / 2) / 1000, 5);
    // Columns are hopSize / sampleRate apart.
    expect(r.centreTimeSec[1] - r.centreTimeSec[0]).toBeCloseTo(hop / 1000, 5);
  });

  test('frequency axis runs DC to Nyquist', () => {
    const r = computeStft(new Float32Array(4096), 1000, 256, 128);
    expect(r.frequencies.length).toBe(256 / 2 + 1);
    expect(r.frequencies[0]).toBe(0);
    expect(r.frequencies[r.frequencies.length - 1]).toBeCloseTo(500, 4); // Nyquist
    expect(r.binHz).toBeCloseTo(1000 / 256, 6);
  });

  test('signal shorter than one window — empty columns, axis still populated', () => {
    const r = computeStft(new Float32Array(100), 1000, 256, 128);
    expect(r.columns).toHaveLength(0);
    expect(r.centreTimeSec).toHaveLength(0);
    expect(r.frequencies[r.frequencies.length - 1]).toBeCloseTo(500, 4);
  });

  test('mean of all columns of a steady tone peaks at the tone bin', () => {
    // STFT columns carry welchPsd's per-segment PSD units, so the mean
    // column behaves like a Welch PSD — same peak bin.
    const windowSize = 256;
    const k = 20;
    const n = 8192;
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[i] = Math.sin((2 * Math.PI * k * i) / windowSize);
    }
    const r = computeStft(signal, 1000, windowSize, 128);
    const mean = new Float32Array(r.frequencies.length);
    for (const col of r.columns) {
      for (let i = 0; i < col.length; i++) mean[i] += col[i];
    }
    for (let i = 0; i < mean.length; i++) mean[i] /= r.columns.length;
    expect(peakBin(mean)).toBe(k);
  });

  test('throws on non-power-of-2 windowSize', () => {
    expect(() => computeStft(new Float32Array(4096), 1000, 200, 100)).toThrow(/power of 2/);
  });

  test('throws on hopSize < 1', () => {
    expect(() => computeStft(new Float32Array(4096), 1000, 256, 0)).toThrow(/hopSize/);
  });

  test('throws on non-positive sample rate', () => {
    expect(() => computeStft(new Float32Array(4096), 0, 256, 128)).toThrow(/sampleRate/);
  });
});
