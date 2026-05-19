// Layer 2 — per-axis servo asymmetric linkage detection.
//
// On wings with paired control surfaces (dual ailerons, paired elevons,
// twin tail-V servos) the firmware mixer typically sends sign-adjusted
// PWM to both servos so they actuate together. If the mechanical
// linkage is healthy + the servos are matched, both arrive at their
// commanded deflection at the same instant with the same magnitude.
//
// Real-world drift surfaces as:
//   · Servo A leads servo B by N milliseconds — loose linkage, worn
//     horn, different gain, mechanical bind on B's side.
//   · Servo A's amplitude is X times servo B's — sub-trim mismatch,
//     different deflection range set in the radio, mechanical
//     end-point asymmetry.
//
// Either drift hurts authority + introduces unintended roll/pitch
// coupling that the controller has to fight. The existing M-Servo
// `InputChainPanel` aggregates BOTH servos into a per-axis signed sum
// (sign-aware so opposite-sign servos add together) — by design that
// hides per-servo asymmetry. This module is the drill-down: for each
// axis with ≥ 2 contributing servos, cross-correlate each non-reference
// servo against the reference (highest |dominantSigned|) and report
// peak lag + amplitude ratio per pairing.
//
// Output is diagnostic-only — there's no CLI fix for mechanical drift
// (it's a check-your-linkage workflow). The recommender emits yellow-
// confidence "asymmetry detected" recs when thresholds are exceeded.

import type { AxisCorrelations } from '@/lib/servoClassifier';

type Axis = 0 | 1 | 2;

const AXIS_LABELS = ['Roll', 'Pitch', 'Yaw'] as const;

/** Minimum |dominantSigned| for a servo to count as contributing to an
 *  axis. Mirrors the threshold used in M-Servo input-chain aggregation
 *  so we analyze the same set of servos the chain panel does. */
const DOMINANT_THRESHOLD = 0.25;

/** Search window for the peak-lag cross-correlation, in milliseconds.
 *  ±30 ms is plenty for "is one servo leading the other?" — anything
 *  beyond that range almost certainly means the signals aren't actually
 *  paired (e.g. one servo dominates a different axis on this maneuver). */
const DEFAULT_LAG_WINDOW_MS = 30;

/** Minimum peak normalized correlation for the lag + ratio to be
 *  reported. Below this the signals are too dissimilar for the pairing
 *  to be meaningful — usually means one servo's mixer contribution
 *  drops out under certain stick positions, e.g. yaw differential on a
 *  V-tail. */
const MIN_PEAK_CORR = 0.5;

/** Asymmetry thresholds. Lag in absolute milliseconds, ratio in
 *  multiplicative deviation from 1.0. Both must clear for 'ok'. */
const LAG_OK_MS = 10;
const RATIO_OK_MIN = 0.7;
const RATIO_OK_MAX = 1.3;

export interface AsymmetryPair {
  /** Field name (e.g. 'motor[4]') being compared against the reference. */
  fieldName: string;
  /** Estimated peak lag in milliseconds. Positive = this servo lags
   *  the reference (responds later). Negative = leads. */
  peakLagMs: number;
  /** Ratio of this servo's standard deviation to the reference's,
   *  after sign-alignment. 1.0 = matched amplitude; > 1 = this servo
   *  swings wider; < 1 = swings less. */
  amplitudeRatio: number;
  /** Peak normalized correlation at the chosen lag. < MIN_PEAK_CORR is
   *  marked 'inconclusive' (signals don't actually pair on this log). */
  peakCorr: number;
  /** Severity classification — 'ok' = matched within thresholds,
   *  'warn' = exceeds at least one threshold, 'inconclusive' = peak
   *  correlation below MIN_PEAK_CORR. */
  severity: 'ok' | 'warn' | 'inconclusive';
}

export interface AxisAsymmetry {
  axis: Axis;
  axisLabel: typeof AXIS_LABELS[number];
  /** Reference servo (highest |dominantSigned| on this axis) — all
   *  others are compared against this one. */
  referenceFieldName: string;
  /** Comparisons for each non-reference contributing servo. Empty
   *  when only one servo is dominant on this axis (single-surface,
   *  no pairing to analyze). */
  pairs: AsymmetryPair[];
}

export interface AnalyzeServoAsymmetryArgs {
  motors: ReadonlyMap<string, Float32Array>;
  axisCorrelations: readonly AxisCorrelations[];
  sampleRateHz: number;
  lagWindowMs?: number;
}

/** For each axis with ≥ 2 contributing servos, compute pairwise lag +
 *  amplitude ratio against the highest-|dominantSigned| reference.
 *  Returns one entry per analyzable axis; axes with only one (or zero)
 *  contributors are omitted (nothing to compare). */
