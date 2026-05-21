// Layer 2 — per-servo "hunt" detection.
//
// M-Servo MVP (lib/inputChain) measures bulk servo→gyro lag. It cannot
// see a servo oscillating on its OWN — high-frequency PWM activity the
// pilot never asked for. That is what this module scores.
//
// "Hunt" here = high-frequency content in a servo's PWM command that
// does not track the pilot's rate setpoint. A clean servo follows the
// commanded setpoint and is otherwise smooth. A hunting servo carries
// fast PWM wiggle on top — the FC's loop chasing gyro noise, a limit
// cycle, or mechanical slop feeding the loop. Whatever the root cause,
// it is servo effort spent on something the pilot did not command:
// heat, wear, slop.
//
// Algorithm, per servo channel:
//   1. high-pass the PWM (one-pole, `hfCutoffHz`) → the HF band,
//   2. `hfRmsPwm` = RMS of that band, in PWM microseconds (amplitude,
//      not variance — it reads directly as "µs of HF wiggle"),
//   3. high-pass the pilot's rate SETPOINT for the servo's axis the
//      same way, take the peak normalized cross-correlation `r` with
//      the HF servo signal (small lag search covers the PID delay),
//   4. `huntScore = hfRmsPwm · (1 − r)` — the HF servo motion NOT
//      explained by the pilot command.
//
// Why setpoint and NOT gyro as the command reference: the servo PWM
// is the FC's OUTPUT — a deterministic function of setpoint + gyro.
// Correlating against gyro would explain away almost all HF content
// (the loop chasing gyro noise is exactly what we want to FLAG), so
// the score would collapse toward 0 and tell us nothing. Setpoint is
// what the PILOT asked for; HF servo motion that does not track it is,
// from the pilot's seat, uncommanded — whether the FC or the linkage
// generated it. The 20 Hz default cutoff sits well above any real
// wing pilot input (CLAUDE.md SCOPE box: wing closed-loop response is
// 200-500 ms), so legitimate gust corrections are not counted.
//
// Diagnostic only — no recommender, no CLI. A hunting servo is a
// mechanical / filtering investigation, not a firmware `set`.

import type { AxisCorrelations } from '@/lib/servoClassifier';
import type { Axis } from '@/lib/inputChain';
import { estimateSampleRate } from '@/lib/spectrum';

export type HuntSeverity = 'ok' | 'watch' | 'hunt' | 'unknown';

export interface ServoHuntChannel {
  /** Field name of the servo / motor PWM channel. */
  fieldName: string;
  /** Dominant control axis the channel was classified to. */
  axis: Axis;
  /** RMS of the high-frequency band of the servo PWM, in PWM
   *  microseconds. Always measurable (no command reference needed). */
  hfRmsPwm: number;
  /** Peak normalized cross-correlation (0..1) between the HF servo
   *  signal and the HF rate setpoint of `axis`. NaN when the axis has
   *  no setpoint reference or the log is too short. */
  commandCorrelation: number;
  /** `hfRmsPwm · (1 − commandCorrelation)` — HF servo amplitude not
   *  explained by the pilot command, in PWM microseconds. NaN when
   *  `commandCorrelation` is NaN. */
  huntScore: number;
  /** Threshold verdict. 'unknown' when there is no command reference
   *  or the log is too short to score. */
  severity: HuntSeverity;
  /** Whether a setpoint reference was available for the correlation. */
  hasReference: boolean;
}

export interface ServoHuntResult {
  channels: ServoHuntChannel[];
  sampleRateHz: number;
  /** HF-band cutoff actually used (Hz) — echoed for the UI header. */
  hfCutoffHz: number;
}

export interface ServoHuntInputs {
  /** Log time axis (seconds) — used only for sample-rate estimation. */
  time: Float32Array;
  /** Servo / motor PWM channels keyed by field name. */
  servos: Map<string, Float32Array>;
  /** Per-channel classification from `correlateServosToAxes`. Channels
   *  with `dominantAxis === null` are skipped (unclassified). The
   *  caller is expected to have already dropped weakly-correlated
   *  channels (throttle PWM etc.). */
  axisCorrelations: AxisCorrelations[];
  /** Per-axis rate setpoint, indexed [roll, pitch, yaw]. `undefined`
   *  for a missing axis. */
  setpoint: (Float32Array | undefined)[];
}

export interface ServoHuntOptions {
  /** High-pass cutoff isolating the "hunt" band (Hz). Above this no
   *  real wing pilot input lives. Wing-regime first guess —
   *  TODO calibrate against the corpus. */
  hfCutoffHz?: number;
  /** Lag search half-width (ms) for the servo↔setpoint correlation —
   *  covers the PID + mixer delay between command and PWM. */
  maxLagMs?: number;
  /** huntScore at/above which a channel is flagged 'watch' (PWM µs).
   *  TODO calibrate. */
  watchThreshold?: number;
  /** huntScore at/above which a channel is flagged 'hunt' (PWM µs).
   *  TODO calibrate. */
  huntThreshold?: number;
}

