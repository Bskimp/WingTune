// Layer 2 — M5 HYPERBOLIC TPA curve fitter.
//
// BF wing's HYPERBOLIC TPA curve maps a normalised airspeed argument
// `x ∈ [0, 1]` (`tpa_arg`) onto a PID multiplier `tpa_factor`. The
// firmware computes this in src/main/flight/pid_init.c::
// tpaCurveHyperbolicFunction (BF PR #13805). The full firmware
// reference + parameter table + tuning heuristics live in
// docs/firmware-reference/tpa-hyperbolic-spec.md. This module:
//
//   · `evaluateHyperbolic(x, params)` — pure formula port. Given the
//     four CLI params (stallThrottle, pidThr0, pidThr100, expo),
//     returns the predicted tpa_factor at x.
//   · `fitHyperbolicCurve(samples, opts)` — Nelder-Mead nonlinear
//     regression on the four params against measured (x, y) pairs.
//   · `buildTpaFitInputs(args)` — pulls tpa_arg + tpa_factor from
//     hydrated fields, gates by minimum coverage, returns inputs for
//     the fit. Mirrors `buildAirspeedFitInputs` shape so the
//     recommender and panel share the same builder.
//
// Confidence note: endpoint params (`pidThr0`, `pidThr100`) are exact
// by construction in the firmware formula — `f(stallThrottle) = pidThr0`
// and `f(1) = pidThr100` regardless of expo. The fit has only 3 truly
// free parameters once the stall threshold is observed: the two
// endpoints and the curvature `expo`. We still optimise all 4 because
// the optimiser can shift stallThrottle slightly to absorb noise; but
// the fit will collapse cleanly when the data is clean.

import { fitNelderMead } from '@/lib/nelderMead';

/** CLI param tuple. Values match BF's CLI param ranges (not the raw
 *  internal multiplier scale — `pidThr0` here is the multiplier in
 *  natural units, NOT the ×100 integer the CLI accepts). */
export interface HyperbolicParams {
  /** thrStall in firmware. CLI value = stallThrottle × 100, 0..100. */
  stallThrottle: number;
  /** pidThr0 multiplier at x = stallThrottle. CLI value = ×100,
   *  0..1000 → multiplier 0..10. */
  pidThr0: number;
  /** pidThr100 multiplier at x = 1.0. CLI value = ×100, 0..1000. */
  pidThr100: number;
  /** Curvature in CLI units, -100..100. Internal `expo` is
   *  `-1 / (-tpa_curve_expo/100 + 0.999)` per BF source. */
  expoCli: number;
}

export interface HyperbolicFitSample {
  x: number;      // tpa_arg, [0, 1]
  y: number;      // tpa_factor, multiplier
}

export interface CoverageStats {
  /** Number of (x, y) samples that contributed. */
  samples: number;
  /** Min / max x observed. */
  xMin: number;
  xMax: number;
  /** Seconds of dwell in the low band (x just above stallThrottle). */
  lowBandDwellSec: number;
  /** Seconds of dwell in the mid band. */
  midBandDwellSec: number;
  /** Seconds of dwell in the high band (x near 1.0). */
  highBandDwellSec: number;
}

export interface HyperbolicFitResult {
  params: HyperbolicParams;
  /** RMS of (y_predicted - y_measured) across input samples. */
  rmsResidual: number;
  /** Residual vector for evidence-chip targeting (same order as input). */
  residuals: Float32Array;
  /** Optimiser converged before iter cap. */
  converged: boolean;
  iterations: number;
  coverage: CoverageStats;
}

/** Pure-formula evaluation. Mirrors the BF firmware function exactly. */
export function evaluateHyperbolic(x: number, p: HyperbolicParams): number {
  // Clamp to legal CLI ranges so an out-of-range optimiser step
  // doesn't NaN; the fit is bounded but Nelder-Mead can wander.
  const stallThrottle = clamp(p.stallThrottle, 0, 0.999);
  const pidThr0       = Math.max(1e-6, p.pidThr0);
  const pidThr100     = Math.max(1e-6, p.pidThr100);
  const expoCli       = clamp(p.expoCli, -100, 100);

  // Below stallThrottle: flat plateau.
  if (x <= stallThrottle) return pidThr0;

  // expo linearisation per pid_init.c.
  const expo = -1 / (-expoCli / 100 + 0.999);

  const xShifted = (x - stallThrottle) / (1 - stallThrottle);
  // base = 1 + (pow(pidThr0/pidThr100, 1/expo) - 1) * xShifted
  const ratio = pidThr0 / pidThr100;
  const ratioPow = safePow(ratio, 1 / expo);
  const base = 1 + (ratioPow - 1) * xShifted;
  const divisor = safePow(base, expo);
  return pidThr0 / Math.max(1e-9, divisor);
}

