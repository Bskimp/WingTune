// Layer 2 — cross-spectral transfer-function + coherence estimator.
//
// The InputChain panel (M-Servo MVP) reports servo->gyro lag as one
// bulk millisecond number — it collapses the airframe's frequency
// response to a scalar. This module keeps the frequency axis: given a
// servo (input) + gyro (output) signal pair it estimates the transfer
// function H(f) — how the airframe converts commanded surface motion
// into rotation rate, across frequency. The -3 dB rolloff of |H(f)|
// is the airframe BANDWIDTH: the hard ceiling on how fast the wing
// can EVER be tuned to respond. A tune chasing a faster response than
// that ceiling is chasing something physics will not deliver.
//
// Method — Welch-averaged cross-spectral estimation:
//   * split both signals into Hann-windowed overlapping segments
//     (reusing fftInPlace + hannWindow from lib/spectrum — no second
//     FFT implementation),
//   * accumulate the auto-spectra Sxx, Syy and the complex cross-
//     spectrum Sxy = E[conj(X)*Y] across segments,
//   * H(f)    = Sxy(f) / Sxx(f)            (the H1 estimator)
//   * gamma2  = |Sxy|^2 / (Sxx * Syy)      magnitude-squared coherence.
//
// Coherence is the honesty metric. gamma2 ~ 1 means the gyro really
// is a linear response to the servo at that frequency; gamma2 ~ 0
// means noise, or the airframe simply was not excited there. It is
// only meaningful AVERAGED over >= 2 segments — a single segment has
// gamma2 identically 1 at every bin by construction. The UI must grey
// any magnitude point whose coherence is low; estimateBandwidth gates
// on it directly.
//
// Per-segment mean removal: servo PWM carries a large DC trim offset
// (~1500 us). We measure dynamics, not trim, so each segment is
// detrended (mean subtracted) before windowing — standard practice
// for transfer-function estimation. Window energy + segment-count
// normalisation cancel in both H and gamma2, so neither is applied.

import { fftInPlace, hannWindow } from '@/lib/spectrum';

const DEFAULT_SEGMENT_LEN = 2048;
const DEFAULT_OVERLAP = 0.5;

export interface TransferFunctionResult {
  /** Frequency axis in Hz; length = segmentLen / 2 + 1 (one-sided,
   *  DC to Nyquist inclusive). */
  frequencies: Float32Array;
  /** |H(f)| — transfer-function magnitude. Output units per input
   *  unit (gyro deg/s per servo PWM unit); unitless when x and y
   *  share units. */
  magnitude: Float32Array;
  /** |H(f)| in decibels, 20*log10(|H|), floored at -120 dB. */
  magnitudeDb: Float32Array;
  /** Phase of H(f) in radians, atan2(Im, Re) ∈ (-π, π]. Negative =
   *  gyro lags servo (the normal case for an airframe). */
  phase: Float32Array;
  /** Magnitude-squared coherence γ²(f) ∈ [0,1]. Near 1 → the gyro is
   *  a linear response to the servo at that bin; near 0 → noise / no
   *  excitation. Meaningful ONLY when numSegments ≥ 2. */
  coherence: Float32Array;
  segmentLen: number;
  /** Welch segments averaged. Coherence is identically 1 at every bin
   *  when this is < 2 — the estimate needs ≥ 2 to be trustworthy. */
  numSegments: number;
}

export interface TransferFunctionOptions {
  /** Welch segment length — power of 2. Default 2048: at ~1 kHz
   *  logging that is ~0.5 Hz resolution, fine enough to resolve the
   *  low-Hz airframe rolloff. */
  segmentLen?: number;
  /** Fractional overlap between segments, [0, 1). Default 0.5. */
  overlap?: number;
  /** Optional [startIdx, endIdx) sample ranges to restrict the Welch
   *  estimate to. A segment never straddles a range boundary, so the
   *  ranges can be NON-contiguous flight spans (e.g. M-FF maneuver
   *  windows) with no join discontinuity — the estimator simply skips
   *  the gaps. Omitted / empty → the whole signal. */
  regions?: ReadonlyArray<readonly [number, number]>;
}

/** Welch-averaged transfer function H(f) = Sxy/Sxx and coherence
 *  γ²(f) for an input `x` (e.g. per-axis servo aggregate) → output
 *  `y` (e.g. gyro) pair sampled at `sampleRateHz`.
 *
 *  A signal shorter than one segment returns zeroed magnitude /
 *  coherence with `numSegments = 0` and the frequency axis still
 *  populated, so a consumer can render an "insufficient samples"
 *  state against the right axis. */
