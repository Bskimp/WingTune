// Layer 2 — multi-source signal registry.
//
// Wing-tuning signals (TPA, SPA, S-term, adjusted setpoint) can come
// from two source paths:
//
//   · main-frame (BF 2026.6+ USE_WING new fields — the post-PR fast
//     path)
//   · debug-mode channels (the pre-PR fallback that works today)
//
// The registry hides that source choice behind `resolveSignal(id,
// axis, capability)`. Predicates ask "is signal X resolvable on this
// log?" and the registry walks the preference list, returning the
// first source that's present and active. Predicates never name a
// debug_mode string or main-frame field directly — that's the
// load-bearing invariant from `wingtune-confidence-scoring`:
//
//   > When the firmware companion PR lands (BF 2026.6), predicate
//   > code doesn't change — only the corpus grows to include
//   > main-frame-sourced fixtures.
//
// SOURCE-MAPPING CAVEAT: the exact main-frame field names + debug
// channel mappings below are this author's best guess against BF's
// observable behavior. Brian (BF firmware contributor) should verify
// each entry marked `TODO verify` before any analytics module ships
// off these resolutions. Wrong field names just cause `missing`
// resolutions — fail-safe, not crash — but a wrong channel index
// would surface garbage as "resolved" output.
//
// The `expected_range` + `out_of_range` mechanism mitigates the
// wrong-channel risk: each source declares the value range it
// expects, the parser samples min/max during scan, and resolveSignal
// returns `state: 'out_of_range'` when sampled values fall outside.
// Predicates collapse out_of_range to `blocked` with a firmware-
// mismatch reason, so the user sees "DEBUG_TPA ch1 [0..50000],
// expected [0..4000] — channel-index mismatch?" rather than silently
// resolving the wrong field.
//
// `min_firmware` filters sources by BF version — useful for sources
// that only exist post-PR. Permissive on parse failure: if either
// the log's firmware string or the source's `min_firmware` value
// can't be parsed into a comparable form, the gate is skipped
// (the rest of the probe — presence, active, range — still runs).

import type { CapabilityReport } from '@/lib/wasmBridge';

// ---- type contracts ----------------------------------------------------

export type SignalSource =
  | {
      kind: 'main_frame';
      field: string;
      /** Inclusive [min, max] of expected sampled values. When set, a
       *  source with sampled values outside this range resolves to
       *  `state: 'out_of_range'` rather than `resolved`. Skipped when
       *  the parser's sample_check reports no measured value. */
      expected_range?: readonly [number, number];
      /** BF version (e.g. "4.5", "2026.6") below which this source is
       *  skipped. Permissive: if either value fails to parse, the gate
       *  is not applied. */
      min_firmware?: string;
    }
  | {
      kind: 'debug';
      mode: string;
      channel: number;
      expected_range?: readonly [number, number];
      min_firmware?: string;
    };

/** Per-axis signals get an axis index passed to their source-list
 *  factory (so `spa` can map to `spa[0]` / `spa[1]` / `spa[2]` etc.).
 *  Non-per-axis signals pass null. */
export type Axis = 0 | 1 | 2;

export interface SignalDef {
  id: string;
  perAxis: boolean;
  /** Sources in preference order — first resolved source wins. */
  sources: (axis: Axis | null) => SignalSource[];
}

export type ResolveResult =
  | { state: 'resolved'; via: 'main_frame' | 'debug'; source: SignalSource }
  | { state: 'inactive'; via: 'main_frame' | 'debug'; source: SignalSource }
  | {
      state: 'out_of_range';
      via: 'main_frame' | 'debug';
      source: SignalSource;
      /** The range the source declared. */
      expected: readonly [number, number];
      /** The min/max actually observed across sampled frames. */
      observed: readonly [number, number];
    }
  | { state: 'missing' };

