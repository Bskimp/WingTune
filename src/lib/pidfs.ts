// Layer 2 — PIDFS controller decomposition primitives.
//
// The five terms in BF's PIDFS controller, per axis:
//   P  — proportional to error (setpoint − gyro)
//   I  — integral of error over time
//   D  — derivative of error (rate of change)
//   F  — feedforward from setpoint
//   S  — static / saturation gain (the wing-friendly newer term)
//
// Each term is logged separately when debug mode + field-set capture
// them, as `axisP[i]`, `axisI[i]`, `axisD[i]`, `axisF[i]`, `axisS[i]`.
// On wings, axisD and axisS on the yaw axis are commonly zero (no yaw
// stab there) — see the `reference-test-logs` memory entry.
//
// This module is the math half of the M2 PIDFS-decomp work. The UI
// half (PIDContributionPanel.vue) consumes these primitives plus the
// raw hydrated typed arrays. No allocations in the hot path — each
// reducer is a single typed-array pass.

export type PIDFSTerm = 'P' | 'I' | 'D' | 'F' | 'S';

export interface PIDFSArrays {
  P?: Float32Array;
  I?: Float32Array;
  D?: Float32Array;
  F?: Float32Array;
  S?: Float32Array;
}

/** Mean of |arr[i]|. Single pass, no boxing. Returns 0 for empty input. */
export function meanAbs(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    sum += v < 0 ? -v : v;
  }
  return sum / arr.length;
}

export interface TermShares {
  P: number;
  I: number;
  D: number;
  F: number;
  S: number;
  /** Highest-contributing term, or null if all terms are zero / absent. */
  dominant: PIDFSTerm | null;
  /** Sum of mean-abs across the present terms — the denominator used
   *  for the per-term shares. Surfaced because "P is 60%" is more
   *  meaningful when the user can see the absolute magnitude too. */
  totalAbs: number;
}

/** Per-term shares of the total controller output, computed as
 *  mean-abs(term) / Σ mean-abs(term across present terms). A term not
 *  provided contributes zero. Useful as a quick "what's driving this
 *  axis right now" summary above the chart. */
export function pidfsShares(arrays: PIDFSArrays): TermShares {
  const ma = {
    P: arrays.P ? meanAbs(arrays.P) : 0,
    I: arrays.I ? meanAbs(arrays.I) : 0,
    D: arrays.D ? meanAbs(arrays.D) : 0,
    F: arrays.F ? meanAbs(arrays.F) : 0,
    S: arrays.S ? meanAbs(arrays.S) : 0,
  };
  const totalAbs = ma.P + ma.I + ma.D + ma.F + ma.S;
  if (totalAbs === 0) {
    return { P: 0, I: 0, D: 0, F: 0, S: 0, dominant: null, totalAbs: 0 };
  }
  const order: PIDFSTerm[] = ['P', 'I', 'D', 'F', 'S'];
  let dominant: PIDFSTerm = 'P';
  let best = -1;
  for (const k of order) {
    if (ma[k] > best) { best = ma[k]; dominant = k; }
  }
  return {
    P: ma.P / totalAbs,
    I: ma.I / totalAbs,
    D: ma.D / totalAbs,
    F: ma.F / totalAbs,
    S: ma.S / totalAbs,
    dominant,
    totalAbs,
  };
}
