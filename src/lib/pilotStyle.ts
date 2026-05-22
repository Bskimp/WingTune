// Layer 2 — M-Pilot: pilot-input style classification.
//
// Reads the pilot's raw `rcCommand[0..2]` and characterises HOW the log
// was flown — separating three cases that look alike in the gyro
// traces but call for different tuning advice:
//
//   - calm wing, calm pilot       — small, infrequent inputs
//   - stable wing, aggressive     — large, deliberate strokes
//   - unstable wing, pilot fight  — constant small, rapid corrections
//
// A panel that says "this gyro is busy" can't tell whether the pilot
// caused it. M-Pilot can: it works off the stick, not the airframe.
// Its second job is to feed M-Style — the input-style verdict is the
// natural signal for non-binding profile suggestion (Cruise / Sport /
// 3D), closing the deferred M-Style Slice 4.
//
// Wing-regime caveat: `rcCommand` is conventionally ±500 in Betaflight.
// The amplitude→profile bands are first-guess values pending corpus
// calibration — see `docs/wingtune-m-pilot-execution.md`. Low stakes:
// the verdict only ever *suggests*; the cardinal "tool may suggest, the
// user declares intent" rule from M-Style applies here too.
//
// Plain absolute units throughout — no normalising by per-log max,
// because the absolute amplitude IS the style: "this pilot only ever
// used 60% stick" must remain visible.

import { estimateSampleRate } from '@/lib/spectrum';
import type { TuneProfile } from '@/lib/tuneProfile';
import type { Axis } from '@/lib/inputChain';

/** rcCommand units above zero below which a sample is treated as
 *  not-moved-from-centre — the activity-RMS gate uses it too. */
const CENTRE = 0;

export interface PilotStyleOptions {
  /** rcCommand-units retrace past the running extremum required to
   *  confirm a turning point. Rejects decode / sensor jitter; smaller
   *  values count more reversals. Default 25 units (5% of the BF ±500
   *  full-scale). TODO calibrate. */
  reversalDeadband?: number;
  /** Aggregate stroke-p90 amplitudes below this → Cruise. TODO. */
  profileCruiseUpper?: number;
  /** Aggregate stroke-p90 amplitudes below this → Sport. Above → 3D.
   *  TODO calibrate. */
  profileSportUpper?: number;
  /** Aggregate reversals/sec below this → 'calm'. TODO calibrate. */
  rateCalmUpper?: number;
  /** Aggregate reversals/sec below this → 'active'. Above → 'busy'.
   *  TODO calibrate. */
  rateActiveUpper?: number;
  /** Minimum log duration to make any aggregate call. Below this the
   *  verdict comes back null — even a 0.5 s clip can hit large stick
   *  numbers, but they're not a style. */
  minDurationSec?: number;
  /** Aggregate activity-RMS below this → no stick motion to read.
   *  Verdict null. */
  minActivityRms?: number;
}

const DEFAULTS: Required<PilotStyleOptions> = {
  reversalDeadband:    25,     // 5% of full-scale ±500
  profileCruiseUpper:  80,     // ~16% of full-scale
  profileSportUpper:   220,    // ~44% of full-scale
  rateCalmUpper:       0.5,    // 1 reversal every 2 s
  rateActiveUpper:     2.0,    // 1 reversal every 0.5 s
  minDurationSec:      3,
  minActivityRms:      5,      // 1% of full-scale — anything less is "stick centred"
};

export type CorrectionCharacter = 'calm' | 'active' | 'busy';

export interface PilotAxisStyle {
  axis: Axis;
  /** RMS deflection from centre in rcCommand units. How hard the pilot
   *  worked this axis on average. 0 when the axis was absent. */
  activityRms: number;
  /** Confirmed turning points per second. The hysteresis-deadband
   *  rejects jitter, so only *real* corrections count. */
  reversalRatePerSec: number;
  /** Median confirmed turning-point amplitude (|deflection from
   *  centre|). NaN when no turning points were confirmed. */
  strokeMedian: number;
  /** 90th-percentile confirmed turning-point amplitude — "how big are
   *  this pilot's big inputs". NaN when no turning points. */
  strokeP90: number;
  /** Count of samples the axis contributed to the per-axis stats. */
  sampleCount: number;
  /** Number of confirmed turning points. */
  reversalCount: number;
}

export interface PilotStyleResult {
  /** Per-axis stats, indexed [roll, pitch, yaw]. Always length 3 —
   *  absent axes get zeroed entries with `sampleCount: 0`. */
  axes: PilotAxisStyle[];
  /** Log duration in seconds, used for the per-axis rate denominator. */
  durationSec: number;
  /** Estimated sample rate (Hz). */
  sampleRateHz: number;
  /** Roll+pitch max of `strokeP90` — the aggregate amplitude that
   *  drives the suggested profile. NaN when no strokes were confirmed. */
  dominantAmplitude: number;
  /** Roll+pitch max of `reversalRatePerSec` — drives correction
   *  character. */
  dominantReversalRate: number;
  /** Non-binding profile suggestion. `null` when the log is too short
   *  or the sticks barely moved — honest empty state. */
  suggestedProfile: TuneProfile | null;
  /** Correction character — calm / active / busy. `null` when there
   *  isn't enough data to make a call. */
  correctionCharacter: CorrectionCharacter | null;
}

/** Characterise the pilot input style from `rcCommand[0..2]`. See the
 *  module header for the method + rationale. */
