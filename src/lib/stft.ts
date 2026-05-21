// Layer 2 — short-time FFT (STFT).
//
// Welch's method (lib/spectrum.welchPsd) averages every windowed
// periodogram into one PSD — it answers "what frequencies are in this
// signal" but throws away WHEN. STFT keeps each window's spectrum as a
// separate column, so the result is a time x frequency picture: a
// spectrogram.
//
// Shared primitive for the Spectrum-tab roadmap (docs/wingtune-
// spectrum-roadmap.md). S1 / M-FilterSim re-tracks the dynamic notch
// by peak-picking STFT columns of the raw gyro; S2 bins STFT columns
// by airspeed for the airspeed x frequency heatmap and builds the
// low-frequency + wavelet views on the same engine. Built once, here.
//
// Reuses the radix-2 FFT and Hann window from lib/spectrum — no second
// FFT implementation. Each column carries the same one-sided PSD units
// (signal^2 / Hz) as welchPsd's per-segment periodogram, so averaging
// every STFT column reproduces a Welch PSD.

import { fftInPlace, hannWindow } from '@/lib/spectrum';

export interface StftResult {
  /** One column per analysis window — each is a one-sided power
   *  spectral density, length `windowSize / 2 + 1`, units signal^2/Hz.
   *  Empty when the signal is shorter than a single window. */
  columns: Float32Array[];
  /** Centre time of each column, seconds since the signal start.
   *  Same length as `columns`. */
  centreTimeSec: Float32Array;
  /** Frequency axis in Hz, shared by every column; length
   *  `windowSize / 2 + 1` (DC to Nyquist inclusive). */
  frequencies: Float32Array;
  /** Frequency resolution — `sampleRateHz / windowSize` Hz per bin. */
  binHz: number;
  windowSize: number;
  hopSize: number;
}

/** Short-time FFT — a sequence of one-sided power spectra, one per
 *  Hann-windowed segment, stepped by `hopSize` samples.
 *
 *  `windowSize` must be a power of 2 (radix-2 FFT). Shorter windows
 *  trade frequency resolution for time resolution — pick per use: the
 *  dyn-notch tracker wants tight time localisation, an airspeed-binned
 *  spectrogram wants more columns.
 *
 *  A signal shorter than one window returns `columns: []` with the
 *  frequency axis still populated, so a consumer can render an
 *  "insufficient samples" state against the right axis. */
export function computeStft(
  signal: Float32Array,
  sampleRateHz: number,
  windowSize: number = 256,
  hopSize: number = windowSize >> 1,
): StftResult {
  if (windowSize < 2 || (windowSize & (windowSize - 1)) !== 0) {
    throw new Error(`computeStft: windowSize must be a power of 2, got ${windowSize}`);
  }
  if (hopSize < 1) {
    throw new Error(`computeStft: hopSize must be >= 1, got ${hopSize}`);
  }
  if (!(sampleRateHz > 0)) {
    throw new Error(`computeStft: sampleRateHz must be > 0, got ${sampleRateHz}`);
  }

  const nyquistBin = windowSize >> 1;
  const numBins = nyquistBin + 1;
  const binHz = sampleRateHz / windowSize;

  const frequencies = new Float32Array(numBins);
  for (let i = 0; i < numBins; i++) frequencies[i] = i * binHz;

  if (signal.length < windowSize) {
    return {
      columns: [],
      centreTimeSec: new Float32Array(0),
      frequencies,
      binHz,
      windowSize,
      hopSize,
    };
  }

  const window = hannWindow(windowSize);
  // Window energy (sum of w^2) — the PSD normalisation, same as welchPsd.
  let windowEnergy = 0;
  for (let i = 0; i < windowSize; i++) windowEnergy += window[i] * window[i];
  const norm = 1 / (sampleRateHz * windowEnergy);

  const numColumns = Math.floor((signal.length - windowSize) / hopSize) + 1;
  const columns: Float32Array[] = [];
  const centreTimeSec = new Float32Array(numColumns);

  const re = new Float32Array(windowSize);
  const im = new Float32Array(windowSize);

  let c = 0;
  for (let start = 0; start + windowSize <= signal.length; start += hopSize) {
    for (let i = 0; i < windowSize; i++) {
      re[i] = signal[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    // One-sided PSD: DC + Nyquist counted once, interior bins doubled
    // (folds the +freq and -freq halves into one positive-freq bin).
    const col = new Float32Array(numBins);
    col[0] = (re[0] * re[0] + im[0] * im[0]) * norm;
    col[nyquistBin] =
      (re[nyquistBin] * re[nyquistBin] + im[nyquistBin] * im[nyquistBin]) * norm;
    for (let i = 1; i < nyquistBin; i++) {
      col[i] = 2 * (re[i] * re[i] + im[i] * im[i]) * norm;
    }
    columns.push(col);
    centreTimeSec[c] = (start + (windowSize - 1) / 2) / sampleRateHz;
    c++;
  }

  return { columns, centreTimeSec, frequencies, binHz, windowSize, hopSize };
}
