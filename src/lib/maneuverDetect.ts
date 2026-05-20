// Layer 2 — M-FF maneuver detection.
//
// Finds the windows of a flight where the pilot made a deliberate fast
// stick input — snap rolls, pitch punches, sharp reversals. These are
// the ONLY windows where feedforward analysis is meaningful: FF reacts
// to stick velocity, so smooth flying gives FF nothing to do and
// produces no signal to analyze.
//
// This module is NOT a standalone panel. It's the segment selector
// that feeds `lib/ffEffectiveness.ts` (and optionally the step-response
// deconvolution) — analyzing FF on exactly the aggressive windows is
// far cleaner than hoping a whole-flight average catches them.
//
// Detection signal: the derivative of the rate setpoint. `setpoint[i]`
// is a rate command in deg/s; its time-derivative is deg/s² and spikes
// hard when the stick is whipped. Smooth flying keeps it low; a snap
// input sends it to thousands of deg/s².
//
// Wing-regime caveat: the enter/exit thresholds are first-guess values
// pending corpus calibration — a sub-200g wing and a 2 m sailplane
// have very different "aggressive" setpoint dynamics. Marked TODO.

type Axis = 0 | 1 | 2;

const AXIS_TYPE = ['roll', 'pitch', 'yaw'] as const;

export interface ManeuverWindow {
  /** First sample index of the (padded) window. */
  startIdx: number;
  /** One-past-last sample index (exclusive). */
  endIdx: number;
  /** Window start/end in seconds-since-log-start. */
  startSec: number;
  endSec: number;
  /** Axis with the highest peak setpoint velocity in the window. */
  dominantAxis: Axis;
  /** Human-readable maneuver class. 'mixed' when a second axis has a
   *  peak within 30% of the dominant — a coordinated/compound input. */
  type: 'roll' | 'pitch' | 'yaw' | 'mixed';
  /** Peak |setpoint velocity| on the dominant axis, deg/s². */
  peakVelocityDegS2: number;
}

export interface ManeuverDetectOptions {
  /** Smoothed |setpoint velocity| (deg/s²) above which a maneuver
   *  window opens. TODO calibrate against the wing corpus. */
  enterThreshold?: number;
  /** Window stays open until ALL axes drop below this. Lower than
   *  enter → hysteresis, prevents chatter mid-maneuver. */
  exitThreshold?: number;
  /** Core windows (pre-pad) shorter than this are discarded as noise. */
  minDurationMs?: number;
  /** Core windows closer than this are merged — a single snap input
   *  can have a brief velocity dip mid-stroke. */
  mergeGapMs?: number;
  /** Each surviving window is padded by this on both ends so the FF
   *  analysis sees the lead-in + settle, not just the peak. */
  padMs?: number;
  /** Boxcar width (samples) for smoothing the raw velocity — the bare
   *  derivative is noisy. Odd numbers center cleanly. */
  smoothSamples?: number;
}

const DEFAULTS: Required<ManeuverDetectOptions> = {
  enterThreshold: 1500,
  exitThreshold:  600,
  // 40 ms core minimum — a hard stick whip drives the setpoint
  // derivative high for only ~50-150 ms, so a 60 ms gate was clipping
  // genuine fast snaps. 40 ms still rejects single-sample noise.
  minDurationMs:  40,
  mergeGapMs:     120,
  padMs:          80,
  smoothSamples:  5,
};

/** Detect aggressive-input windows from the per-axis rate setpoint.
 *  `setpoint` is indexed [roll, pitch, yaw]; missing axes pass
 *  `undefined` and are skipped. Returns windows sorted by startIdx. */
