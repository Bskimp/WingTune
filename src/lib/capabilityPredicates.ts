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
  airspeedAutoTune:  Capability;
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

// ---- registry-pending stubs --------------------------------------------
//
// These predicates route multi-source signals (main-frame vs debug-mode
// fallback) through src/lib/signalRegistry.ts. The registry isn't built
// yet; shipping these as `blocked` with an honest "registry-pending"
// reason keeps the readiness UI showing the full module list so users
// see what's coming.

function registryPending(module: string): Capability {
  return {
    state: 'blocked',
    reason: `${module} predicate pending — needs signal registry (lib/signalRegistry.ts) for main-frame vs debug-mode source abstraction`,
  };
}

export function checkAirspeedAutoTune(_: CapabilityReport): Capability {
  return registryPending('airspeed auto-tune');
}

export function checkTpaCurveFit(_: CapabilityReport): Capability {
  return registryPending('TPA curve fit');
}

export function checkSpaEffectiveness(_axis: 0 | 1 | 2, _: CapabilityReport): Capability {
  return registryPending('SPA effectiveness');
}

export function checkSTermTpaViz(_axis: 0 | 1 | 2, _: CapabilityReport): Capability {
  return registryPending('S-term TPA viz');
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
    airspeedAutoTune: checkAirspeedAutoTune(capability),
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
