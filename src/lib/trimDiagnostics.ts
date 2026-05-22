// Layer 2 — trim diagnostics: the steady-state I-term as a structural
// "fix the airplane before the PIDs" reading.
//
// The integral term exists to drive steady-state error to zero. In
// trimmed, hands-off level flight a healthy axis needs almost no
// integral — its I-term rests near zero. A LARGE, PERSISTENT I-term
// in steady cruise means the controller is holding a constant
// control-surface offset to fight a structural asymmetry the pilot
// never trimmed out: a heavy wing, a CG too far fore/aft, asymmetric
// thrust, a warped surface. The PID loop masks it; the airframe still
// has it, and every gain the user then tunes is tuned around a
// crooked baseline.
//
// This module measures the mean I-term per axis over the STEADY-
// CRUISE samples of a flight — the pilot commanding ~no rotation on
// any axis, wings level (when attitude is available), and far enough
// past the last input for the integrator to settle — and expresses
// it as a fraction of that axis's whole-flight I-term RMS:
//
//   trimFraction = |mean(I-term over steady cruise)| / RMS(I-term)
//
// i.e. how much of the integrator's activity is a static trim offset
// versus genuine dynamic correction. Because both terms share the
// I-term's units it is dimensionless — reasonably airframe-portable,
// and zero-mean integrator noise averages to ~1/√N over N steady
// samples, far below the flag thresholds.
//
// Diagnostic only — no recommender, no CLI. The fix is mechanical
// (trim / CG / linkage), not a firmware `set`. The thresholds are
// wing-regime first guesses (TODO calibrate); the metric being
// dimensionless keeps that debt small.

import { estimateSampleRate } from '@/lib/spectrum';
import type { Axis } from '@/lib/inputChain';

/** Below this rate-setpoint magnitude (deg/s) the pilot is treated as
 *  not commanding rotation on that axis. TODO calibrate. */
const SETPOINT_FLOOR_DEG_S = 20;
/** Wings-level gate (decidegrees of roll attitude, ±150 = ±15°). Only
 *  applied when an attitude-roll array is supplied — it excludes
 *  sustained banked turns, where the I-terms carry turn-holding
 *  effort rather than a trim error. TODO calibrate. */
const ROLL_FLOOR_DECIDEG = 150;
/** Lead-in a sample needs free of any input before it counts as
 *  steady — lets the integrator settle to its trim value after the
 *  last stick input. TODO calibrate. */
const SETTLE_MS = 1500;
/** Minimum steady-cruise coverage to make a call at all. */
export const MIN_COVERAGE_SEC = 5;
/** trimFraction band edges. TODO calibrate. */
const TRIM_FRACTION_SLIGHT = 0.25;
const TRIM_FRACTION_ERROR = 0.5;
/** Below this the I-term is inert (gain off / empty field) — reported
 *  'balanced', no division. */
const ITERM_RMS_FLOOR = 1e-9;

export type TrimSeverity = 'balanced' | 'slight' | 'trim-error' | 'unknown';

export interface AxisTrim {
  axis: Axis;
  /** Mean signed I-term over steady-cruise samples, raw axis units.
   *  NaN when the axis has no I-term data or there is no steady
   *  cruise to average over. */
  meanITerm: number;
  /** RMS of the I-term across the whole flight — the reference for
   *  "how much does this axis's integrator move at all". */
  itermRms: number;
  /** |meanITerm| / itermRms ∈ [0, 1]. How much of the integrator's
   *  activity is a static trim offset. 0 when not measurable. */
  trimFraction: number;
  severity: TrimSeverity;
}

export interface TrimDiagnosticsResult {
  axes: AxisTrim[];
  /** Steady-cruise samples found (shared across axes — the mask is a
   *  whole-craft condition). */
  steadySampleCount: number;
  /** steadySampleCount expressed in seconds. */
  steadyCoverageSec: number;
  sampleRateHz: number;
  /** True when an attitude-roll array was supplied and the wings-level
   *  gate was applied — the steady detection is more reliable then. */
  usedAttitudeGate: boolean;
}

export interface TrimDiagnosticsInputs {
  /** Log time axis (seconds). */
  time: Float32Array;
  /** Per-axis I-term (`axisI[0..2]`), indexed [roll, pitch, yaw].
   *  `undefined` for a missing axis. */
  iTerm: (Float32Array | undefined)[];
  /** Per-axis rate setpoint, indexed [roll, pitch, yaw]. */
  setpoint: (Float32Array | undefined)[];
  /** Optional roll attitude (`attitude[0]`, decidegrees). When given,
   *  sustained banked turns are excluded from the steady mask. */
  attitudeRoll?: Float32Array;
}

