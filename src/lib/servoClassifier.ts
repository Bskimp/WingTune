// Layer 2 — servo role classifier.
//
// PROBLEM: a BF wing log declares every servo[i] channel the firmware
// supports, but knowing `servo[1]` carries PWM doesn't tell you it's
// the left elevon vs the rudder vs a gear retract. The UI wants
// "Elevon-L pegged at high endpoint," not "servo[1] pegged."
//
// FOUR-TIER CLASSIFICATION (best source first):
//
//   0. **smix table** — Brian's wing firmware fork logs the servo
//      mixer (`smix*`) into the BBL header. When present it is the
//      authoritative per-log wiring: each rule's `inputSource` names
//      the driving axis, its `rate` sign splits a differential pair.
//      Decoded by `lib/servoMixer.ts`. Confidence: 'confident',
//      `via: 'smix'`. Beats a preset — it's the actual config, not a
//      mixer-family assumption. Stock BF does NOT log smix; those
//      logs fall through.
//   1. **Preset** — if the `mixer` header value matches a known
//      preset, roles come from the preset's index map. Confidence:
//      'confident', `via: 'preset'`. The preset table starts empty
//      and is populated from bench-FC CLI dumps.
//   2. **Correlation** — for logs with neither smix nor a known
//      preset (typically MIXER_CUSTOM_AIRPLANE on stock firmware),
//      Pearson-correlate each servo's PWM against each axis's
//      commanded setpoint. Dominant axis → general role; correlation
//      sign splits L/R. Confidence: 'inferred' (score reported so the
//      UI can show a "weak" qualifier).
//   3. **Unclassified** — no correlation clears the threshold (a
//      near-static servo, or one moving independent of the
//      controller — gear, dropper, switch-flap). Confidence:
//      'unclassified'.
//
// User-override persistence (keyed by `craft_name`) is a future
// slice — first slice ships the deterministic classification path
// so the UI can show the new states without persistence wired.

// Note: this module does NOT import CapabilityReport. The mixer name
// (when present) comes from ScanReport.header_params['mixer'] and is
// passed in by the caller — keeps the classifier decoupled from where
// the metadata sits in the bridge types.

import { smixInputAxis, type SmixRule } from '@/lib/servoMixer';

// ---- types ----------------------------------------------------------

export type ServoRole =
  | 'unknown'
  | 'elevon-l' | 'elevon-r' | 'elevon-paired'
  | 'aileron-l' | 'aileron-r' | 'aileron-paired'
  | 'elevator'
  | 'rudder'
  | 'flap-l' | 'flap-r'
  | 'vtail-l' | 'vtail-r'
  | 'throttle'
  | 'other';

export const ROLE_LABELS: Record<ServoRole, string> = {
  'unknown':         'unknown',
  'elevon-l':        'Elevon-L',
  'elevon-r':        'Elevon-R',
  'elevon-paired':   'Elevon',
  'aileron-l':       'Aileron-L',
  'aileron-r':       'Aileron-R',
  'aileron-paired':  'Aileron',
  'elevator':        'Elevator',
  'rudder':          'Rudder',
  'flap-l':          'Flap-L',
  'flap-r':          'Flap-R',
  'vtail-l':         'V-Tail-L',
  'vtail-r':         'V-Tail-R',
  'throttle':        'Throttle',
  'other':           'Other',
};

export type ClassificationConfidence = 'confident' | 'inferred' | 'unclassified';

export interface ClassifiedChannel {
  fieldName: string;
  role: ServoRole;
  confidence: ClassificationConfidence;
  /** Correlation score against the dominant axis. Present when
   *  confidence is 'inferred'; absent for 'confident' / 'unclassified'. */
  correlationScore?: number;
  /** Preset name that resolved the role. Present when 'confident'
   *  via the preset path. */
  presetName?: string;
  /** Which deterministic path produced a 'confident' result —
   *  'smix' (decoded mixer table) or 'preset' (matched preset). */
  via?: 'preset' | 'smix';
}

