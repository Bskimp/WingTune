// First concrete recommender — emits "enable <debug mode>" suggestions
// when readiness shows a module is blocked specifically due to
// missing debug-mode coverage that the user could fix next flight by
// setting a different BF debug_mode.
//
// Recs are GREEN-confidence (cardinal-rule cleanest case) because the
// criteria are direct measurements from the parser report:
//   1. the target module is currently `blocked`
//   2. the current debug_mode is not the one that would unblock it
// Both verifiable; no inference. The "WingTune is helping you set up
// your next flight to be analyzable" loop is the user-value here.

import type { Capability } from '@/lib/capabilityPredicates';
import type { Recommendation, Recommender } from '@/lib/recommendations';

/** This recommender doesn't read hydrated fields — its criteria are
 *  pure metadata (capability + currentMode). Empty list keeps the
 *  registry-wide union shape simple. */
export const debugModeRequiredFields: readonly string[] = [];

interface RecSpec {
  mode: string;
  moduleLabel: string;
  unlocks: readonly string[];
  /** Returns true if the module(s) needing this debug mode are blocked. */
  isBlocked: (modules: import('@/lib/capabilityPredicates').ModuleReport) => boolean;
}

function allBlocked(perAxis: { roll: Capability; pitch: Capability; yaw: Capability }): boolean {
  return perAxis.roll.state === 'blocked'
    && perAxis.pitch.state === 'blocked'
    && perAxis.yaw.state  === 'blocked';
}

const SPECS: RecSpec[] = [
  {
    mode: 'TPA',
    // DEBUG_TPA unlocks BOTH the BASIC airspeed cross-check AND the
    // M5 HYPERBOLIC TPA curve fit (both read tpa_arg / tpa_factor
    // straight off this mode). The previous WING_SETPOINT spec was
    // stale — the prior `checkTpaCurveFit` derived tpa_factor as
    // adjusted_setpoint/pre_setpoint, but per BF PR #13805 the
    // factor is logged directly as a DEBUG_TPA channel, so we don't
    // need WING_SETPOINT for the curve fit at all.
    moduleLabel: 'DEBUG_TPA analyses',
    unlocks: [
      'firmware-estimator cross-check on the BASIC airspeed fit',
      'M5 HYPERBOLIC TPA curve fit',
    ],
    isBlocked: (m) =>
      m.airspeedAutoTune.tpaCrossCheck.state === 'blocked' ||
      m.tpaCurveFit.state === 'blocked',
  },
  {
    mode: 'SPA',
    moduleLabel: 'SPA effectiveness',
    unlocks: ['SPA effectiveness (per-axis)'],
    isBlocked: (m) => allBlocked(m.spaEffectiveness),
  },
  {
    mode: 'S_TERM',
    moduleLabel: 'S-term TPA visualization',
    unlocks: ['S-term TPA visualization (per-axis)'],
    isBlocked: (m) => allBlocked(m.sTermTpaViz),
  },
];

export const debugModeRecommender: Recommender = ({ capability, modules }) => {
  const out: Recommendation[] = [];
  const currentMode = capability.debug_mode ?? 'NONE';

  for (const spec of SPECS) {
    if (!spec.isBlocked(modules)) continue;
    if (currentMode === spec.mode) continue; // already set; don't re-suggest

    out.push({
      id: `debug-mode-${spec.mode.toLowerCase()}`,
      domain: 'Setup',
      axis: null,
      severity: 'low',
      title: `Enable ${spec.mode} debug logging for ${spec.moduleLabel}`,
      summary: `Unlock ${spec.unlocks.join(' / ')} on future flights of this craft.`,
      detail:
        `WingTune's ${spec.moduleLabel} analysis needs the ${spec.mode} debug ` +
        `channels populated. The current log uses debug_mode = ${currentMode}, ` +
        `so this analysis is unavailable for this flight. Set debug_mode = ` +
        `${spec.mode} in the BF config before your next flight to populate ` +
        `the channels — WingTune will then surface the ${spec.moduleLabel} ` +
        `insights for that flight. Note: BF logs one debug mode per flight, ` +
        `so if you want multiple wing-analysis modules, alternate the debug ` +
        `mode across flights.`,
      current:   [['debug_mode', currentMode]] as const,
      suggested: [['debug_mode', spec.mode]]    as const,
      cli: [`set debug_mode = ${spec.mode}`],
      confidence: 'green',
      criteria_met: [
        `${spec.moduleLabel} is currently blocked in the readiness report`,
        `current debug_mode (${currentMode}) is not ${spec.mode}`,
      ],
      criteria_failed: [],
    });
  }

  return out;
};