export function detectManeuvers(
  setpoint: readonly (Float32Array | undefined)[],
  time: Float32Array,
  options: ManeuverDetectOptions = {},
): ManeuverWindow[] {
  const opt = { ...DEFAULTS, ...options };
  const n = time.length;
  if (n < 3) return [];

  const dt = (time[n - 1] - time[0]) / (n - 1);
  if (!(dt > 0)) return [];
  const sampleRateHz = 1 / dt;

  // Per-axis smoothed |setpoint velocity| (deg/s²). axisVel[a] is null
  // for absent axes.
  const axisVel: (Float32Array | null)[] = [null, null, null];
  let anyAxis = false;
  for (let a = 0 as Axis; a <= 2; a = (a + 1) as Axis) {
    const sp = setpoint[a];
    if (!sp || sp.length < 3) continue;
    const len = Math.min(sp.length, n);
    axisVel[a] = smoothAbs(velocity(sp, len, dt), opt.smoothSamples);
    anyAxis = true;
  }
  if (!anyAxis) return [];

  // Combined trigger = max over axes of smoothed |velocity|.
  const trigger = new Float32Array(n);
  for (let a = 0 as Axis; a <= 2; a = (a + 1) as Axis) {
    const v = axisVel[a];
    if (!v) continue;
    for (let i = 0; i < v.length; i++) {
      if (v[i] > trigger[i]) trigger[i] = v[i];
    }
  }

  // Hysteresis walk: open at enterThreshold, close once below exit.
  interface RawWindow { startIdx: number; endIdx: number; }
  const raw: RawWindow[] = [];
  let open = false;
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (!open && trigger[i] >= opt.enterThreshold) {
      open = true;
      start = i;
    } else if (open && trigger[i] < opt.exitThreshold) {
      raw.push({ startIdx: start, endIdx: i });
      open = false;
    }
  }
  if (open) raw.push({ startIdx: start, endIdx: n });

  // Merge windows separated by less than mergeGapMs.
  const mergeGapSamples = msToSamples(opt.mergeGapMs, sampleRateHz);
  const merged: RawWindow[] = [];
  for (const w of raw) {
    const prev = merged[merged.length - 1];
    if (prev && w.startIdx - prev.endIdx <= mergeGapSamples) {
      prev.endIdx = w.endIdx;
    } else {
      merged.push({ ...w });
    }
  }

  // Discard core windows shorter than minDurationMs (pre-pad).
  const minDurationSamples = msToSamples(opt.minDurationMs, sampleRateHz);
  const kept = merged.filter((w) => w.endIdx - w.startIdx >= minDurationSamples);

  // Pad + classify.
  const padSamples = msToSamples(opt.padMs, sampleRateHz);
  const out: ManeuverWindow[] = [];
  for (const w of kept) {
    const startIdx = Math.max(0, w.startIdx - padSamples);
    const endIdx   = Math.min(n, w.endIdx + padSamples);
    out.push(classifyWindow(startIdx, endIdx, time, axisVel));
  }
  return out;
}

/** Public wrapper — central-difference time-derivative of the full
 *  rate-setpoint array. `setpoint[i]` is deg/s; the result is deg/s²,
 *  the signal feedforward responds to. Shared with `lib/ffEffectiveness`
 *  so both modules use one velocity definition. */
export function setpointVelocity(sp: Float32Array, dt: number): Float32Array {
  return velocity(sp, sp.length, dt);
}

/** Central-difference time-derivative of a rate signal. Edges use a
 *  one-sided difference. Output units: input-units per second. */
function velocity(sp: Float32Array, len: number, dt: number): Float32Array {
  const v = new Float32Array(len);
  if (len < 2) return v;
  const inv2dt = 1 / (2 * dt);
  for (let i = 1; i < len - 1; i++) {
    v[i] = (sp[i + 1] - sp[i - 1]) * inv2dt;
  }
  v[0]       = (sp[1] - sp[0]) / dt;
  v[len - 1] = (sp[len - 1] - sp[len - 2]) / dt;
  return v;
}

/** Take |value| then boxcar-smooth. Width is clamped to odd ≥ 1. */
function smoothAbs(v: Float32Array, width: number): Float32Array {
  const n = v.length;
  const abs = new Float32Array(n);
  for (let i = 0; i < n; i++) abs[i] = Math.abs(v[i]);
  const w = Math.max(1, width | 1); // force odd
  if (w === 1) return abs;
  const half = (w - 1) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= n) continue;
      sum += abs[j];
      count += 1;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

function msToSamples(ms: number, sampleRateHz: number): number {
  return Math.max(0, Math.round((ms / 1000) * sampleRateHz));
}

function classifyWindow(
  startIdx: number,
  endIdx: number,
  time: Float32Array,
  axisVel: readonly (Float32Array | null)[],
): ManeuverWindow {
  const peaks: number[] = [0, 0, 0];
  for (let a = 0 as Axis; a <= 2; a = (a + 1) as Axis) {
    const v = axisVel[a];
    if (!v) continue;
    let peak = 0;
    const hi = Math.min(endIdx, v.length);
    for (let i = startIdx; i < hi; i++) {
      if (v[i] > peak) peak = v[i];
    }
    peaks[a] = peak;
  }
  let dominant: Axis = 0;
  for (let a = 1 as Axis; a <= 2; a = (a + 1) as Axis) {
    if (peaks[a] > peaks[dominant]) dominant = a;
  }
  const domPeak = peaks[dominant];
  // 'mixed' when a non-dominant axis has a peak within 30% of dominant.
  let mixed = false;
  for (let a = 0 as Axis; a <= 2; a = (a + 1) as Axis) {
    if (a === dominant) continue;
    if (domPeak > 0 && peaks[a] >= 0.7 * domPeak) mixed = true;
  }
  return {
    startIdx,
    endIdx,
    startSec: time[Math.min(startIdx, time.length - 1)],
    endSec:   time[Math.min(endIdx - 1, time.length - 1)],
    dominantAxis: dominant,
    type: mixed ? 'mixed' : AXIS_TYPE[dominant],
    peakVelocityDegS2: domPeak,
  };
}