/** Maps from BF `mixer` header value (e.g. "FLYING_WING", verbatim
 *  string as logged) → role per servo channel index. Indices not
 *  present in the map → 'other' for that channel. */
export interface MixerPreset {
  /** Match value: the string BF writes for `mixer` in the log header. */
  mixerName: string;
  /** Display name. */
  label: string;
  /** servo[i] index → role for THIS mixer. */
  servoRoles: Readonly<Record<number, ServoRole>>;
}

/** Known mixer presets. STARTS EMPTY — populated incrementally from
 *  bench-FC CLI dumps. Stock BF doesn't log the smix table, so each
 *  preset needs to be validated against the firmware mapping
 *  (`mixer.c` servo mixer tables) AND ideally a physical-hardware
 *  sanity check. (Wing-fork logs carry `smix*` directly — tier 0.)
 *
 *  Adding a preset: append an entry below. The mixerName must match
 *  the BF log header value verbatim — check `header_params['mixer']`
 *  on a real flight to confirm spelling. */
export const KNOWN_PRESETS: readonly MixerPreset[] = [
  // (intentionally empty for the first slice — see banner copy in
  // ServosTab.vue, and the open task in CLAUDE.md.)
];

// ---- correlation math ----------------------------------------------

/** Pearson correlation coefficient between two equal-length series.
 *  Returns 0 when either series has zero variance (constant signal). */
export function pearsonCorrelation(x: Float32Array, y: Float32Array): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

export interface AxisCorrelations {
  fieldName: string;
  roll: number;
  pitch: number;
  yaw: number;
  /** 0=roll, 1=pitch, 2=yaw, null = none above threshold. */
  dominantAxis: 0 | 1 | 2 | null;
  /** Signed correlation value for the dominant axis (sign matters for L/R split). */
  dominantSigned: number;
}

const DOMINANT_THRESHOLD = 0.25;

/** Correlate each servo channel against each axis setpoint and report
 *  the dominant axis (one whose |correlation| is largest, provided it
 *  clears DOMINANT_THRESHOLD). */
export function correlateServosToAxes(
  servos: ReadonlyMap<string, Float32Array>,
  setpointRoll: Float32Array,
  setpointPitch: Float32Array,
  setpointYaw: Float32Array,
): AxisCorrelations[] {
  const out: AxisCorrelations[] = [];
  for (const [fieldName, arr] of servos) {
    const roll  = pearsonCorrelation(arr, setpointRoll);
    const pitch = pearsonCorrelation(arr, setpointPitch);
    const yaw   = pearsonCorrelation(arr, setpointYaw);
    const abs = [Math.abs(roll), Math.abs(pitch), Math.abs(yaw)];
    let dominantAxis: 0 | 1 | 2 | null = null;
    let bestAbs = DOMINANT_THRESHOLD;
    if (abs[0] > bestAbs) { bestAbs = abs[0]; dominantAxis = 0; }
    if (abs[1] > bestAbs) { bestAbs = abs[1]; dominantAxis = 1; }
    if (abs[2] > bestAbs) { bestAbs = abs[2]; dominantAxis = 2; }
    const signed = dominantAxis === 0 ? roll : dominantAxis === 1 ? pitch : dominantAxis === 2 ? yaw : 0;
    out.push({ fieldName, roll, pitch, yaw, dominantAxis, dominantSigned: signed });
  }
  return out;
}

// ---- classifier --------------------------------------------------

/** Pair-correlation threshold above which two roll-dominant channels
 *  are treated as a "paired identical signal" pair (typical wing
 *  setup: BF mixer sends the same PWM to both servos, physical
 *  reverse on one of them produces the actual L/R deflection — but
 *  the log can't see that, both PWM traces are identical). Below the
 *  negative threshold, the two are anti-correlated → true
 *  differential mixing → sign-split L/R is meaningful.
 *
 *  This was a wing-vs-quad gap in the original classifier: quad
 *  ailerons live on opposite sides of the differential, wing
 *  ailerons typically don't. */
