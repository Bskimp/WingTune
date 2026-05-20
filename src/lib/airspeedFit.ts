// Layer 2 — BF BASIC airspeed model: forward integrator + Nelder-Mead fit.
//
// Fits BF's `tpa_speed_type = BASIC` model parameters against logged GPS
// 3D speed so M3 can emit `set tpa_speed_basic_delay = X` /
// `tpa_speed_basic_gravity = Y` recommendations.
//
// MAX VOLTAGE IS PINNED, NOT FITTED. `tpa_speed_max_voltage` is a known
// physical fact (the battery's full-charge voltage) and it is degenerate
// with `gravity` in the thrust term — `thrust ∝ TWR / maxVoltage`, so an
// unconstrained 3-param fit lets the optimiser trade the two off along a
// flat valley and land both on unphysical values (observed: gravity
// pinned at its 100 % clamp, maxVoltage drifting to ~28 V on a 3S log).
// So it is read from the log's saved BF config (`tpa_speed_max_voltage`
// header param) and fed in as a fixed `ModelInputs.maxVoltageX100`; only
// `delay` + `gravity` are fitted. Fallback when the header lacks the
// key: peak observed `vbatLatest` (a freshly-charged pack ≈ its max V).
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
// PITCH SIGN: BF logs `attitude[1]` with NEGATIVE for nose-up and
// POSITIVE for nose-down (Brian-confirmed BF convention; verified
// 2026-05-17). The integrator works in a nose-up-positive convention
// so it can write `−g · sin(pitch)` and have climb → deceleration.
// `buildAirspeedFitInputs` negates the raw BF value at the boundary
// so the integrator's sign convention stays clean.
//
// INTEGRATOR: explicit Euler. At BF's typical logged rate (~125 Hz)
// the model is stable for any realistic (delay, gravity, max_voltage)
// in the user-facing CLI ranges. Sample gaps (dt > 1s or non-finite)
// hold the previous airspeed rather than blowing up.
//
// OPTIMIZER: generic Nelder-Mead from `lib/nelderMead.ts`. Two
// params (delay, gravity), smooth loss surface, no gradients needed —
// NM converges in 50–150 iters on typical inputs. The cost-function
// wrapper clamps the raw simplex vector to legal CLI ranges before
// evaluating, so the optimiser can step anywhere without emitting NaN.
// Initial-step sizes are passed per-axis (250 ms / 12 %) to reflect
// the differing param scales. Avoids pulling in
// `ml-levenberg-marquardt` for a 2D problem that doesn't need it.

import { fitNelderMead } from '@/lib/nelderMead';
import { resampleToTimeAxis } from '@/lib/timeAlign';
import { resolveSignal } from '@/lib/signalRegistry';
import type { CapabilityReport } from '@/lib/wasmBridge';

const G = 9.81;
const ATANH_HALF = 0.5493061443340549;

/** The two genuinely fittable parameters. `tpa_speed_max_voltage` is
 *  deliberately NOT here — it is a fixed model input, see file header. */
export interface BasicAirspeedParams {
  /** `tpa_speed_basic_delay` — milliseconds. */
  delayMs: number;
  /** `tpa_speed_basic_gravity` — percent. */
  gravityPct: number;
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
  /** `tpa_speed_max_voltage` — V × 100 (BF CLI scaling). FIXED, not
   *  fitted: resolved by `buildAirspeedFitInputs` from the log header. */
  maxVoltageX100: number;
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
}

function deriveConstants(p: BasicAirspeedParams): InternalConstants {
  const gravity = Math.max(1, p.gravityPct);
  const twr = (100 / gravity) ** 2;
  const delaySec = Math.max(0.001, p.delayMs / 1000);
  const tau = delaySec / ATANH_HALF;
  const vTerm = tau * twr * G;
  const k = 1 / (vTerm * tau);
  return { twr, k };
}

