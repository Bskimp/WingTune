// Layer 2 — M-FF feedforward effectiveness analysis.
//
// Feedforward (the F term of PIDFS) responds to stick VELOCITY — the
// time-derivative of the rate setpoint — not to gyro error. Its job is
// to push the servo the instant the stick moves, so the airframe
// starts responding before P-term error has time to accumulate.
//
// The standard tuning heuristic is "adjust FF until the P-term does
// nothing during the move" — feel-based in PIDtoolbox/PIDscope. This
// module measures it directly:
//
//   FF coverage = Σ|axisF| / (Σ|axisF| + Σ|axisP|)   over the span
//                 where the stick is actually moving inside a
//                 detected maneuver window.
//
//   · High coverage  → FF is carrying the transient (well-tuned).
//   · Low coverage   → P is doing FF's job — feedforward undergained.
//
//   Leading-edge overshoot = does the gyro punch PAST the setpoint
//   in the ~150 ms right after the stick-velocity peak? That's the
//   signature of overgained FF — it pushes too hard and PID has to
//   rein the airframe back.
//
// Analysis is scoped to the maneuver windows from `lib/maneuverDetect`
// — FF produces no signal during smooth flying, so whole-flight
// averaging would just dilute the metric with dead air.

import { setpointVelocity, type ManeuverWindow } from '@/lib/maneuverDetect';

type Axis = 0 | 1 | 2;

/** |setpoint velocity| (deg/s²) above which the stick counts as
 *  "moving" — the span FF coverage is computed over. Matches the
 *  maneuver detector's exit threshold so the two modules agree on
 *  what "the stick is moving" means. */
const MOVING_THRESHOLD = 600;

/** Post-velocity-peak window for leading-edge overshoot, in ms. FF's
 *  job is the transient; beyond ~150 ms it's PID holding the rate. */
const OVERSHOOT_WINDOW_MS = 150;

/** Leading-edge overshoot fraction above which a window is flagged.
 *  0.15 = gyro exceeded the commanded setpoint by 15% of the maneuver
 *  magnitude on the leading edge. */
const OVERSHOOT_FLAG = 0.15;

/** FF coverage below this = FF is undergained (P carrying the move). */
const COVERAGE_UNDERGAINED = 0.5;

/** FF noise ratio above this = the F-term is carrying heavy high-
 *  frequency jitter (RC-link noise amplified by the derivative). The
 *  fix is the FF smoothing params, NOT the FF gain — they're
 *  orthogonal, so noise is a separate flag, not a verdict value. */
const FF_NOISE_FLAG = 0.35;

/** Boxcar window (seconds) for the FF-noise high-pass split. Wide
 *  enough to preserve the maneuver-timescale envelope (hundreds of
 *  ms), short enough that RC jitter (single- to tens-of-ms) lands in
 *  the residual. */
const NOISE_SMOOTH_SEC = 0.02;

export interface FFWindowMetric {
  window: ManeuverWindow;
  /** Σ|F| / (Σ|F| + Σ|P|) over the moving span, [0, 1]. */
  ffCoverage: number;
  /** Peak (gyro − setpoint) in the input direction over the post-peak
   *  window, as a fraction of the maneuver's peak |setpoint|. Positive
   *  = gyro overshot the command. */
  leadingEdgeOvershoot: number;
  /** True when `leadingEdgeOvershoot` exceeds OVERSHOOT_FLAG. */
  hasOvershoot: boolean;
  /** High-frequency content of the F-term over the window:
   *  RMS(F − smooth(F)) / RMS(smooth(F)). ~0 = clean F tracking the
   *  maneuver envelope; high = jittery F (RC noise amplified). */
  ffNoiseRatio: number;
  /** True when `ffNoiseRatio` exceeds FF_NOISE_FLAG. */
  noisy: boolean;
}

export type FFVerdict = 'no-data' | 'undergained' | 'healthy' | 'overgained';

export interface FFAxisResult {
  axis: Axis;
  /** Per-maneuver-window metrics for windows relevant to this axis. */
  windows: FFWindowMetric[];
  /** Energy-weighted mean FF coverage across the relevant windows. */
  meanFFCoverage: number;
  /** Count of relevant windows flagged for leading-edge overshoot. */
  overshootCount: number;
  /** Count of relevant windows analyzed. */
  windowCount: number;
  verdict: FFVerdict;
  /** Mean FF noise ratio across the relevant windows. */
  meanFFNoise: number;
  /** True when `meanFFNoise` exceeds FF_NOISE_FLAG — the F-term is
   *  jittery. Orthogonal to `verdict` (gain health): a well-gained
   *  FF can still be noisy. Fix is feedforward_smoothing /
   *  feedforward_jitter_factor, not the FF gain. */
  noisy: boolean;
}

export interface AnalyzeFFAxisArgs {
  axis: Axis;
  setpoint: Float32Array;
  axisF: Float32Array;
  axisP: Float32Array;
  gyro: Float32Array;
  time: Float32Array;
  /** Maneuver windows from `detectManeuvers` — all of them; this
   *  function filters to the ones relevant to `axis`. */
  maneuvers: readonly ManeuverWindow[];
}

/** Compute FF effectiveness for one axis. Relevant maneuver windows
 *  are those where this axis was the dominant input OR the maneuver
 *  was 'mixed' (this axis likely contributed). Windows where the axis
 *  was idle are skipped — FF has nothing to do there. */
