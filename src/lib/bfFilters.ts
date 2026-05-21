// Layer 2 — Betaflight gyro filter primitives, ported from firmware.
//
// The biquad (lowpass + notch) and PT1/PT2/PT3 lowpass filters that make
// up Betaflight's gyro filter chain. Load-bearing for M-FilterSim
// (Spectrum roadmap S1) — the per-stage filter simulator.
//
// Every formula is ported from docs/firmware-reference/bf-filter-chain-
// spec.md, which is grounded against betaflight/betaflight master @
// 144702cd57ab3c23ed73590e667f1d15c3ab1975. See that spec for the source
// citations (filter.c functions, the slaa447 biquad reference, the PTn
// cutoff-correction derivation).
//
// Direct Form 1 throughout (BF's biquadFilterApplyDF1) — DF1 is stable
// under per-sample coefficient changes, which the dynamic gyro stages
// (dyn LPF, dyn notch, RPM) need; the chain layer that drives those is
// built on these same primitives.
//
// The chain orchestration — RPM filter, dynamic LPF1, dynamic notch,
// plus simulateChain + validateChain — builds on the primitives below;
// it all lives in this module.
//
// Layer 2 — no Vue.

import { computeStft } from '@/lib/stft';

/** Butterworth Q — Betaflight's gyro biquad lowpass uses this fixed
 *  value (BF `BIQUAD_Q`). */
export const BIQUAD_Q = 1 / Math.SQRT2;

/** PT2 / PT3 cutoff-correction constants — `1 / sqrt(2^(1/n) - 1)` —
 *  shifting the per-stage cutoff up so the cascaded -3 dB point lands
 *  on the nominal cutoff (BF `CUTOFF_CORRECTION_PT2` / `_PT3`). */
export const PT2_CUTOFF_CORRECTION = 1.553773974;
export const PT3_CUTOFF_CORRECTION = 1.961459177;

/** Normalised biquad coefficients (already divided by a0). Transfer
 *  function `H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)`.
 *  `a1`/`a2` carry BF's sign convention — the DF1 apply step SUBTRACTS
 *  them. */
export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function biquadCoeffs(
  freqHz: number,
  dtSec: number,
  q: number,
  kind: 'lpf' | 'notch',
): BiquadCoeffs {
  const omega = 2 * Math.PI * freqHz * dtSec;
  const cs = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;

  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === 'lpf') {
    b1 = 1 - cs;
    b0 = b1 * 0.5;
    b2 = b0;
  } else {
    b0 = 1;
    b1 = -2 * cs;
    b2 = 1;
  }
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: (-2 * cs) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Biquad lowpass coefficients — 2nd-order Butterworth (Q = 1/sqrt2),
 *  BF's `FILTER_LPF`. */
export function biquadLowpassCoeffs(cutoffHz: number, dtSec: number): BiquadCoeffs {
  return biquadCoeffs(cutoffHz, dtSec, BIQUAD_Q, 'lpf');
}

/** Biquad notch coefficients — BF's `FILTER_NOTCH`. Larger `q` →
 *  narrower notch; the notch has an exact transmission zero at
 *  `centreHz`. */
export function biquadNotchCoeffs(
  centreHz: number,
  dtSec: number,
  q: number,
): BiquadCoeffs {
  return biquadCoeffs(centreHz, dtSec, q, 'notch');
}

/** Apply a fixed-coefficient biquad over a signal, Direct Form 1 (BF's
 *  `biquadFilterApplyDF1`). State (x1,x2,y1,y2) starts at zero, so the
 *  leading samples carry the filter's startup transient. */