const PAIR_THRESHOLD = 0.5;

/** Infer a per-channel role from a set of correlation results. For
 *  each axis where multiple servos dominate, we check pair
 *  correlation BETWEEN the two servos to decide whether they're
 *  truly differential (anti-correlated, classic L/R split) or
 *  paired-identical (positively correlated, no L/R from PWM alone).
 *  Single-servo-per-axis cases get the unilateral role. */
function rolesFromCorrelation(
  corrs: readonly AxisCorrelations[],
  servos: ReadonlyMap<string, Float32Array>,
): Map<string, ClassifiedChannel> {
  const result = new Map<string, ClassifiedChannel>();

  // Group channels by dominant axis.
  const byAxis: Record<0 | 1 | 2, AxisCorrelations[]> = { 0: [], 1: [], 2: [] };
  for (const c of corrs) {
    if (c.dominantAxis === null) {
      result.set(c.fieldName, {
        fieldName: c.fieldName,
        role: 'unknown',
        confidence: 'unclassified',
      });
      continue;
    }
    byAxis[c.dominantAxis].push(c);
  }

  // Roll axis: 2-channel case branches on pair correlation.
  const rollChans = byAxis[0];
  if (rollChans.length === 2) {
    const hasPitchSurface = byAxis[1].length > 0;
    const arrA = servos.get(rollChans[0].fieldName);
    const arrB = servos.get(rollChans[1].fieldName);
    const pairR = arrA && arrB ? pearsonCorrelation(arrA, arrB) : 0;

    if (pairR >= PAIR_THRESHOLD) {
      // Paired-identical: BF mixer sends same PWM to both servos,
      // physical reverse splits L/R downstream. L/R cannot be
      // determined from the log alone. Standard wing setup.
      const paired: ServoRole = hasPitchSurface ? 'aileron-paired' : 'elevon-paired';
      for (const c of rollChans) {
        result.set(c.fieldName, {
          fieldName: c.fieldName, role: paired, confidence: 'inferred',
          correlationScore: Math.abs(c.dominantSigned),
        });
      }
    } else {
      // Anti-correlated (or weakly coupled) → differential mixing →
      // sign-split L/R. Sign convention is heuristic and may need
      // flipping per-mixer; locked once preset table validates.
      const sorted = [...rollChans].sort((a, b) => a.dominantSigned - b.dominantSigned);
      const lRole: ServoRole = hasPitchSurface ? 'aileron-l' : 'elevon-l';
      const rRole: ServoRole = hasPitchSurface ? 'aileron-r' : 'elevon-r';
      result.set(sorted[0].fieldName, {
        fieldName: sorted[0].fieldName, role: lRole, confidence: 'inferred',
        correlationScore: Math.abs(sorted[0].dominantSigned),
      });
      result.set(sorted[1].fieldName, {
        fieldName: sorted[1].fieldName, role: rRole, confidence: 'inferred',
        correlationScore: Math.abs(sorted[1].dominantSigned),
      });
    }
  } else {
    for (const c of rollChans) {
      result.set(c.fieldName, {
        fieldName: c.fieldName,
        role: 'other',  // unusual configuration; bail to generic.
        confidence: 'inferred',
        correlationScore: Math.abs(c.dominantSigned),
      });
    }
  }

  // Pitch axis: typically a single Elevator surface.
  for (const c of byAxis[1]) {
    result.set(c.fieldName, {
      fieldName: c.fieldName,
      role: 'elevator',
      confidence: 'inferred',
      correlationScore: Math.abs(c.dominantSigned),
    });
  }

  // Yaw axis: typically a single Rudder surface (or none on a delta).
  for (const c of byAxis[2]) {
    result.set(c.fieldName, {
      fieldName: c.fieldName,
      role: 'rudder',
      confidence: 'inferred',
      correlationScore: Math.abs(c.dominantSigned),
    });
  }

  return result;
}

