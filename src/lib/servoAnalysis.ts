// Layer 2 — servo output analysis.
//
// Detects PWM endpoint saturation per channel and aggregates it into
// stats + per-sample boolean masks suitable for rendering as time-axis-
// aligned strips below the ServoPanel chart.
//
// A saturated control surface means the controller has run out of
// authority — it's commanding more deflection than the surface can
// physically produce. Persistent saturation on a wing is one of the
// most actionable tuning signals: it either means PID gains are too
// hot (D-term running into the limit on noise) or that the user is
// over-commanding the airframe (mechanical setup needs more throw,
// or the rates are too aggressive).
//
// PWM endpoints: BF servos default to 1000–2000 µs. Per-channel
// `servo_lowpwm_N` / `servo_highpwm_N` overrides exist in the header
// params; a future slice could look them up from `header_params` and
// use the actual configured limits. For now we use 1000 / 2000 with
// a configurable margin (default 25 µs) which catches "this PWM
// hit or got within a hair of the endpoint" without false-firing
// on a channel that simply lives near the endpoint for some reason.

export interface SaturationConfig {
  minPwm?: number;
  maxPwm?: number;
  /** µs margin from the endpoint that still counts as saturated.
   *  Catches "close enough" hits without needing exact endpoint
   *  contact. Default 25 µs. */
  marginUs?: number;
  /** Sample rate (Hz) of the input. Used to convert sample-count
   *  durations into milliseconds. Default 1000 Hz (correct for
   *  most BF wing logs at the default sample rate). */
  sampleRateHz?: number;
}

export interface SaturationEpisode {
  /** Sample index of the first saturated sample in this run. */
  startIdx: number;
  /** Sample index of the last saturated sample in this run (inclusive). */
  endIdx: number;
  /** 'low' = pegged near minPwm, 'high' = pegged near maxPwm. */
  kind: 'low' | 'high';
  /** Duration in milliseconds. */
  durationMs: number;
}

export interface SaturationResult {
  /** Per-sample state: 0 = not saturated, 1 = low, 2 = high. Length
   *  matches input. Uint8Array for compact representation. */
  states: Uint8Array;
  /** Fraction of samples saturated at either endpoint (0..1). */
  saturatedFraction: number;
  /** Count of distinct saturation episodes (any kind). */
  episodes: number;
  /** Longest single episode duration in milliseconds. */
  longestRunMs: number;
  /** Count of times the channel hit the low endpoint. */
  lowHits: number;
  /** Count of times the channel hit the high endpoint. */
  highHits: number;
  /** Observed PWM range across the input — useful for sanity-checking
   *  the threshold config against this channel's actual behaviour. */
  observedMin: number;
  observedMax: number;
  /** Detailed episode list (ordered by startIdx). */
  episodeList: SaturationEpisode[];
}

const DEFAULT_MIN_PWM = 1000;
const DEFAULT_MAX_PWM = 2000;
const DEFAULT_MARGIN_US = 25;
const DEFAULT_SAMPLE_RATE_HZ = 1000;

export function detectSaturation(
  pwm: Float32Array,
  config: SaturationConfig = {},
): SaturationResult {
  const minPwm = config.minPwm ?? DEFAULT_MIN_PWM;
  const maxPwm = config.maxPwm ?? DEFAULT_MAX_PWM;
  const marginUs = config.marginUs ?? DEFAULT_MARGIN_US;
  const sampleRateHz = config.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;

  const n = pwm.length;
  const states = new Uint8Array(n);

  const empty: SaturationResult = {
    states,
    saturatedFraction: 0,
    episodes: 0,
    longestRunMs: 0,
    lowHits: 0,
    highHits: 0,
    observedMin: 0,
    observedMax: 0,
    episodeList: [],
  };
  if (n === 0) return empty;

  const lowThresh  = minPwm + marginUs;
  const highThresh = maxPwm - marginUs;

  let observedMin = Infinity;
  let observedMax = -Infinity;
  let saturatedCount = 0;
  let lowHits = 0;
  let highHits = 0;

  // Single pass: state assignment + observed range.
  for (let i = 0; i < n; i++) {
    const v = pwm[i];
    if (v < observedMin) observedMin = v;
    if (v > observedMax) observedMax = v;
    if (v <= lowThresh) {
      states[i] = 1;
      saturatedCount++;
    } else if (v >= highThresh) {
      states[i] = 2;
      saturatedCount++;
    }
  }

  // Second pass: collect episodes (run-length encode the state).
  const episodeList: SaturationEpisode[] = [];
  let longestRunMs = 0;
  let runStart = -1;
  let runKind: 'low' | 'high' | null = null;
  const msPerSample = 1000 / sampleRateHz;

  for (let i = 0; i <= n; i++) {
    const s = i < n ? states[i] : 0;
    const kind: 'low' | 'high' | null = s === 1 ? 'low' : s === 2 ? 'high' : null;
    if (kind !== runKind) {
      // Close prior run, if any.
      if (runKind !== null && runStart >= 0) {
        const endIdx = i - 1;
        const durationMs = (endIdx - runStart + 1) * msPerSample;
        episodeList.push({ startIdx: runStart, endIdx, kind: runKind, durationMs });
        if (durationMs > longestRunMs) longestRunMs = durationMs;
        if (runKind === 'low') lowHits++; else highHits++;
      }
      // Start new run (if not idle).
      runStart = kind !== null ? i : -1;
      runKind = kind;
    }
  }

  return {
    states,
    saturatedFraction: saturatedCount / n,
    episodes: episodeList.length,
    longestRunMs,
    lowHits,
    highHits,
    observedMin,
    observedMax,
    episodeList,
  };
}
