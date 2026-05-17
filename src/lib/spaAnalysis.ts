// Layer 2 — SPA (Setpoint PID Attenuation) effectiveness analysis.
//
// BF's SPA gates the I-term per axis based on commanded setpoint
// rate. The intent is to prevent I-term wind-up during aggressive
// manoeuvres (e.g. a hard roll input shouldn't accumulate integral
// error while the controller hasn't yet caught up). SPA is a
// multiplier in [0, 1]: 1.0 means "no attenuation" (I-term full), 0.0
// means "fully gated" (I-term frozen). The gate engages when |setpoint
// rate| exceeds `spa_center` and ramps to floor over `spa_width`.
//
// This module turns the raw spa multiplier trace into:
//   · gate-active region detection (where spa < threshold)
//   · gate-active percentage (proxy for "is SPA doing anything")
//   · wind-up events: I-term keeps growing while SPA is at floor
//     (the controller is fighting the gate; if persistent, the gate
//     is too aggressive or the user is over-commanding)
//   · bounce-back events: large post-gate-release I-term swings
//     (gate held back too much; user gets surprising response when
//     it releases)
//
// Units: the parser emits debug[axis] = spa × 1000 (per BF PR #13719).
// The panel divides by 1000 at the boundary so this module always
// works in the natural 0..1 multiplier space.
//
// Confidence note: SPA event detection is heuristic, not a strict
// definition — there is no firmware-side event flag. The thresholds
// below are tuned against documented BF wing behaviour but a noisy
// log can trip false positives. Recommender callers should treat event
// counts as evidence weight, not ground truth.

/** SPA multiplier value below which the gate is considered "active"
 *  (i.e. meaningfully attenuating I-term). Per BF wing tuning docs,
 *  any value < 0.98 is noticeable; we use 0.95 for clean event
 *  boundaries against sensor noise. */
const DEFAULT_GATE_ACTIVE_THRESHOLD = 0.95;
/** SPA value at/below which the gate is considered "at floor" — used
 *  for wind-up detection where we need the gate to be holding I-term
 *  almost completely off. */
const DEFAULT_FLOOR_THRESHOLD = 0.10;
/** Minimum gate-active duration (samples) before a region is counted
 *  as an event. Filters out single-sample blips from sensor noise. */
const DEFAULT_MIN_EVENT_SAMPLES = 16;
/** Wind-up: |dI/dt| over the gate-active window exceeding this fraction
 *  of the axis's overall I-term range counts as wind-up. */
const DEFAULT_WINDUP_GROWTH_FRAC = 0.20;
/** Bounce-back: peak |I-term| in the 200 ms post-release window
 *  exceeding this fraction of overall range counts as bounce-back. */
const DEFAULT_BOUNCEBACK_PEAK_FRAC = 0.60;
/** Post-release window in seconds for bounce-back detection. */
const DEFAULT_BOUNCEBACK_WINDOW_SEC = 0.2;

export type SpaEventKind = 'wind_up' | 'bounce_back';

export interface SpaEvent {
  kind: SpaEventKind;
  axis: 0 | 1 | 2;
  /** Time of the triggering condition (samples-since-log-start). */
  timeSec: number;
  /** Severity 0..1 — for ranking by the recommender. Wind-up: how
   *  hard the I-term grew (1.0 = full-range growth). Bounce-back: how
   *  high I-term peaked post-release (1.0 = full-range peak). */
  severity: number;
}

export interface SpaAxisAnalysis {
  axis: 0 | 1 | 2;
  /** Count of samples where SPA < gateActiveThreshold. */
  gateActiveSamples: number;
  /** Percentage of the flight where SPA gate was active. */
  gateActivePct: number;
  /** Minimum SPA value observed (most attenuation reached). */
  minSpa: number;
  /** Mean SPA value across the flight (1.0 = gate never engaged). */
  meanSpa: number;
  /** Wind-up + bounce-back events, ordered by time. */
  events: readonly SpaEvent[];
}

export interface AnalyzeSpaOptions {
  gateActiveThreshold?: number;
  floorThreshold?: number;
  minEventSamples?: number;
  windupGrowthFrac?: number;
  bouncebackPeakFrac?: number;
  bouncebackWindowSec?: number;
}

