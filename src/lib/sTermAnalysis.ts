// Layer 2 — S-term TPA effectiveness analysis.
//
// On wing builds, BF's PIDFS controller adds an S-term per axis
// (`axisS[i]` on the main frame). TPA (Throttle/airspeed-based PID
// Attenuation) scales this S contribution down at higher airspeeds
// to prevent over-correction during fast cruise — the same way TPA
// scales P/I/D, but with its own per-controller-term effect.
//
// To diagnose whether TPA is effective on S, we need both:
//   · pre-TPA S contribution (what the controller computed BEFORE
//     TPA scaling — emitted only when `debug_mode = S_TERM`,
//     channel 2*axis)
//   · post-TPA S contribution (`axisS[i]` on the main frame, always
//     present in USE_WING builds)
//
// The effective per-sample TPA factor on S is `post / pre`. A value
// near 1.0 means TPA isn't doing anything to S right now (probably
// low airspeed); near 0 means S is being heavily attenuated (high
// airspeed). Mean attenuation across the flight = 1 - mean(factor)
// where pre is meaningfully active.
//
// This module is diagnostic-only per the roadmap (Module F / M7).
// No CLI recommendations — TPA-on-S tuning has the same `tpa_*` knobs
// as TPA-on-PID, which the M3 BASIC fit recommender already addresses.
// This module's job is to make TPA-on-S behaviour visible so the user
// can sanity-check whether the airspeed scaling matches their stick
// inputs.
//
// Units note: `axisS[i]` is in the same units as the other PID terms
// (degrees-of-correction-per-second equivalent). DEBUG_S_TERM channels
// emit the raw pre-TPA value in the same units — no ×N scaling
// boundary like SPA (verified against BF source ground-truth memory).

/** Below this absolute pre-TPA S value, the per-sample TPA factor is
 *  considered uninformative (small numerator → noisy ratio). Used to
 *  gate which samples enter the mean-attenuation aggregate and which
 *  get NaN in the factor series (so the chart shows gaps, not garbage). */
const DEFAULT_ACTIVE_THRESHOLD = 1.0;
/** Hard upper-clamp on the factor series. With small denominators,
 *  the post/pre ratio can blow up; clamp keeps charts readable and
 *  the aggregate stable against single-sample outliers. */
const DEFAULT_FACTOR_MAX = 3.0;

export interface STermAxisAnalysis {
  axis: 0 | 1 | 2;
  /** Per-sample TPA factor on S = post/pre. NaN where pre is below
   *  activeThreshold (so the chart renders gaps, not garbage spikes). */
  tpaFactorSeries: Float32Array;
  /** Mean attenuation = 1 - mean(factor) across active samples, in
   *  [0, 1]. 0 = TPA isn't attenuating S at all; 1 = fully nuked. */
  meanAttenuation: number;
  /** Minimum factor reached (max attenuation point) across active
   *  samples. 1.0 means TPA never attenuated; 0.0 means full attenuation. */
  minTpaFactor: number;
  /** Mean factor across active samples (companion to meanAttenuation). */
  meanTpaFactor: number;
  /** Count of samples where |pre| ≥ activeThreshold. */
  activeSamples: number;
  /** Percentage of the flight where S-term was meaningfully active. */
  activePct: number;
}

export interface AnalyzeSTermOptions {
  activeThreshold?: number;
  factorMax?: number;
}

export function analyzeSTermAxis(
  axis: 0 | 1 | 2,
  preTpaS: Float32Array,
  postTpaS: Float32Array,
  options: AnalyzeSTermOptions = {},
): STermAxisAnalysis {
  const activeThreshold = options.activeThreshold ?? DEFAULT_ACTIVE_THRESHOLD;
  const factorMax = options.factorMax ?? DEFAULT_FACTOR_MAX;

  const n = Math.min(preTpaS.length, postTpaS.length);
  const factor = new Float32Array(n);

  if (n === 0) {
    return {
      axis,
      tpaFactorSeries: factor,
      meanAttenuation: 0,
      minTpaFactor: 1,
      meanTpaFactor: 1,
      activeSamples: 0,
      activePct: 0,
    };
  }

  let activeSamples = 0;
  let factorSum = 0;
  let minFactor = Infinity;
  for (let i = 0; i < n; i++) {
    const pre = preTpaS[i];
    const post = postTpaS[i];
    if (Math.abs(pre) < activeThreshold) {
      factor[i] = NaN;
      continue;
    }
    // Clamp magnitude so noisy small denominators don't wreck the
    // chart or the aggregate. Sign handling: we look at the magnitude
    // ratio — TPA is an attenuation factor, not a sign-flipper, and
    // pre/post should share sign in healthy operation.
    let f = post / pre;
    if (f < 0) f = 0;           // sign disagreement → effectively cancelled
    if (f > factorMax) f = factorMax;
    factor[i] = f;
    factorSum += f;
    if (f < minFactor) minFactor = f;
    activeSamples++;
  }

  if (activeSamples === 0) {
    return {
      axis,
      tpaFactorSeries: factor,
      meanAttenuation: 0,
      minTpaFactor: 1,
      meanTpaFactor: 1,
      activeSamples: 0,
      activePct: 0,
    };
  }

  const meanTpaFactor = factorSum / activeSamples;
  const meanAttenuation = Math.max(0, Math.min(1, 1 - meanTpaFactor));
  return {
    axis,
    tpaFactorSeries: factor,
    meanAttenuation,
    minTpaFactor: minFactor,
    meanTpaFactor,
    activeSamples,
    activePct: (activeSamples / n) * 100,
  };
}
