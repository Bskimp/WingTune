import { describe, test, expect } from 'vitest';

import { estimateTransferFunction, estimateBandwidth } from '@/lib/transferFunction';

// --- Synthetic signal helpers ---------------------------------------

/** Deterministic PRNG (mulberry32) so the tests are reproducible. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White noise in [-1, 1] — broadband, so every FFT bin is excited. */
function whiteNoise(n: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = rng() * 2 - 1;
  return s;
}

/** One-pole IIR low-pass: y[n] = (1-α)·y[n-1] + α·x[n]. The -3 dB
 *  cutoff is fc ≈ -ln(1-α)·fs/(2π); inverting gives the α below. */
function onePoleLowpass(x: Float32Array, alpha: number): Float32Array {
  const y = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += alpha * (x[i] - acc);
    y[i] = acc;
  }
  return y;
}

/** α for a one-pole low-pass with -3 dB cutoff `fc` at sample rate `fs`. */
function alphaForCutoff(fc: number, fs: number): number {
  return 1 - Math.exp((-2 * Math.PI * fc) / fs);
}

/** Index of the FFT bin nearest `freqHz`. */
function binAt(freqHz: number, segmentLen: number, fs: number): number {
  return Math.round((freqHz * segmentLen) / fs);
}

// --- Tests ----------------------------------------------------------

describe('estimateTransferFunction', () => {
  const FS = 1000;

  test('first-order low-pass — |H| matches the analytic rolloff, coherence ≈ 1', () => {
    const fc = 10;
    const x = whiteNoise(100_000, 1);
    const y = onePoleLowpass(x, alphaForCutoff(fc, FS));
    const tf = estimateTransferFunction(x, y, FS);

    expect(tf.numSegments).toBeGreaterThan(50);

    // Low-frequency plateau gain ≈ 1 (DC gain of a unit-gain low-pass).
    const loBin = binAt(1.5, tf.segmentLen, FS);
    expect(tf.magnitude[loBin]).toBeGreaterThan(0.9);

    // At the cutoff |H| ≈ 1/√2 ≈ 0.707 (-3 dB).
    const fcBin = binAt(fc, tf.segmentLen, FS);
    expect(tf.magnitude[fcBin]).toBeGreaterThan(0.6);
    expect(tf.magnitude[fcBin]).toBeLessThan(0.82);

    // Above the cutoff the response keeps falling.
    const hiBin = binAt(40, tf.segmentLen, FS);
    expect(tf.magnitude[hiBin]).toBeLessThan(tf.magnitude[fcBin]);

    // A clean linear filter driven by broadband noise → coherence ≈ 1.
    expect(tf.coherence[loBin]).toBeGreaterThan(0.95);
    expect(tf.coherence[fcBin]).toBeGreaterThan(0.95);
  });

  test('first-order low-pass — phase is ~0 at DC and lags toward the cutoff', () => {
    const fc = 10;
    const x = whiteNoise(100_000, 2);
    const y = onePoleLowpass(x, alphaForCutoff(fc, FS));
    const tf = estimateTransferFunction(x, y, FS);

    const loBin = binAt(1.5, tf.segmentLen, FS);
    const fcBin = binAt(fc, tf.segmentLen, FS);
    // Near DC the filter barely shifts phase.
    expect(Math.abs(tf.phase[loBin])).toBeLessThan(0.25);
    // At the cutoff a one-pole lags by ≈ -45° (-π/4).
    expect(tf.phase[fcBin]).toBeLessThan(0);
    expect(tf.phase[fcBin]).toBeGreaterThan(-Math.PI / 2);
  });

  test('identity system — |H| ≈ 1, phase ≈ 0, coherence ≈ 1 everywhere', () => {
    const x = whiteNoise(80_000, 3);
    const y = x.slice();
    const tf = estimateTransferFunction(x, y, FS);

    for (const b of [10, 100, 500]) {
      expect(tf.magnitude[b]).toBeGreaterThan(0.98);
      expect(tf.magnitude[b]).toBeLessThan(1.02);
      expect(Math.abs(tf.phase[b])).toBeLessThan(0.02);
      expect(tf.coherence[b]).toBeGreaterThan(0.99);
    }
  });

  test('pure gain — |H| sits at the gain factor', () => {
    const x = whiteNoise(80_000, 4);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[i] * 2.5;
    const tf = estimateTransferFunction(x, y, FS);

    for (const b of [20, 200]) {
      expect(tf.magnitude[b]).toBeGreaterThan(2.45);
      expect(tf.magnitude[b]).toBeLessThan(2.55);
    }
  });

  test('uncorrelated signals — coherence ≈ 0 across the band', () => {
    const x = whiteNoise(100_000, 5);
    const y = whiteNoise(100_000, 6);
    const tf = estimateTransferFunction(x, y, FS);

    let sum = 0;
    let count = 0;
    for (let i = 1; i < tf.coherence.length; i++) {
      sum += tf.coherence[i];
      count++;
    }
    // With ~100 averaged segments the coherence bias of independent
    // signals is ≈ 1/numSegments — far below any trust threshold.
    expect(sum / count).toBeLessThan(0.2);
  });

  test('signal shorter than one segment — empty result, axis populated', () => {
    const tf = estimateTransferFunction(
      new Float32Array(1000),
      new Float32Array(1000),
      FS,
      { segmentLen: 2048 },
    );
    expect(tf.numSegments).toBe(0);
    expect(tf.frequencies.length).toBe(2048 / 2 + 1);
    expect(tf.frequencies[tf.frequencies.length - 1]).toBeCloseTo(FS / 2, 4);
    expect(tf.magnitude.every((v) => v === 0)).toBe(true);
  });

  test('length mismatch throws', () => {
    expect(() =>
      estimateTransferFunction(new Float32Array(4096), new Float32Array(2048), FS),
    ).toThrow(/length mismatch/);
  });

  test('non-power-of-2 segmentLen throws', () => {
    expect(() =>
      estimateTransferFunction(new Float32Array(8000), new Float32Array(8000), FS, {
        segmentLen: 1000,
      }),
    ).toThrow(/power of 2/);
  });
});