// ---- smix-table classifier ---------------------------------------
//
// When the log carries the servo mixer (Brian's wing firmware fork),
// roles are deterministic: a rule's `inputSource` names the driving
// axis, a servo driven by both roll AND pitch is an elevon (pitch AND
// yaw → V-tail), and the rate sign splits a two-servo pair into L/R.
// No correlation, no preset assumption — the log states the wiring.

interface SmixServo {
  fieldName: string;
  index: number;
  axes: Set<'roll' | 'pitch' | 'yaw'>;
  /** Summed signed roll / yaw rate across this servo's rules — sign
   *  splits a differential pair (roll: ailerons/elevons; yaw: V-tail). */
  rollRate: number;
  yawRate: number;
  /** Has a throttle / RC-direct rule — not a stabilized surface. */
  nonStabilized: boolean;
}

/** Split a two-servo control pair into L/R by signed rate; a lone
 *  servo or an unusual >2 group falls back to `pairedRole`. Which
 *  physical side is "left" is unknowable from the log — the split is
 *  deterministic and mirrors the correlation path's lower-signed-
 *  value-is-left convention. */
function splitPaired(
  servo: SmixServo,
  group: readonly SmixServo[],
  rateOf: (s: SmixServo) => number,
  lRole: ServoRole,
  rRole: ServoRole,
  pairedRole: ServoRole,
): ServoRole {
  if (group.length !== 2) return pairedRole;
  const sorted = [...group].sort((a, b) => rateOf(a) - rateOf(b));
  return servo.fieldName === sorted[0].fieldName ? lRole : rRole;
}

/** Classify every servo channel from the decoded smix rules. Returns
 *  null when no rule targets any present servo channel (a
 *  targetChannel ↔ servo[i] indexing mismatch) so the caller can fall
 *  back to correlation rather than reporting everything 'unknown'. */
function classifyFromSmix(
  servos: ReadonlyMap<string, Float32Array>,
  smixRules: readonly SmixRule[],
): ClassifiedChannel[] | null {
  const smixServos: SmixServo[] = [];
  const nonServoFields: string[] = [];

  for (const fieldName of servos.keys()) {
    const m = /^servo\[(\d+)\]$/.exec(fieldName);
    if (!m) { nonServoFields.push(fieldName); continue; }
    const index = Number(m[1]);
    const axes = new Set<'roll' | 'pitch' | 'yaw'>();
    let rollRate = 0;
    let yawRate = 0;
    let nonStabilized = false;
    for (const rule of smixRules) {
      if (rule.targetChannel !== index) continue;
      const axis = smixInputAxis(rule.inputSource);
      if (axis === 'roll') { axes.add('roll'); rollRate += rule.rate; }
      else if (axis === 'pitch') axes.add('pitch');
      else if (axis === 'yaw') { axes.add('yaw'); yawRate += rule.rate; }
      else nonStabilized = true;
    }
    smixServos.push({ fieldName, index, axes, rollRate, yawRate, nonStabilized });
  }

  // No smix rule matched any present servo channel → indexing
  // mismatch; bail so the caller tries correlation instead of
  // reporting every channel 'unknown'.
  if (!smixServos.some((s) => s.axes.size > 0 || s.nonStabilized)) {
    return null;
  }

  const rollGroup  = smixServos.filter((s) => s.axes.has('roll'));
  const vtailGroup = smixServos.filter(
    (s) => s.axes.has('pitch') && s.axes.has('yaw') && !s.axes.has('roll'),
  );

  const byField = new Map<string, ClassifiedChannel>();
  for (const s of smixServos) {
    const hasRoll = s.axes.has('roll');
    const hasPitch = s.axes.has('pitch');
    const hasYaw = s.axes.has('yaw');
    let role: ServoRole;
    if (hasRoll && hasPitch) {
      role = splitPaired(s, rollGroup, (x) => x.rollRate,
        'elevon-l', 'elevon-r', 'elevon-paired');
    } else if (hasRoll) {
      role = splitPaired(s, rollGroup, (x) => x.rollRate,
        'aileron-l', 'aileron-r', 'aileron-paired');
    } else if (hasPitch && hasYaw) {
      role = splitPaired(s, vtailGroup, (x) => x.yawRate,
        'vtail-l', 'vtail-r', 'vtail-l');
    } else if (hasPitch) {
      role = 'elevator';
    } else if (hasYaw) {
      role = 'rudder';
    } else if (s.nonStabilized) {
      role = 'other';
    } else {
      role = 'unknown';
    }
    byField.set(
      s.fieldName,
      role === 'unknown'
        ? { fieldName: s.fieldName, role, confidence: 'unclassified' }
        : { fieldName: s.fieldName, role, confidence: 'confident', via: 'smix' },
    );
  }
  for (const fieldName of nonServoFields) {
    byField.set(fieldName, { fieldName, role: 'unknown', confidence: 'unclassified' });
  }

  // Preserve the caller's servo-map iteration order.
  return [...servos.keys()].map((fn) => byField.get(fn)!);
}