export function analyzeServoAsymmetry(
  args: AnalyzeServoAsymmetryArgs,
): AxisAsymmetry[] {
  const { motors, axisCorrelations, sampleRateHz } = args;
  const lagWindowMs = args.lagWindowMs ?? DEFAULT_LAG_WINDOW_MS;
  const out: AxisAsymmetry[] = [];

  for (let a = 0 as Axis; a <= 2; a = (a + 1) as Axis) {
    const contributors = axisCorrelations
      .filter((c) => c.dominantAxis === a && Math.abs(c.dominantSigned) >= DOMINANT_THRESHOLD)
      .sort((x, y) => Math.abs(y.dominantSigned) - Math.abs(x.dominantSigned));
    if (contributors.length < 2) continue;

    const ref = contributors[0];
    const refArr = motors.get(ref.fieldName);
    if (!refArr || refArr.length === 0) continue;
    const refSign = ref.dominantSigned >= 0 ? 1 : -1;
    const refCentered = signCenter(refArr, refSign);
    const refStd = stdDev(refCentered);
    if (refStd === 0) continue;

    const pairs: AsymmetryPair[] = [];
    for (let i = 1; i < contributors.length; i++) {
      const other = contributors[i];
      const otherArr = motors.get(other.fieldName);
      if (!otherArr || otherArr.length === 0) continue;
      const otherSign = other.dominantSigned >= 0 ? 1 : -1;
      const otherCentered = signCenter(otherArr, otherSign);
      const otherStd = stdDev(otherCentered);
      if (otherStd === 0) continue;

      const lagWindowSamples = Math.max(1, Math.round((lagWindowMs / 1000) * sampleRateHz));
      const { peakLagSamples, peakCorr } = correlateForLag(
        refCentered, otherCentered, refStd, otherStd, lagWindowSamples,
      );
      const peakLagMs = (peakLagSamples / sampleRateHz) * 1000;
      const amplitudeRatio = otherStd / refStd;

      pairs.push({
        fieldName: other.fieldName,
        peakLagMs,
        amplitudeRatio,
        peakCorr,
        severity: classifySeverity(peakLagMs, amplitudeRatio, peakCorr),
      });
    }

    out.push({
      axis: a,
      axisLabel: AXIS_LABELS[a],
      referenceFieldName: ref.fieldName,
      pairs,
    });
  }

  return out;
}

/** Subtract a constant 1500 (PWM neutral) AND apply the +1/-1 sign
 *  from the axis-correlation classifier so opposite-sign-paired servos
 *  produce signal that aligns when they're correctly tracking each
 *  other. Returns a NEW Float32Array; source is not mutated. */
function signCenter(arr: Float32Array, sign: 1 | -1): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - 1500) * sign;
  return out;
}

function stdDev(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let mean = 0;
  for (let i = 0; i < arr.length; i++) mean += arr[i];
  mean /= arr.length;
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / arr.length);
}

interface LagResult {
  peakLagSamples: number;
  peakCorr: number;
}

/** Search lag τ ∈ [-window, +window] for the τ that maximizes
 *  normalized correlation. Positive τ → b lags a (b's events later
 *  in b's own index space). */
function correlateForLag(
  a: Float32Array,
  b: Float32Array,
  aStd: number,
  bStd: number,
  lagWindowSamples: number,
): LagResult {
  const n = Math.min(a.length, b.length);
  if (n === 0 || aStd === 0 || bStd === 0) return { peakLagSamples: 0, peakCorr: 0 };
  const denom = n * aStd * bStd;
  let peakCorr = -Infinity;
  let peakLag = 0;
  for (let lag = -lagWindowSamples; lag <= lagWindowSamples; lag++) {
    const iMin = Math.max(0, -lag);
    const iMax = Math.min(n, n - lag);
    let sum = 0;
    for (let i = iMin; i < iMax; i++) sum += a[i] * b[i + lag];
    const corr = sum / denom;
    if (corr > peakCorr) {
      peakCorr = corr;
      peakLag = lag;
    }
  }
  return { peakLagSamples: peakLag, peakCorr };
}

function classifySeverity(
  peakLagMs: number,
  amplitudeRatio: number,
  peakCorr: number,
): AsymmetryPair['severity'] {
  if (peakCorr < MIN_PEAK_CORR) return 'inconclusive';
  const lagOk   = Math.abs(peakLagMs) <= LAG_OK_MS;
  const ratioOk = amplitudeRatio >= RATIO_OK_MIN && amplitudeRatio <= RATIO_OK_MAX;
  return lagOk && ratioOk ? 'ok' : 'warn';
}
