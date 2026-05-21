// Layer 2 — M-Coupling cross-axis coupling analysis.
//
// "The wing rolls fine but pitches weirdly when I correct" is a real
// mystery-bug class no other panel surfaces. Command one axis hard and
// watch the other two: a roll input that wobbles pitch is a mixer
// imbalance, a CG problem, or a mechanical bind. M-Coupling turns that
// into a 3x3 number.
//
// Method — measure coupling ONLY inside the transient windows from
// `lib/maneuverDetect`. That gating is deliberate. In sustained flight
// a banked turn naturally trades away some pitch authority; a quad-
// style whole-flight correlation would read that aerodynamically-
// EXPECTED coupling as a fault. A fast snap input is short enough that
// genuine cross-axis coupling shows up as a discrete wobble against an
// otherwise steady baseline — so transient gating sidesteps the
// "real vs expected coupling" problem entirely.
//
// Only single-axis-dominant windows are used (the detector's 'roll' /
// 'pitch' / 'yaw' classes — 'mixed' is excluded): coupling needs ONE
// cleanly commanded axis to attribute the response to.
//
// Per window, per axis: the peak signed gyro deviation from the pre-
// input baseline. The commanded axis's peak is the normalizer; a
// responding axis's peak over that normalizer is the window's coupling
// ratio. Ratios are sign-aligned by the commanded rotation direction
// before averaging across windows, so SYSTEMATIC coupling (mixer / CG)
// reinforces while random wobble averages toward zero.
//
// This is a measurement, not a verdict — thresholds are wing-regime
// first guesses pending corpus calibration (marked TODO). Diagnostic-
// only: coupling has no firmware `set` fix, so M-Coupling never emits
// CLI (see lib/recommenders/coupling.ts).
//
// Layer 2 — no Vue. This module does NOT call the detector itself; the
// caller passes the window list, keeping `coupling.ts` decoupled from
// how/when detection runs. Gyro is the only signal needed here — the
// rate setpoint was already consumed upstream by maneuverDetect.

import type { ManeuverWindow } from '@/lib/maneuverDetect';

type Axis = 0 | 1 | 2;
type Triple = [number, number, number];

/** Extra span past a maneuver window's end, in ms, over which the
 *  responding axes are still measured — cross-axis coupling lags the
 *  commanded input. TODO calibrate against the wing corpus. */
const RESPONSE_TAIL_MS = 150;

/** Lead-in span (ms) at the window start averaged to get each axis's
 *  pre-input baseline rate. The detector pads windows, so the start is
 *  steady-state flight just before the stick moved. */
const BASELINE_MS = 30;

/** Floor on the commanded axis's peak gyro response, deg/s. Below this
 *  the plane barely rotated (servo saturation, a ground log, a
 *  detector false-positive) and the ratio denominator would blow up —
 *  the window is skipped. TODO calibrate. */
const MIN_CMD_RESPONSE_DEG_S = 20;

/** Single-axis maneuver windows needed for one commanded axis before
 *  that row of the matrix is trustworthy. Below this the panel greys
 *  the row and the recommender stays silent for it. */
export const MIN_WINDOWS_FOR_COUPLING = 3;

// The significance threshold — |off-diagonal coupling| flagged as a
// fault — is style-dependent (a 3D plane couples axes naturally and
// tolerates more; a cruiser wants it tighter), so it moved to
// lib/tuneProfile.ts as `ProfileThresholds.couplingSignificance`, read
// via the Cruise/Sport/3D dial. Sport keeps the historical 0.15.

export interface CouplingOptions {
  /** Override `RESPONSE_TAIL_MS`. */
  responseTailMs?: number;
  /** Override `BASELINE_MS`. */
  baselineMs?: number;
  /** Override `MIN_CMD_RESPONSE_DEG_S`. */
  minCmdResponseDegS?: number;
}

const DEFAULTS: Required<CouplingOptions> = {
  responseTailMs: RESPONSE_TAIL_MS,
  baselineMs: BASELINE_MS,
  minCmdResponseDegS: MIN_CMD_RESPONSE_DEG_S,
};

export interface CouplingWindowMetric {
  /** The single-axis maneuver window this came from. */
  window: ManeuverWindow;
  /** Commanded axis (= `window.dominantAxis`). */
  commandedAxis: Axis;
  /** Signed coupling ratio onto each axis [roll, pitch, yaw], aligned
   *  by the commanded rotation direction. `ratios[commandedAxis]` is 1
   *  by construction. NaN for an axis with no gyro data in the window. */
  ratios: Triple;
}

export interface CouplingResult {
  /** 3x3 signed coupling matrix, `matrix[commanded][responding]`. The
   *  diagonal is 1 where the commanded axis has windows. Off-diagonal
   *  cells are the mean signed coupling ratio. NaN where the commanded
   *  axis has no single-axis windows OR the responding axis has no
   *  gyro data. The panel displays magnitude; the sign is direction. */
  matrix: [Triple, Triple, Triple];
  /** Single-axis maneuver windows counted per commanded axis. Compare
   *  against `MIN_WINDOWS_FOR_COUPLING` for row trustworthiness. */
  sampleCount: Triple;
  /** Per-window detail — feeds the panel's evidence affordance. */
  windows: CouplingWindowMetric[];
}

export interface AnalyzeCouplingArgs {
  /** Per-axis gyro rate [roll, pitch, yaw], deg/s (gyroADC). A missing
   *  axis passes `undefined`; its matrix column comes back NaN. */
  gyro: readonly (Float32Array | undefined)[];
  /** Seconds-since-log-start — the shared sample axis. */
  time: Float32Array;
  /** ALL maneuver windows from `detectManeuvers`; this function keeps
   *  the single-axis-dominant ones and ignores 'mixed'. */
  maneuvers: readonly ManeuverWindow[];
  options?: CouplingOptions;
}

