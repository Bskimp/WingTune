// Layer 2 — BF BASIC airspeed model: forward integrator + Nelder-Mead fit.
//
// Fits BF's `tpa_speed_type = BASIC` model parameters against logged GPS
// 3D speed so M3 can emit `set tpa_speed_basic_delay = X` / `tpa_speed_basic_gravity = Y`
// / `tpa_speed_max_voltage = Z` recommendations.
//
// PHYSICAL MODEL (matches `project-bf-basic-airspeed-model` memory):
//
//   a = TWR · t_eff · g  −  k · v²  −  g · sin(pitch)
//
// where
//   t_eff = throttle · (vbat / max_voltage),  clamped to [0, 1]
//   TWR   = (100 / gravity_pct)²         from the BF gravity-percent definition
//           (since v_term_dive / v_term_horiz = 1/√TWR, and BF defines
//           gravity_pct as that ratio × 100)
//   τ     = (delay_ms / 1000) / atanh(0.5)
//           (BF defines delay_ms as the time to reach v_term/2 at full
//            throttle horizontal; the closed-form ODE solution
//            v(t) = v_term · tanh(t/τ) gives τ from delay)
//   v_term_horiz = τ · TWR · g
//   k     = 1 / (v_term_horiz · τ)        drag-coeff over mass
//
// PITCH SIGN: BF logs pitch as nose-up positive. Climbing should
// decelerate airspeed → the gravity term is `−g · sin(pitch)`. If
// firmware verification later shows BF uses the opposite convention
// internally, flip the sign here; the rest of the model stays put.
//
// INTEGRATOR: explicit Euler. At BF's typical logged rate (~125 Hz)
// the model is stable for any realistic (delay, gravity, max_voltage)
// in the user-facing CLI ranges. Sample gaps (dt > 1s or non-finite)
// hold the previous airspeed rather than blowing up.
//
// OPTIMIZER: hand-rolled Nelder-Mead simplex. Three params, smooth
// loss surface, no gradients needed — NM converges in 50–150 iters on
// typical inputs. Avoids pulling in `ml-levenberg-marquardt` for a
// 3D problem that doesn't need it.

import { resampleToTimeAxis } from '@/lib/timeAlign';

const G = 9.81;
const ATANH_HALF = 0.5493061443340549;

export interface BasicAirspeedParams {
  /** `tpa_speed_basic_delay` — milliseconds. */
  delayMs: number;
  /** `tpa_speed_basic_gravity` — percent. */
  gravityPct: number;
  /** `tpa_speed_max_voltage` — V × 100 (BF CLI scaling). */
  maxVoltageX100: number;
}

export interface ModelInputs {
  /** Seconds since log start, monotonically increasing. */
  time: Float32Array;
  /** Normalized 0..1. Caller is responsible for mapping `rcCommand[3]`
   *  or motor-mean to this range. */
  throttle: Float32Array;
  /** Battery voltage in volts (real volts, not V × 100). */
  vbat: Float32Array;
  /** Pitch in radians, BF convention (nose-up positive). */
  pitch: Float32Array;
}

export interface AirspeedFitInputs extends ModelInputs {
  /** Ground-truth target: GPS 3D speed in m/s. */
  gpsSpeed: Float32Array;
}

export interface CoverageMetrics {
  speedMin: number;
  speedMax: number;
  /** Count of |Δthrottle| > 0.15 events per minute of log duration. */
  throttleTransitionsPerMin: number;
  /** −1 = all dive, +1 = all climb, 0 = balanced. Uses ±10° pitch thresholds. */
  diveClimbBalance: number;
  /** 8-bin histogram of sample count by speed (0..speedMax). */
  samplesPerSpeedBin: Int32Array;
  /** (vMax − vMin) / vMax over the fit window. */
  voltageSagFraction: number;
}

export interface AirspeedFitResult {
  params: BasicAirspeedParams;
  predicted: Float32Array;
  residuals: Float32Array;
  rSquared: number;
  rmsResidual: number;
  coverage: CoverageMetrics;
  iterations: number;
  converged: boolean;
}

interface InternalConstants {
  twr: number;
  k: number;
  vMaxVolts: number;
}

