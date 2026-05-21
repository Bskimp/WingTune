// Layer 2 — airspeed-resolved spectrogram.
//
// M4's whole-log Welch PSD averages every windowed periodogram into one
// spectrum — it assumes the gyro spectrum is stationary across the flight.
// On a wing it is not: the plant scales with airspeed, and control-surface
// buzz / flutter precursors onset AT A SPEED. This bins STFT columns by
// the airspeed at each column's centre time instead of averaging them all
// together, producing an airspeed x frequency picture.
//
// Spectrum-tab roadmap S2 (docs/wingtune-spectrum-roadmap.md +
// docs/wingtune-s2-execution.md). Built on lib/stft.ts (shipped with S1).
//
// Source-agnostic: takes a pre-built per-sample airspeed series aligned to
// the gyro's main-frame axis. The model-vs-GPS choice is the panel's — the
// binning here never sees a fit.

import { computeStft } from '@/lib/stft';

export interface AirspeedSpectrogramOptions {
  /** STFT window size — power of 2. Default 256. */
  windowSize?: number;
  /** STFT hop size, samples. Default windowSize >> 1. */
  hopSize?: number;
  /** Number of linear airspeed bins across [speedMin, speedMax].
   *  Default 20 (the S2 working default — TODO calibrate). */
  airspeedBinCount?: number;
  /** A bin with fewer contributing STFT columns than this is flagged
   *  under-sampled (greyed in the UI — the coverage honesty signal,
   *  same pattern as M-Coupling's greyed rows). Default 3. */
  minColumnsPerBin?: number;
  /** Airspeed range, m/s. Default: finite min/max of `airspeed`. */
  speedMin?: number;
  speedMax?: number;
}

export interface AirspeedSpectrogram {
  /** One row per airspeed bin, each a one-sided mean PSD over the STFT
   *  columns that fell in that bin (linear units, signal^2/Hz — average
   *  in linear, the UI converts to dB). An airspeed bin that caught no
   *  column is a NaN-filled row, so the UI renders it blank, not zero. */
  grid: Float32Array[];
  /** `airspeedBinCount + 1` bin edges, m/s. */
  airspeedEdges: Float32Array;
  /** Bin centres, m/s — convenience for axis labelling. */
  airspeedCentres: Float32Array;
  /** Shared frequency axis, Hz — DC to Nyquist, from the STFT. */
  frequencies: Float32Array;
  /** STFT columns contributing to each airspeed bin. */
  columnsPerBin: Int32Array;
  /** `columnsPerBin[i] < minColumnsPerBin` — true for both too-few and
   *  empty bins. The UI greys these; a fully-empty bin is additionally
   *  a NaN `grid` row. */
  underSampled: boolean[];
  /** Frequency resolution — `sampleRateHz / windowSize` Hz per bin. */
  binHz: number;
  windowSize: number;
  hopSize: number;
  /** STFT columns that had a finite airspeed and were binned. A column
   *  whose centre-time airspeed is NaN (GPS dropout, pre-lock) is
   *  dropped — it cannot be placed on the airspeed axis. */
  columnsBinned: number;
}

/** Bin a gyro signal's short-time spectra by the airspeed at each
 *  column's centre time.
 *
 *  `gyro` and `airspeed` must share the log's main-frame sample axis
 *  (same indexing — `airspeed[i]` is the airspeed when `gyro[i]` was
 *  logged). `airspeed` may carry NaN gaps (GPS dropout, pre-lock); STFT
 *  columns centred on a NaN are dropped from the grid rather than
 *  forced into a bin.
 *
 *  A signal shorter than one STFT window, or an airspeed series with no
 *  finite samples, returns an all-NaN grid with the frequency + airspeed
 *  axes still populated, so a consumer can render an honest empty state
 *  against the right axes. */
