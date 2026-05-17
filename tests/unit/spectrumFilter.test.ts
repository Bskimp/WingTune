import { describe, test, expect } from 'vitest';

import { findSpectrumPeaks } from '@/lib/recommenders/spectrumFilter';

function buildFrequencies(n: number, sampleRate: number, segmentLen: number): Float32Array {
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = (i * sampleRate) / segmentLen;
  return f;
}

describe('findSpectrumPeaks', () => {
  test('finds a single sharp peak above baseline', () => {
    // Synthetic PSD: low baseline with a 10x spike at bin 80.
    const n = 513;
    const psd = new Float32Array(n);
    for (let i = 0; i < n; i++) psd[i] = 1.0;
    psd[80] = 50;
    psd[79] = 10;
    psd[81] = 10;
    const freq = buildFrequencies(n, 1000, 1024);
    const peaks = findSpectrumPeaks(psd, freq, 'R');
    expect(peaks.length).toBeGreaterThan(0);
    const top = peaks.sort((a, b) => b.db - a.db)[0];
    // bin 80 at sr=1000, seg=1024 → freq ≈ 78.1 Hz
    expect(top.freqHz).toBeCloseTo(78.1, 0);
    expect(top.axisShort).toBe('R');
  });

  test('skips peaks below floorHz', () => {
    const n = 513;
    const psd = new Float32Array(n).fill(1);
    psd[20] = 100; // Hz ≈ 19.5 — below default floor of 30
    psd[19] = 10;
    psd[21] = 10;
    const freq = buildFrequencies(n, 1000, 1024);
    const peaks = findSpectrumPeaks(psd, freq, 'P');
    expect(peaks).toHaveLength(0);
  });

  test('skips peaks above ceilingHz', () => {
    const n = 513;
    const psd = new Float32Array(n).fill(1);
    // bin 500 ≈ 488 Hz — above default ceiling of 400
    psd[500] = 100;
    psd[499] = 10;
    psd[501] = 10;
    const freq = buildFrequencies(n, 1000, 1024);
    const peaks = findSpectrumPeaks(psd, freq, 'Y');
    expect(peaks).toHaveLength(0);
  });

  test('rejects peaks below the dB-above-baseline threshold', () => {
    // 2x baseline = 3 dB — well below 6 dB default minimum.
    const n = 513;
    const psd = new Float32Array(n).fill(1);
    psd[100] = 2;
    psd[99] = 1.5;
    psd[101] = 1.5;
    const freq = buildFrequencies(n, 1000, 1024);
    const peaks = findSpectrumPeaks(psd, freq, 'R');
    expect(peaks).toHaveLength(0);
  });

  test('accepts custom thresholds', () => {
    // 2x baseline + lower threshold (1 dB) — should pass.
    const n = 513;
    const psd = new Float32Array(n).fill(1);
    psd[100] = 5;
    psd[99] = 1.5;
    psd[101] = 1.5;
    const freq = buildFrequencies(n, 1000, 1024);
    const peaks = findSpectrumPeaks(psd, freq, 'R', { minDbAboveBaseline: 1 });
    expect(peaks.length).toBeGreaterThan(0);
  });

  test('finds multiple distinct peaks', () => {
    const n = 513;
    const psd = new Float32Array(n).fill(1);
    psd[80]  = 50; psd[79]  = 5; psd[81]  = 5;
    psd[180] = 80; psd[179] = 5; psd[181] = 5;
    psd[250] = 30; psd[249] = 5; psd[251] = 5;
    const freq = buildFrequencies(n, 1000, 1024);
    const peaks = findSpectrumPeaks(psd, freq, 'P');
    expect(peaks.length).toBe(3);
    const freqs = peaks.map((p) => Math.round(p.freqHz)).sort((a, b) => a - b);
    expect(freqs).toEqual([78, 176, 244]);
  });

  test('empty or short input returns no peaks', () => {
    const peaks = findSpectrumPeaks(new Float32Array(5), new Float32Array(5), 'R');
    expect(peaks).toEqual([]);
  });
});
