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

import type { CapabilityReport } from '@/lib/wasmBridge';

// ---- type contracts ----------------------------------------------------

export type SignalSource =
  | { kind: 'main_frame'; field: string }
  | { kind: 'debug'; mode: string; channel: number };

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
  | { state: 'missing' };

// ---- signal definitions ------------------------------------------------
//
// Source mappings ground-truthed against the merged BF PRs that
// introduced these debug modes:
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
  // Airspeed estimator output (PR #13895). Active whenever
  // `debug_mode = TPA` regardless of which estimator model is
  // configured (BASIC or ADVANCED — WingTune just reads the value;
  // the user's BF `tpa_speed_adv_*` tuning params are firmware-side).
  // Also requires `gps_use_3d_speed = ON` in the BF config; we can't
  // see that from the parser's scan report (it's a CLI param, not
  // logged), so we surface a GPS-present check as proxy.
  //
  // TODO verify exact DEBUG_TPA channel index — best guess channel 0.
  // Open question for Brian: which channel of DEBUG_TPA carries the
  // speed estimate vs the throttle/pitch references in the PR's graph?
  tpa_speed_est: {
    id: 'tpa_speed_est',
    perAxis: false,
    sources: () => [
      { kind: 'debug', mode: 'TPA', channel: 0 },
    ],
  },

  // TPA argument — the final scaling argument BF feeds into the TPA
  // curve (clamped 0..1). M3's fit needs this alongside the speed
  // estimate so the curve can be characterised independently of the
  // raw speed channel. Debug-mode-only via TPA.
  //
  // TODO verify exact DEBUG_TPA channel index — best guess channel 1.
  // See `project-bf-wing-debug-modes` memory for the channel layout
  // once it's pinned against the BF source.
  tpa_arg: {
    id: 'tpa_arg',
    perAxis: false,
    sources: () => [
      { kind: 'debug', mode: 'TPA', channel: 1 },
    ],
  },

  // TPA factor — the curve OUTPUT applied multiplicatively to PID
  // gains. Paired with `tpa_arg` (curve input) to fit the HYPERBOLIC
  // curve in M5. Per PR #13805 + the existing wing-support YAML this
  // ships as a DEBUG_TPA channel.
  //
  // TODO verify exact DEBUG_TPA channel index — best guess channel 2
  // (tpa_speed_est = 0, tpa_arg = 1, tpa_factor = 2 is the natural
  // ordering and matches BF's `debug_set` pattern for TPA). Brian to
  // confirm once a clean DEBUG_TPA wing log is available.
  tpa_factor: {
    id: 'tpa_factor',
    perAxis: false,
    sources: () => [
      { kind: 'debug', mode: 'TPA', channel: 2 },
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

  // SPA per-axis attenuation multiplier. Debug-mode source only;
  // not exposed as a main-frame field (config-only header fields
  // `spa_center` / `spa_width` / `spa_mode` describe the curve but
  // the runtime multiplier lands only via DEBUG_SPA).
  spa: {
    id: 'spa',
    perAxis: true,
    sources: (axis) => [
      { kind: 'debug', mode: 'SPA', channel: axis as number },
    ],
  },

  // Pre-TPA setpoint per axis — what the mixer commanded before
  // TPA airspeed scaling. Debug-mode-only via WING_SETPOINT.
  pre_tpa_setpoint: {
    id: 'pre_tpa_setpoint',
    perAxis: true,
    sources: (axis) => [
      { kind: 'debug', mode: 'WING_SETPOINT', channel: 2 * (axis as number) },
    ],
  },

  // Setpoint after TPA attenuation per axis. Debug-mode-only via
  // WING_SETPOINT (odd channels).
  adjusted_setpoint: {
    id: 'adjusted_setpoint',
    perAxis: true,
    sources: (axis) => [
      { kind: 'debug', mode: 'WING_SETPOINT', channel: 2 * (axis as number) + 1 },
    ],
  },

  // Pre-TPA S-term — S contribution before TPA scaling.
  // Debug-mode-only via S_TERM (even channels).
  pre_tpa_s: {
    id: 'pre_tpa_s',
    perAxis: true,
    sources: (axis) => [
      { kind: 'debug', mode: 'S_TERM', channel: 2 * (axis as number) },
    ],
  },

  // Post-TPA S-term per axis. Has both a USE_WING main-frame field
  // (axisS[axis]) and a debug-mode source — preferred order is
  // main-frame first since that's the modern path and is always
  // present in USE_WING builds.
  post_tpa_s: {
    id: 'post_tpa_s',
    perAxis: true,
    sources: (axis) => [
      { kind: 'main_frame', field: `axisS[${axis}]` },
      { kind: 'debug', mode: 'S_TERM', channel: 2 * (axis as number) + 1 },
    ],
  },
};

// ---- resolution --------------------------------------------------------

interface SourceProbe {
  state: 'resolved' | 'inactive' | 'missing';
  via: 'main_frame' | 'debug';
}

function debugFieldName(channel: number): string {
  return `debug[${channel}]`;
}

function probeSource(source: SignalSource, capability: CapabilityReport): SourceProbe {
  if (source.kind === 'main_frame') {
    if (!capability.fields_present.includes(source.field)) {
      return { state: 'missing', via: 'main_frame' };
    }
    const sc = capability.sample_check[source.field];
    if (sc && sc.all_zero) {
      return { state: 'inactive', via: 'main_frame' };
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
  // return immediately. If we find an `inactive` source, remember it
  // as a fallback (active disabled in FW is a meaningful distinct
  // state from "missing entirely"). If everything's `missing`, return
  // missing.
  let fallback: ResolveResult | null = null;
  for (const source of def.sources(axis)) {
    const probe = probeSource(source, capability);
    if (probe.state === 'resolved') {
      return { state: 'resolved', via: probe.via, source };
    }
    if (probe.state === 'inactive' && fallback === null) {
      fallback = { state: 'inactive', via: probe.via, source };
    }
  }
  return fallback ?? { state: 'missing' };
}
