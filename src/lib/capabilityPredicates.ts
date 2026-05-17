// Layer 2 — capability predicates (the first half of the two-layer
// trust model from `wingtune-confidence-scoring`).
//
// A capability predicate answers "can this analysis module run against
// this log?" — independent of how trustworthy any output would be
// (that's confidence's job). The same predicate function is the
// source of truth for:
//
//   · runtime UI (M1.6 readiness report — this commit)
//   · module runner (refuses to start a module returning `blocked`)
//   · validate-parser corpus regression (cross-checks per-log
//     `expected.modules_runnable`)
//
// That triple-coverage is the invariant — never duplicate predicate
// logic into the UI / runner / test harness.
//
// THIS SLICE: ships the type contracts + the two predicates that
// don't need the multi-source signal registry (basicViewing,
// pidfsDecomp). TPA / SPA / airspeed predicates are stubbed as
// `state: 'blocked'` with a "registry-pending" reason — they're
// gated on `src/lib/signalRegistry.ts` which lands in the M1.6
// follow-up slice. Stubbing rather than omitting keeps the
// ReadinessCard rendering the full module list so users see what's
// coming.

import type { CapabilityReport, SampleCheck } from '@/lib/wasmBridge';
import { resolveSignal, type Axis } from '@/lib/signalRegistry';

// ---- type contracts (skill-spec'd) -------------------------------------

export type CapabilityState = 'available' | 'partial' | 'inactive' | 'blocked';

export interface Capability {
  state: CapabilityState;
  /** Human-readable; surfaced in the readiness report as the second
   *  line under the module name. Required for `blocked` and `partial`,
   *  recommended for `inactive`. */
  reason?: string;
  /** Which source path the signal-registry walk resolved through.
   *  Surfaced as a "(via …)" suffix in the UI. Only meaningful for
   *  predicates that route through the registry; basicViewing /
   *  pidfsDecomp leave this undefined. */
  via?: 'main_frame' | 'debug' | 'mixed';
}

/** Three-state field presence. Single-source signals get classified
 *  via `presenceOf`; multi-source signals use `resolveSignal()` (M1.6
 *  follow-up, not in this commit). */
export type FieldPresence = 'missing' | 'zero' | 'active';

export interface ModuleReport {
  basicViewing:      Capability;
  pidfsDecomp:       { roll: Capability; pitch: Capability; yaw: Capability };
  /** Airspeed auto-tune surfaces as TWO separate readiness items:
   *
   *   · basicFit — can the BASIC airspeed model fit run? Needs GPS
   *     present + locked. Independent of debug_mode.
   *   · tpaCrossCheck — can we cross-validate the BASIC fit against
   *     BF's own `tpa_speed_est`? Needs `debug_mode = TPA`. Bonus
   *     confidence, not a prerequisite.
   *
   *  Previously these were packed into a single `Capability` whose
   *  state conflated two distinct concerns — readers couldn't tell
   *  whether "partial" meant "no DEBUG_TPA" or "no GPS." Splitting
   *  also fixes a latent bug in debugModeRecommender where the
   *  `set debug_mode = TPA` rec fired on the GPS-missing path (which
   *  setting DEBUG_TPA doesn't fix). */
  airspeedAutoTune: {
    basicFit:      Capability;
    tpaCrossCheck: Capability;
  };
  tpaCurveFit:       Capability;
  spaEffectiveness:  { roll: Capability; pitch: Capability; yaw: Capability };
  sTermTpaViz:       { roll: Capability; pitch: Capability; yaw: Capability };
}

// ---- single-source presence helper -------------------------------------

export function presenceOf(
  fieldName: string,
  capability: CapabilityReport,
): FieldPresence {
  if (!capability.fields_present.includes(fieldName)) return 'missing';
  const sc: SampleCheck | undefined = capability.sample_check[fieldName];
  if (sc && sc.all_zero) return 'zero';
  return 'active';
}

// ---- predicates --------------------------------------------------------

/** Can the user view raw fields and time-domain charts at all? If we
 *  have a non-empty fields_present list, yes — this is the floor of
 *  the analysis stack. */
export function checkBasicViewing(capability: CapabilityReport): Capability {
  if (capability.fields_present.length === 0) {
    return { state: 'blocked', reason: 'no fields in scan report' };
  }
  if (capability.total_frames === 0) {
    return { state: 'blocked', reason: 'no main frames decoded' };
  }
  return { state: 'available' };
}