export function estimateTransferFunction(
  x: Float32Array,
  y: Float32Array,
  sampleRateHz: number,
  options: TransferFunctionOptions = {},
): TransferFunctionResult {
  const segmentLen = options.segmentLen ?? DEFAULT_SEGMENT_LEN;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (segmentLen < 2 || (segmentLen & (segmentLen - 1)) !== 0) {
    throw new Error(
      `estimateTransferFunction: segmentLen must be a power of 2, got ${segmentLen}`,
    );
  }
  if (overlap < 0 || overlap >= 1) {
    throw new Error(`estimateTransferFunction: overlap must be in [0, 1), got ${overlap}`);
  }
  if (!(sampleRateHz > 0)) {
    throw new Error(`estimateTransferFunction: sampleRateHz must be > 0, got ${sampleRateHz}`);
  }
  if (x.length !== y.length) {
    throw new Error(
      `estimateTransferFunction: x (${x.length}) and y (${y.length}) length mismatch`,
    );
  }

  const nyquistBin = segmentLen >> 1;
  const numBins = nyquistBin + 1;

  const frequencies = new Float32Array(numBins);
  for (let i = 0; i < numBins; i++) frequencies[i] = (i * sampleRateHz) / segmentLen;

  const magnitude = new Float32Array(numBins);
  const magnitudeDb = new Float32Array(numBins);
  const phase = new Float32Array(numBins);
  const coherence = new Float32Array(numBins);

  if (x.length < segmentLen) {
    return { frequencies, magnitude, magnitudeDb, phase, coherence, segmentLen, numSegments: 0 };
  }

  const step = Math.max(1, Math.floor(segmentLen * (1 - overlap)));
  const window = hannWindow(segmentLen);

  // Welch accumulators: auto-spectra Sxx/Syy (real) and the complex
  // cross-spectrum Sxy. Float64 — many segments summed, precision matters.
  const sxx = new Float64Array(numBins);
  const syy = new Float64Array(numBins);
  const sxyRe = new Float64Array(numBins);
  const sxyIm = new Float64Array(numBins);

  // Reusable per-segment FFT buffers.
  const xRe = new Float32Array(segmentLen);
  const xIm = new Float32Array(segmentLen);
  const yRe = new Float32Array(segmentLen);
  const yIm = new Float32Array(segmentLen);

  // Whole signal unless explicit regions were given.
  const regions: ReadonlyArray<readonly [number, number]> =
    options.regions && options.regions.length > 0
      ? options.regions
      : [[0, x.length]];

  let numSegments = 0;
  for (const region of regions) {
    const lo = Math.max(0, Math.trunc(region[0]));
    const hi = Math.min(x.length, Math.trunc(region[1]));
    for (let start = lo; start + segmentLen <= hi; start += step) {
      // Per-segment mean removal — measure dynamics, not DC trim.
      let xMean = 0;
      let yMean = 0;
      for (let i = 0; i < segmentLen; i++) {
        xMean += x[start + i];
        yMean += y[start + i];
      }
      xMean /= segmentLen;
      yMean /= segmentLen;

      for (let i = 0; i < segmentLen; i++) {
        const w = window[i];
        xRe[i] = (x[start + i] - xMean) * w;
        xIm[i] = 0;
        yRe[i] = (y[start + i] - yMean) * w;
        yIm[i] = 0;
      }
      fftInPlace(xRe, xIm);
      fftInPlace(yRe, yIm);

      // Sxy = conj(X) * Y = (xRe - i·xIm)(yRe + i·yIm).
      for (let i = 0; i < numBins; i++) {
        sxx[i] += xRe[i] * xRe[i] + xIm[i] * xIm[i];
        syy[i] += yRe[i] * yRe[i] + yIm[i] * yIm[i];
        sxyRe[i] += xRe[i] * yRe[i] + xIm[i] * yIm[i];
        sxyIm[i] += xRe[i] * yIm[i] - xIm[i] * yRe[i];
      }
      numSegments++;
    }
  }

  for (let i = 0; i < numBins; i++) {
    const sx = sxx[i];
    if (sx <= 0) {
      // No input energy at this bin — H undefined, coherence 0.
      magnitudeDb[i] = -120;
      continue;
    }
    // H = Sxy / Sxx.
    const hRe = sxyRe[i] / sx;
    const hIm = sxyIm[i] / sx;
    const mag = Math.hypot(hRe, hIm);
    magnitude[i] = mag;
    magnitudeDb[i] = mag > 1e-6 ? 20 * Math.log10(mag) : -120;
    phase[i] = Math.atan2(hIm, hRe);

    // γ² = |Sxy|² / (Sxx · Syy). Clamp — round-off can nudge past 1.
    const denom = sx * syy[i];
    coherence[i] =
      denom > 0
        ? Math.min(1, (sxyRe[i] * sxyRe[i] + sxyIm[i] * sxyIm[i]) / denom)
        : 0;
  }

  return { frequencies, magnitude, magnitudeDb, phase, coherence, segmentLen, numSegments };
}

