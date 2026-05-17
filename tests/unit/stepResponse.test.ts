import { describe, test, expect } from 'vitest';

import { computeStepResponse, ifftInPlace } from '@/lib/stepResponse';
import { fftInPlace } from '@/lib/spectrum';

describe('ifftInPlace', () => {
  test('IFFT of FFT recovers the original real signal', () => {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const orig = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.1);
      re[i] = v;
      orig[i] = v;
    }
    fftInPlace(re, im);
    ifftInPlace(re, im);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(orig[i], 4);
    }
  });
});

describe('computeStepResponse', () => {
  // Synthetic system: y(t) = (1 - e^(-t/tau)) * step input.
  // Convolution of setpoint with first-order impulse response
  // h(t) = (1/tau) · e^(-t/tau) yields this y(t).
  function simulateFirstOrder(
    setpoint: Float32Array,
    sampleRate: number,
    tauSec: number,
  ): Float32Array {
    const out = new Float32Array(setpoint.length);
    const dt = 1 / sampleRate;
    const alpha = dt / (tauSec + dt); // discrete first-order coefficient
    let y = 0;
    for (let i = 0; i < setpoint.length; i++) {
      y += alpha * (setpoint[i] - y);
      out[i] = y;
    }
    return out;
  }

  test('insufficient samples returns empty result with numSegments=0', () => {
    const sr = 1000;
    const r = computeStepResponse(
      new Float32Array(100),
      new Float32Array(100),
      sr,
      { segmentLen: 256 },
    );
    expect(r.numSegments).toBe(0);
  });

  test('throws on mismatched setpoint/gyro length', () => {
    expect(() =>
      computeStepResponse(
        new Float32Array(2048),
        new Float32Array(1024),
        1000,
      ),
    ).toThrow(/length mismatch/);
  });

  test('throws on non-power-of-2 segmentLen', () => {
    expect(() =>
      computeStepResponse(
        new Float32Array(1024),
        new Float32Array(1024),
        1000,
        { segmentLen: 1000 },
      ),
    ).toThrow(/power of 2/);
  });

  test('recovers settling shape of a synthetic first-order system', () => {
    const sr = 1000;
    const n = 8192;
    const tauSec = 0.08; // 80 ms time constant — settles ~95% by 240 ms
    // Setpoint with rich spectral content (square wave) so deconvolution
    // has enough excitation.
    const setpoint = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const phase = Math.floor(i / 200) % 2;
      setpoint[i] = phase === 0 ? 100 : -100;
    }
    const gyro = simulateFirstOrder(setpoint, sr, tauSec);

    const r = computeStepResponse(setpoint, gyro, sr, {
      segmentLen: 1024,
      windowSec: 0.3,
      setpointPeakThreshold: 10,
    });
    expect(r.numSegments).toBeGreaterThan(0);
    // Final value should be near 1.0 for a perfect first-order tracker.
    expect(r.finalValue).toBeGreaterThan(0.7);
    expect(r.finalValue).toBeLessThan(1.4);
    // Settling time should be roughly 3·tau (~240 ms) for 95%.
    expect(r.settlingTimeMs).toBeGreaterThan(50);
    expect(r.settlingTimeMs).toBeLessThan(300);
  });

  test('all-quiet setpoint produces zero segments', () => {
    const sr = 1000;
    const setpoint = new Float32Array(8192); // all zeros
    const gyro = new Float32Array(8192);
    const r = computeStepResponse(setpoint, gyro, sr, {
      segmentLen: 1024,
      setpointPeakThreshold: 5,
    });
    expect(r.numSegments).toBe(0);
  });

  test('peak time is positive and within the window', () => {
    const sr = 1000;
    const n = 4096;
    const setpoint = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      setpoint[i] = Math.floor(i / 200) % 2 === 0 ? 80 : -80;
    }
    const gyro = simulateFirstOrder(setpoint, sr, 0.05);
    const r = computeStepResponse(setpoint, gyro, sr, {
      segmentLen: 1024,
      windowSec: 0.3,
      setpointPeakThreshold: 10,
    });
    expect(r.peakTimeMs).toBeGreaterThan(0);
    expect(r.peakTimeMs).toBeLessThanOrEqual(300);
  });
});