const nan3 = (): Triple => [NaN, NaN, NaN];

/** Build the cross-axis coupling matrix from gyro + maneuver windows.
 *  See the module header for the method. */
export function analyzeCoupling(args: AnalyzeCouplingArgs): CouplingResult {
  const { gyro, time, maneuvers } = args;
  const opt = { ...DEFAULTS, ...args.options };

  const empty = (): CouplingResult => ({
    matrix: [nan3(), nan3(), nan3()],
    sampleCount: [0, 0, 0],
    windows: [],
  });

  const n = time.length;
  if (n < 3) return empty();
  const dt = (time[n - 1] - time[0]) / (n - 1);
  if (!(dt > 0)) return empty();

  const tailSamples = msToSamples(opt.responseTailMs, dt);
  const baselineSamples = Math.max(1, msToSamples(opt.baselineMs, dt));

  // sums[c][r] / cellCount[c][r] = matrix[c][r]. Per-cell counts so a
  // responding axis that is absent for some windows doesn't dilute.
  const sums: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const cellCount: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const sampleCount: Triple = [0, 0, 0];
  const windows: CouplingWindowMetric[] = [];

  for (const m of maneuvers) {
    if (m.type === 'mixed') continue; // need a single cleanly commanded axis
    const c = m.dominantAxis;
    if (!gyro[c]) continue; // commanded axis not logged

    const lo = Math.max(0, m.startIdx);
    const hi = Math.min(n, m.endIdx + tailSamples);
    if (hi - lo < 3) continue;

    // Peak signed gyro deviation from the pre-input baseline, per axis.
    const peakDev = nan3();
    for (let a = 0 as Axis; a <= 2; a = (a + 1) as Axis) {
      const g = gyro[a];
      if (!g) continue; // absent axis stays NaN
      peakDev[a] = peakSignedDeviation(g, lo, Math.min(hi, g.length), baselineSamples);
    }

    const cmdDev = peakDev[c];
    if (!Number.isFinite(cmdDev)) continue;
    const cmdAbs = Math.abs(cmdDev);
    if (cmdAbs < opt.minCmdResponseDegS) continue; // plane barely rotated
    const cmdSign = cmdDev >= 0 ? 1 : -1;

    const ratios = nan3();
    for (let a = 0 as Axis; a <= 2; a = (a + 1) as Axis) {
      if (!Number.isFinite(peakDev[a])) continue;
      // Multiply by cmdSign so a left snap and a right snap with the
      // same physical coupling produce the same-signed ratio.
      ratios[a] = (peakDev[a] / cmdAbs) * cmdSign;
    }

    for (let r = 0 as Axis; r <= 2; r = (r + 1) as Axis) {
      if (!Number.isFinite(ratios[r])) continue;
      sums[c][r] += ratios[r];
      cellCount[c][r] += 1;
    }
    sampleCount[c] += 1;
    windows.push({ window: m, commandedAxis: c, ratios });
  }

  const matrix: [Triple, Triple, Triple] = [nan3(), nan3(), nan3()];
  for (let c = 0 as Axis; c <= 2; c = (c + 1) as Axis) {
    for (let r = 0 as Axis; r <= 2; r = (r + 1) as Axis) {
      matrix[c][r] = cellCount[c][r] > 0 ? sums[c][r] / cellCount[c][r] : NaN;
    }
  }

  return { matrix, sampleCount, windows };
}

export interface WorstCoupling {
  commandedAxis: Axis;
  respondingAxis: Axis;
  /** Signed coupling value from the matrix. */
  value: number;
}

/** The off-diagonal matrix cell with the largest |coupling|, among
 *  finite cells. Returns `null` when no finite off-diagonal cell
 *  exists. Does NOT apply the sample-count gate — callers check
 *  `result.sampleCount` against `MIN_WINDOWS_FOR_COUPLING`. */
export function worstCoupling(result: CouplingResult): WorstCoupling | null {
  let best: WorstCoupling | null = null;
  for (let c = 0 as Axis; c <= 2; c = (c + 1) as Axis) {
    for (let r = 0 as Axis; r <= 2; r = (r + 1) as Axis) {
      if (c === r) continue;
      const v = result.matrix[c][r];
      if (!Number.isFinite(v)) continue;
      if (!best || Math.abs(v) > Math.abs(best.value)) {
        best = { commandedAxis: c, respondingAxis: r, value: v };
      }
    }
  }
  return best;
}

/** Peak signed deviation of `g` from its pre-input baseline over
 *  [lo, hi). Baseline = mean of the first `baselineSamples` of the
 *  range. "Signed deviation with the largest magnitude" — a coupled
 *  wobble can be either direction. NaN when the range is too short. */
function peakSignedDeviation(
  g: Float32Array,
  lo: number,
  hi: number,
  baselineSamples: number,
): number {
  if (hi - lo < 3) return NaN;
  const bn = Math.min(baselineSamples, hi - lo);
  let bsum = 0;
  for (let i = lo; i < lo + bn; i++) bsum += g[i];
  const base = bsum / bn;
  let peak = 0; // signed; replaced by any larger-magnitude deviation
  for (let i = lo; i < hi; i++) {
    const d = g[i] - base;
    if (Math.abs(d) > Math.abs(peak)) peak = d;
  }
  return peak;
}

function msToSamples(ms: number, dt: number): number {
  return Math.max(0, Math.round((ms / 1000) / dt));
}