export function computePilotStyle(
  rcCommand: readonly (Float32Array | undefined)[],
  time: Float32Array,
  options: PilotStyleOptions = {},
): PilotStyleResult {
  const opt = { ...DEFAULTS, ...options };
  const n = time.length;
  const sampleRateHz = estimateSampleRate(time);
  const durationSec = n >= 2 ? Math.max(0, time[n - 1] - time[0]) : 0;

  const axes: PilotAxisStyle[] = [0, 1, 2].map((a) =>
    perAxis(rcCommand[a], a as Axis, durationSec, opt.reversalDeadband),
  );

  // Roll + pitch are the primary maneuvering axes; yaw is intentionally
  // excluded from the verdict because rudder use varies enormously by
  // airframe (wings without a fin even fly rudderless) and isn't a
  // "style" signal in the way roll/pitch are.
  const verdictAxes = axes.slice(0, 2).filter((ax) => ax.sampleCount > 0);
  // When strokes were confirmed, strokeP90 is the right amplitude
  // measure. When not (calm jitter, sub-deadband), fall back to the
  // per-axis activityRms — a small-but-finite reading that steers a
  // truly quiet flight to Cruise instead of falling out of the verdict.
  const dominantAmplitude = maxFinite(
    verdictAxes.map((ax) => (Number.isFinite(ax.strokeP90) ? ax.strokeP90 : ax.activityRms)),
  );
  const dominantReversalRate = maxFinite(verdictAxes.map((ax) => ax.reversalRatePerSec));
  const aggregateActivity = maxFinite(verdictAxes.map((ax) => ax.activityRms));

  let suggestedProfile: TuneProfile | null = null;
  let correctionCharacter: CorrectionCharacter | null = null;
  if (
    durationSec >= opt.minDurationSec &&
    verdictAxes.length > 0 &&
    aggregateActivity >= opt.minActivityRms
  ) {
    if (Number.isFinite(dominantAmplitude)) {
      suggestedProfile =
        dominantAmplitude < opt.profileCruiseUpper ? 'cruise'
        : dominantAmplitude < opt.profileSportUpper ? 'sport'
        : '3d';
    }
    correctionCharacter =
      dominantReversalRate < opt.rateCalmUpper ? 'calm'
      : dominantReversalRate < opt.rateActiveUpper ? 'active'
      : 'busy';
  }

  return {
    axes,
    durationSec,
    sampleRateHz,
    dominantAmplitude,
    dominantReversalRate,
    suggestedProfile,
    correctionCharacter,
  };
}

function perAxis(
  arr: Float32Array | undefined,
  axis: Axis,
  durationSec: number,
  reversalDeadband: number,
): PilotAxisStyle {
  if (!arr || arr.length === 0 || durationSec <= 0) {
    return {
      axis,
      activityRms: 0,
      reversalRatePerSec: 0,
      strokeMedian: NaN,
      strokeP90: NaN,
      sampleCount: 0,
      reversalCount: 0,
    };
  }

  // Activity = RMS deflection from centre (rcCommand is signed, so
  // mean-deflection cancels and RMS is the honest measure).
  let sq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - CENTRE;
    sq += d * d;
  }
  const activityRms = Math.sqrt(sq / arr.length);

  // Hysteresis zigzag — confirm a turning point only when the signal
  // retraces from the running extremum by more than reversalDeadband.
  // Priming tracks running max AND min separately until their span
  // exceeds deadband; we then commit to whichever extreme was hit most
  // recently as the current direction, and record the opposite extreme
  // as the opening stroke. A clean K-cycle square wave records 2K-1
  // strokes = 2K-1 reversals.
  const strokes: number[] = [];
  let runMax = arr[0];
  let runMaxIdx = 0;
  let runMin = arr[0];
  let runMinIdx = 0;
  let extremum = arr[0];
  let direction: 0 | 1 | -1 = 0;
  for (let i = 1; i < arr.length; i++) {
    const x = arr[i];
    if (direction === 0) {
      if (x > runMax) { runMax = x; runMaxIdx = i; }
      if (x < runMin) { runMin = x; runMinIdx = i; }
      if (runMax - runMin > reversalDeadband) {
        if (runMaxIdx > runMinIdx) {
          // Most recent extreme is the max → currently trending up.
          // Opening stroke = the prior low we left behind.
          strokes.push(Math.abs(runMin - CENTRE));
          extremum = runMax;
          direction = 1;
        } else {
          strokes.push(Math.abs(runMax - CENTRE));
          extremum = runMin;
          direction = -1;
        }
      }
    } else if (direction === 1) {
      if (x > extremum) {
        extremum = x;
      } else if (extremum - x > reversalDeadband) {
        // Confirmed top — flip down.
        strokes.push(Math.abs(extremum - CENTRE));
        extremum = x;
        direction = -1;
      }
    } else {
      if (x < extremum) {
        extremum = x;
      } else if (x - extremum > reversalDeadband) {
        strokes.push(Math.abs(extremum - CENTRE));
        extremum = x;
        direction = 1;
      }
    }
  }

  // Every confirmed turning point is a real direction-change: the
  // first stroke records "pilot held X then reversed to the other
  // direction", which IS a reversal — so the count equals strokes.length.
  const reversalCount = strokes.length;
  const reversalRatePerSec = reversalCount / durationSec;

  // Stroke distribution. We use ALL recorded extrema (including the
  // priming one) because they all describe "how big this pilot's
  // turning points were" — the count is what's hedged, not the
  // amplitudes themselves.
  const strokeMedian = strokes.length > 0 ? percentile(strokes, 0.5) : NaN;
  const strokeP90 = strokes.length > 0 ? percentile(strokes, 0.9) : NaN;

  return {
    axis,
    activityRms,
    reversalRatePerSec,
    strokeMedian,
    strokeP90,
    sampleCount: arr.length,
    reversalCount,
  };
}

function percentile(values: readonly number[], q: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function maxFinite(xs: readonly number[]): number {
  let best = NaN;
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    if (!Number.isFinite(best) || x > best) best = x;
  }
  return best;
}