function deriveConstants(p: BasicAirspeedParams): InternalConstants {
  const gravity = Math.max(1, p.gravityPct);
  const twr = (100 / gravity) ** 2;
  const delaySec = Math.max(0.001, p.delayMs / 1000);
  const tau = delaySec / ATANH_HALF;
  const vTerm = tau * twr * G;
  const k = 1 / (vTerm * tau);
  const vMaxVolts = Math.max(0.01, p.maxVoltageX100 / 100);
  return { twr, k, vMaxVolts };
}

export function integrateBasicAirspeedModel(
  params: BasicAirspeedParams,
  inputs: ModelInputs,
): Float32Array {
  const { twr, k, vMaxVolts } = deriveConstants(params);
  const n = inputs.time.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  let v = 0;
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    const dt = inputs.time[i] - inputs.time[i - 1];
    if (!isFinite(dt) || dt <= 0 || dt > 1) {
      out[i] = v;
      continue;
    }
    let tEff = (inputs.throttle[i] * inputs.vbat[i]) / vMaxVolts;
    if (tEff < 0) tEff = 0;
    else if (tEff > 1) tEff = 1;
    const accel = twr * tEff * G - k * v * v - G * Math.sin(inputs.pitch[i]);
    v += accel * dt;
    if (v < 0) v = 0;
    out[i] = v;
  }
  return out;
}

function meanSquaredResidual(params: BasicAirspeedParams, inputs: AirspeedFitInputs): number {
  const pred = integrateBasicAirspeedModel(params, inputs);
  const target = inputs.gpsSpeed;
  let ssr = 0;
  let n = 0;
  for (let i = 0; i < pred.length; i++) {
    const m = target[i];
    if (!isFinite(m)) continue;
    const r = pred[i] - m;
    ssr += r * r;
    n++;
  }
  return n > 0 ? ssr / n : Infinity;
}

interface SimplexPoint {
  d: number;
  g: number;
  v: number;
  loss: number;
}

const NM_ALPHA = 1;
const NM_GAMMA = 2;
const NM_RHO = 0.5;
const NM_SIGMA = 0.5;

function clampParams(d: number, g: number, v: number): BasicAirspeedParams {
  return {
    delayMs: Math.max(50, Math.min(5000, d)),
    gravityPct: Math.max(5, Math.min(100, g)),
    maxVoltageX100: Math.max(420, Math.min(8400, v)),
  };
}

function evalPoint(d: number, g: number, v: number, inputs: AirspeedFitInputs): SimplexPoint {
  const p = clampParams(d, g, v);
  return { d: p.delayMs, g: p.gravityPct, v: p.maxVoltageX100, loss: meanSquaredResidual(p, inputs) };
}

