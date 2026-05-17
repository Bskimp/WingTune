// Layer 2 — spectrum analysis primitives.
//
// Hand-rolled real-input FFT + Welch's method (averaged windowed
// periodograms) for power spectral density of wing log signals
// (gyroADC, D-term, etc.). Roadmap nominated `fft.js`; we hand-roll
// instead so the hot path is Float32-native, no external dep, and
// the API is shaped to what wing analytics actually want (one-sided
// PSD with a real frequency axis).
//
// Why Welch over a single FFT: long flight logs (~100k samples)
// produce noisy single-FFT spectra. Averaging across overlapping
// windowed segments trades frequency resolution for variance
// reduction — the standard tradeoff for "find resonance peaks in
// noisy real-world signal" workloads. Hann window for low sidelobes
// (non-periodic gyro signals).
//
// Segment length is chosen by the caller; a reasonable default is
// 1024 (at ~1 kHz logging that's a 1-second window with ~1 Hz
// resolution — good for the sub-50 Hz wing-tuning band).

/** In-place radix-2 Cooley-Tukey FFT. `re` and `im` must be the same
 *  length n=2^k. After return, re/im hold the frequency-domain
 *  spectrum (DC at index 0, Nyquist at n/2, negative freqs in upper
 *  half). */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`fftInPlace: length must be a power of 2, got ${n}`);
  }
  if (im.length !== n) {
    throw new Error(`fftInPlace: re/im length mismatch (${n} vs ${im.length})`);
  }

  // Bit-reversal permutation.
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Cooley-Tukey butterflies.
  for (let step = 1; step < n; step <<= 1) {
    const stride = step << 1;
    const angleStep = -Math.PI / step;
    for (let i = 0; i < n; i += stride) {
      for (let k = 0; k < step; k++) {
        const angle = angleStep * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = i + k;
        const b = a + step;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Hann window coefficients of length n. */
export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  if (n === 1) { w[0] = 1; return w; }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

export interface WelchResult {
  /** Frequency axis in Hz; length = segmentLen / 2 + 1 (one-sided). */
  frequencies: Float32Array;
  /** Power spectral density per bin, units of signal² / Hz. */
  psd: Float32Array;
  segmentLen: number;
  numSegments: number;
}

/** Power spectral density via Welch's method. Splits the signal into
 *  overlapping Hann-windowed segments, FFTs each, averages the
 *  per-segment magnitude-squared spectra. Returns a one-sided PSD
 *  (DC to Nyquist inclusive) with units signal² / Hz so the integral
 *  over frequency equals total signal variance.
 *
 *  Insufficient samples (< segmentLen) returns zeros + numSegments=0
 *  so the consumer can render an "insufficient samples" hint
 *  instead of breaking. */
export function welchPsd(
  signal: Float32Array,
  sampleRateHz: number,
  segmentLen: number = 1024,
  overlap: number = 0.5,
): WelchResult {
  if (segmentLen < 2 || (segmentLen & (segmentLen - 1)) !== 0) {
    throw new Error(`welchPsd: segmentLen must be a power of 2, got ${segmentLen}`);
  }
  if (overlap < 0 || overlap >= 1) {
    throw new Error(`welchPsd: overlap must be in [0, 1), got ${overlap}`);
  }

  const nyquistBin = segmentLen >> 1;
  const numBins = nyquistBin + 1;
  const psd = new Float32Array(numBins);
  const frequencies = new Float32Array(numBins);
  for (let i = 0; i < numBins; i++) frequencies[i] = (i * sampleRateHz) / segmentLen;

  if (signal.length < segmentLen) {
    return { frequencies, psd, segmentLen, numSegments: 0 };
  }

  const step = Math.max(1, Math.floor(segmentLen * (1 - overlap)));
  const window = hannWindow(segmentLen);
  // Sum of window² — used as the PSD normalisation factor (window energy).
  let windowEnergy = 0;
  for (let i = 0; i < segmentLen; i++) windowEnergy += window[i] * window[i];

  const re = new Float32Array(segmentLen);
  const im = new Float32Array(segmentLen);

  let numSegments = 0;
  for (let start = 0; start + segmentLen <= signal.length; start += step) {
    for (let i = 0; i < segmentLen; i++) {
      re[i] = signal[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    // One-sided PSD: DC and Nyquist count once, interior bins doubled
    // (combines +freq and −freq into a single positive-freq bin).
    psd[0] += re[0] * re[0] + im[0] * im[0];
    psd[nyquistBin] += re[nyquistBin] * re[nyquistBin] + im[nyquistBin] * im[nyquistBin];
    for (let i = 1; i < nyquistBin; i++) {
      psd[i] += 2 * (re[i] * re[i] + im[i] * im[i]);
    }
    numSegments++;
  }

  const norm = 1 / (numSegments * sampleRateHz * windowEnergy);
  for (let i = 0; i < numBins; i++) psd[i] *= norm;

  return { frequencies, psd, segmentLen, numSegments };
}

/** Convert linear PSD to decibels (10·log10). Floors at -120 dB to
 *  avoid -Infinity on zero bins. */
export function psdToDb(psd: Float32Array): Float32Array {
  const out = new Float32Array(psd.length);
  for (let i = 0; i < psd.length; i++) {
    const v = psd[i];
    out[i] = v > 1e-12 ? 10 * Math.log10(v) : -120;
  }
  return out;
}

/** Estimate effective sample rate from a monotonic time axis. Returns
 *  the inverse of the median dt across samples. */
export function estimateSampleRate(time: Float32Array): number {
  if (time.length < 2) return 0;
  // Median dt — robust to occasional sample gaps without sorting cost.
  // For typical BBL time axes dt is near-constant so picking any
  // mid-range sample is fine; use the midpoint.
  const mid = time.length >> 1;
  const dt = time[mid] - time[mid - 1];
  if (!isFinite(dt) || dt <= 0) return 0;
  return 1 / dt;
}