export function analyzeSpaAxis(
  axis: 0 | 1 | 2,
  spa: Float32Array,
  iTerm: Float32Array,
  timeAxis: Float32Array,
  options: AnalyzeSpaOptions = {},
): SpaAxisAnalysis {
  const gateActiveThreshold = options.gateActiveThreshold ?? DEFAULT_GATE_ACTIVE_THRESHOLD;
  const floorThreshold = options.floorThreshold ?? DEFAULT_FLOOR_THRESHOLD;
  const minEventSamples = options.minEventSamples ?? DEFAULT_MIN_EVENT_SAMPLES;
  const windupGrowthFrac = options.windupGrowthFrac ?? DEFAULT_WINDUP_GROWTH_FRAC;
  const bouncebackPeakFrac = options.bouncebackPeakFrac ?? DEFAULT_BOUNCEBACK_PEAK_FRAC;
  const bouncebackWindowSec = options.bouncebackWindowSec ?? DEFAULT_BOUNCEBACK_WINDOW_SEC;

  const n = Math.min(spa.length, iTerm.length, timeAxis.length);
  if (n === 0) {
    return { axis, gateActiveSamples: 0, gateActivePct: 0, minSpa: 1, meanSpa: 1, events: [] };
  }

  // First pass: SPA stats + I-term range (used as denominator for event
  // severity normalization).
  let minSpa = Infinity;
  let spaSum = 0;
  let gateActiveSamples = 0;
  let iMin = Infinity;
  let iMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = spa[i];
    if (s < minSpa) minSpa = s;
    spaSum += s;
    if (s < gateActiveThreshold) gateActiveSamples++;
    const it = iTerm[i];
    if (it < iMin) iMin = it;
    if (it > iMax) iMax = it;
  }
  const meanSpa = spaSum / n;
  const gateActivePct = (gateActiveSamples / n) * 100;
  const iRange = Math.max(1e-9, iMax - iMin);  // avoid /0 on flat I-term

  // Second pass: walk gate-active runs (spa < gateActiveThreshold).
  // Within each qualifying run, check wind-up (I-term growth during)
  // and bounce-back (I-term peak after release).
  const events: SpaEvent[] = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const active = i < n && spa[i] < gateActiveThreshold;
    if (active && runStart < 0) {
      runStart = i;
    } else if (!active && runStart >= 0) {
      const runEnd = i;  // exclusive
      const runLen = runEnd - runStart;
      if (runLen >= minEventSamples) {
        // Wind-up check: only meaningful if the gate hit floor during
        // the run (otherwise it's a "light touch" gate, not holding
        // the I-term back).
        let hitFloor = false;
        for (let k = runStart; k < runEnd; k++) {
          if (spa[k] <= floorThreshold) { hitFloor = true; break; }
        }
        if (hitFloor) {
          const iStart = iTerm[runStart];
          const iEnd = iTerm[runEnd - 1];
          const growth = Math.abs(iEnd - iStart) / iRange;
          if (growth >= windupGrowthFrac) {
            events.push({
              kind: 'wind_up',
              axis,
              timeSec: timeAxis[runStart],
              severity: Math.min(1, growth),
            });
          }
        }
        // Bounce-back: peak |I-term| in the post-release window
        // (relative to I-term at release point).
        const releaseIdx = runEnd;
        const releaseTime = timeAxis[releaseIdx - 1];
        const windowEndTime = releaseTime + bouncebackWindowSec;
        let postPeakAbs = 0;
        for (let k = releaseIdx; k < n; k++) {
          if (timeAxis[k] > windowEndTime) break;
          const abs = Math.abs(iTerm[k]);
          if (abs > postPeakAbs) postPeakAbs = abs;
        }
        const peakFrac = postPeakAbs / iRange;
        if (peakFrac >= bouncebackPeakFrac) {
          events.push({
            kind: 'bounce_back',
            axis,
            timeSec: releaseTime,
            severity: Math.min(1, peakFrac),
          });
        }
      }
      runStart = -1;
    }
  }

  return { axis, gateActiveSamples, gateActivePct, minSpa, meanSpa, events };
}

/** Convenience: convert raw debug-mode SPA channel (×1000 scaling) to
 *  natural multiplier space. Used at the panel boundary so the analytics
 *  layer always sees [0, 1] values. */
export function debugSpaToMultiplier(rawSpa: Float32Array): Float32Array {
  const out = new Float32Array(rawSpa.length);
  for (let i = 0; i < rawSpa.length; i++) out[i] = rawSpa[i] / 1000;
  return out;
}

/** Setpoint rate (first difference, deg/s²) — used as the diagnostic
 *  overlay since SPA gates on `|setpoint_rate|` vs spa_center. Output
 *  length matches input length; first sample is 0 (no previous sample
 *  to diff against). */
export function setpointRate(
  setpoint: Float32Array,
  timeAxis: Float32Array,
): Float32Array {
  const n = Math.min(setpoint.length, timeAxis.length);
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dt = timeAxis[i] - timeAxis[i - 1];
    out[i] = dt > 0 ? (setpoint[i] - setpoint[i - 1]) / dt : 0;
  }
  return out;
}