export function applyBiquadDf1(signal: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(signal.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Convenience — biquad lowpass over a whole signal. */
export function applyBiquadLowpass(
  signal: Float32Array,
  cutoffHz: number,
  dtSec: number,
): Float32Array {
  return applyBiquadDf1(signal, biquadLowpassCoeffs(cutoffHz, dtSec));
}

/** Convenience — biquad notch over a whole signal. */
export function applyBiquadNotch(
  signal: Float32Array,
  centreHz: number,
  dtSec: number,
  q: number,
): Float32Array {
  return applyBiquadDf1(signal, biquadNotchCoeffs(centreHz, dtSec, q));
}

/** Per-stage gain `k` for an `order`-stage PTn lowpass.
 *  `k = omega / (omega + 1)`, with `omega` taken from the cutoff-
 *  corrected frequency so PT2 / PT3 are -3 dB at the *nominal* cutoff
 *  (BF `pt1/pt2/pt3FilterGain`). */
export function ptLowpassGain(
  cutoffHz: number,
  dtSec: number,
  order: 1 | 2 | 3,
): number {
  const correction =
    order === 1 ? 1 : order === 2 ? PT2_CUTOFF_CORRECTION : PT3_CUTOFF_CORRECTION;
  const omega = 2 * Math.PI * cutoffHz * correction * dtSec;
  return omega / (omega + 1);
}

/** Apply a PT1 / PT2 / PT3 lowpass over a signal — `order` cascaded
 *  one-pole stages sharing one gain (BF's `pt1/pt2/pt3FilterApply`). */
export function applyPtLowpass(
  signal: Float32Array,
  cutoffHz: number,
  dtSec: number,
  order: 1 | 2 | 3,
): Float32Array {
  const k = ptLowpassGain(cutoffHz, dtSec, order);
  const state = new Float32Array(order);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    let v = signal[i];
    for (let s = 0; s < order; s++) {
      state[s] += k * (v - state[s]);
      v = state[s];
    }
    out[i] = v;
  }
  return out;
}

// ── Chain orchestration ─────────────────────────────────────────────
//
// simulateChain replays Betaflight's gyro filter chain on the logged
// raw gyro: RPM filter → LPF1 → dynamic notch (spec section 3; the
// default-off static notches are omitted). validateChain compares the
// simulated full chain against the logged gyroADC — the honesty check
// on the one approximate stage, the dynamic-notch peak track.

/** Betaflight eRPM telemetry LSB unit (BF `ERPM_PER_LSB`). */
const ERPM_PER_LSB = 100;

/** Betaflight gyro filter configuration, in runtime units. The caller
 *  (the panel) builds this from the BBL header params — `*Q` values
 *  are the runtime Q (header value / 100), `rpmWeights` are 0..1
 *  (header / 100). */
export interface BfFilterParams {
  /** Gyro LPF1 — the (usually dynamic) gyro lowpass. */
  lpf1Type: 'PT1' | 'PT2' | 'PT3' | 'BIQUAD';
  /** Static LPF1 cutoff (Hz); used when the dynamic LPF1 is off.
   *  0 with no dynamic range = LPF1 disabled. */
  lpf1StaticHz: number;
  /** Dynamic LPF1 range; `lpf1DynMinHz > 0` enables the throttle-
   *  scheduled cutoff (spec section 8). */
  lpf1DynMinHz: number;
  lpf1DynMaxHz: number;
  /** Dynamic-LPF throttle-curve expo (BF `gyro_lpf1_dyn_expo`). */
  lpf1DynExpo: number;
  /** Dynamic notch. */
  dynNotchCount: number;
  dynNotchQ: number;
  dynNotchMinHz: number;
  dynNotchMaxHz: number;
  /** RPM filter. `rpmHarmonics` 0 = filter off. */
  rpmHarmonics: number;
  rpmQ: number;
  rpmMinHz: number;
  rpmFadeRangeHz: number;
  rpmLpfHz: number;
  /** Per-harmonic weights, 0..1. */
  rpmWeights: number[];
  motorPoles: number;
}

/** Apply a biquad whose centre frequency varies per sample (DF1).
 *  `weight` is an optional per-sample crossfade (the RPM notch fade). */
function applyDynamicBiquad(
  signal: Float32Array,
  freqHz: Float32Array,
  q: number,
  dtSec: number,
  kind: 'lpf' | 'notch',
  weight?: Float32Array,
): Float32Array {
  const n = signal.length;
  const out = new Float32Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const c = biquadCoeffs(freqHz[i], dtSec, q, kind);
    const x = signal[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    const w = weight ? weight[i] : 1;
    out[i] = w * y + (1 - w) * x;
  }
  return out;
}

/** Apply a PTn lowpass whose cutoff varies per sample. */
function applyDynamicPt(
  signal: Float32Array,
  cutoffHz: Float32Array,
  dtSec: number,
  order: 1 | 2 | 3,
): Float32Array {
  const n = signal.length;
  const state = new Float32Array(order);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = ptLowpassGain(cutoffHz[i], dtSec, order);
    let v = signal[i];
    for (let s = 0; s < order; s++) {
      state[s] += k * (v - state[s]);
      v = state[s];
    }
    out[i] = v;
  }
  return out;
}

/** RPM filter — biquad notches at each motor's rotation harmonics.
 *  Notch frequency per sample = `(harmonic) × motorFreqHz`, with
 *  `motorFreqHz` derived from the logged eRPM (spec sections 5/6) and
 *  PT1-smoothed at `rpmLpfHz`. Exact — no approximation. Returns the
 *  input unchanged when the RPM filter is inactive. */