export interface ClassifyServosArgs {
  /** Decoded `smix*` rules (`lib/servoMixer.ts`). When non-empty and
   *  at least one rule targets a present servo channel, this is the
   *  authoritative path — preset + correlation are skipped. Empty on
   *  stock-BF logs that don't carry the mixer table. */
  smixRules?: readonly SmixRule[];
  /** BF `mixer` header value (from `scanReport.header_params['mixer']`).
   *  When present and matching a KNOWN_PRESETS entry, every channel
   *  is classified deterministically; otherwise correlation kicks in.
   *  Pass undefined / null to skip the preset path entirely. */
  mixerName?: string | null;
  servos: ReadonlyMap<string, Float32Array>;
  setpointRoll: Float32Array;
  setpointPitch: Float32Array;
  setpointYaw: Float32Array;
}

/** Top-level classifier. Tries preset match against `mixerName`
 *  first; falls back to correlation-based inference per channel.
 *  Channels with no signal are returned as 'unknown' / 'unclassified'. */
export function classifyServos(args: ClassifyServosArgs): ClassifiedChannel[] {
  // Path 0: smix table — the authoritative per-log servo wiring.
  if (args.smixRules && args.smixRules.length > 0) {
    const fromSmix = classifyFromSmix(args.servos, args.smixRules);
    if (fromSmix) return fromSmix;
    // smix rules present but none matched a servo channel (indexing
    // mismatch) — fall through to preset / correlation.
  }

  const preset = args.mixerName
    ? KNOWN_PRESETS.find((p) => p.mixerName === args.mixerName)
    : undefined;

  // Path 1: preset match → assign every channel deterministically.
  if (preset) {
    const out: ClassifiedChannel[] = [];
    for (const fieldName of args.servos.keys()) {
      const m = /^servo\[(\d+)\]$/.exec(fieldName);
      if (!m) {
        out.push({ fieldName, role: 'unknown', confidence: 'unclassified' });
        continue;
      }
      const idx = Number(m[1]);
      const role = preset.servoRoles[idx] ?? 'other';
      out.push({
        fieldName,
        role,
        confidence: 'confident',
        presetName: preset.label,
        via: 'preset',
      });
    }
    return out;
  }

  // Path 2: correlation-based inference.
  const corrs = correlateServosToAxes(
    args.servos,
    args.setpointRoll,
    args.setpointPitch,
    args.setpointYaw,
  );
  const inferred = rolesFromCorrelation(corrs, args.servos);

  // Fill in any servo not in the correlation result with unclassified.
  const out: ClassifiedChannel[] = [];
  for (const fieldName of args.servos.keys()) {
    const found = inferred.get(fieldName);
    out.push(found ?? { fieldName, role: 'unknown', confidence: 'unclassified' });
  }
  return out;
}