export function binStftByAirspeed(
  gyro: Float32Array,
  airspeed: Float32Array,
  sampleRateHz: number,
  options: AirspeedSpectrogramOptions = {},
): AirspeedSpectrogram {
  const windowSize = options.windowSize ?? 256;
  const hopSize = options.hopSize ?? windowSize >> 1;
  const binCount = Math.max(1, Math.floor(options.airspeedBinCount ?? 20));
  const minColumns = Math.max(1, Math.floor(options.minColumnsPerBin ?? 3));

  const stft = computeStft(gyro, sampleRateHz, windowSize, hopSize);
  const numFreq = stft.frequencies.length;

  // Airspeed range — explicit override, else the finite data extent.
  let speedMin = options.speedMin;
  let speedMax = options.speedMax;
  if (speedMin === undefined || speedMax === undefined) {
    let dMin = Infinity;
    let dMax = -Infinity;
    for (let i = 0; i < airspeed.length; i++) {
      const v = airspeed[i];
      if (!Number.isFinite(v)) continue;
      if (v < dMin) dMin = v;
      if (v > dMax) dMax = v;
    }
    if (speedMin === undefined) speedMin = Number.isFinite(dMin) ? dMin : 0;
    if (speedMax === undefined) speedMax = Number.isFinite(dMax) ? dMax : 0;
  }
  // A constant (or absent) airspeed gives a zero-width range — nudge so
  // every column lands in bin 0 and the edges stay strictly increasing.
  if (!(speedMax > speedMin)) speedMax = speedMin + 1;
  const range = speedMax - speedMin;

  const airspeedEdges = new Float32Array(binCount + 1);
  const airspeedCentres = new Float32Array(binCount);
  for (let b = 0; b <= binCount; b++) {
    airspeedEdges[b] = speedMin + (range * b) / binCount;
  }
  for (let b = 0; b < binCount; b++) {
    airspeedCentres[b] = (airspeedEdges[b] + airspeedEdges[b + 1]) / 2;
  }

  const columnsPerBin = new Int32Array(binCount);
  // Linear-PSD accumulator per bin; divided by the column count at the
  // end. Allocated lazily — a bin that catches no column stays a NaN row.
  const accum: (Float64Array | null)[] = new Array(binCount).fill(null);

  let columnsBinned = 0;
  const halfWindow = (windowSize - 1) / 2;
  for (let c = 0; c < stft.columns.length; c++) {
    // Column c starts at sample c*hopSize; its centre sample indexes the
    // main-frame-aligned airspeed series.
    let centreIdx = Math.round(c * hopSize + halfWindow);
    if (centreIdx < 0) centreIdx = 0;
    else if (centreIdx >= airspeed.length) centreIdx = airspeed.length - 1;
    const v = airspeed.length > 0 ? airspeed[centreIdx] : NaN;
    if (!Number.isFinite(v)) continue;

    let bin = Math.floor(((v - speedMin) / range) * binCount);
    if (bin < 0) bin = 0;
    else if (bin >= binCount) bin = binCount - 1;

    let acc = accum[bin];
    if (acc === null) {
      acc = new Float64Array(numFreq);
      accum[bin] = acc;
    }
    const col = stft.columns[c];
    for (let f = 0; f < numFreq; f++) acc[f] += col[f];
    columnsPerBin[bin]++;
    columnsBinned++;
  }

  const grid: Float32Array[] = new Array(binCount);
  const underSampled: boolean[] = new Array(binCount);
  for (let b = 0; b < binCount; b++) {
    const count = columnsPerBin[b];
    underSampled[b] = count < minColumns;
    const row = new Float32Array(numFreq);
    const acc = accum[b];
    if (count > 0 && acc !== null) {
      for (let f = 0; f < numFreq; f++) row[f] = acc[f] / count;
    } else {
      row.fill(NaN);
    }
    grid[b] = row;
  }

  return {
    grid,
    airspeedEdges,
    airspeedCentres,
    frequencies: stft.frequencies,
    columnsPerBin,
    underSampled,
    binHz: stft.binHz,
    windowSize,
    hopSize,
    columnsBinned,
  };
}
