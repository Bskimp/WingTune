// Layer 2 — airspeed-binned closed-loop step response.
//
// stepResponse.ts deconvolves ONE closed-loop step response from the
// whole flight. On a wing that hides the thing that matters most: the
// SAME PID gains produce a DIFFERENT closed-loop response at 15 m/s
// than at 30 m/s, because aerodynamic control authority scales with
// airspeed (TPA is the firmware's attempt to compensate). A single
// whole-flight step response averages those regimes together — the
// exact place quad-derived "one step response per tune" thinking
// breaks for fixed wing.
//
// This module bins the flight by airspeed and deconvolves a separate
// step response within each bin, so the per-bin curves overlay:
// sluggish-at-low-speed vs ringy-at-high-speed becomes visible
// directly. It is the DIAGNOSIS; the M5 hyperbolic TPA curve fitter
// is the response to it.
//
// Each bin's region set is the contiguous runs where airspeed stays
// inside the bin — so every averaged segment was flown entirely at
// that airspeed. The stepResponse `regions` param guarantees segments
// never straddle a bin boundary, so no join discontinuity is
// introduced. `numSegments` on each bin's result is the honest
// coverage signal: 0 means no real step was flown at that airspeed.
//
// Airspeed source is the caller's choice (the M3 BASIC whole-log
// estimate or GPS groundspeed) — this module just takes the array.
//
// Diagnostic only — no recommender, no CLI.

import { computeStepResponse, type StepResponseResult } from '@/lib/stepResponse';

const DEFAULT_BIN_COUNT = 3;
const DEFAULT_SEGMENT_LEN = 2048;
const DEFAULT_WINDOW_SEC = 0.5;
const DEFAULT_PCT_CLIP = 5;
/** Minimum percentile-clipped airspeed spread to bother binning. */
const MIN_SPEED_SPREAD = 2;

export interface AirspeedStepBin {
  /** Bin airspeed bounds (same units as the airspeed input). */
  loSpeed: number;
  hiSpeed: number;
  /** Bin centre — the natural trace label. */
  midSpeed: number;
  /** Contiguous in-bin runs long enough to host a Welch segment. */
  regionCount: number;
  /** Step response deconvolved from this bin's regions. Its
   *  `numSegments` is the coverage signal — 0 means no real step was
   *  flown at this airspeed. */
  response: StepResponseResult;
}

export interface AirspeedStepResponseResult {
  bins: AirspeedStepBin[];
  /** Shared impulse-relative time axis (s) — every bin uses the same
   *  windowSec / sample rate. Empty when there is no usable airspeed. */
  time: Float32Array;
  /** False when the airspeed series has too few finite samples or too
   *  little spread to bin meaningfully. */
  hasAirspeed: boolean;
}

export interface AirspeedStepOptions {
  /** Number of airspeed bins. Default 3 (low / mid / high). */
  binCount?: number;
  /** Welch segment length passed through to computeStepResponse. */
  segmentLen?: number;
  /** Step-response window length (s). */
  windowSec?: number;
  /** Percentile clip for the bin range — bins span [pClip, 100−pClip]
   *  of the finite airspeed values so outliers don't stretch it.
   *  Default 5. */
  speedPercentileClip?: number;
}

/** Value at percentile `p` of an ascending-sorted array. */
function percentile(sortedAsc: number[], p: number): number {
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1))),
  );
  return sortedAsc[idx];
}

/** Contiguous [start, end) runs where airspeed stays in [lo, hi), each
 *  at least `minLen` samples (long enough for one Welch segment). */
function inBinRegions(
  airspeed: Float32Array,
  n: number,
  lo: number,
  hi: number,
  minLen: number,
): [number, number][] {
  const regions: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const inBin =
      i < n && Number.isFinite(airspeed[i]) && airspeed[i] >= lo && airspeed[i] < hi;
    if (inBin) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart >= minLen) regions.push([runStart, i]);
      runStart = -1;
    }
  }
  return regions;
}

/** Deconvolve a per-airspeed-bin step response. See the module header
 *  for the method + rationale. */
export function computeAirspeedStepResponse(
  setpoint: Float32Array,
  gyro: Float32Array,
  airspeed: Float32Array,
  sampleRateHz: number,
  options: AirspeedStepOptions = {},
): AirspeedStepResponseResult {
  const binCount = Math.max(1, Math.floor(options.binCount ?? DEFAULT_BIN_COUNT));
  const segmentLen = options.segmentLen ?? DEFAULT_SEGMENT_LEN;
  const windowSec = options.windowSec ?? DEFAULT_WINDOW_SEC;
  const pctClip = options.speedPercentileClip ?? DEFAULT_PCT_CLIP;

  const n = Math.min(setpoint.length, gyro.length, airspeed.length);

  const noAirspeed = (): AirspeedStepResponseResult => ({
    bins: [],
    time: new Float32Array(0),
    hasAirspeed: false,
  });

  if (n < segmentLen || sampleRateHz <= 0) return noAirspeed();

  // Finite airspeed values → percentile-clipped bin range.
  const finite: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(airspeed[i])) finite.push(airspeed[i]);
  }
  if (finite.length < segmentLen) return noAirspeed();
  finite.sort((a, b) => a - b);
  const loSpeed = percentile(finite, pctClip);
  const hiSpeed = percentile(finite, 100 - pctClip);
  if (!(hiSpeed - loSpeed >= MIN_SPEED_SPREAD)) return noAirspeed();

  // Equal-width bin edges; nudge the top edge so the max value lands
  // inside the last bin (inBinRegions uses a half-open [lo, hi)).
  const edges = new Float64Array(binCount + 1);
  for (let b = 0; b <= binCount; b++) {
    edges[b] = loSpeed + ((hiSpeed - loSpeed) * b) / binCount;
  }
  edges[binCount] += Math.abs(edges[binCount]) * 1e-6 + 1e-6;

  const bins: AirspeedStepBin[] = [];
  for (let b = 0; b < binCount; b++) {
    const lo = edges[b];
    const hi = edges[b + 1];
    const regions = inBinRegions(airspeed, n, lo, hi, segmentLen);
    // A bin with no qualifying run still gets a call — a zero-length
    // region yields a valid empty result (numSegments 0) with the
    // shared time axis populated, so every bin is uniform downstream.
    const response = computeStepResponse(setpoint, gyro, sampleRateHz, {
      segmentLen,
      windowSec,
      regions: regions.length > 0 ? regions : [[0, 0]],
    });
    bins.push({
      loSpeed: lo,
      hiSpeed: hi,
      midSpeed: (lo + hi) / 2,
      regionCount: regions.length,
      response,
    });
  }

  return { bins, time: bins[0].response.time, hasAirspeed: true };
}
