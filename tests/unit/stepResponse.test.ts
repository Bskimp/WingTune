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

  // Synthetic underdamped 2nd-order plant: ÿ + 2ζωn·ẏ + ωn²·y = ωn²·u.
  // Semi-implicit Euler integration — independent code from the Wiener
  // deconvolution under test. Continuous-time closed forms:
  //   overshoot Mp = exp(-ζπ/√(1-ζ²)),  peak time tp = π/(ωn√(1-ζ²)).
  function simulateSecondOrder(
    setpoint: Float32Array,
    sampleRate: number,
    omegaN: number,
    zeta: number,
  ): Float32Array {
    const out = new Float32Array(setpoint.length);
    const dt = 1 / sampleRate;
    let y = 0;
    let yd = 0;
    for (let i = 0; i < setpoint.length; i++) {
      const ydd = omegaN * omegaN * (setpoint[i] - y) - 2 * zeta * omegaN * yd;
      yd += ydd * dt;
      y += yd * dt;
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

  test('recovers shape + latency of a synthetic first-order system', () => {
    const sr = 1000;
    const n = 8192;
    const tauSec = 0.08; // 80 ms time constant
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
      peakWindowMs: 300,
    });
    expect(r.numSegments).toBeGreaterThan(0);
    // Final value should be near 1.0 for a perfect first-order tracker.
    expect(r.finalValue).toBeGreaterThan(0.7);
    expect(r.finalValue).toBeLessThan(1.4);
    // Peak (within 300 ms window) should be around 1.0 — no overshoot
    // on a clean 1st-order system, just asymptotic approach.
    expect(r.peakAmplitude).toBeGreaterThan(0.7);
    expect(r.peakAmplitude).toBeLessThan(1.4);
    // Latency to 0.5 for 1st-order: t = tau · ln(2) ≈ 55 ms. Wide
    // tolerance for Wiener deconvolution noise.
    expect(r.latencyMs).toBeGreaterThan(30);
    expect(r.latencyMs).toBeLessThan(100);
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

  test('recovers overshoot of a synthetic underdamped 2nd-order system', () => {
    // A first-order plant only ever approaches 1.0 asymptotically, so it
    // never exercises peakAmplitude > 1.0 — the overshoot diagnostic the
    // Step tab exists for. An underdamped 2nd-order plant overshoots by a
    // known amount, covering that path and guarding the Wiener
    // deconvolution's ability to preserve mid-band ringing.
    const sr = 1000;
    const n = 16384;
    const omegaN = 40; // rad/s
    const zeta = 0.3;  // → Mp ≈ 0.372, peak ≈ 1.372, tp ≈ 82 ms
    const setpoint = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      setpoint[i] = Math.floor(i / 400) % 2 === 0 ? 100 : -100;
    }
    const gyro = simulateSecondOrder(setpoint, sr, omegaN, zeta);

    const r = computeStepResponse(setpoint, gyro, sr, {
      segmentLen: 2048,
      windowSec: 0.4,
      setpointPeakThreshold: 10,
      peakWindowMs: 400,
    });

    const mp = Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
    const expectedPeak = 1 + mp; // ≈ 1.372
    const tpMs = (Math.PI / (omegaN * Math.sqrt(1 - zeta * zeta))) * 1000; // ≈ 82 ms

    expect(r.numSegments).toBeGreaterThan(0);
    // Load-bearing assertion: a genuine overshoot is detected. A
    // first-order plant can never satisfy this.
    expect(r.peakAmplitude).toBeGreaterThan(1.08);
    // ...and it lands near the closed-form overshoot. The band absorbs
    // Euler discretization + Wiener deconvolution noise.
    expect(r.peakAmplitude).toBeGreaterThan(expectedPeak - 0.25);
    expect(r.peakAmplitude).toBeLessThan(expectedPeak + 0.25);
    // Settles back toward 1.0.
    expect(r.finalValue).toBeGreaterThan(0.7);
    expect(r.finalValue).toBeLessThan(1.3);
    // Peak occurs near the closed-form peak time, not at the window edge.
    expect(r.peakTimeMs).toBeGreaterThan(tpMs - 50);
    expect(r.peakTimeMs).toBeLessThan(tpMs + 80);
  });
});
