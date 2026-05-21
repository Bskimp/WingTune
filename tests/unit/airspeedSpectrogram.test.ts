import { describe, test, expect } from 'vitest';

import { binStftByAirspeed } from '@/lib/airspeedSpectrogram';

/** Index of the largest-power bin in a PSD row. */
function peakBin(row: Float32Array): number {
  let peak = -Infinity;
  let idx = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] > peak) { peak = row[i]; idx = i; }
  }
  return idx;
}

/** Steady tone at `k` cycles per `windowSize` samples — sits on STFT bin k. */
function steadyTone(n: number, k: number, windowSize: number): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = Math.sin((2 * Math.PI * k * i) / windowSize);
  }
  return s;
}

/** Linear chirp whose instantaneous STFT bin sweeps k0 -> k1 over n samples. */
function chirp(n: number, k0: number, k1: number, windowSize: number): Float32Array {
  const s = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const kInst = k0 + (i / (n - 1)) * (k1 - k0);
    phase += (2 * Math.PI * kInst) / windowSize;
    s[i] = Math.sin(phase);
  }
  return s;
}

/** Airspeed series ramping linearly v0 -> v1 over n samples. */
function ramp(n: number, v0: number, v1: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = v0 + (i / (n - 1)) * (v1 - v0);
  return a;
}