export function applyRpmFilter(
  signal: Float32Array,
  params: BfFilterParams,
  eRPM: readonly Float32Array[],
  sampleRateHz: number,
): Float32Array {
  if (params.rpmHarmonics < 1 || eRPM.length === 0 || params.motorPoles < 2) {
    return signal;
  }
  const dt = 1 / sampleRateHz;
  const erpmToHz = ERPM_PER_LSB / 60 / (params.motorPoles / 2);
  const maxHz = 0.48 * sampleRateHz;
  let out = signal;
  for (const motorErpm of eRPM) {
    if (!motorErpm || motorErpm.length < signal.length) continue;
    // eRPM → motor Hz, then PT1-smoothed (firmware smooths post-telemetry).
    const rawFreq = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) rawFreq[i] = motorErpm[i] * erpmToHz;
    const motorFreq = applyPtLowpass(rawFreq, params.rpmLpfHz, dt, 1);
    for (let h = 0; h < params.rpmHarmonics; h++) {
      const baseWeight = params.rpmWeights[h] ?? 0;
      if (baseWeight <= 0) continue;
      const freq = new Float32Array(signal.length);
      const weight = new Float32Array(signal.length);
      for (let i = 0; i < signal.length; i++) {
        const f = Math.min(Math.max((h + 1) * motorFreq[i], params.rpmMinHz), maxHz);
        freq[i] = f;
        let w = baseWeight;
        const margin = f - params.rpmMinHz;
        if (params.rpmFadeRangeHz > 0 && margin < params.rpmFadeRangeHz) {
          w *= margin / params.rpmFadeRangeHz;
        }
        weight[i] = Math.min(1, Math.max(0, w));
      }
      out = applyDynamicBiquad(out, freq, params.rpmQ, dt, 'notch', weight);
    }
  }
  return out;
}

/** Gyro LPF1 — a static cutoff, or a throttle-scheduled dynamic cutoff
 *  (spec section 8) when `lpf1DynMinHz > 0` and `throttle` is supplied.
 *  PT1/PT2/PT3 or biquad per `lpf1Type`. */
export function applyGyroLpf1(
  signal: Float32Array,
  params: BfFilterParams,
  throttle: Float32Array | null,
  sampleRateHz: number,
): Float32Array {
  const dt = 1 / sampleRateHz;
  const order =
    params.lpf1Type === 'PT1' ? 1
      : params.lpf1Type === 'PT2' ? 2
        : params.lpf1Type === 'PT3' ? 3
          : 0; // 0 = biquad
  const dynamic = params.lpf1DynMinHz > 0 && throttle != null;

  if (!dynamic) {
    const fc = params.lpf1StaticHz;
    if (fc <= 0) return signal; // LPF1 off
    return order === 0
      ? applyBiquadLowpass(signal, fc, dt)
      : applyPtLowpass(signal, fc, dt, order as 1 | 2 | 3);
  }

  // Per-sample cutoff from throttle.
  const cutoff = new Float32Array(signal.length);
  const expof = params.lpf1DynExpo / 10;
  const span = params.lpf1DynMaxHz - params.lpf1DynMinHz;
  for (let i = 0; i < signal.length; i++) {
    const t = Math.min(1, Math.max(0, throttle![i]));
    if (params.lpf1DynExpo > 0) {
      const curve = t * (1 - t) * expof + t;
      cutoff[i] = span * curve + params.lpf1DynMinHz;
    } else {
      const dynThrottle = t * (1 - (t * t) / 3) * 1.5;
      cutoff[i] = Math.max(dynThrottle * params.lpf1DynMaxHz, params.lpf1DynMinHz);
    }
  }
  return order === 0
    ? applyDynamicBiquad(signal, cutoff, BIQUAD_Q, dt, 'lpf')
    : applyDynamicPt(signal, cutoff, dt, order as 1 | 2 | 3);
}

/** Re-derive the dynamic notch's per-slot centre-frequency tracks by
 *  peak-picking an STFT of the signal at the dyn-notch input — the
 *  approximation of BF's SDFT (which BF runs at the same point in the
 *  chain, post-LPF1). Each of the `count` slots gets a per-sample
 *  frequency; a slot with no peak parks at `dynNotchMaxHz` (a notch at
 *  the band edge is near-inert). This is the one approximate stage of
 *  the chain — validateChain is the check on it. */
