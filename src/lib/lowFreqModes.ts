// Layer 2 — low-frequency airframe-mode detection.
//
// M4's Spectrum tab and S2's airspeed spectrogram both live in the
// 3-500 Hz band — noise, filters, control-surface buzz. Nothing looks
// BELOW that, where a fixed-wing aircraft's slow rigid-body modes live:
//   · phugoid       ~0.02-0.12 Hz  — slow speed/altitude exchange (pitch)
//   · dutch roll    ~0.15-1.2 Hz   — coupled roll + yaw oscillation
//   · short period  ~0.4-3 Hz      — fast pitch bob
// A peak in this band is an AIRFRAME dynamic mode — a CG / tail-volume /
// dihedral diagnostic — not motor noise. (CLAUDE.md SCOPE box: wing
// airframe modes are a regime quad analyzers never look at.)
//
// Resolving these needs frequency resolution, not time localisation, so
// this is a long-window FFT — the opposite tradeoff from lib/stft.ts.
// The gyro is first decimated (block-average) to ~20 Hz: the modes are
// all sub-3 Hz, so a large rate cut costs nothing and makes a single
// whole-flight FFT cheap. The analysis window is the WHOLE decimated
// signal (Hann-windowed, zero-padded to a power of 2) — every sample
// counts toward the resolution, which is what a 0.02 Hz phugoid demands.
//
// Spectrum-tab roadmap S2 Phase 3 (docs/wingtune-spectrum-roadmap.md +
// docs/wingtune-s2-execution.md).

import { fftInPlace, hannWindow, psdToDb } from '@/lib/spectrum';

export type ControlAxis = 'roll' | 'pitch' | 'yaw';
export type AirframeModeName = 'phugoid' | 'dutch-roll' | 'short-period';

export interface LowFreqModeOptions {
  /** Rate the gyro is decimated to before the long FFT, Hz. Default 20
   *  (Nyquist 10 Hz — comfortably above the 3 Hz mode band). */
  targetRateHz?: number;
  /** Upper edge of the analysed band, Hz. Default 3. */
  maxBandHz?: number;
  /** Minimum prominence above the local spectral floor for a peak, dB.
   *  Default 6. */
  prominenceDb?: number;
  /** Cycles of a band's slowest frequency the window must span for that
   *  band to count as resolved. Default 2. */
  minCycles?: number;
}

export interface LowFreqBand {
  name: AirframeModeName;
  loHz: number;
  hiHz: number;
  /** Control axes this mode is expected to show on. */
  axes: ReadonlyArray<ControlAxis>;
  /** Seconds of continuous flight needed to resolve this band
   *  (`minCycles / loHz`). */
  requiredWindowSec: number;
  /** False when the analysis window is shorter than `requiredWindowSec`
   *  — a peak found in an unresolved band is not trustworthy. */
  resolved: boolean;
}

export interface LowFreqPeak {
  /** Peak centre frequency, Hz. */
  freqHz: number;
  /** Peak PSD magnitude, dB. */
  powerDb: number;
  /** Rise above the higher of the two flanking spectral minima, dB. */
  prominenceDb: number;
  /** Best-guess airframe mode from the peak's frequency band + axis,
   *  or 'unclassified' when no named mode covers it on this axis. */
  mode: AirframeModeName | 'unclassified';
  /** False when the peak's band is unresolved (window too short) — the
   *  peak is then suspect. True for resolved bands and 'unclassified'. */
  bandResolved: boolean;
}

export interface LowFreqModeResult {
  /** Sub-band frequency axis, Hz — DC-adjacent bins excluded, capped at
   *  `maxBandHz`. */
  frequencies: Float32Array;
  /** PSD in dB over `frequencies`. */
  psdDb: Float32Array;
  /** Detected peaks, sorted by descending prominence. */
  peaks: LowFreqPeak[];
  /** The three named airframe-mode bands + their resolved flags. */
  bands: LowFreqBand[];
  /** FFT bin spacing on the frequency axis, Hz. */
  binHz: number;
  /** Analysis window length, seconds — the real decimated-signal
   *  duration (the resolution limit, regardless of zero-padding). */
  windowSec: number;
  /** Rate the gyro was decimated to before the long FFT, Hz. */
  decimatedRateHz: number;
  /** True when the log is too short to run the analysis at all. */
  tooShort: boolean;
}

