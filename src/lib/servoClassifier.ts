// Layer 2 — servo role classifier.
//
// PROBLEM: BF wing logs declare every servo[i] channel the firmware
// supports (MAX_SUPPORTED_SERVOS), but doesn't include the smix table
// in the BBL. So we know `servo[1]` carries some PWM signal, but we
// don't know whether it's the left elevon, the rudder, or the
// landing-gear retract. Showing raw indices in the UI is honest but
// not helpful — the user wants "Elevon-L pegged at high endpoint,"
// not "servo[1] pegged at high endpoint."
//
// THREE-TIER CLASSIFICATION (per `project-servo-identification`):
//
//   1. **Preset** — if the log's `mixer` header value matches a known
//      preset, every channel's role is determined directly from the
//      preset's index map. Confidence: 'confident'. The preset table
//      starts empty and is populated as bench-FC dumps validate each
//      mixer family (Brian's plan: set mixers one by one on a bench
//      FC, dump CLI, capture the servo→role mapping).
//   2. **Correlation** — for unknown mixers (typically
//      MIXER_CUSTOM_AIRPLANE), Pearson-correlate each servo's PWM
//      output against each axis's commanded setpoint. The servo's
//      dominant axis (highest |r|) determines its general role
//      (roll → aileron/elevon, pitch → elevator, yaw → rudder).
//      Sign of the correlation splits left from right when an axis
//      has two surfaces (positive ↔ negative roll command means
//      opposite elevons). Confidence: 'inferred' (with the
//      correlation score reported so the UI can show a "weak"
//      qualifier).
//   3. **Unclassified** — if no correlation clears the threshold
//      (e.g. a servo that doesn't move much, or moves
//      independent of the controller — gear, dropper, flap on a
//      switch), label as 'unknown'. Confidence: 'unclassified'.
//
// User-override persistence (keyed by `craft_name`) is a future
// slice — first slice ships the deterministic classification path
// so the UI can show the new states without persistence wired.

// Note: this module does NOT import CapabilityReport. The mixer name
// (when present) comes from ScanReport.header_params['mixer'] and is
// passed in by the caller — keeps the classifier decoupled from where
// the metadata sits in the bridge types.

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
  /** Preset name that resolved the role. Present when 'confident'. */
  presetName?: string;
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
 *  bench-FC CLI dumps. The smix table isn't in BBL so each preset
 *  needs to be validated against the firmware mapping (`mixer.c`
 *  servo mixer tables) AND ideally a physical-hardware sanity check.
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

export interface ClassifyServosArgs {
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
