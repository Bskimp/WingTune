import { describe, test, expect } from 'vitest';

import {
  fftInPlace,
  hannWindow,
  welchPsd,
  psdToDb,
  estimateSampleRate,
} from '@/lib/spectrum';

describe('fftInPlace', () => {
  test('single-tone signal has a peak at the corresponding bin', () => {
    const n = 256;
    const k = 8;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.cos((2 * Math.PI * k * i) / n);
    }
    fftInPlace(re, im);
    const mag = (j: number) => Math.sqrt(re[j] * re[j] + im[j] * im[j]);
    let peak = 0, peakIdx = 0;
    for (let i = 0; i < n / 2; i++) {
      const m = mag(i);
      if (m > peak) { peak = m; peakIdx = i; }
    }
    expect(peakIdx).toBe(k);
  });

  test('Parseval — sum of |X|^2 / N equals sum of |x|^2', () => {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.37) + 0.4 * Math.cos(i * 1.1);
    let timeEnergy = 0;
    for (let i = 0; i < n; i++) timeEnergy += re[i] * re[i];
    fftInPlace(re, im);
    let freqEnergy = 0;
    for (let i = 0; i < n; i++) freqEnergy += re[i] * re[i] + im[i] * im[i];
    expect(freqEnergy / n).toBeCloseTo(timeEnergy, 3);
  });

  test('throws on non-power-of-2 length', () => {
    const re = new Float32Array(100);
    const im = new Float32Array(100);
    expect(() => fftInPlace(re, im)).toThrow(/power of 2/);
  });

  test('throws on length mismatch', () => {
    expect(() => fftInPlace(new Float32Array(64), new Float32Array(32))).toThrow(/mismatch/);
  });
});

describe('hannWindow', () => {
  test('starts and ends at zero, peaks at one in the middle', () => {
    const w = hannWindow(128);
    expect(w[0]).toBeCloseTo(0, 5);
    expect(w[127]).toBeCloseTo(0, 5);
    expect(w[63]).toBeGreaterThan(0.99);
  });

  test('single-element window is 1', () => {
    const w = hannWindow(1);
    expect(w[0]).toBe(1);
  });
});

describe('welchPsd', () => {
  test('60 Hz sine in 1000 Hz signal peaks at 60 Hz', () => {
    const sampleRate = 1000;
    const freq = 60;
    const n = 8192;
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    const r = welchPsd(signal, sampleRate, 1024, 0.5);
    let peakIdx = 0, peakVal = 0;
    for (let i = 1; i < r.psd.length; i++) {
      if (r.psd[i] > peakVal) { peakVal = r.psd[i]; peakIdx = i; }
    }
    expect(r.frequencies[peakIdx]).toBeCloseTo(60, 0);
    expect(r.numSegments).toBeGreaterThan(10);
  });

  test('two-tone signal resolves both peaks', () => {
    const sampleRate = 1000;
    const n = 8192;
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[i] = Math.sin((2 * Math.PI * 50 * i) / sampleRate)
               + Math.sin((2 * Math.PI * 120 * i) / sampleRate);
    }
    const r = welchPsd(signal, sampleRate, 1024, 0.5);
    // Find local maxima above 30% of max.
    let max = 0;
    for (const v of r.psd) if (v > max) max = v;
    const peaks: number[] = [];
    for (let i = 5; i < r.psd.length - 5; i++) {
      if (r.psd[i] > r.psd[i - 1] && r.psd[i] > r.psd[i + 1] && r.psd[i] > max * 0.3) {
        peaks.push(r.frequencies[i]);
      }
    }
    expect(peaks).toEqual(expect.arrayContaining([
      expect.closeTo(50, 0),
      expect.closeTo(120, 0),
    ]));
  });

  test('insufficient samples returns zeros + numSegments=0', () => {
    const r = welchPsd(new Float32Array(100), 1000, 1024, 0.5);
    expect(r.numSegments).toBe(0);
    for (const v of r.psd) expect(v).toBe(0);
    // Frequency axis still populated so consumers can render the
    // empty chart against the right x bounds.
    expect(r.frequencies[r.frequencies.length - 1]).toBeCloseTo(500, 0);
  });

  test('throws on non-power-of-2 segment length', () => {
    expect(() => welchPsd(new Float32Array(1000), 1000, 700, 0.5)).toThrow(/power of 2/);
  });

  test('throws on invalid overlap', () => {
    expect(() => welchPsd(new Float32Array(1000), 1000, 512, 1.0)).toThrow(/overlap/);
    expect(() => welchPsd(new Float32Array(1000), 1000, 512, -0.1)).toThrow(/overlap/);
  });
});

describe('psdToDb', () => {
  test('converts linear power to 10·log10', () => {
    const psd = new Float32Array([1, 10, 100, 0.01]);
    const db = psdToDb(psd);
    expect(db[0]).toBeCloseTo(0, 5);
    expect(db[1]).toBeCloseTo(10, 5);
    expect(db[2]).toBeCloseTo(20, 5);
    expect(db[3]).toBeCloseTo(-20, 5);
  });

  test('floors zero bins at -120 dB', () => {
    const db = psdToDb(new Float32Array([0]));
    expect(db[0]).toBe(-120);
  });
});

describe('estimateSampleRate', () => {
  test('reads 1000 Hz off a uniformly-spaced axis', () => {
    const t = new Float32Array(1000);
    for (let i = 0; i < t.length; i++) t[i] = i * 0.001;
    expect(estimateSampleRate(t)).toBeCloseTo(1000, 0);
  });

  test('returns 0 for an empty or single-sample axis', () => {
    expect(estimateSampleRate(new Float32Array(0))).toBe(0);
    expect(estimateSampleRate(new Float32Array([0]))).toBe(0);
  });
});
