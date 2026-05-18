// Cross-correlation auto-align for M1.7.1 multi-log compare.
//
// Given two logs (a "reference" and an "other"), find the time offset
// that maximizes the normalized cross-correlation of their gyro
// magnitude signals. Set `other.timeOffsetSec` to that value to align
// the two logs on the session axis so corresponding flight events
// land at the same session time.
//
// Why gyro magnitude (and not throttle / arm-event / mode-change):
//   · arm and first-throttle-up don't anchor flight start when the
//     wing uses auto-launch (the arm happens well before the actual
//     launch, by an inconsistent amount).
//   · mode changes are flight-style-dependent.
//   · GPS time-of-day requires GPS lock in both logs.
//   · gyro magnitude (sqrt(gx² + gy² + gz²)) directly reflects the
//     actual airframe motion — the moment any meaningful rotation
//     happens, it appears in the signal. Same flight pattern → same
//     gyro signature, regardless of pre-flight choreography.
//
// Algorithm:
//   1. Compute RMS gyro magnitude per log (Float32Array indexed by
//      `log.time`).
//   2. Downsample both signals to 50 Hz via boxcar averaging — wing
//      dynamics are sub-50 Hz so higher sample rates don't help
//      correlation quality, and downsampling makes the correlation
//      O(N) cheap.
//   3. Compute normalized cross-correlation across the bounded lag
//      window [-maxLagSec, +maxLagSec] (default ±60 s). The lag at
//      which NCC peaks is the relative offset between the two
//      signals.
//   4. Convert the best-lag in samples back to seconds, return as
//      the offset to apply to the other log (preserves the
//      reference's existing offset — see `alignLogToReference` below
//      for the sign convention).
//
// This is the math layer only — orchestration (iterate visible logs,
// call `session.setTimeOffset` per result) lives in LogRoster.

import { type LogState } from '@/stores/session';

const GYRO_FIELDS = ['gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]'] as const;
const TARGET_RATE_HZ = 50;
const DEFAULT_MAX_LAG_SEC = 60;

export interface AlignResult {
  /** Offset (seconds) to apply to `otherLog` so its events land at the
   *  same session time as `refLog`'s corresponding events, assuming
   *  the reference's offset is 0. If the reference already has an
   *  offset, callers must add it: `finalOffset = refOffset + offsetSec`. */
  offsetSec: number;
  /** Normalized cross-correlation at the best lag, in [-1, 1].
   *  Higher = stronger match. > 0.7 reads as high confidence,
   *  0.4-0.7 moderate, < 0.4 low (likely no shared content). */
  ncc: number;
  /** Ratio of best peak's NCC to the second-best peak (excluding a
   *  small neighborhood around the best). > 1.5 reads as unambiguous;
   *  ~1.0 means multiple equally-good alignments (signal is periodic
   *  or the logs have little distinctive shared content). */
  peakRatio: number;
  /** Which signal class was used, or 'none' if alignment failed
   *  (missing fields, empty signal). */
  signal: 'gyro' | 'none';
}

/** RMS gyro magnitude as Float32Array indexed by `log.time`. Returns
 *  null if no gyro fields are hydrated on this log. */
export function computeGyroMagnitude(log: LogState): Float32Array | null {
  const arrays: Float32Array[] = [];
  for (const field of GYRO_FIELDS) {
    const arr = log.fields.get(field);
    if (arr && arr.length > 0) arrays.push(arr);
  }
  if (arrays.length === 0) return null;
  // Use the shortest available length so we don't index past any
  // partial array. In practice gyro x/y/z are always the same length.
  let len = arrays[0].length;
  for (const a of arrays) if (a.length < len) len = a.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sumSq = 0;
    for (const a of arrays) {
      const v = a[i];
      sumSq += v * v;
    }
    out[i] = Math.sqrt(sumSq);
  }
  return out;
}

/** Boxcar-average downsample. Assumes input is uniformly sampled at
 *  `srcDt` seconds between samples. Returns a new Float32Array at
 *  `targetRateHz`. If source rate is already at or below target,
 *  returns the input unchanged. */