function safePow(base: number, exp: number): number {
  // Math.pow on negative base with non-integer exp is NaN. Clamp base
  // to a small positive value before the call so the optimiser never
  // sees NaN residuals.
  return Math.pow(Math.max(1e-9, base), exp);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface FitOptions {
  /** Initial guess. Default = a sensible mid-point per the discussion
   *  thread's mockup (`stall=0.2 / pid_thr0=3.0 / pid_thr100=0.5 / expo=5`). */
  initial?: Partial<HyperbolicParams>;
  /** Max iterations before stopping. Default 800. */
  maxIter?: number;
}

const DEFAULT_INITIAL: HyperbolicParams = {
  stallThrottle: 0.20,
  pidThr0: 3.0,
  pidThr100: 0.5,
  expoCli: 5,
};

export function fitHyperbolicCurve(
  samples: readonly HyperbolicFitSample[],
  coverage: CoverageStats,
  options: FitOptions = {},
): HyperbolicFitResult {
  const initial: HyperbolicParams = {
    ...DEFAULT_INITIAL,
    ...options.initial,
  };
  const maxIter = options.maxIter ?? 800;

  const cost = (vec: number[]): number => {
    const params: HyperbolicParams = {
      stallThrottle: vec[0],
      pidThr0:       vec[1],
      pidThr100:     vec[2],
      expoCli:       vec[3],
    };
    let sse = 0;
    for (const s of samples) {
      const predicted = evaluateHyperbolic(s.x, params);
      const err = predicted - s.y;
      sse += err * err;
    }
    return sse;
  };

  const seed = [
    initial.stallThrottle,
    initial.pidThr0,
    initial.pidThr100,
    initial.expoCli,
  ];
  const fit = fitNelderMead(seed, cost, { maxIter });

  const params: HyperbolicParams = {
    stallThrottle: fit.x[0],
    pidThr0:       fit.x[1],
    pidThr100:     fit.x[2],
    expoCli:       fit.x[3],
  };

  const residuals = new Float32Array(samples.length);
  let sse = 0;
  for (let i = 0; i < samples.length; i++) {
    const predicted = evaluateHyperbolic(samples[i].x, params);
    const err = predicted - samples[i].y;
    residuals[i] = err;
    sse += err * err;
  }
  const rmsResidual = Math.sqrt(sse / Math.max(1, samples.length));

  return {
    params,
    rmsResidual,
    residuals,
    converged: fit.converged,
    iterations: fit.iterations,
    coverage,
  };
}

// ---- input builder ------------------------------------------------------

export interface BuildTpaFitInputs {
  /** Main-frame time axis (Float32 seconds-since-log-start). */
  time: Float32Array;
  /** Hydrated fields map (logStore.fields). */
  fields: ReadonlyMap<string, Float32Array>;
  /** Field name resolved from signal registry's `tpa_arg`. */
  tpaArgField: string;
  /** Field name resolved from signal registry's `tpa_factor`. */
  tpaFactorField: string;
  /** Min |x| above which a sample counts as "active" (rejects the
   *  flat-plateau zone where the curve is constant and uninformative). */
  minActiveX?: number;
}

export interface BuiltTpaFitInputs {
  samples: HyperbolicFitSample[];
  coverage: CoverageStats;
}

/** Pull (tpa_arg, tpa_factor) sample pairs from the hydrated field
 *  cache, drop the flat-plateau samples (below `minActiveX`) since
 *  those don't constrain the curve shape, and compute coverage stats
 *  for confidence scoring. Returns null when required fields aren't
 *  hydrated or no active samples exist. */
export function buildTpaFitInputs(input: BuildTpaFitInputs): BuiltTpaFitInputs | null {
  const xArr = input.fields.get(input.tpaArgField);
  const yArr = input.fields.get(input.tpaFactorField);
  if (!xArr || !yArr) return null;

  const n = Math.min(xArr.length, yArr.length, input.time.length);
  if (n === 0) return null;

  const minActiveX = input.minActiveX ?? 0.05;
  const samples: HyperbolicFitSample[] = [];

  // Band thresholds — relative to the observed xMax so a low-airspeed
  // log still gets a meaningful low/mid/high split. Bands are
  // (lo, lo+third), (lo+third, lo+2·third), (lo+2·third, max).
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xArr[i];
    if (x < minActiveX) continue;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    samples.push({ x, y: yArr[i] });
  }

  if (samples.length === 0) {
    return {
      samples,
      coverage: {
        samples: 0, xMin: 0, xMax: 0,
        lowBandDwellSec: 0, midBandDwellSec: 0, highBandDwellSec: 0,
      },
    };
  }

  const third = (xMax - xMin) / 3;
  const lowEnd  = xMin + third;
  const highStart = xMin + 2 * third;

  // Dwell estimate: average inter-sample dt × samples-in-band. Robust
  // to non-uniform sampling.
  const dt = input.time.length > 1
    ? (input.time[input.time.length - 1] - input.time[0]) / (input.time.length - 1)
    : 0;

  let lowSamples = 0, midSamples = 0, highSamples = 0;
  for (const s of samples) {
    if (s.x <= lowEnd) lowSamples++;
    else if (s.x >= highStart) highSamples++;
    else midSamples++;
  }

  return {
    samples,
    coverage: {
      samples: samples.length,
      xMin,
      xMax,
      lowBandDwellSec:  lowSamples  * dt,
      midBandDwellSec:  midSamples  * dt,
      highBandDwellSec: highSamples * dt,
    },
  };
}

// ---- CLI emission helpers ----------------------------------------------

/** Convert internal HyperbolicParams (natural units) into the integer
 *  CLI values BF expects. CLI multipliers are ×100 (so 0.5 → 50). */
export interface HyperbolicCliValues {
  tpa_curve_type: 'HYPERBOLIC';
  tpa_curve_stall_throttle: number;  // 0..100
  tpa_curve_pid_thr0: number;        // 0..1000
  tpa_curve_pid_thr100: number;      // 0..1000
  tpa_curve_expo: number;            // -100..100
}

export function paramsToCli(p: HyperbolicParams): HyperbolicCliValues {
  return {
    tpa_curve_type: 'HYPERBOLIC',
    tpa_curve_stall_throttle: Math.round(clamp(p.stallThrottle * 100, 0, 100)),
    tpa_curve_pid_thr0:       Math.round(clamp(p.pidThr0 * 100, 0, 1000)),
    tpa_curve_pid_thr100:     Math.round(clamp(p.pidThr100 * 100, 0, 1000)),
    tpa_curve_expo:           Math.round(clamp(p.expoCli, -100, 100)),
  };
}