describe('binStftByAirspeed', () => {
  test('constant airspeed — every column lands in one bin', () => {
    const signal = steadyTone(8192, 20, 256);
    const airspeed = new Float32Array(8192).fill(15);
    const r = binStftByAirspeed(signal, airspeed, 1000, { airspeedBinCount: 10 });

    // All columns in bin 0; the rest empty.
    expect(r.columnsPerBin[0]).toBe(r.columnsBinned);
    expect(r.columnsBinned).toBeGreaterThan(20);
    for (let b = 1; b < 10; b++) expect(r.columnsPerBin[b]).toBe(0);

    // The occupied bin peaks at the tone; empty bins are NaN rows.
    expect(peakBin(r.grid[0])).toBe(20);
    expect(Number.isNaN(r.grid[5][0])).toBe(true);
  });

  test('frequency rising with airspeed — peak bin migrates up the airspeed axis', () => {
    const windowSize = 256;
    const n = 16384;
    const signal = chirp(n, 8, 100, windowSize);
    const airspeed = ramp(n, 10, 40);
    const r = binStftByAirspeed(signal, airspeed, 1000, {
      windowSize,
      airspeedBinCount: 6,
    });

    // A monotone airspeed ramp paired with a monotone chirp: the peak
    // frequency of the slowest airspeed bin sits well below the fastest.
    expect(peakBin(r.grid[0])).toBeLessThan(peakBin(r.grid[5]));
    expect(peakBin(r.grid[0])).toBeLessThan(35);
    expect(peakBin(r.grid[5])).toBeGreaterThan(65);
    for (let b = 0; b < 6; b++) expect(r.columnsPerBin[b]).toBeGreaterThan(0);
  });

  test('NaN airspeed columns are dropped, not forced into a bin', () => {
    const n = 8192;
    const signal = steadyTone(n, 20, 256);
    const airspeed = new Float32Array(n);
    airspeed.fill(NaN, 0, n / 2);     // pre-lock / dropout
    airspeed.fill(20, n / 2, n);
    const r = binStftByAirspeed(signal, airspeed, 1000, { airspeedBinCount: 10 });

    // Columns centred in the NaN half cannot be placed — fewer binned
    // than the STFT produced.
    const totalCols = Math.floor((n - 256) / 128) + 1;
    expect(r.columnsBinned).toBeGreaterThan(0);
    expect(r.columnsBinned).toBeLessThan(totalCols);
    expect(r.columnsPerBin[0]).toBe(r.columnsBinned);
  });

  test('under-sampled bins are flagged (too-few and empty alike)', () => {
    const n = 8192;
    const signal = steadyTone(n, 20, 256);
    const airspeed = new Float32Array(n);
    airspeed.fill(12, 0, 7000);
    airspeed.fill(30, 7000, n);
    const r = binStftByAirspeed(signal, airspeed, 1000, {
      airspeedBinCount: 18,
      minColumnsPerBin: 15,
    });

    // Most columns sit at 12 m/s (well-sampled); the 30 m/s tail catches
    // only a handful (under-sampled); the middle bins catch none.
    expect(r.columnsPerBin[0]).toBeGreaterThan(40);
    expect(r.columnsPerBin[17]).toBeGreaterThan(0);
    expect(r.columnsPerBin[17]).toBeLessThan(15);
    expect(r.underSampled[0]).toBe(false);
    expect(r.underSampled[17]).toBe(true);
    expect(r.underSampled[8]).toBe(true);          // empty middle bin
    expect(Number.isNaN(r.grid[8][0])).toBe(true); // empty bin -> NaN row
    expect(Number.isNaN(r.grid[0][0])).toBe(false);
  });

  test('explicit speed range — out-of-range bins stay empty', () => {
    const n = 16384;
    const signal = steadyTone(n, 20, 256);
    const airspeed = ramp(n, 10, 40);
    const r = binStftByAirspeed(signal, airspeed, 1000, {
      airspeedBinCount: 10,
      speedMin: 0,
      speedMax: 100,
    });

    expect(r.airspeedEdges[0]).toBe(0);
    expect(r.airspeedEdges[10]).toBe(100);
    // Airspeed only spans 10..40 -> bins 1..3 of the 0..100 range.
    expect(r.columnsPerBin[0]).toBe(0);
    expect(r.columnsPerBin[9]).toBe(0);
    expect(r.columnsPerBin[1] + r.columnsPerBin[2] + r.columnsPerBin[3]).toBe(
      r.columnsBinned,
    );
  });

  test('signal shorter than one window — empty grid, axes still populated', () => {
    const r = binStftByAirspeed(
      new Float32Array(100),
      new Float32Array(100).fill(20),
      1000,
      { windowSize: 256, airspeedBinCount: 8 },
    );
    expect(r.columnsBinned).toBe(0);
    expect(r.grid).toHaveLength(8);
    for (const row of r.grid) expect(Number.isNaN(row[0])).toBe(true);
    expect(r.frequencies.length).toBe(256 / 2 + 1);
    expect(r.frequencies[r.frequencies.length - 1]).toBeCloseTo(500, 4);
    expect(r.airspeedEdges).toHaveLength(9);
  });

  test('all-NaN airspeed — nothing binned, grid all NaN', () => {
    const signal = steadyTone(8192, 20, 256);
    const airspeed = new Float32Array(8192).fill(NaN);
    const r = binStftByAirspeed(signal, airspeed, 1000, { airspeedBinCount: 8 });
    expect(r.columnsBinned).toBe(0);
    for (let b = 0; b < 8; b++) {
      expect(r.columnsPerBin[b]).toBe(0);
      expect(Number.isNaN(r.grid[b][0])).toBe(true);
    }
  });

  test('axes — edges, centres and binHz are consistent', () => {
    const r = binStftByAirspeed(
      steadyTone(8192, 20, 256),
      ramp(8192, 10, 30),
      1000,
      { windowSize: 256, airspeedBinCount: 20 },
    );
    expect(r.airspeedEdges).toHaveLength(21);
    expect(r.airspeedCentres).toHaveLength(20);
    expect(r.airspeedEdges[0]).toBeCloseTo(10, 5);
    expect(r.airspeedEdges[20]).toBeCloseTo(30, 5);
    expect(r.airspeedCentres[0]).toBeCloseTo(
      (r.airspeedEdges[0] + r.airspeedEdges[1]) / 2,
      5,
    );
    expect(r.binHz).toBeCloseTo(1000 / 256, 6);
  });
});