describe('estimateBandwidth', () => {
  const FS = 1000;

  test('first-order low-pass — rolloff lands on the planted cutoff', () => {
    const fc = 10;
    const x = whiteNoise(120_000, 7);
    const y = onePoleLowpass(x, alphaForCutoff(fc, FS));
    const tf = estimateTransferFunction(x, y, FS);
    const bw = estimateBandwidth(tf);

    expect(bw.trustworthy).toBe(true);
    expect(bw.plateauGain).toBeGreaterThan(0.9);
    expect(bw.rolloffHz).toBeGreaterThan(7.5);
    expect(bw.rolloffHz).toBeLessThan(12.5);
    expect(bw.bandCoherence).toBeGreaterThan(0.8);
  });

  test('lower planted cutoff → lower estimated bandwidth', () => {
    const x = whiteNoise(150_000, 8);
    const slow = estimateBandwidth(
      estimateTransferFunction(x, onePoleLowpass(x, alphaForCutoff(5, FS)), FS),
    );
    const fast = estimateBandwidth(
      estimateTransferFunction(x, onePoleLowpass(x, alphaForCutoff(20, FS)), FS),
      { plateauHiHz: 4, searchMaxHz: 50 },
    );
    expect(slow.rolloffHz).toBeLessThan(fast.rolloffHz);
  });

  test('uncorrelated signals — no plateau, untrustworthy', () => {
    const x = whiteNoise(100_000, 9);
    const y = whiteNoise(100_000, 10);
    const bw = estimateBandwidth(estimateTransferFunction(x, y, FS));
    expect(bw.trustworthy).toBe(false);
  });

  test('flat (identity) system — no rolloff found within the search ceiling', () => {
    const x = whiteNoise(100_000, 11);
    const bw = estimateBandwidth(estimateTransferFunction(x, x.slice(), FS));
    expect(Number.isNaN(bw.rolloffHz)).toBe(true);
    expect(bw.trustworthy).toBe(false);
    // The plateau itself still resolves — a flat system is well-defined.
    expect(bw.plateauGain).toBeGreaterThan(0.95);
  });

  test('single Welch segment — coherence not yet meaningful, untrustworthy', () => {
    // A signal exactly one segment long yields numSegments = 1, where
    // coherence is identically 1 by construction.
    const x = whiteNoise(2048, 12);
    const y = onePoleLowpass(x, alphaForCutoff(10, FS));
    const tf = estimateTransferFunction(x, y, FS, { segmentLen: 2048 });
    expect(tf.numSegments).toBe(1);
    expect(estimateBandwidth(tf).trustworthy).toBe(false);
  });
});