export function analyzeFFAxis(args: AnalyzeFFAxisArgs): FFAxisResult {
  const { axis, setpoint, axisF, axisP, gyro, time, maneuvers } = args;
  const n = Math.min(setpoint.length, axisF.length, axisP.length, gyro.length, time.length);

  const empty = (): FFAxisResult => ({
    axis, windows: [], meanFFCoverage: 0,
    overshootCount: 0, windowCount: 0, verdict: 'no-data',
    meanFFNoise: 0, noisy: false,
  });
  if (n < 3) return empty();

  const dt = (time[n - 1] - time[0]) / (n - 1);
  if (!(dt > 0)) return empty();

  const vel = setpointVelocity(setpoint, dt);
  const overshootSamples = Math.max(1, Math.round((OVERSHOOT_WINDOW_MS / 1000) / dt));
  const noiseSmoothSamples = Math.max(3, Math.round(NOISE_SMOOTH_SEC / dt));

  const relevant = maneuvers.filter(
    (m) => m.dominantAxis === axis || m.type === 'mixed',
  );

  const windows: FFWindowMetric[] = [];
  let coverageWeightedSum = 0;
  let weightTotal = 0;
  let overshootCount = 0;
  let noiseSum = 0;

  for (const m of relevant) {
    const lo = Math.max(0, m.startIdx);
    const hi = Math.min(n, m.endIdx);
    if (hi - lo < 2) continue;

    // FF coverage over the "stick moving" span only.
    let sumF = 0;
    let sumP = 0;
    let peakVelIdx = lo;
    let peakVelAbs = 0;
    let peakSetpointAbs = 0;
    for (let i = lo; i < hi; i++) {
      const av = Math.abs(vel[i]);
      if (av > peakVelAbs) { peakVelAbs = av; peakVelIdx = i; }
      const asp = Math.abs(setpoint[i]);
      if (asp > peakSetpointAbs) peakSetpointAbs = asp;
      if (av >= MOVING_THRESHOLD) {
        sumF += Math.abs(axisF[i]);
        sumP += Math.abs(axisP[i]);
      }
    }
    const denom = sumF + sumP;
    const ffCoverage = denom > 0 ? sumF / denom : 0;

    // Leading-edge overshoot: post-peak window, gyro past setpoint in
    // the direction the stick moved.
    const dir = vel[peakVelIdx] >= 0 ? 1 : -1;
    let maxOver = 0;
    const ohHi = Math.min(n, peakVelIdx + overshootSamples);
    for (let i = peakVelIdx; i < ohHi; i++) {
      const over = (gyro[i] - setpoint[i]) * dir;
      if (over > maxOver) maxOver = over;
    }
    const leadingEdgeOvershoot = peakSetpointAbs > 0 ? maxOver / peakSetpointAbs : 0;
    const hasOvershoot = leadingEdgeOvershoot > OVERSHOOT_FLAG;
    if (hasOvershoot) overshootCount += 1;

    // FF noise: high-frequency content of the F-term over the
    // contiguous window. Boxcar-smooth to get the envelope; the
    // residual is the jitter.
    const ffNoiseRatio = windowNoiseRatio(axisF, lo, hi, noiseSmoothSamples);
    noiseSum += ffNoiseRatio;

    windows.push({
      window: m, ffCoverage, leadingEdgeOvershoot, hasOvershoot,
      ffNoiseRatio, noisy: ffNoiseRatio > FF_NOISE_FLAG,
    });

    // Energy weight = denominator (total controller effort in the
    // window) so big maneuvers count more than tiny ones.
    coverageWeightedSum += ffCoverage * denom;
    weightTotal += denom;
  }

  const meanFFCoverage = weightTotal > 0 ? coverageWeightedSum / weightTotal : 0;
  const windowCount = windows.length;
  const meanFFNoise = windowCount > 0 ? noiseSum / windowCount : 0;

  let verdict: FFVerdict;
  if (windowCount === 0) {
    verdict = 'no-data';
  } else if (overshootCount / windowCount > 0.5) {
    verdict = 'overgained';
  } else if (meanFFCoverage < COVERAGE_UNDERGAINED) {
    verdict = 'undergained';
  } else {
    verdict = 'healthy';
  }

  return {
    axis, windows, meanFFCoverage, overshootCount, windowCount, verdict,
    meanFFNoise, noisy: meanFFNoise > FF_NOISE_FLAG,
  };
}

/** RMS(F − smooth(F)) / RMS(smooth(F)) over [lo, hi) — the fraction
 *  of the F-term's energy that's high-frequency jitter rather than
 *  maneuver-envelope signal. Returns 0 when the smoothed F is
 *  effectively zero (no FF activity → noise ratio undefined). */
function windowNoiseRatio(
  axisF: Float32Array,
  lo: number,
  hi: number,
  smoothSamples: number,
): number {
  const len = hi - lo;
  if (len < 3) return 0;
  const w = Math.max(1, smoothSamples | 1); // odd
  const half = (w - 1) / 2;
  let resSq = 0;
  let smoothSq = 0;
  for (let i = lo; i < hi; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < lo || j >= hi) continue;
      sum += axisF[j];
      count += 1;
    }
    const smooth = count > 0 ? sum / count : 0;
    const residual = axisF[i] - smooth;
    smoothSq += smooth * smooth;
    resSq += residual * residual;
  }
  const smoothRms = Math.sqrt(smoothSq / len);
  const resRms = Math.sqrt(resSq / len);
  return smoothRms > 1e-6 ? resRms / smoothRms : 0;
}