interface ModeBandDef {
  name: AirframeModeName;
  loHz: number;
  hiHz: number;
  axes: ReadonlyArray<ControlAxis>;
}

/** Wing-regime airframe-mode bands. On the pitch axis phugoid and
 *  short-period do not overlap (gap 0.12-0.4 Hz); dutch roll is the only
 *  roll/yaw mode — so frequency + axis classify a peak unambiguously. */
const MODE_BANDS: ModeBandDef[] = [
  { name: 'phugoid',      loHz: 0.02, hiHz: 0.12, axes: ['pitch'] },
  { name: 'dutch-roll',   loHz: 0.15, hiHz: 1.2,  axes: ['roll', 'yaw'] },
  { name: 'short-period', loHz: 0.4,  hiHz: 3.0,  axes: ['pitch'] },
];

/** Lowest frequency kept on the axis — below this is DC drift, not a
 *  mode (the slowest named mode, phugoid, starts at 0.02 Hz). */
const FLOOR_HZ = 0.015;
/** Smallest decimated-signal length the analysis will run on. */
const MIN_DECIMATED = 64;
/** Cap on the zero-padded FFT length — bounds cost on very long logs. */
const MAX_FFT_LEN = 65536;
/** Minimum frequency separation between two reported 'unclassified'
 *  peaks, Hz (named-mode peaks are capped at one each). */
const MIN_PEAK_SEP_HZ = 0.05;
/** Maximum peaks reported in total. */
const MAX_PEAKS = 8;
/** Maximum 'unclassified' peaks reported — named-mode peaks are capped
 *  at one each (a band is one physical rigid-body mode; see findPeaks). */
const MAX_UNCLASSIFIED_PEAKS = 3;
/** Proportional smoothing width applied to the PSD before peak-picking:
 *  bin i is boxcar-averaged over ±round(absBin · this) neighbours.
 *  Frequency-proportional (not fixed-width) so it cleans noise spikes in
 *  the wide upper bands without flattening the narrow phugoid band.
 *  TODO calibrate against a clean-flight corpus log. */
const SMOOTH_FRACTION = 0.1;

/** Block-average decimation by an integer factor — a crude anti-alias
 *  low-pass (first null at the new sample rate), which is plenty when
 *  the band of interest (<3 Hz) sits far below the new Nyquist. */
function decimate(signal: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return signal;
  const outLen = Math.floor(signal.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) sum += signal[base + k];
    out[i] = sum / factor;
  }
  return out;
}

/** Smallest power of 2 >= n. */
function ceilPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Frequency-proportional triangular smoothing of a dB spectrum. Bin i
 *  is a triangular-weighted average over ±round(absBin · fraction)
 *  neighbours, where absBin = freq / binHz. Wide at high frequency
 *  (cleans the broadband noise spikes riding on a mode, which would
 *  otherwise each read as a separate "mode"); near-zero at the low end
 *  so the narrow phugoid band stays sharp.
 *
 *  Triangular, not boxcar: a boxcar turns a sharp peak into a flat-
 *  topped plateau — many tied local maxima the peak-picker can't place.
 *  A triangular kernel keeps a single rounded maximum at the peak. */
