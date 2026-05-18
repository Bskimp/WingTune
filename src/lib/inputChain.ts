// Layer 2 — input-chain lag analysis.
//
// Decomposes the wing's pilot-to-gyro lag into three measurable
// stages by per-axis windowed normalized cross-correlation:
//
//   stage A: rcCommand[axis]  → setpoint[axis]
//            (rate curves; usually near-zero on a sensible setup)
//   stage B: setpoint[axis]   → aggregated servo PWM for this axis
//            (PID loop + mixer response time)
//   stage C: aggregated servo → gyroADC[axis]
//            (servo + mechanical linkage + aero damping)
//
// The fourth stage (control surface deflection) isn't measurable
// without position feedback — the UI labels it "missing link" rather
// than fake a measurement.
//
// Decomposition matters because each stage has a different remedy:
// stage B is filter/PID-side, stage C is mechanical-side, stage A
// is the rate-curves block. Showing one "total lag" number hides
// which one to fix.
//
// Algorithm summary: per stage, slice the log into overlapping
// windows; for each window, find τ (samples) that maximizes the
// normalized correlation between input and output; skip windows
// with low input variance (servo not moving = no information) or
// flat correlation peaks (noise-dominated); aggregate the remaining
// τ estimates via median (robust against gusts and mode switches).
//
// Per-axis aggregation of the servo signal uses the classifier's
// `dominantAxis` + sign(dominantSigned) so opposite-sign servos
// (true L/R elevons) add together cleanly without cancellation,
// and paired-identical servos add without double-counting their
// magnitude artifact.

import type { AxisCorrelations } from '@/lib/servoClassifier';

export type Axis = 0 | 1 | 2;
export const AXIS_LABELS = ['Roll', 'Pitch', 'Yaw'] as const;
export const AXIS_SHORTS = ['R', 'P', 'Y'] as const;

export type Stage = 'A' | 'B' | 'C';

export interface StageResult {
  stage: Stage;
  /** Estimated lag in ms (median across valid windows). NaN when no
   *  valid windows survived the skip-idle + min-peak-corr filters. */
  lagMs: number;
  /** Median normalized correlation peak across valid windows (0..1).
   *  Higher = sharper peak = more confident measurement. */
  peakCorr: number;
  /** Count of windows that contributed (after filters). */
  windowCount: number;
  /** Per-window lag estimates (ms). For sparkline + uncertainty
   *  display. Empty when windowCount === 0. */
  perWindowLagsMs: number[];
}

export interface AxisChainResult {
  axis: Axis;
  stages: { A: StageResult; B: StageResult; C: StageResult };
  /** Sum of stage lags. NaN if any stage is NaN. */
  totalLagMs: number;
  /** True if any stage produced a valid estimate. */
  hasData: boolean;
}

export interface InputChainResult {
  axes: AxisChainResult[];
  /** Effective sample rate used for lag conversion. */
  sampleRateHz: number;
}

export interface InputChainInputs {
  /** Log time axis (seconds). Used only for sample-rate estimation. */
  time: Float32Array;
  /** Per-axis arrays, indexed by axis [0,1,2]. `undefined` for missing axes. */
  rcCommand: (Float32Array | undefined)[];
  setpoint: (Float32Array | undefined)[];
  /** Sign-aligned aggregate servo PWM per axis. Build via
   *  `buildPerAxisServoAggregate`. */
  servoAgg: (Float32Array | undefined)[];
  gyro: (Float32Array | undefined)[];
}

export interface InputChainOptions {
  windowMs: number;
  stepMs: number;
  maxLagMs: number;
  /** Skip windows where the input signal's stddev is below this. */
  minStddev: number;
  /** Skip lag estimates with normalized peak correlation below this. */
  minPeakCorr: number;
}

const DEFAULT_OPTIONS: InputChainOptions = {
  windowMs:     2000,
  stepMs:       1000,
  maxLagMs:     150,
  minStddev:    5,
  minPeakCorr:  0.35,
};

// ---------------------------------------------------------------------------
// Servo aggregation: build a per-axis "axis-equivalent command" trace.
// ---------------------------------------------------------------------------

export interface ServoAggregateArgs {
  /** Motor channel arrays — caller passes `motor[i]` field map. */
  motors: Map<string, Float32Array>;
  /** Per-channel correlation results from `correlateServosToAxes`. */
  axisCorrelations: AxisCorrelations[];
  /** Common length to pre-allocate the aggregate arrays at. */
  length: number;
}

/** For each axis, sums `sign × (motor[i] - 1500)` across servos with
 *  `dominantAxis === a`. Sign comes from `sign(dominantSigned)` so:
 *
 *   · true differential (Elevon-L/R, opposite-sign correlations):
 *     L contributes -value, R contributes +value → ADD, doubling the
 *     axis-equivalent magnitude.
 *
 *   · paired-identical (BF-mixer-sends-same-PWM-physical-reverse-splits-LR):
 *     both contribute +value → magnitudes ADD, same direction.
 *
 *   Either way, the aggregate is a clean per-axis command signal
 *   suitable for cross-correlation with setpoint or gyro. */