const DEFAULT_OPTIONS: Required<ServoHuntOptions> = {
  hfCutoffHz:     20,
  maxLagMs:       30,
  watchThreshold: 3,
  huntThreshold:  8,
};

/** Minimum samples to attempt a score — below this the correlation is
 *  meaningless and the channel is reported 'unknown'. */
const MIN_SAMPLES = 256;

/** One-pole high-pass stage: hf = x − lowpass(x). `alpha` is the
 *  low-pass smoothing factor 1 − exp(−2π·fc/fs); the result has
 *  near-zero mean (the DC trim offset lands entirely in the low-pass). */
function highPassStage(x: Float32Array, alpha: number): Float32Array {
  const n = x.length;
  const hf = new Float32Array(n);
  if (n === 0) return hf;
  let lp = x[0];
  for (let i = 0; i < n; i++) {
    lp += alpha * (x[i] - lp);
    hf[i] = x[i] - lp;
  }
  return hf;
}

/** Two-pole (12 dB/oct) high-pass — two cascaded one-pole stages. A
 *  single pole rolls off only 6 dB/oct, which leaks a meaningful slice
 *  of a big slow maneuver (a sub-1 Hz turn at hundreds of deg/s) into
 *  the hunt band and inflates the score. The second pole pushes that
 *  leak below noise — at 1 Hz with a 20 Hz cutoff it is ~0.0025×. */
function highPass(x: Float32Array, alpha: number): Float32Array {
  return highPassStage(highPassStage(x, alpha), alpha);
}

function rms(x: Float32Array): number {
  if (x.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

function meanOf(x: Float32Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i];
  return s / n;
}

/** Peak |normalized cross-correlation| between `a` and `b` over integer
 *  lags in [−maxLag, +maxLag]. Both signals are mean-subtracted; the
 *  result is in [0, 1] (1 = identical shape at some lag). Returns 0
 *  when either signal has no variance. */
function normalizedXCorrPeak(a: Float32Array, b: Float32Array, maxLag: number): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const am = meanOf(a, n);
  const bm = meanOf(b, n);
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - am;
    const db = b[i] - bm;
    normA += da * da;
    normB += db * db;
  }
  if (normA < 1e-12 || normB < 1e-12) return 0;
  const denom = Math.sqrt(normA * normB);

  let best = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const lo = Math.max(0, -lag);
    const hi = Math.min(n, n - lag);
    let dot = 0;
    for (let i = lo; i < hi; i++) {
      dot += (a[i] - am) * (b[i + lag] - bm);
    }
    const r = dot / denom;
    if (Math.abs(r) > Math.abs(best)) best = r;
  }
  return Math.min(1, Math.abs(best));
}

function classify(score: number, opts: Required<ServoHuntOptions>): HuntSeverity {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= opts.huntThreshold) return 'hunt';
  if (score >= opts.watchThreshold) return 'watch';
  return 'ok';
}

/** Score every classified servo channel for uncommanded high-frequency
 *  motion. See the module header for the algorithm + rationale. */
export function computeServoHunt(
  inputs: ServoHuntInputs,
  options: ServoHuntOptions = {},
): ServoHuntResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sampleRateHz = estimateSampleRate(inputs.time);
  const channels: ServoHuntChannel[] = [];

  // alpha for the one-pole high-pass at hfCutoffHz. Guarded so a
  // zero/invalid sample rate degrades to "everything is HF" rather
  // than NaN — the MIN_SAMPLES gate below still reports 'unknown'.
  const alpha =
    sampleRateHz > 0
      ? 1 - Math.exp((-2 * Math.PI * opts.hfCutoffHz) / sampleRateHz)
      : 1;
  const maxLag = Math.max(1, Math.round((opts.maxLagMs / 1000) * sampleRateHz));

  for (const c of inputs.axisCorrelations) {
    if (c.dominantAxis === null) continue; // unclassified — skip.
    const axis = c.dominantAxis as Axis;
    const servo = inputs.servos.get(c.fieldName);
    if (!servo || servo.length === 0) continue;

    const hfServo = highPass(servo, alpha);
    const hfRmsPwm = rms(hfServo);

    const setpoint = inputs.setpoint[axis];
    const hasReference = !!setpoint && setpoint.length > 0;
    const enoughData =
      sampleRateHz > 0 && Math.min(servo.length, setpoint?.length ?? 0) >= MIN_SAMPLES;

    let commandCorrelation = NaN;
    let huntScore = NaN;
    if (hasReference && enoughData) {
      const hfSetpoint = highPass(setpoint as Float32Array, alpha);
      commandCorrelation = normalizedXCorrPeak(hfServo, hfSetpoint, maxLag);
      huntScore = hfRmsPwm * (1 - commandCorrelation);
    }

    channels.push({
      fieldName: c.fieldName,
      axis,
      hfRmsPwm,
      commandCorrelation,
      huntScore,
      severity: classify(huntScore, opts),
      hasReference,
    });
  }

  return { channels, sampleRateHz, hfCutoffHz: opts.hfCutoffHz };
}