function smoothProportional(
  psdDb: Float32Array,
  frequencies: Float32Array,
  binHz: number,
  fraction: number,
): Float32Array {
  const n = psdDb.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const absBin = binHz > 0 ? frequencies[i] / binHz : i;
    const half = Math.max(1, Math.round(absBin * fraction));
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    let wsum = 0;
    for (let j = lo; j <= hi; j++) {
      const w = 1 - Math.abs(j - i) / (half + 1);
      sum += psdDb[j] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

function buildBands(windowSec: number, minCycles: number): LowFreqBand[] {
  return MODE_BANDS.map((b) => {
    const requiredWindowSec = minCycles / b.loHz;
    return {
      name: b.name,
      loHz: b.loHz,
      hiHz: b.hiHz,
      axes: b.axes,
      requiredWindowSec,
      resolved: windowSec >= requiredWindowSec,
    };
  });
}

/** Classify a peak frequency on a given axis against the named bands. */
function classifyPeak(
  freqHz: number,
  axis: ControlAxis,
  bands: LowFreqBand[],
): { mode: AirframeModeName | 'unclassified'; bandResolved: boolean } {
  for (const b of bands) {
    if (freqHz >= b.loHz && freqHz <= b.hiHz && b.axes.includes(axis)) {
      return { mode: b.name, bandResolved: b.resolved };
    }
  }
  return { mode: 'unclassified', bandResolved: true };
}

function findPeaks(
  frequencies: Float32Array,
  psdDb: Float32Array,
  prominenceDb: number,
  axis: ControlAxis,
  bands: LowFreqBand[],
): LowFreqPeak[] {
  const n = psdDb.length;
  if (n < 5) return [];
  const binHz = frequencies[1] - frequencies[0];
  // Flanking-valley search window — ~0.4 Hz each side, bin-count clamped.
  const K = Math.min(200, Math.max(3, Math.round(0.4 / binHz)));

  const found: LowFreqPeak[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(psdDb[i] >= psdDb[i - 1] && psdDb[i] >= psdDb[i + 1])) continue;
    // Topographic prominence: rise above the higher of the two flanking
    // minima. On a 1/f slope a non-peak bin sits BELOW its low-side
    // valley, so this never false-positives on the slope itself.
    let leftMin = Infinity;
    for (let j = Math.max(0, i - K); j < i; j++) {
      if (psdDb[j] < leftMin) leftMin = psdDb[j];
    }
    let rightMin = Infinity;
    for (let j = i + 1; j <= Math.min(n - 1, i + K); j++) {
      if (psdDb[j] < rightMin) rightMin = psdDb[j];
    }
    const prominence = psdDb[i] - Math.max(leftMin, rightMin);
    if (!(prominence >= prominenceDb)) continue;

    const { mode, bandResolved } = classifyPeak(frequencies[i], axis, bands);
    found.push({
      freqHz: frequencies[i],
      powerDb: psdDb[i],
      prominenceDb: prominence,
      mode,
      bandResolved,
    });
  }

  // A named mode band is ONE physical rigid-body mode — keep only its
  // strongest peak (a broad, slightly noisy mode still yields several
  // local maxima even after smoothing). 'unclassified' peaks carry no
  // such constraint: keep a few, separated by MIN_PEAK_SEP_HZ.
  found.sort((a, b) => b.prominenceDb - a.prominenceDb);
  const kept: LowFreqPeak[] = [];
  const usedModes = new Set<AirframeModeName>();
  let unclassified = 0;
  for (const p of found) {
    if (kept.length >= MAX_PEAKS) break;
    if (p.mode === 'unclassified') {
      if (unclassified >= MAX_UNCLASSIFIED_PEAKS) continue;
      if (kept.some((q) => Math.abs(q.freqHz - p.freqHz) < MIN_PEAK_SEP_HZ)) continue;
      unclassified++;
    } else {
      if (usedModes.has(p.mode)) continue;
      usedModes.add(p.mode);
    }
    kept.push(p);
  }
  return kept;
}

/** Detect low-frequency airframe modes in one axis's gyro signal.
 *
 *  `gyro` is a main-frame gyro channel; `axis` names which one (drives
 *  peak classification — short-period is a pitch mode, dutch roll a
 *  roll/yaw mode). A log too short to FFT even the decimated signal
 *  returns `tooShort: true` with empty peaks + PSD. */
export function detectLowFreqModes(
  gyro: Float32Array,
  sampleRateHz: number,
  axis: ControlAxis,
  options: LowFreqModeOptions = {},
): LowFreqModeResult {
  const targetRate = options.targetRateHz ?? 20;
  const maxBandHz = options.maxBandHz ?? 3;
  const prominenceDb = options.prominenceDb ?? 6;
  const minCycles = options.minCycles ?? 2;

  const factor =
    sampleRateHz > 0 ? Math.max(1, Math.round(sampleRateHz / targetRate)) : 1;
  const decimatedRate = sampleRateHz > 0 ? sampleRateHz / factor : 0;

  const tooShortResult = (): LowFreqModeResult => ({
    frequencies: new Float32Array(0),
    psdDb: new Float32Array(0),
    peaks: [],
    bands: buildBands(0, minCycles),
    binHz: 0,
    windowSec: 0,
    decimatedRateHz: decimatedRate,
    tooShort: true,
  });

  if (!(sampleRateHz > 0) || gyro.length < MIN_DECIMATED * factor) {
    return tooShortResult();
  }

  const decimated = decimate(gyro, factor);
  if (decimated.length < MIN_DECIMATED) return tooShortResult();

  // Hann-window the whole decimated signal, zero-pad to a power of 2.
  // The resolution is set by the real data length, not the padded FFT
  // size — windowSec reports the honest figure.
  const usedLen = Math.min(decimated.length, MAX_FFT_LEN);
  const fftLen = Math.min(MAX_FFT_LEN, ceilPow2(usedLen));
  const window = hannWindow(usedLen);
  let windowEnergy = 0;
  for (let i = 0; i < usedLen; i++) windowEnergy += window[i] * window[i];

  const re = new Float32Array(fftLen);
  const im = new Float32Array(fftLen);
  for (let i = 0; i < usedLen; i++) re[i] = decimated[i] * window[i];
  fftInPlace(re, im);

  // One-sided PSD, signal^2 / Hz — same normalisation as welchPsd.
  const nyquistBin = fftLen >> 1;
  const fullPsd = new Float32Array(nyquistBin + 1);
  const norm = 1 / (decimatedRate * windowEnergy);
  fullPsd[0] = (re[0] * re[0] + im[0] * im[0]) * norm;
  fullPsd[nyquistBin] =
    (re[nyquistBin] * re[nyquistBin] + im[nyquistBin] * im[nyquistBin]) * norm;
  for (let i = 1; i < nyquistBin; i++) {
    fullPsd[i] = 2 * (re[i] * re[i] + im[i] * im[i]) * norm;
  }

  const fullBinHz = decimatedRate / fftLen;

  // Slice to the analysed band: drop DC-adjacent drift, cap at maxBandHz.
  let lo = 0;
  while (lo < fullPsd.length && lo * fullBinHz < FLOOR_HZ) lo++;
  let hi = fullPsd.length;
  while (hi > lo && (hi - 1) * fullBinHz > maxBandHz) hi--;
  if (hi - lo < 2) return tooShortResult();

  const frequencies = new Float32Array(hi - lo);
  const psdLinear = new Float32Array(hi - lo);
  for (let i = lo; i < hi; i++) {
    frequencies[i - lo] = i * fullBinHz;
    psdLinear[i - lo] = fullPsd[i];
  }
  // Frequency-proportional smoothing before peak-picking — a wing has
  // ONE rigid-body mode per band, but the raw PSD's noise spikes would
  // otherwise each read as a separate "mode". This smoothed curve is
  // also what the panel displays, so markers sit on visible features.
  const psdDb = smoothProportional(
    psdToDb(psdLinear),
    frequencies,
    fullBinHz,
    SMOOTH_FRACTION,
  );

  const windowSec = usedLen / decimatedRate;
  const bands = buildBands(windowSec, minCycles);
  const peaks = findPeaks(frequencies, psdDb, prominenceDb, axis, bands);

  return {
    frequencies,
    psdDb,
    peaks,
    bands,
    binHz: fullBinHz,
    windowSec,
    decimatedRateHz: decimatedRate,
    tooShort: false,
  };
}
