// Layer 2 — group-delay budget for BF's gyro/D-term filter chain.
//
// BF cascades multiple LP stages plus a dynamic-notch bank. Each stage
// adds latency between physical motion and the value the PID loop
// reacts to. Excess delay → unresponsive control + higher overshoot.
// Rough rule of thumb: total filter delay should stay under ~5 ms on
// a wing; this module surfaces the total + per-stage breakdown so the
// user can see whether their filter chain has bloated.
//
// Delay formulas (DC group delay, in seconds, given cutoff fc in Hz):
//   · PT1:    τ ≈ 1 / (2π · fc)
//   · PT2:    ≈ 2 × PT1 (cascade of two PT1s)
//   · PT3:    ≈ 3 × PT1
//   · BIQUAD: ≈ 1.5 × PT1 (Butterworth Q ≈ 0.707; rough average)
//   · Notch:  τ ≈ Q / (π · fc) per notch
//
// For dynamic LP filters the worst-case (lowest cutoff) is used; for
// the notch bank the lowest-frequency notch contributes the most
// delay so dyn_notch_min_hz is the conservative estimate.

import type { FilterConfig, LowPassConfig, DynNotchConfig, RpmFilterConfig } from '@/lib/wasmBridge';

export interface FilterStage {
  /** Human-readable label for the budget table (e.g. "gyro LPF1"). */
  name: string;
  /** Filter type as logged ("PT1", "BIQUAD", or notch "Qn.n"). */
  detail: string;
  /** Cutoff used for the delay computation, in Hz. */
  cutoffHz: number;
  /** This stage's group delay in milliseconds. */
  delayMs: number;
}

export interface FilterDelayBudget {
  stages: FilterStage[];
  /** Sum of stage delays in milliseconds. */
  totalMs: number;
}

const PT_MULTIPLIERS: Record<string, number> = {
  PT1: 1,
  PT2: 2,
  PT3: 3,
  BIQUAD: 1.5,
};

/** PT1-equivalent DC group delay at cutoff `fc`, in milliseconds. */
function pt1DelayMs(fc: number): number {
  if (fc <= 0) return 0;
  return 1000 / (2 * Math.PI * fc);
}

/** Effective cutoff for delay calculation: dyn_min_hz if dynamic
 *  (worst-case delay at lowest cutoff), else static_hz. */
function effectiveCutoff(lpf: LowPassConfig): number {
  if (lpf.dyn_min_hz != null && lpf.dyn_min_hz > 0) return lpf.dyn_min_hz;
  return lpf.static_hz ?? 0;
}

function lpfStage(name: string, lpf: LowPassConfig | null): FilterStage | null {
  if (!lpf) return null;
  const fc = effectiveCutoff(lpf);
  if (fc <= 0) return null;
  const mult = PT_MULTIPLIERS[lpf.filter_type.toUpperCase()] ?? 1;
  const delayMs = pt1DelayMs(fc) * mult;
  const dynNote = lpf.dyn_min_hz != null && lpf.dyn_max_hz != null
    ? ` (dyn ${lpf.dyn_min_hz}–${lpf.dyn_max_hz} Hz)`
    : '';
  return { name, detail: `${lpf.filter_type}${dynNote}`, cutoffHz: fc, delayMs };
}

function notchStage(dn: DynNotchConfig): FilterStage | null {
  if (dn.count <= 0 || dn.min_hz <= 0) return null;
  // BF logs Q × 100; actual Q is q / 100.
  const qActual = dn.q / 100;
  // Per-notch delay at the lowest-frequency notch (worst case).
  const perNotchMs = (qActual / (Math.PI * dn.min_hz)) * 1000;
  const totalMs = perNotchMs * dn.count;
  return {
    name: `dyn notch ×${dn.count}`,
    detail: `Q=${qActual.toFixed(1)} (${dn.min_hz}–${dn.max_hz} Hz)`,
    cutoffHz: dn.min_hz,
    delayMs: totalMs,
  };
}

function rpmStage(rpm: RpmFilterConfig): FilterStage | null {
  if (rpm.harmonics <= 0 || rpm.min_hz <= 0) return null;
  // RPM notches sweep with motor frequency; we estimate worst-case
  // delay at rpm_filter_min_hz (the lowest frequency BF will place
  // a notch at). Sum over harmonics.
  const qActual = rpm.q / 100;
  const perNotchMs = (qActual / (Math.PI * rpm.min_hz)) * 1000;
  const totalMs = perNotchMs * rpm.harmonics;
  return {
    name: `rpm filter ×${rpm.harmonics}`,
    detail: `Q=${qActual.toFixed(1)} (≥${rpm.min_hz} Hz, LP ${rpm.lpf_hz} Hz)`,
    cutoffHz: rpm.min_hz,
    delayMs: totalMs,
  };
}

export function computeDelayBudget(config: FilterConfig): FilterDelayBudget {
  const candidates: Array<FilterStage | null> = [
    lpfStage('gyro LPF1',  config.gyro_lpf1),
    lpfStage('gyro LPF2',  config.gyro_lpf2),
    lpfStage('dterm LPF1', config.dterm_lpf1),
    lpfStage('dterm LPF2', config.dterm_lpf2),
    config.dyn_notch  ? notchStage(config.dyn_notch)  : null,
    config.rpm_filter ? rpmStage(config.rpm_filter)   : null,
  ];
  const stages = candidates.filter((s): s is FilterStage => s !== null);
  const totalMs = stages.reduce((sum, s) => sum + s.delayMs, 0);
  return { stages, totalMs };
}