/** Per-axis PIDFS decomposition. Needs axisP / axisI / axisD / axisF
 *  for the requested axis; axisS is the wing-specific term and its
 *  absence downgrades to `partial` (PIDF-without-S) rather than
 *  blocking the whole module. axisS is single-source (main-frame
 *  USE_WING — no debug fallback), so direct presenceOf is correct
 *  here per the skill. */
export function checkPidfsDecomp(
  axis: 0 | 1 | 2,
  capability: CapabilityReport,
): Capability {
  const core = ['axisP', 'axisI', 'axisD', 'axisF'].map((t) => `${t}[${axis}]`);
  const corePresence = core.map((f) => presenceOf(f, capability));

  const anyMissing = corePresence.some((p) => p === 'missing');
  if (anyMissing) {
    const missing = core.filter((_, i) => corePresence[i] === 'missing');
    return {
      state: 'blocked',
      reason: `missing core PIDFS field(s): ${missing.join(', ')}`,
    };
  }

  const anyZero = corePresence.some((p) => p === 'zero');
  if (anyZero) {
    const zero = core.filter((_, i) => corePresence[i] === 'zero');
    return {
      state: 'inactive',
      reason: `core term(s) logged but all zero: ${zero.join(', ')}`,
    };
  }

  // S-term: optional. Missing → partial (PIDF without S). Zero → still
  // partial-with-context: S gain disabled in firmware.
  const sName = `axisS[${axis}]`;
  const sPresence = presenceOf(sName, capability);
  if (sPresence === 'missing') {
    return {
      state: 'partial',
      reason: `${sName} not logged — falling back to PIDF without S`,
    };
  }
  if (sPresence === 'zero') {
    return {
      state: 'partial',
      reason: `${sName} always zero — S gain disabled in firmware`,
    };
  }

  return { state: 'available' };
}

// ---- multi-source predicates (signal-registry-routed) ------------------
//
// These call resolveSignal() rather than naming a debug_mode string or
// main-frame field directly — the load-bearing invariant of the
// capability layer. When BF 2026.6 lands (or a partial PR), only
// signalRegistry.ts changes; predicate code stays put.
//
// `combineVia` rolls two/three signal resolutions into a single
// `via` for the Capability return — if all signals resolved through
// the same source, that's the via; otherwise it's `mixed`.

function combineVia(
  vias: ReadonlyArray<'main_frame' | 'debug'>,
): 'main_frame' | 'debug' | 'mixed' {
  if (vias.length === 0) return 'main_frame';
  const first = vias[0];
  return vias.every((v) => v === first) ? first : 'mixed';
}

/** TPA curve fit reads `tpa_arg` (curve input) + `tpa_factor` (curve
 *  output) directly from the DEBUG_TPA channel pair, and fits the
 *  HYPERBOLIC curve formula from BF PR #13805 against the scatter
 *  (see docs/firmware-reference/tpa-hyperbolic-spec.md). Both signals
 *  share the same `debug_mode = TPA` requirement, so this collapses
 *  to a single signal-pair check on the M3 setup. */
export function checkTpaCurveFit(capability: CapabilityReport): Capability {
  const arg    = resolveSignal('tpa_arg', null, capability);
  const factor = resolveSignal('tpa_factor', null, capability);
  if (arg.state === 'missing' || factor.state === 'missing') {
    return {
      state: 'blocked',
      reason: 'set `debug_mode = TPA` in BF to log `tpa_arg` + `tpa_factor` (M5 fits the curve from this scatter)',
    };
  }
  if (arg.state === 'inactive' || factor.state === 'inactive') {
    return {
      state: 'inactive',
      reason: 'DEBUG_TPA channels logged but always zero — check `gps_use_3d_speed = ON` in BF',
      via: combineVia([arg.via, factor.via]),
    };
  }
  return { state: 'available', via: combineVia([arg.via, factor.via]) };
}

/** Airspeed BASIC fit — can the M3 BASIC airspeed model fit run on
 *  this log? Pure GPS check (presence + lock). Independent of
 *  debug_mode entirely. */
export function checkAirspeedBasicFit(capability: CapabilityReport): Capability {
  if (!capability.gps_present) {
    return {
      state: 'blocked',
      reason: 'no GPS frames in this log — wing needs a GPS module wired + `set gps_use_3d_speed = ON` in BF',
    };
  }
  const speedCheck = capability.sample_check['gps:GPS_speed'];
  if (speedCheck && speedCheck.all_zero) {
    return {
      state: 'inactive',
      reason: 'GPS frames present but never got a satellite lock — gps:GPS_speed all zero across the flight',
    };
  }
  return { state: 'available' };
}

