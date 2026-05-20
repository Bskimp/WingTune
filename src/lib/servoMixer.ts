// Layer 2 — servo configuration decoder.
//
// Brian's wing firmware fork writes the servo mixer + per-servo params
// into the BBL header as `smix<N>` and `servoParam<N>` lines. Stock BF
// does NOT (see servoClassifier.ts). When present this is the
// AUTHORITATIVE servo configuration — which controller axis drives
// which servo channel, and each servo's PWM endpoints + reverse flag —
// so it supersedes both the preset table and the correlation guess.
//
// Header line formats (BF writes `H key:value`; the parser captures
// every pair into `header_params`):
//
//   smix<N>:targetChannel,inputSource,rate,speed,min,max,box
//   servoParam<N>:rate,min,max,middle,forwardFromChannel
//
// `inputSource` is BF's `servoMixerInputSource_e`: stabilized
// roll/pitch/yaw = 0/1/2, stabilized throttle = 3, RC roll/pitch/yaw/
// throttle = 4/5/6/7, RC aux = 8+.
//
// SERVOPARAM FIELD-ORDER CAVEAT: the value order (rate first, then the
// min/max/middle PWM triple) is decoded from observed values — the
// ±rate field is unambiguous (small signed, ≤ ±125) and the
// ~1000-2000 fields are clearly PWM endpoints. Confirm against the
// firmware writer if a value ever decodes implausibly.

/** One decoded `smix<N>` rule — a servo-mixer rule from the log. */
export interface SmixRule {
  /** N from the `smix<N>` key. */
  ruleIndex: number;
  /** Servo output channel this rule drives (→ `servo[targetChannel]`). */
  targetChannel: number;
  /** BF `servoMixerInputSource_e` — see `smixInputAxis`. */
  inputSource: number;
  /** Signed weight (%). Sign splits a differential pair. */
  rate: number;
  speed: number;
  min: number;
  max: number;
  box: number;
}

/** One decoded `servoParam<N>` entry — a servo's hardware config. */
export interface ServoParam {
  /** N from the `servoParam<N>` key (→ `servo[servoIndex]`). */
  servoIndex: number;
  /** Signed rate/direction (%). A negative value = physically reversed. */
  rate: number;
  /** PWM endpoints, µs. */
  min: number;
  max: number;
  middle: number;
  /** RC channel this servo forwards from (0 = none). */
  forwardFromChannel: number;
}

export interface ServoConfig {
  /** `smix*` rules, sorted by ruleIndex. Empty when the log carries
   *  none (stock BF, or a pre-fork firmware build). */
  smixRules: SmixRule[];
  /** `servoParam*` entries, sorted by servoIndex. */
  servoParams: ServoParam[];
}

/** Coarse axis classification of a `smix` input source. */
export type SmixAxis = 'roll' | 'pitch' | 'yaw' | 'throttle' | 'rc' | 'other';

/** Map a BF `servoMixerInputSource_e` value to a coarse axis. Only the
 *  stabilized roll/pitch/yaw sources (0/1/2) drive a control surface
 *  the classifier can name; 3 = throttle, 4+ = RC-direct passthrough. */
export function smixInputAxis(inputSource: number): SmixAxis {
  switch (inputSource) {
    case 0: return 'roll';
    case 1: return 'pitch';
    case 2: return 'yaw';
    case 3: return 'throttle';
    default: return inputSource >= 4 ? 'rc' : 'other';
  }
}

/** Parse a comma-separated integer list; returns [] on any non-finite
 *  field so a malformed line is dropped rather than half-decoded. */
function parseIntList(value: string): number[] {
  const parts = value.split(',');
  const out: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p.trim(), 10);
    if (!Number.isFinite(n)) return [];
    out.push(n);
  }
  return out;
}

export function parseSmixRules(
  headerParams: Record<string, string> | undefined,
): SmixRule[] {
  if (!headerParams) return [];
  const out: SmixRule[] = [];
  for (const [key, value] of Object.entries(headerParams)) {
    const m = /^smix(\d+)$/.exec(key);
    if (!m) continue;
    const n = parseIntList(value);
    if (n.length < 7) continue;
    out.push({
      ruleIndex: Number(m[1]),
      targetChannel: n[0],
      inputSource: n[1],
      rate: n[2],
      speed: n[3],
      min: n[4],
      max: n[5],
      box: n[6],
    });
  }
  out.sort((a, b) => a.ruleIndex - b.ruleIndex);
  return out;
}

export function parseServoParams(
  headerParams: Record<string, string> | undefined,
): ServoParam[] {
  if (!headerParams) return [];
  const out: ServoParam[] = [];
  for (const [key, value] of Object.entries(headerParams)) {
    const m = /^servoParam(\d+)$/.exec(key);
    if (!m) continue;
    const n = parseIntList(value);
    if (n.length < 5) continue;
    out.push({
      servoIndex: Number(m[1]),
      rate: n[0],
      min: n[1],
      max: n[2],
      middle: n[3],
      forwardFromChannel: n[4],
    });
  }
  out.sort((a, b) => a.servoIndex - b.servoIndex);
  return out;
}

/** Decode the full servo configuration from BBL header params. Both
 *  lists are empty when the log predates the smix/servoParam-logging
 *  firmware — callers fall back to the correlation classifier. */
export function parseServoConfig(
  headerParams: Record<string, string> | undefined,
): ServoConfig {
  return {
    smixRules: parseSmixRules(headerParams),
    servoParams: parseServoParams(headerParams),
  };
}