// ---- signal definitions ------------------------------------------------
//
// Source mappings ground-truthed against Brian's firmware diffs (he
// has BF contributor access) — see [[project-bf-wing-debug-modes]]
// memory for the full integer roster + channel layouts.
//   · DEBUG_TPA           — 6 channels, stable layout since PR #13895:
//                             ch0 = tpaFactor × 1000
//                             ch1 = attitude.roll (decideg)
//                             ch2 = attitude.pitch (decideg)
//                             ch3 = calculated throttle × 1000 (0..1000)
//                             ch4 = tpaSpeed × 10 (m/s × 10)
//                             ch5 = tpaArgument × 1000 (0..1000)
//                           `expected_range` on each source guards
//                           against silent failure if a future
//                           firmware shifts the layout.
//   · DEBUG_SPA           — PR #13719 (SPA / Setpoint PID attenuation)
//                           channel = axis, value = spa[axis] × 1000
//   · DEBUG_WING_SETPOINT — PR #14010 (TPA mode PDS + Wing setpoint)
//                           channel = 2*axis     → pre-TPA setpoint
//                           channel = 2*axis + 1 → post-TPA (adjusted) setpoint
//   · DEBUG_S_TERM        — PR #14010 (paired with WING_SETPOINT)
//                           channel = 2*axis     → s-term before TPA
//                           channel = 2*axis + 1 → s-term after TPA
//   · axisS[i] (main-frame) — single-source USE_WING field; equivalent
//                           to S_TERM channel 2*axis+1 (post-TPA s-term)
//
// HEADS-UP: our local `blackbox-log` parser's
// `types/data/Betaflight/2026.6/debug_mode.yaml` does NOT yet include
// SPA / WING_SETPOINT / S_TERM in its enum — those merged upstream but
// our fork's YAML is stale. Until that's fixed, the parser will
// report `debug_mode = null` for logs that use these modes, and the
// registry will return `missing` for everything below. The fix is
// trivial (add the enum entries) but lives in the blackbox-log
// repo, not WingTune. Tracked as a follow-up slice.
//
// Not represented here:
//   · The applied TPA factor (post/pre setpoint ratio) — derivable
//     from WING_SETPOINT channels in analytics, not a signal lookup.