export function trackDynNotchPeaks(
  signal: Float32Array,
  params: BfFilterParams,
  sampleRateHz: number,
): Float32Array[] {
  const count = Math.max(0, Math.min(Math.floor(params.dynNotchCount), 7));
  if (count === 0) return [];
  const windowSize = 256;
  const hop = windowSize >> 2;
  const n = signal.length;
  const tracks: Float32Array[] = [];
  for (let s = 0; s < count; s++) {
    tracks.push(new Float32Array(n).fill(params.dynNotchMaxHz));
  }
  if (n < windowSize) return tracks;

  const stft = computeStft(signal, sampleRateHz, windowSize, hop);
  if (stft.columns.length === 0) return tracks;
  const loBin = Math.max(1, Math.round(params.dynNotchMinHz / stft.binHz));
  const hiBin = Math.min(
    stft.frequencies.length - 2,
    Math.round(params.dynNotchMaxHz / stft.binHz),
  );
  if (hiBin <= loBin) return tracks;

  // Per column: the `count` strongest in-band spectral peaks, then
  // sorted ascending by frequency so each notch slot keeps a stable lane.
  const perColumn: number[][] = stft.columns.map((col) => {
    const peaks: { f: number; p: number }[] = [];
    for (let b = loBin; b <= hiBin; b++) {
      if (col[b] > col[b - 1] && col[b] >= col[b + 1]) {
        peaks.push({ f: b * stft.binHz, p: col[b] });
      }
    }
    peaks.sort((a, b) => b.p - a.p);
    return peaks.slice(0, count).map((p) => p.f).sort((a, b) => a - b);
  });

  const numCols = perColumn.length;
  const half = (windowSize - 1) / 2;
  for (let i = 0; i < n; i++) {
    let col = Math.round((i - half) / hop);
    if (col < 0) col = 0;
    else if (col >= numCols) col = numCols - 1;
    const fs = perColumn[col];
    for (let s = 0; s < fs.length; s++) tracks[s][i] = fs[s];
  }
  return tracks;
}

/** Dynamic notch — `count` biquad notches following the tracked
 *  spectral peaks of the input signal. */
export function applyDynNotch(
  signal: Float32Array,
  params: BfFilterParams,
  sampleRateHz: number,
): Float32Array {
  const tracks = trackDynNotchPeaks(signal, params, sampleRateHz);
  if (tracks.length === 0) return signal;
  const dt = 1 / sampleRateHz;
  let out = signal;
  for (const track of tracks) {
    out = applyDynamicBiquad(out, track, params.dynNotchQ, dt, 'notch');
  }
  return out;
}

/** Which chain stages to apply. An omitted stage defaults to on. */
export interface ChainStages {
  rpm?: boolean;
  lpf1?: boolean;
  dynNotch?: boolean;
}

export interface SimulateChainArgs {
  /** Raw (pre-filter) gyro for one axis — the logged `gyroUnfilt[axis]`. */
  rawGyro: Float32Array;
  sampleRateHz: number;
  params: BfFilterParams;
  /** Per-motor eRPM (the logged `eRPM[m]` field, LSB units). Omit / []
   *  if the log has no DSHOT telemetry — the RPM stage is then skipped. */
  eRPM?: readonly Float32Array[];
  /** Per-sample throttle 0..1 (`setpoint[3] / 1000`). Omit → LPF1 uses
   *  its static cutoff. */
  throttle?: Float32Array | null;
  /** Stage toggles; all stages on when omitted. */
  stages?: ChainStages;
}

/** Replay the Betaflight gyro filter chain on raw gyro. Applies the
 *  enabled stages in firmware order — RPM → LPF1 → dynamic notch — and
 *  returns the filtered signal. */
export function simulateChain(args: SimulateChainArgs): Float32Array {
  const { rawGyro, sampleRateHz, params } = args;
  const stages: Required<ChainStages> = {
    rpm: true,
    lpf1: true,
    dynNotch: true,
    ...args.stages,
  };
  let s = rawGyro;
  if (stages.rpm && args.eRPM && args.eRPM.length > 0) {
    s = applyRpmFilter(s, params, args.eRPM, sampleRateHz);
  }
  if (stages.lpf1) {
    s = applyGyroLpf1(s, params, args.throttle ?? null, sampleRateHz);
  }
  if (stages.dynNotch && params.dynNotchCount > 0) {
    s = applyDynNotch(s, params, sampleRateHz);
  }
  return s;
}