export function fitBasicAirspeedModel(
  inputs: AirspeedFitInputs,
  options: { initialParams?: BasicAirspeedParams; maxIterations?: number } = {},
): AirspeedFitResult {
  const init = options.initialParams ?? { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 };
  const maxIter = options.maxIterations ?? 250;

  // Initial simplex: seed + 3 perturbations along each parameter axis.
  const simplex: SimplexPoint[] = [
    evalPoint(init.delayMs, init.gravityPct, init.maxVoltageX100, inputs),
    evalPoint(init.delayMs * 1.25, init.gravityPct, init.maxVoltageX100, inputs),
    evalPoint(init.delayMs, init.gravityPct * 1.25, init.maxVoltageX100, inputs),
    evalPoint(init.delayMs, init.gravityPct, init.maxVoltageX100 * 1.1, inputs),
  ];
  simplex.sort((a, b) => a.loss - b.loss);

  let iter = 0;
  let converged = false;
  for (; iter < maxIter; iter++) {
    const best = simplex[0];
    const worst = simplex[3];
    const secondWorst = simplex[2];

    // Simplex-size convergence: max coord spread, normalized per-axis.
    const spread = Math.max(
      Math.abs(simplex[3].d - simplex[0].d) / 100,
      Math.abs(simplex[3].g - simplex[0].g) / 10,
      Math.abs(simplex[3].v - simplex[0].v) / 100,
    );
    if (spread < 1e-3) { converged = true; break; }

    // Centroid of the 3 best points.
    const cd = (simplex[0].d + simplex[1].d + simplex[2].d) / 3;
    const cg = (simplex[0].g + simplex[1].g + simplex[2].g) / 3;
    const cv = (simplex[0].v + simplex[1].v + simplex[2].v) / 3;

    // Reflection through centroid.
    const rd = cd + NM_ALPHA * (cd - worst.d);
    const rg = cg + NM_ALPHA * (cg - worst.g);
    const rv = cv + NM_ALPHA * (cv - worst.v);
    const refl = evalPoint(rd, rg, rv, inputs);

    if (refl.loss >= best.loss && refl.loss < secondWorst.loss) {
      simplex[3] = refl;
    } else if (refl.loss < best.loss) {
      // Expand further along the reflection direction.
      const ed = cd + NM_GAMMA * (rd - cd);
      const eg = cg + NM_GAMMA * (rg - cg);
      const ev = cv + NM_GAMMA * (rv - cv);
      const exp = evalPoint(ed, eg, ev, inputs);
      simplex[3] = exp.loss < refl.loss ? exp : refl;
    } else {
      // Contract toward centroid.
      const xd = cd + NM_RHO * (worst.d - cd);
      const xg = cg + NM_RHO * (worst.g - cg);
      const xv = cv + NM_RHO * (worst.v - cv);
      const con = evalPoint(xd, xg, xv, inputs);
      if (con.loss < worst.loss) {
        simplex[3] = con;
      } else {
        // Shrink the whole simplex toward the best vertex.
        for (let i = 1; i < 4; i++) {
          const sd = best.d + NM_SIGMA * (simplex[i].d - best.d);
          const sg = best.g + NM_SIGMA * (simplex[i].g - best.g);
          const sv = best.v + NM_SIGMA * (simplex[i].v - best.v);
          simplex[i] = evalPoint(sd, sg, sv, inputs);
        }
      }
    }
    simplex.sort((a, b) => a.loss - b.loss);
  }

  const winner = clampParams(simplex[0].d, simplex[0].g, simplex[0].v);
  const predicted = integrateBasicAirspeedModel(winner, inputs);
  const residuals = new Float32Array(predicted.length);

  let meanGps = 0;
  let nGps = 0;
  for (let i = 0; i < predicted.length; i++) {
    residuals[i] = predicted[i] - inputs.gpsSpeed[i];
    if (isFinite(inputs.gpsSpeed[i])) { meanGps += inputs.gpsSpeed[i]; nGps++; }
  }
  if (nGps > 0) meanGps /= nGps;

  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < predicted.length; i++) {
    ssr += residuals[i] * residuals[i];
    const d = inputs.gpsSpeed[i] - meanGps;
    sst += d * d;
  }
  const rSquared = sst > 0 ? 1 - ssr / sst : 0;
  const rmsResidual = predicted.length > 0 ? Math.sqrt(ssr / predicted.length) : 0;

  return {
    params: winner,
    predicted,
    residuals,
    rSquared,
    rmsResidual,
    coverage: computeCoverage(inputs),
    iterations: iter,
    converged,
  };
}

// --- input construction from hydrated fields ----------------------------
//
// Shared between AirspeedPanel and the airspeedBasic recommender so they
// agree on field selection, unit scaling, GPS-window trimming, and
// pitch-fallback behavior. Single source of truth for the "BF-encoded
// hydrated fields → fit-ready AirspeedFitInputs" projection.

export interface BuildInputsArgs {
  /** Main-frame time axis (logStore.time). */
  time: Float32Array;
  /** GPS-frame time axis (logStore.gpsTimeSec). Must have ≥ 2 samples
   *  or the function returns null — no GPS lock window, no fit. */
  gpsTimeSec: Float32Array;
  /** Hydrated field map (logStore.fields). Reads `rcCommand[3]`,
   *  `vbatLatest`, `attitude[1]`, `gps:GPS_speed`. Throttle and vbat
   *  are required; attitude (pitch) is optional and falls back to
   *  level-flight zero when missing. */
  fields: ReadonlyMap<string, Float32Array>;
}

export interface BuiltInputs {
  inputs: AirspeedFitInputs;
  /** True when attitude[1] was missing and pitch fell back to zeros.
   *  Surface as a UI annotation — the gravity term is unconstrained
   *  in this case since dive/climb signal is absent. */
  pitchFromFallback: boolean;
}