export const SIGNALS: Record<string, SignalDef> = {
  // Airspeed estimator output. Main-frame `wingTpaAirspeed` is the
  // modern path (logged unconditionally when USE_WING firmware is
  // running); DEBUG_TPA ch4 (m/s × 10) is the pre-USE_WING fallback.
  // expected_range not set on main_frame source yet — Brian's first
  // bench/flight log will let us tighten this with real data.
  tpa_speed_est: {
    id: 'tpa_speed_est',
    perAxis: false,
    sources: () => [
      { kind: 'main_frame', field: 'wingTpaAirspeed' },
      { kind: 'debug', mode: 'TPA', channel: 4, expected_range: [0, 1500] },
    ],
  },

  // TPA curve input argument. Main-frame `wingTpaArg`; debug fallback
  // DEBUG_TPA ch5 (0..1000 BF-encoded).
  tpa_arg: {
    id: 'tpa_arg',
    perAxis: false,
    sources: () => [
      { kind: 'main_frame', field: 'wingTpaArg' },
      { kind: 'debug', mode: 'TPA', channel: 5, expected_range: [0, 1000] },
    ],
  },

  // TPA factor — the curve OUTPUT applied multiplicatively to PID
  // gains. Main-frame `wingTpaFactor`; debug fallback DEBUG_TPA ch0
  // (0..1000 BF-encoded). Paired with `tpa_arg` for M5 HYPERBOLIC fit.
  tpa_factor: {
    id: 'tpa_factor',
    perAxis: false,
    sources: () => [
      { kind: 'main_frame', field: 'wingTpaFactor' },
      { kind: 'debug', mode: 'TPA', channel: 0, expected_range: [0, 1000] },
    ],
  },

  // Attitude roll angle. Main-frame `wingTpaRoll`; debug fallback
  // DEBUG_TPA ch1 (decidegrees, ±1800 = ±180°).
  attitude_roll: {
    id: 'attitude_roll',
    perAxis: false,
    sources: () => [
      { kind: 'main_frame', field: 'wingTpaRoll' },
      { kind: 'debug', mode: 'TPA', channel: 1, expected_range: [-1800, 1800] },
    ],
  },

  // Attitude pitch angle — consumed by the M3 airspeed model's gravity
  // term. `wingTpaPitch` (USE_WING main-frame) and the standard
  // `attitude[1]` blackbox field are both decidegrees in BF's sign
  // convention (negative = nose-up); debug fallback DEBUG_TPA ch2
  // (decidegrees, ±900 = ±90° gimbal-clamped).
  attitude_pitch: {
    id: 'attitude_pitch',
    perAxis: false,
    sources: () => [
      { kind: 'main_frame', field: 'wingTpaPitch' },
      { kind: 'main_frame', field: 'attitude[1]' },
      { kind: 'debug', mode: 'TPA', channel: 2, expected_range: [-900, 900] },
    ],
  },

  // Calculated post-mixer throttle (distinct from raw `rcCommand[3]`).
  // Main-frame `wingTpaThrottle`; debug fallback DEBUG_TPA ch3 (0..1000).
  throttle_calc: {
    id: 'throttle_calc',
    perAxis: false,
    sources: () => [
      { kind: 'main_frame', field: 'wingTpaThrottle' },
      { kind: 'debug', mode: 'TPA', channel: 3, expected_range: [0, 1000] },
    ],
  },

  // Pre-filter gyro per axis. Used by the Spectrum tab to overlay
  // pre- vs post-filter gyro so the user can see exactly what the
  // filter chain is removing.
  //
  // Source preference: main-frame `gyroUnfilt[axis]` first, debug
  // fallback second. The Blackbox "Gyro (Unfiltered)" toggle is
  // independent of `debug_mode`, so when it's on we get raw gyro as
  // a proper main-frame field and `debug_mode` stays free for
  // whatever wing-tuning module the flight is targeting (TPA / SPA /
  // S_TERM / WING_SETPOINT). DEBUG_GYRO_RAW remains as fallback for
  // older logs.
  //
  // BF naming caveat: the logged `gyroADC[]` is FILTERED despite
  // the name (it's fed from `gyro.gyroADCf[]` per BF's write code in
  // docs/firmware-pr/wing-fields-firmware.patch:168-169), and
  // `gyroUnfilt[]` is the truly unfiltered raw sensor reading.
  gyro_raw: {
    id: 'gyro_raw',
    perAxis: true,
    sources: (axis) => [
      { kind: 'main_frame', field: `gyroUnfilt[${axis}]` },
      { kind: 'debug', mode: 'GYRO_RAW', channel: axis as number },
    ],
  },

  // SPA per-axis attenuation multiplier. Main-frame `wingSpa[axis]`
  // is the modern path; DEBUG_SPA ch=axis (value × 1000) is the
  // pre-USE_WING fallback.
  spa: {
    id: 'spa',
    perAxis: true,
    sources: (axis) => [
      { kind: 'main_frame', field: `wingSpa[${axis}]` },
      { kind: 'debug', mode: 'SPA', channel: axis as number },
    ],
  },

  // Pre-TPA setpoint per axis — what the mixer commanded before
  // TPA airspeed scaling. Main-frame `wingSetpointRaw[axis]`; debug
  // fallback DEBUG_WING_SETPOINT ch 2*axis.
  pre_tpa_setpoint: {
    id: 'pre_tpa_setpoint',
    perAxis: true,
    sources: (axis) => [
      { kind: 'main_frame', field: `wingSetpointRaw[${axis}]` },
      { kind: 'debug', mode: 'WING_SETPOINT', channel: 2 * (axis as number) },
    ],
  },

  // Setpoint after TPA attenuation per axis. Main-frame
  // `wingSetpointAdj[axis]`; debug fallback DEBUG_WING_SETPOINT
  // ch 2*axis + 1.
  adjusted_setpoint: {
    id: 'adjusted_setpoint',
    perAxis: true,
    sources: (axis) => [
      { kind: 'main_frame', field: `wingSetpointAdj[${axis}]` },
      { kind: 'debug', mode: 'WING_SETPOINT', channel: 2 * (axis as number) + 1 },
    ],
  },

  // Pre-TPA S-term — S contribution before TPA scaling. Main-frame
  // `wingSTermRaw[axis]`; debug fallback DEBUG_S_TERM ch 2*axis.
  pre_tpa_s: {
    id: 'pre_tpa_s',
    perAxis: true,
    sources: (axis) => [
      { kind: 'main_frame', field: `wingSTermRaw[${axis}]` },
      { kind: 'debug', mode: 'S_TERM', channel: 2 * (axis as number) },
    ],
  },

  // Post-TPA S-term per axis. Main-frame `wingSTermPost[axis]` is
  // the modern source (all 3 axes always present); `axisS[axis]` is
  // the legacy USE_WING field (yaw skipped if `yaw_type = DIFF_THRUST`,
  // hence sometimes only axes 0/1). DEBUG_S_TERM ch 2*axis+1 is the
  // pre-USE_WING fallback.
  post_tpa_s: {
    id: 'post_tpa_s',
    perAxis: true,
    sources: (axis) => [
      { kind: 'main_frame', field: `wingSTermPost[${axis}]` },
      { kind: 'main_frame', field: `axisS[${axis}]` },
      { kind: 'debug', mode: 'S_TERM', channel: 2 * (axis as number) + 1 },
    ],
  },
};