export function integrateBasicAirspeedModel(
  params: BasicAirspeedParams,
  inputs: ModelInputs,
): Float32Array {
  const { twr, k } = deriveConstants(params);
  const vMaxVolts = Math.max(0.01, inputs.maxVoltageX100 / 100);
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

function clampParams(d: number, g: number): BasicAirspeedParams {
  return {
    delayMs: Math.max(50, Math.min(5000, d)),
    gravityPct: Math.max(5, Math.min(100, g)),
  };
}

export function fitBasicAirspeedModel(
  inputs: AirspeedFitInputs,
  options: { initialParams?: BasicAirspeedParams; maxIterations?: number } = {},
): AirspeedFitResult {
  const init = options.initialParams ?? { delayMs: 1000, gravityPct: 50 };
  const maxIter = options.maxIterations ?? 250;

  // Cost wrapper for the generic Nelder-Mead optimiser. Clamps the
  // raw vector to legal CLI ranges before evaluating — keeps the
  // optimiser free to step anywhere without producing NaN-prone params.
  // `maxVoltageX100` rides on `inputs` (fixed), so the simplex is 2-D.
  const cost = (vec: number[]): number => {
    const p = clampParams(vec[0], vec[1]);
    return meanSquaredResidual(p, inputs);
  };

  // Per-axis ABSOLUTE initial step sizes (ms / %). Absolute keeps the
  // simplex sized sensibly regardless of seed magnitude.
  const fit = fitNelderMead(
    [init.delayMs, init.gravityPct],
    cost,
    { maxIter, initialStep: [250, 12] },
  );

  const winner = clampParams(fit.x[0], fit.x[1]);
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
    iterations: fit.iterations,
    converged: fit.converged,
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
   *  `vbatLatest`, `gps:GPS_speed`, plus the pitch field resolved via
   *  the signal registry (see `capability`). Throttle and vbat are
   *  required; pitch is optional and falls back to level-flight zero
   *  when missing. */
  fields: ReadonlyMap<string, Float32Array>;
  /** BBL header params (`scanReport.header_params`). When present,
   *  `tpa_speed_max_voltage` is read from here to pin the fixed
   *  max-voltage model input. Absent → peak-vbat fallback. */
  headerParams?: Record<string, string>;
  /** Scan capability report (`scanReport.capability`). When present,
   *  the pitch field is resolved through the signal registry
   *  (`attitude_pitch`) so USE_WING `wingTpaPitch` / DEBUG_TPA ch2 are
   *  picked up, not just the raw `attitude[1]` field. Absent → the
   *  raw `attitude[1]` field is used directly. */
  capability?: CapabilityReport;
}

export interface BuiltInputs {
  inputs: AirspeedFitInputs;
  /** True when attitude[1] was missing and pitch fell back to zeros.
   *  Surface as a UI annotation — the gravity term is unconstrained
   *  in this case since dive/climb signal is absent. */
  pitchFromFallback: boolean;
  /** Where the fixed `inputs.maxVoltageX100` came from: the log's
   *  saved `tpa_speed_max_voltage` CLI value, or a peak-vbat estimate
   *  when the header lacked the key. Surface as a UI annotation. */
  maxVoltageSource: 'header' | 'vbat-fallback';
}

/** BF CLI valid range for `tpa_speed_max_voltage` (V × 100): a 1S
 *  pack (~4.2 V) up to a 20S pack (~84 V). */
const MAX_VOLTAGE_X100_MIN = 420;
const MAX_VOLTAGE_X100_MAX = 8400;

/** Resolve the FIXED max-voltage model input. Prefers the log's saved
 *  `tpa_speed_max_voltage` CLI value (exact — it is the user's real
 *  battery config); falls back to peak observed vbat × 100 (a freshly-
 *  charged pack rests near its max voltage). Never fitted — see the
 *  file header for why fitting it produces unphysical params. */
export function resolveMaxVoltageX100(
  headerParams: Record<string, string> | undefined,
  vbat: Float32Array,
): { maxVoltageX100: number; maxVoltageSource: 'header' | 'vbat-fallback' } {
  const raw = headerParams?.['tpa_speed_max_voltage'];
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (
      Number.isFinite(parsed) &&
      parsed >= MAX_VOLTAGE_X100_MIN &&
      parsed <= MAX_VOLTAGE_X100_MAX
    ) {
      return { maxVoltageX100: parsed, maxVoltageSource: 'header' };
    }
  }
  let vMax = 0;
  for (let i = 0; i < vbat.length; i++) {
    if (isFinite(vbat[i]) && vbat[i] > vMax) vMax = vbat[i];
  }
  const fallback = Math.max(
    MAX_VOLTAGE_X100_MIN,
    Math.min(MAX_VOLTAGE_X100_MAX, Math.round(vMax * 100)),
  );
  return { maxVoltageX100: fallback, maxVoltageSource: 'vbat-fallback' };
}

/** Resolve which hydrated field carries pitch attitude for the airspeed
 *  model. Routes through the signal registry's `attitude_pitch` signal
 *  so USE_WING `wingTpaPitch` and DEBUG_TPA ch2 are found — not only
 *  the raw `attitude[1]` field. Returns `'attitude[1]'` as the default
 *  when no capability report is available (e.g. unit-test callers) or
 *  the registry resolves nothing. All candidates share BF's decidegree
 *  / negative-nose-up convention, so the caller's unit conversion is
 *  identical regardless of which field is returned. */
export function resolveAirspeedPitchField(
  capability: CapabilityReport | undefined,
): string {
  if (capability) {
    const r = resolveSignal('attitude_pitch', null, capability);
    if (r.state === 'resolved') {
      return r.source.kind === 'debug'
        ? `debug[${r.source.channel}]`
        : r.source.field;
    }
  }
  return 'attitude[1]';
}

export function buildAirspeedFitInputs(args: BuildInputsArgs): BuiltInputs | null {
  const throttle = args.fields.get('rcCommand[3]');
  const vbat = args.fields.get('vbatLatest');
  const pitchRaw = args.fields.get(resolveAirspeedPitchField(args.capability));
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
      // The resolved pitch field (attitude[1] / wingTpaPitch /
      // DEBUG_TPA ch2) is deci-degrees, BF sign convention NEGATIVE
      // for nose-up / POSITIVE for nose-down. Integrator expects
      // nose-up-positive so we negate at this boundary (single source
      // of truth — the integrator never sees raw BF pitch).
      pi[j] = -pitchRaw![k] * 0.1 * Math.PI / 180;
    }
  }
  const gpsSpeed = resampleToTimeAxis(args.gpsTimeSec, gpsSpeedRaw, t);

  // Pin max voltage from the log header (it is a known battery fact,
  // not a fittable parameter — see file header).
  const { maxVoltageX100, maxVoltageSource } = resolveMaxVoltageX100(
    args.headerParams,
    vb,
  );

  return {
    inputs: { time: t, throttle: th, vbat: vb, pitch: pi, gpsSpeed, maxVoltageX100 },
    pitchFromFallback,
    maxVoltageSource,
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