function rmsRange(x: Float32Array, n: number): number {
  if (n <= 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

function classify(
  trimFraction: number,
  measurable: boolean,
  enoughCoverage: boolean,
): TrimSeverity {
  if (!measurable || !enoughCoverage) return 'unknown';
  if (trimFraction >= TRIM_FRACTION_ERROR) return 'trim-error';
  if (trimFraction >= TRIM_FRACTION_SLIGHT) return 'slight';
  return 'balanced';
}

/** Diagnose per-axis trim error from the steady-cruise I-term. See the
 *  module header for the method + rationale. */
export function computeTrimDiagnostics(
  inputs: TrimDiagnosticsInputs,
): TrimDiagnosticsResult {
  const { time, iTerm, setpoint, attitudeRoll } = inputs;
  const n = time.length;
  const sampleRateHz = estimateSampleRate(time);
  const usedAttitudeGate = !!attitudeRoll && attitudeRoll.length > 0;

  const emptyAxes = (): AxisTrim[] =>
    [0, 1, 2].map((a) => ({
      axis: a as Axis,
      meanITerm: NaN,
      itermRms: iTerm[a] ? rmsRange(iTerm[a]!, Math.min(n, iTerm[a]!.length)) : 0,
      trimFraction: 0,
      severity: 'unknown' as TrimSeverity,
    }));

  if (n < 2 || sampleRateHz <= 0) {
    return {
      axes: emptyAxes(),
      steadySampleCount: 0,
      steadyCoverageSec: 0,
      sampleRateHz,
      usedAttitudeGate,
    };
  }

  // Raw steady mask: no axis being commanded to rotate, and (when
  // attitude is available) wings level.
  const rawSteady = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let steady = 1;
    for (let a = 0; a < 3; a++) {
      const sp = setpoint[a];
      if (sp && i < sp.length && Math.abs(sp[i]) >= SETPOINT_FLOOR_DEG_S) {
        steady = 0;
        break;
      }
    }
    if (steady && usedAttitudeGate && i < attitudeRoll!.length) {
      if (Math.abs(attitudeRoll![i]) >= ROLL_FLOOR_DECIDEG) steady = 0;
    }
    rawSteady[i] = steady;
  }

  // Erode: a sample counts as steady only after SETTLE_MS of unbroken
  // raw-steady lead-in — the integrator needs time to settle.
  const settleSamples = Math.max(1, Math.round((SETTLE_MS / 1000) * sampleRateHz));
  const steady = new Uint8Array(n);
  let run = 0;
  let steadyCount = 0;
  for (let i = 0; i < n; i++) {
    run = rawSteady[i] ? run + 1 : 0;
    if (run >= settleSamples) {
      steady[i] = 1;
      steadyCount++;
    }
  }

  const steadyCoverageSec = steadyCount / sampleRateHz;
  const enoughCoverage = steadyCoverageSec >= MIN_COVERAGE_SEC;

  const axes: AxisTrim[] = [0, 1, 2].map((a) => {
    const iArr = iTerm[a];
    if (!iArr || iArr.length === 0) {
      return {
        axis: a as Axis,
        meanITerm: NaN,
        itermRms: 0,
        trimFraction: 0,
        severity: 'unknown' as TrimSeverity,
      };
    }
    const len = Math.min(n, iArr.length);
    const itermRms = rmsRange(iArr, len);

    // Mean I-term over the steady-cruise samples.
    let sum = 0;
    let count = 0;
    for (let i = 0; i < len; i++) {
      if (steady[i]) {
        sum += iArr[i];
        count++;
      }
    }
    const measurable = count > 0;
    const meanITerm = measurable ? sum / count : NaN;

    let trimFraction = 0;
    if (measurable && itermRms > ITERM_RMS_FLOOR) {
      trimFraction = Math.min(1, Math.abs(meanITerm) / itermRms);
    }

    return {
      axis: a as Axis,
      meanITerm,
      itermRms,
      trimFraction,
      severity: classify(trimFraction, measurable, enoughCoverage),
    };
  });

  return {
    axes,
    steadySampleCount: steadyCount,
    steadyCoverageSec,
    sampleRateHz,
    usedAttitudeGate,
  };
}