export interface BandwidthEstimate {
  /** -3 dB rolloff frequency in Hz, measured relative to the
   *  low-frequency gain plateau (NOT relative to unity — the
   *  airframe's low-freq gain is whatever the mixer + control
   *  authority give). NaN when the plateau can't be resolved (too few
   *  coherent low-freq bins) or |H| never drops 3 dB before coherence
   *  fails / the search ceiling. */
  rolloffHz: number;
  /** Low-frequency gain plateau — median |H| over the plateau band.
   *  NaN when too few coherent bins fall in the band. */
  plateauGain: number;
  /** Mean coherence across the band used for the estimate (plateau
   *  band + the rolloff search span). Low → the airframe was not
   *  excited broadly enough to trust the estimate. */
  bandCoherence: number;
  /** True only when a rolloff was found AND bandCoherence clears the
   *  trust threshold. False → render the estimate greyed / caveated. */
  trustworthy: boolean;
}

export interface EstimateBandwidthOptions {
  /** Low-frequency band [plateauLoHz, plateauHiHz] whose median |H|
   *  is the gain plateau the -3 dB rolloff is measured against.
   *  Wing-regime first guess — TODO calibrate. */
  plateauLoHz?: number;
  plateauHiHz?: number;
  /** Coherence floor. Plateau bins below it are excluded from the
   *  median; the rolloff search stops if coherence falls below it
   *  before -3 dB is reached (|H| is not trustworthy past that).
   *  TODO calibrate. */
  minCoherence?: number;
  /** Upper bound of the rolloff search (Hz). Past this the airframe
   *  is effectively flat for wing purposes (CLAUDE.md SCOPE box:
   *  interesting band sub-50 Hz). TODO calibrate. */
  searchMaxHz?: number;
}

const DEFAULT_PLATEAU_LO_HZ = 0.5;
const DEFAULT_PLATEAU_HI_HZ = 4;
const DEFAULT_MIN_COHERENCE = 0.5;
const DEFAULT_SEARCH_MAX_HZ = 50;

/** Median of a numeric array (sorts a copy — arrays here are small). */
function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Estimate the airframe bandwidth — the -3 dB rolloff of |H(f)|
 *  relative to its low-frequency gain plateau.
 *
 *  Returns NaN / untrustworthy rather than a guessed number whenever
 *  the data does not support an estimate: fewer than 2 Welch segments
 *  (coherence not yet meaningful), too few coherent bins in the
 *  plateau band, or coherence failing before |H| crosses -3 dB. The
 *  panel greys those cases — a fabricated bandwidth is worse than
 *  "couldn't tell". */
export function estimateBandwidth(
  tf: TransferFunctionResult,
  options: EstimateBandwidthOptions = {},
): BandwidthEstimate {
  const plateauLoHz = options.plateauLoHz ?? DEFAULT_PLATEAU_LO_HZ;
  const plateauHiHz = options.plateauHiHz ?? DEFAULT_PLATEAU_HI_HZ;
  const minCoherence = options.minCoherence ?? DEFAULT_MIN_COHERENCE;
  const searchMaxHz = options.searchMaxHz ?? DEFAULT_SEARCH_MAX_HZ;

  const untrustworthy: BandwidthEstimate = {
    rolloffHz: NaN,
    plateauGain: NaN,
    bandCoherence: 0,
    trustworthy: false,
  };

  // Coherence is identically 1 with a single segment — meaningless.
  if (tf.numSegments < 2) return untrustworthy;

  const { frequencies, magnitude, coherence } = tf;

  // --- Plateau gain: median |H| over coherent bins in the low band. ---
  const plateauMags: number[] = [];
  let cohSum = 0;
  let cohCount = 0;
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    if (f < plateauLoHz || f > plateauHiHz) continue;
    cohSum += coherence[i];
    cohCount++;
    if (coherence[i] >= minCoherence) plateauMags.push(magnitude[i]);
  }
  if (plateauMags.length < 2) {
    return { ...untrustworthy, bandCoherence: cohCount > 0 ? cohSum / cohCount : 0 };
  }
  const plateauGain = median(plateauMags);
  const threshold = plateauGain / Math.SQRT2; // -3 dB.

  // --- Rolloff search: first bin above the plateau band where |H|
  //     drops to the -3 dB threshold. Stop if coherence fails first —
  //     |H| past that point is not trustworthy. ---
  let rolloffHz = NaN;
  let prevF = plateauHiHz;
  let prevMag = plateauGain;
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    if (f <= plateauHiHz) continue;
    if (f > searchMaxHz) break;
    cohSum += coherence[i];
    cohCount++;
    if (coherence[i] < minCoherence) break; // |H| unreliable past here.
    const mag = magnitude[i];
    if (mag <= threshold) {
      // Linear-interpolate the crossing for a sub-bin estimate.
      rolloffHz =
        prevMag > threshold && prevMag !== mag
          ? prevF + ((prevMag - threshold) / (prevMag - mag)) * (f - prevF)
          : f;
      break;
    }
    prevF = f;
    prevMag = mag;
  }

  const bandCoherence = cohCount > 0 ? cohSum / cohCount : 0;
  return {
    rolloffHz,
    plateauGain,
    bandCoherence,
    trustworthy: Number.isFinite(rolloffHz) && bandCoherence >= minCoherence,
  };
}