export interface ChainValidation {
  /** [0,1] — 1 = the simulated full chain reproduces the logged
   *  gyroADC, so the per-stage breakdown is trustworthy; low = the sim
   *  diverges (most likely the dyn-notch peak track) and the per-stage
   *  view should be flagged unreliable. */
  simFidelity: number;
  /** Normalised RMS residual — `RMS(sim - logged) / RMS(logged)`. */
  nrmse: number;
  /** Samples compared (after the warm-up skip). */
  samplesCompared: number;
}

/** Validate a simulated full chain against the logged gyroADC — the
 *  honesty check. `warmupSamples` skips the filter startup transient
 *  (the sim's filter state starts at zero; the logged signal's did
 *  not). */
export function validateChain(
  simulated: Float32Array,
  loggedGyroADC: Float32Array,
  warmupSamples = 0,
): ChainValidation {
  const n = Math.min(simulated.length, loggedGyroADC.length);
  const lo = Math.min(Math.max(0, Math.floor(warmupSamples)), n);
  let sumSqErr = 0;
  let sumSqRef = 0;
  for (let i = lo; i < n; i++) {
    const e = simulated[i] - loggedGyroADC[i];
    sumSqErr += e * e;
    sumSqRef += loggedGyroADC[i] * loggedGyroADC[i];
  }
  const count = n - lo;
  if (count <= 0 || sumSqRef <= 0) {
    return { simFidelity: 0, nrmse: Infinity, samplesCompared: Math.max(0, count) };
  }
  const nrmse = Math.sqrt(sumSqErr / sumSqRef);
  return { simFidelity: Math.max(0, 1 - nrmse), nrmse, samplesCompared: count };
}

/** Build `BfFilterParams` from a BBL header param map. Each field is
 *  looked up by its BF header key; a missing key falls back to the BF
 *  default (spec section 7) so the simulation still runs on a partial
 *  header. Q values and weights are converted to runtime units.
 *
 *  Header key names are BF's CLI names; the dyn-LPF range and RPM
 *  weights are logged as comma-joined values. Key strings verified
 *  2026-05-20 against a real BF wing-branch log. A missing or renamed
 *  key just defaults that field, which validateChain's simFidelity
 *  surfaces. */
export function parseFilterParams(headerParams: Record<string, string>): BfFilterParams {
  const num = (key: string, def: number): number => {
    const v = headerParams[key];
    if (v == null) return def;
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : def;
  };
  // Header values like "250,500" (dyn-LPF range) or "100,100,100"
  // (RPM weights) — pick the nth comma-separated field.
  const nth = (key: string, idx: number, def: number): number => {
    const v = headerParams[key];
    if (v == null) return def;
    const part = v.split(',')[idx];
    if (part == null) return def;
    const n = Number.parseFloat(part.trim());
    return Number.isFinite(n) ? n : def;
  };
  // Filter type is logged either as a name or a lookup index
  // (FILTER_PT1 = 0, BIQUAD = 1, PT2 = 2, PT3 = 3).
  const lpf1Type = ((): BfFilterParams['lpf1Type'] => {
    const t = (headerParams['gyro_lpf1_type'] ?? '').trim().toUpperCase();
    if (t === 'PT2' || t === '2') return 'PT2';
    if (t === 'PT3' || t === '3') return 'PT3';
    if (t === 'BIQUAD' || t === '1') return 'BIQUAD';
    return 'PT1';
  })();

  return {
    lpf1Type,
    lpf1StaticHz: num('gyro_lpf1_static_hz', 0),
    lpf1DynMinHz: nth('gyro_lpf1_dyn_hz', 0, 0),
    lpf1DynMaxHz: nth('gyro_lpf1_dyn_hz', 1, 0),
    lpf1DynExpo: num('gyro_lpf1_dyn_expo', 5),
    dynNotchCount: num('dyn_notch_count', 0),
    dynNotchQ: num('dyn_notch_q', 300) / 100,
    dynNotchMinHz: num('dyn_notch_min_hz', 100),
    dynNotchMaxHz: num('dyn_notch_max_hz', 600),
    rpmHarmonics: num('rpm_filter_harmonics', 0),
    rpmQ: num('rpm_filter_q', 500) / 100,
    rpmMinHz: num('rpm_filter_min_hz', 100),
    rpmFadeRangeHz: num('rpm_filter_fade_range_hz', 50),
    rpmLpfHz: num('rpm_filter_lpf_hz', 150),
    rpmWeights: [
      nth('rpm_filter_weights', 0, 100) / 100,
      nth('rpm_filter_weights', 1, 100) / 100,
      nth('rpm_filter_weights', 2, 100) / 100,
    ],
    motorPoles: num('motor_poles', 14),
  };
}