export function buildAirspeedFitInputs(args: BuildInputsArgs): BuiltInputs | null {
  const throttle = args.fields.get('rcCommand[3]');
  const vbat = args.fields.get('vbatLatest');
  const pitchRaw = args.fields.get('attitude[1]');
  const gpsSpeedRaw = args.fields.get('gps:GPS_speed');

  if (!throttle || throttle.length === 0) return null;
  if (!vbat || vbat.length === 0) return null;
  if (!gpsSpeedRaw || gpsSpeedRaw.length === 0) return null;
  if (args.gpsTimeSec.length < 2) return null;
  if (args.time.length < 2) return null;

  const startT = args.gpsTimeSec[0];
  const endT = args.gpsTimeSec[args.gpsTimeSec.length - 1];
  let i0 = 0;
  while (i0 < args.time.length && args.time[i0] < startT) i0++;
  let i1 = args.time.length - 1;
  while (i1 > i0 && args.time[i1] > endT) i1--;
  const n = i1 - i0 + 1;
  if (n < 10) return null;

  const pitchFromFallback = !pitchRaw || pitchRaw.length === 0;

  const t = new Float32Array(n);
  const th = new Float32Array(n);
  const vb = new Float32Array(n);
  const pi = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const k = i0 + j;
    t[j] = args.time[k];
    // BF rcCommand[3] is PWM-like 1000..2000; clamp + normalise to 0..1.
    let thv = (throttle[k] - 1000) / 1000;
    if (thv < 0) thv = 0;
    else if (thv > 1) thv = 1;
    th[j] = thv;
    vb[j] = vbat[k];
    if (!pitchFromFallback) {
      // attitude[1] is deci-degrees (Signed); convert to radians.
      pi[j] = pitchRaw![k] * 0.1 * Math.PI / 180;
    }
  }
  const gpsSpeed = resampleToTimeAxis(args.gpsTimeSec, gpsSpeedRaw, t);
  return {
    inputs: { time: t, throttle: th, vbat: vb, pitch: pi, gpsSpeed },
    pitchFromFallback,
  };
}

export function computeCoverage(inputs: AirspeedFitInputs): CoverageMetrics {
  const n = inputs.time.length;
  const empty: CoverageMetrics = {
    speedMin: 0,
    speedMax: 0,
    throttleTransitionsPerMin: 0,
    diveClimbBalance: 0,
    samplesPerSpeedBin: new Int32Array(8),
    voltageSagFraction: 0,
  };
  if (n === 0) return empty;

  let sMin = Infinity;
  let sMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = inputs.gpsSpeed[i];
    if (!isFinite(s)) continue;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
  }
  if (!isFinite(sMin)) sMin = 0;
  if (!isFinite(sMax)) sMax = 0;

  let transitions = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(inputs.throttle[i] - inputs.throttle[i - 1]) > 0.15) transitions++;
  }
  const durationMin = (inputs.time[n - 1] - inputs.time[0]) / 60;
  const throttleTransitionsPerMin = durationMin > 0 ? transitions / durationMin : 0;

  const DEG10 = (10 * Math.PI) / 180;
  let dive = 0;
  let climb = 0;
  for (let i = 0; i < n; i++) {
    const p = inputs.pitch[i];
    if (p > DEG10) climb++;
    else if (p < -DEG10) dive++;
  }
  const tot = dive + climb;
  const diveClimbBalance = tot > 0 ? (dive - climb) / tot : 0;

  const samplesPerSpeedBin = new Int32Array(8);
  const span = Math.max(sMax, 1);
  for (let i = 0; i < n; i++) {
    const s = inputs.gpsSpeed[i];
    if (!isFinite(s)) continue;
    let b = Math.floor((s / span) * 8);
    if (b < 0) b = 0;
    else if (b > 7) b = 7;
    samplesPerSpeedBin[b]++;
  }

  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = inputs.vbat[i];
    if (!isFinite(v)) continue;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const voltageSagFraction = isFinite(vMax) && vMax > 0 ? (vMax - vMin) / vMax : 0;

  return {
    speedMin: sMin,
    speedMax: sMax,
    throttleTransitionsPerMin,
    diveClimbBalance,
    samplesPerSpeedBin,
    voltageSagFraction,
  };
}