// ---- firmware version comparison --------------------------------------
//
// BF firmware revision strings vary across versions:
//   · "Betaflight/STM32F411 4.5.0 dev (abc123)"   — newer style
//   · "Betaflight 4.6.0"                           — minimal
//   · "Betaflight 2026.6.0-alpha"                  — year-versioned
//
// Extract the first `<major>.<minor>(.<patch>)?` substring and parse
// as a numeric tuple. Comparison is component-wise.

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Extract a comparable version triple from a BF firmware string, or
 *  null if no `N.N(.N)?` pattern is found. Tolerant — returns null
 *  rather than throwing so the min_firmware gate can permissively
 *  skip when the format isn't recognised. */
export function parseFirmwareVersion(s: string | null | undefined): ParsedVersion | null {
  if (!s) return null;
  const m = s.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  const patch = m[3] !== undefined ? parseInt(m[3], 10) : 0;
  if (!isFinite(major) || !isFinite(minor) || !isFinite(patch)) return null;
  return { major, minor, patch };
}

/** -1 / 0 / +1 comparing a vs b. */
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** True when `logVersion` meets or exceeds `requiredVersion`. Permissive
 *  on parse failure: returns true (don't filter) when either string
 *  can't be parsed. */
function meetsMinFirmware(
  logFirmware: string | null,
  requiredVersion: string,
): boolean {
  const log = parseFirmwareVersion(logFirmware);
  const req = parseFirmwareVersion(requiredVersion);
  if (!log || !req) return true; // permissive
  return compareVersions(log, req) >= 0;
}

// ---- resolution --------------------------------------------------------

type ProbeResult =
  | { state: 'resolved'; via: 'main_frame' | 'debug' }
  | { state: 'inactive'; via: 'main_frame' | 'debug' }
  | {
      state: 'out_of_range';
      via: 'main_frame' | 'debug';
      observed: readonly [number, number];
    }
  | { state: 'missing'; via: 'main_frame' | 'debug' }
  /** Source filtered out by min_firmware — caller should treat as
   *  "try the next source in the preference list" without remembering
   *  this as a fallback (it's not a problem with the log, the source
   *  just isn't a valid candidate). */
  | { state: 'filtered'; via: 'main_frame' | 'debug' };

function debugFieldName(channel: number): string {
  return `debug[${channel}]`;
}

function checkRange(
  sc: { value_min: number | null; value_max: number | null } | undefined,
  expected: readonly [number, number],
): { ok: true } | { ok: false; observed: readonly [number, number] } {
  if (!sc) return { ok: true };
  if (sc.value_min === null || sc.value_max === null) return { ok: true };
  const observed: readonly [number, number] = [sc.value_min, sc.value_max];
  // Inclusive bounds; a small floating-point slop isn't worth modelling
  // — expected_range is set with a deliberately generous margin per
  // signal so values genuinely meant for that signal land well inside.
  if (sc.value_min < expected[0] || sc.value_max > expected[1]) {
    return { ok: false, observed };
  }
  return { ok: true };
}

function probeSource(source: SignalSource, capability: CapabilityReport): ProbeResult {
  // min_firmware gate fires first — if the source isn't eligible at
  // this firmware version, skip without remembering as fallback.
  if (source.min_firmware && !meetsMinFirmware(capability.firmware_revision, source.min_firmware)) {
    return { state: 'filtered', via: source.kind === 'main_frame' ? 'main_frame' : 'debug' };
  }

  if (source.kind === 'main_frame') {
    if (!capability.fields_present.includes(source.field)) {
      return { state: 'missing', via: 'main_frame' };
    }
    const sc = capability.sample_check[source.field];
    if (sc && sc.all_zero) {
      return { state: 'inactive', via: 'main_frame' };
    }
    if (source.expected_range) {
      const rc = checkRange(sc, source.expected_range);
      if (!rc.ok) {
        return { state: 'out_of_range', via: 'main_frame', observed: rc.observed };
      }
    }
    return { state: 'resolved', via: 'main_frame' };
  }
  // debug source: requires both the right debug_mode AND the field present.
  if (capability.debug_mode !== source.mode) {
    return { state: 'missing', via: 'debug' };
  }
  const field = debugFieldName(source.channel);
  if (!capability.fields_present.includes(field)) {
    return { state: 'missing', via: 'debug' };
  }
  const sc = capability.sample_check[field];
  if (sc && sc.all_zero) {
    return { state: 'inactive', via: 'debug' };
  }
  if (source.expected_range) {
    const rc = checkRange(sc, source.expected_range);
    if (!rc.ok) {
      return { state: 'out_of_range', via: 'debug', observed: rc.observed };
    }
  }
  return { state: 'resolved', via: 'debug' };
}

export function resolveSignal(
  id: string,
  axis: Axis | null,
  capability: CapabilityReport,
): ResolveResult {
  const def = SIGNALS[id];
  if (!def) {
    throw new Error(`signalRegistry: unknown signal id "${id}"`);
  }
  if (def.perAxis && axis === null) {
    throw new Error(`signalRegistry: signal "${id}" is per-axis, axis required`);
  }

  // Walk sources in preference order. If we find a `resolved` source,
  // return immediately. Otherwise remember the first informative
  // non-`resolved` fallback — preferring out_of_range > inactive >
  // missing in the diagnostic hierarchy, since out_of_range tells
  // the user something specific is wrong while missing is the
  // catch-all. `filtered` sources (min_firmware gate failed) are
  // skipped entirely — they're not a problem with the log.
  let fallback: ResolveResult | null = null;
  for (const source of def.sources(axis)) {
    const probe = probeSource(source, capability);
    if (probe.state === 'resolved') {
      return { state: 'resolved', via: probe.via, source };
    }
    if (probe.state === 'filtered') {
      continue;
    }
    // Promote fallback only if the new probe is more informative than
    // what we already remembered. Hierarchy: out_of_range > inactive >
    // missing.
    const newRank = fallbackRank(probe.state);
    const oldRank = fallback ? fallbackRank(fallback.state) : -1;
    if (newRank > oldRank) {
      if (probe.state === 'out_of_range') {
        // out_of_range carries diagnostic info; expected_range is guaranteed
        // present on the source because it's what triggered the state.
        fallback = {
          state: 'out_of_range',
          via: probe.via,
          source,
          expected: source.expected_range!,
          observed: probe.observed,
        };
      } else if (probe.state === 'inactive') {
        fallback = { state: 'inactive', via: probe.via, source };
      } else {
        // missing — kept as fallback but the final resolve() returns
        // `missing` (no source) if this is all we have.
        fallback = { state: 'missing' };
      }
    }
  }
  return fallback ?? { state: 'missing' };
}

function fallbackRank(state: 'out_of_range' | 'inactive' | 'missing'): number {
  switch (state) {
    case 'out_of_range': return 2;
    case 'inactive':     return 1;
    case 'missing':      return 0;
  }
}