export function buildPerAxisServoAggregate(
  args: ServoAggregateArgs,
): (Float32Array | undefined)[] {
  const { motors, axisCorrelations, length } = args;
  const out: (Float32Array | undefined)[] = [undefined, undefined, undefined];
  for (let a: Axis = 0; a <= 2; a = (a + 1) as Axis) {
    const contributors = axisCorrelations.filter((c) => c.dominantAxis === a);
    if (contributors.length === 0) continue;
    const agg = new Float32Array(length);
    let touched = false;
    for (const c of contributors) {
      const arr = motors.get(c.fieldName);
      if (!arr || arr.length === 0) continue;
      const sign = c.dominantSigned >= 0 ? 1 : -1;
      const n = Math.min(arr.length, length);
      for (let i = 0; i < n; i++) {
        agg[i] += sign * (arr[i] - 1500);
      }
      touched = true;
    }
    if (touched) out[a] = agg;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-window lag estimation — direct normalized cross-correlation.
// ---------------------------------------------------------------------------

/** Search for τ in [0, maxLag) that maximizes normalized correlation
 *  between x[off..off+winLen) and y[off+τ..off+τ+winLen). Returns null
 *  when input variance is too low or the peak correlation is too weak
 *  (likely noise-only window). */
function windowLag(
  x: Float32Array, xOff: number,
  y: Float32Array, yOff: number,
  winLen: number,
  maxLag: number,
  minStddev: number,
  minPeakCorr: number,
): { lagSamples: number; peakCorr: number } | null {
  // x is fixed (no τ shift) — compute its mean + variance once.
  let xSum = 0;
  for (let i = 0; i < winLen; i++) xSum += x[xOff + i];
  const xMean = xSum / winLen;
  let xVar = 0;
  for (let i = 0; i < winLen; i++) {
    const d = x[xOff + i] - xMean;
    xVar += d * d;
  }
  const xStd = Math.sqrt(xVar / winLen);
  if (xStd < minStddev) return null;

  // y needs to span [yOff, yOff + winLen + maxLag). Caller verified
  // the buffer is long enough, but a defensive check costs nothing.
  if (yOff + winLen + maxLag > y.length) return null;

  let bestLag = 0;
  let bestCorr = -Infinity;
  // Walk τ; recompute y stats per shift. O(maxLag × winLen).
  for (let lag = 0; lag < maxLag; lag++) {
    let ySum = 0;
    for (let i = 0; i < winLen; i++) ySum += y[yOff + i + lag];
    const yMean = ySum / winLen;
    let yVar = 0;
    let xy = 0;
    for (let i = 0; i < winLen; i++) {
      const dx = x[xOff + i] - xMean;
      const dy = y[yOff + i + lag] - yMean;
      yVar += dy * dy;
      xy   += dx * dy;
    }
    const yStd = Math.sqrt(yVar / winLen);
    if (yStd < 1e-9) continue;
    const r = xy / (winLen * xStd * yStd);
    if (r > bestCorr) {
      bestCorr = r;
      bestLag  = lag;
    }
  }

  if (bestCorr < minPeakCorr) return null;
  return { lagSamples: bestLag, peakCorr: bestCorr };
}

function estimateStage(
  x: Float32Array | undefined,
  y: Float32Array | undefined,
  sampleRateHz: number,
  stage: Stage,
  opts: InputChainOptions,
): StageResult {
  const empty: StageResult = {
    stage, lagMs: NaN, peakCorr: 0, windowCount: 0, perWindowLagsMs: [],
  };
  if (!x || !y) return empty;
  const winLen   = Math.max(64, Math.round((opts.windowMs / 1000) * sampleRateHz));
  const stepLen  = Math.max(32, Math.round((opts.stepMs / 1000) * sampleRateHz));
  const maxLag   = Math.max(8,  Math.round((opts.maxLagMs / 1000) * sampleRateHz));
  const len = Math.min(x.length, y.length);
  if (len < winLen + maxLag) return empty;

  const lags:  number[] = [];
  const corrs: number[] = [];
  for (let off = 0; off + winLen + maxLag <= len; off += stepLen) {
    const w = windowLag(x, off, y, off, winLen, maxLag, opts.minStddev, opts.minPeakCorr);
    if (w) {
      lags.push(w.lagSamples);
      corrs.push(w.peakCorr);
    }
  }
  if (lags.length === 0) return empty;

  const medianSamples   = median(lags);
  const medianPeakCorr  = median(corrs);
  const medianLagMs     = (medianSamples / sampleRateHz) * 1000;
  const perWindowLagsMs = lags.map((l) => (l / sampleRateHz) * 1000);

  return {
    stage,
    lagMs: medianLagMs,
    peakCorr: medianPeakCorr,
    windowCount: lags.length,
    perWindowLagsMs,
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 === 1
    ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function estimateSampleRate(time: Float32Array): number {
  if (time.length < 2) return 1000;
  const dt = time[time.length - 1] - time[0];
  if (dt <= 0) return 1000;
  return (time.length - 1) / dt;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export function computeInputChain(
  inputs: InputChainInputs,
  options: Partial<InputChainOptions> = {},
): InputChainResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sampleRateHz = estimateSampleRate(inputs.time);
  const axes: AxisChainResult[] = [];
  for (let a: Axis = 0; a <= 2; a = (a + 1) as Axis) {
    const A = estimateStage(inputs.rcCommand[a], inputs.setpoint[a],  sampleRateHz, 'A', opts);
    const B = estimateStage(inputs.setpoint[a],  inputs.servoAgg[a],  sampleRateHz, 'B', opts);
    const C = estimateStage(inputs.servoAgg[a],  inputs.gyro[a],      sampleRateHz, 'C', opts);
    const total = A.lagMs + B.lagMs + C.lagMs;
    const hasData = !Number.isNaN(A.lagMs) || !Number.isNaN(B.lagMs) || !Number.isNaN(C.lagMs);
    axes.push({
      axis: a,
      stages: { A, B, C },
      totalLagMs: Number.isFinite(total) ? total : NaN,
      hasData,
    });
  }
  return { axes, sampleRateHz };
}