/** DEBUG_TPA firmware cross-check — can we read BF's own
 *  `tpa_speed_est` to cross-validate our BASIC fit? Needs
 *  `debug_mode = TPA`. Strictly bonus confidence; the BASIC fit
 *  itself is runnable without this. */
export function checkAirspeedTpaCrossCheck(capability: CapabilityReport): Capability {
  const speed = resolveSignal('tpa_speed_est', null, capability);
  if (speed.state === 'missing') {
    return {
      state: 'blocked',
      reason: 'set `debug_mode = TPA` in BF for the firmware-estimator cross-check (bonus confidence on the BASIC fit)',
    };
  }
  if (speed.state === 'inactive') {
    return {
      state: 'inactive',
      reason: 'DEBUG_TPA channel logged but always zero — check `gps_use_3d_speed = ON` in BF',
      via: speed.via,
    };
  }
  return { state: 'available', via: speed.via };
}

/** Per-axis SPA effectiveness needs the spa multiplier trace for the
 *  requested axis. Debug-mode-only signal (no main-frame source). */
export function checkSpaEffectiveness(axis: Axis, capability: CapabilityReport): Capability {
  const spa = resolveSignal('spa', axis, capability);
  if (spa.state === 'missing') {
    const ax = ['roll', 'pitch', 'yaw'][axis];
    return {
      state: 'blocked',
      reason: `set \`debug_mode = SPA\` in BF to log per-axis SPA multiplier (need ${ax} channel populated)`,
    };
  }
  if (spa.state === 'inactive') {
    const ax = ['roll', 'pitch', 'yaw'][axis];
    return {
      state: 'inactive',
      reason: `SPA on ${ax} logged but always zero — SPA disabled for this axis`,
      via: spa.via,
    };
  }
  return { state: 'available', via: spa.via };
}

/** Per-axis S-term TPA visualization compares the pre-TPA S contribution
 *  to the post-TPA `axisS[i]`. Post-TPA is single-source main-frame
 *  USE_WING; pre-TPA is debug-mode-only via S_TERM. Needs both. */
export function checkSTermTpaViz(axis: Axis, capability: CapabilityReport): Capability {
  const ax = ['roll', 'pitch', 'yaw'][axis];

  // post-TPA s-term: single-source (axisS is main-frame USE_WING only)
  const post = presenceOf(`axisS[${axis}]`, capability);
  if (post === 'missing') {
    return {
      state: 'blocked',
      reason: `post-TPA S-term \`axisS[${axis}]\` not logged — needed for the ${ax} comparison view (USE_WING build required)`,
    };
  }

  // pre-TPA s-term: debug-only via S_TERM mode
  const pre = resolveSignal('pre_tpa_s', axis, capability);
  if (pre.state === 'missing') {
    return {
      state: 'blocked',
      reason: `set \`debug_mode = S_TERM\` in BF to log pre-/post-TPA S-term per axis (need ${ax} channel populated)`,
    };
  }
  if (post === 'zero' || pre.state === 'inactive') {
    return {
      state: 'inactive',
      reason: `${ax} S-term traces logged but always zero — S gain disabled for this axis`,
      via: pre.via,
    };
  }
  return { state: 'available', via: pre.via };
}

// ---- aggregator --------------------------------------------------------

export function evaluateModules(capability: CapabilityReport): ModuleReport {
  return {
    basicViewing:     checkBasicViewing(capability),
    pidfsDecomp: {
      roll:  checkPidfsDecomp(0, capability),
      pitch: checkPidfsDecomp(1, capability),
      yaw:   checkPidfsDecomp(2, capability),
    },
    airspeedAutoTune: {
      basicFit:      checkAirspeedBasicFit(capability),
      tpaCrossCheck: checkAirspeedTpaCrossCheck(capability),
    },
    tpaCurveFit:      checkTpaCurveFit(capability),
    spaEffectiveness: {
      roll:  checkSpaEffectiveness(0, capability),
      pitch: checkSpaEffectiveness(1, capability),
      yaw:   checkSpaEffectiveness(2, capability),
    },
    sTermTpaViz: {
      roll:  checkSTermTpaViz(0, capability),
      pitch: checkSTermTpaViz(1, capability),
      yaw:   checkSTermTpaViz(2, capability),
    },
  };
}