export function downsampleToRate(
  signal: Float32Array,
  srcDt: number,
  targetRateHz: number,
): Float32Array {
  if (signal.length === 0 || !isFinite(srcDt) || srcDt <= 0) return signal;
  const srcRateHz = 1 / srcDt;
  const ratio = srcRateHz / targetRateHz;
  if (ratio <= 1) return signal;
  const outLen = Math.floor(signal.length / ratio);
  if (outLen === 0) return signal;
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcStart = Math.floor(i * ratio);
    const srcEnd   = Math.min(Math.floor((i + 1) * ratio), signal.length);
    let sum = 0;
    let count = 0;
    for (let j = srcStart; j < srcEnd; j++) {
      sum += signal[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

/** Normalized cross-correlation across the lag window
 *  `[-maxLagSamples, +maxLagSamples]`. Returns an array of length
 *  `2*maxLagSamples + 1`; index `k` holds NCC at lag `k - maxLagSamples`.
 *
 *  Convention: NCC(a, b, lag) = Σ a[i] * b[i + lag] (mean-centered,
 *  normalized by full-sequence energies). The lag at which NCC peaks
 *  satisfies: b's events occur `lag` samples LATER (in its own
 *  index space) than a's corresponding events. Positive lag → b is
 *  delayed relative to a → to align, shift b LEFT (negative offset). */
export function normalizedCrossCorrelate(
  a: Float32Array,
  b: Float32Array,
  maxLagSamples: number,
): Float32Array {
  const meanA = mean(a);
  const meanB = mean(b);
  const da = subtractMean(a, meanA);
  const db = subtractMean(b, meanB);
  const normA = vecNorm(da);
  const normB = vecNorm(db);
  const outLen = 2 * maxLagSamples + 1;
  const out = new Float32Array(outLen);
  if (normA === 0 || normB === 0) return out;
  const denom = normA * normB;
  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag++) {
    let sum = 0;
    const iMin = Math.max(0, -lag);
    const iMax = Math.min(da.length, db.length - lag);
    for (let i = iMin; i < iMax; i++) sum += da[i] * db[i + lag];
    out[lag + maxLagSamples] = sum / denom;
  }
  return out;
}

function mean(a: Float32Array): number {
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum / a.length;
}

function subtractMean(a: Float32Array, m: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - m;
  return out;
}

function vecNorm(a: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum);
}

function estimateDt(log: LogState): number | null {
  if (log.time.length < 2) return null;
  const dt = (log.time[log.time.length - 1] - log.time[0]) / (log.time.length - 1);
  return isFinite(dt) && dt > 0 ? dt : null;
}

export interface AlignOptions {
  maxLagSec?: number;
  targetRateHz?: number;
}

/** Cross-correlate ref against other; return the offset to apply to
 *  `otherLog` (in the convention that final_offset = refOffset +
 *  result.offsetSec). Caller is responsible for adding the reference's
 *  current offset and calling `session.setTimeOffset`. */
export function alignLogToReference(
  refLog: LogState,
  otherLog: LogState,
  opts: AlignOptions = {},
): AlignResult {
  const maxLagSec    = opts.maxLagSec    ?? DEFAULT_MAX_LAG_SEC;
  const targetRateHz = opts.targetRateHz ?? TARGET_RATE_HZ;

  const refSig   = computeGyroMagnitude(refLog);
  const otherSig = computeGyroMagnitude(otherLog);
  if (!refSig || !otherSig) {
    return { offsetSec: 0, ncc: 0, peakRatio: 0, signal: 'none' };
  }
  const refDt   = estimateDt(refLog);
  const otherDt = estimateDt(otherLog);
  if (refDt === null || otherDt === null) {
    return { offsetSec: 0, ncc: 0, peakRatio: 0, signal: 'none' };
  }

  const dsRef   = downsampleToRate(refSig,   refDt,   targetRateHz);
  const dsOther = downsampleToRate(otherSig, otherDt, targetRateHz);

  const maxLagSamples = Math.round(maxLagSec * targetRateHz);
  const nccArr = normalizedCrossCorrelate(dsRef, dsOther, maxLagSamples);

  let bestIdx = 0;
  let bestNcc = -Infinity;
  for (let i = 0; i < nccArr.length; i++) {
    if (nccArr[i] > bestNcc) {
      bestNcc = nccArr[i];
      bestIdx = i;
    }
  }
  const bestLagSamples = bestIdx - maxLagSamples;

  // Convention: bestLag positive → other's events are `bestLag` samples
  // LATER than ref's events (in other's own index space). To align other
  // with ref, shift other LEFT on the session axis by that amount, i.e.
  // apply a NEGATIVE offset.
  const offsetSec = -bestLagSamples / targetRateHz;

  // Second-best peak (skipping a ±1s neighborhood around the best) —
  // gives a confidence metric. A clean single-peak alignment has
  // peakRatio >> 1; ambiguous (periodic or low-content) signals have
  // peakRatio ~1.
  const neighborhood = Math.max(1, Math.round(targetRateHz)); // ~1 s
  let secondBestNcc = -Infinity;
  for (let i = 0; i < nccArr.length; i++) {
    if (Math.abs(i - bestIdx) <= neighborhood) continue;
    if (nccArr[i] > secondBestNcc) secondBestNcc = nccArr[i];
  }
  const peakRatio = bestNcc > 0 && secondBestNcc > 0
    ? bestNcc / secondBestNcc
    : (bestNcc > 0 ? Infinity : 0);

  return { offsetSec, ncc: bestNcc, peakRatio, signal: 'gyro' };
}
