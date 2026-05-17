// Per-axis recommendations derived from the PIDFS mean-abs share
// distribution computed by `lib/pidfs.ts`. Two checks ship in this
// slice:
//
//   1. High-P-low-D  — surfaces the "P-term is doing too much / D
//      is barely engaging" pattern. Often presents as setpoint
//      overshoot during aggressive maneuvers.
//   2. I-term dominance — I share elevated past a threshold; suggests
//      sustained tracking error that the controller is integrating
//      to chase (windup risk).
//
// Both emit at YELLOW confidence: share-based diagnostics are
// heuristic, not measurement-grade. A green-confidence equivalent
// would need windowed share analysis over isolated maneuver
// segments (M2.x work, not this slice). The cardinal-rule copy-CLI
// affordance is absent here because we don't have the user's
// current P/I/D values (would need CLI-dump header parsing — also
// M2.x). Recs are descriptive-only with an empty `cli: []`.
//
// Axis-skip logic: a check is skipped on any axis where its
// required field is missing or all-zero. Yaw commonly has no D
// or S on wings — don't false-positive there.

import { pidfsShares, type PIDFSArrays } from '@/lib/pidfs';
import type {
  Recommendation,
  Recommender,
  AxisShort,
} from '@/lib/recommendations';
import type { CapabilityReport } from '@/lib/wasmBridge';

const AXES: ReadonlyArray<{ id: 0 | 1 | 2; name: string; short: AxisShort }> = [
  { id: 0, name: 'Roll',  short: 'R' },
  { id: 1, name: 'Pitch', short: 'P' },
  { id: 2, name: 'Yaw',   short: 'Y' },
];

/** Field IDs we need to hydrate for share computation across all
 *  three axes. Eager-hydrated by AnalysisView on log load. */
export const pidfsSharesRequiredFields: readonly string[] = AXES.flatMap((a) => [
  `axisP[${a.id}]`,
  `axisI[${a.id}]`,
  `axisD[${a.id}]`,
  `axisF[${a.id}]`,
  `axisS[${a.id}]`,
]);

function isActiveField(capability: CapabilityReport, name: string): boolean {
  if (!capability.fields_present.includes(name)) return false;
  const sc = capability.sample_check[name];
  return !sc?.all_zero;
}

function collectActiveArrays(
  axisId: 0 | 1 | 2,
  capability: CapabilityReport,
  fields: ReadonlyMap<string, Float32Array>,
): PIDFSArrays {
  const out: PIDFSArrays = {};
  for (const term of ['P', 'I', 'D', 'F', 'S'] as const) {
    const name = `axis${term}[${axisId}]`;
    if (!isActiveField(capability, name)) continue;
    const arr = fields.get(name);
    if (arr && arr.length > 0) out[term] = arr;
  }
  return out;
}

// Thresholds — tuned conservatively. The whole point of yellow
// confidence is "worth a look", not "definite problem".

const HIGH_P_THRESHOLD       = 0.45;  // P share > 45%
const LOW_D_THRESHOLD        = 0.08;  // D share < 8%
const I_DOMINANCE_LOW        = 0.40;  // 40% → low severity
const I_DOMINANCE_MEDIUM     = 0.55;  // 55% → medium severity
const I_DOMINANCE_HIGH       = 0.70;  // 70% → high severity

const fmtPct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

export const pidfsSharesRecommender: Recommender = ({ capability, fields }) => {
  const recs: Recommendation[] = [];

  for (const axis of AXES) {
    const arrays = collectActiveArrays(axis.id, capability, fields);
    if (!arrays.P || !arrays.I) {
      // Without P + I active, share math isn't meaningful on this axis.
      // (Could be a freshly-loaded log where hydration hasn't completed
      // yet; the computed re-runs as fields arrive.)
      continue;
    }
    const shares = pidfsShares(arrays);

    // -------- check 1: high P + low D --------
    //
    // Brian's "P too high" observation surfaces here. Only emit when
    // D is genuinely ACTIVE on this axis — yaw commonly has no D, and
    // an absent-D axis shouldn't false-positive a "low D" alert.
    if (arrays.D && shares.P > HIGH_P_THRESHOLD && shares.D < LOW_D_THRESHOLD) {
      recs.push({
        id: `pidfs-high-p-low-d-${axis.short.toLowerCase()}`,
        domain: 'PID',
        axis: axis.short,
        severity: 'low',
        title: `${axis.name}: high P with minimal D`,
        summary:
          `${axis.name} P-term carries ${fmtPct(shares.P)} of mean-abs ` +
          `controller output while D-term is only ${fmtPct(shares.D)}.`,
        detail:
          `This pattern often presents as setpoint overshoot during ` +
          `aggressive maneuvers — the controller has plenty of restoring ` +
          `proportional force but minimal damping to brake against ` +
          `overshoot.\n\n` +
          `Things to investigate before changing gains:\n` +
          `· Setpoint tracking on ${axis.name.toLowerCase()} — visible ` +
          `overshoot after step inputs?\n` +
          `· D-term spectrum (M4) — is D-term filtering eating most of its ` +
          `contribution?\n` +
          `· On wings: PIDFS S-term carries some of what D would on a quad. ` +
          `Check S-term share before reaching for more D.\n\n` +
          `If the pattern is real, options are typically: reduce P slightly, ` +
          `increase D, or (on a wing) lean on S more. WingTune can't suggest ` +
          `specific PID numbers yet because we don't parse the BF CLI dump ` +
          `from headers — that's M2.x work.`,
        current: undefined,
        suggested: undefined,
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `P share ${fmtPct(shares.P)} exceeds ${fmtPct(HIGH_P_THRESHOLD)} threshold`,
          `D share ${fmtPct(shares.D)} is below ${fmtPct(LOW_D_THRESHOLD)} threshold`,
          `D-term field axisD[${axis.id}] is logged + active (not disabled in firmware)`,
        ],
        criteria_failed: [
          `share-based heuristic — not a windowed maneuver-segment analysis ` +
          `(that's M2.x)`,
          `current PID values not parsed from BF CLI dump — no concrete CLI ` +
          `delta proposed`,
        ],
      });
    }

    // -------- check 2: I-term dominance --------
    if (shares.I > I_DOMINANCE_LOW) {
      const severity: Recommendation['severity'] =
        shares.I > I_DOMINANCE_HIGH ? 'high'
        : shares.I > I_DOMINANCE_MEDIUM ? 'medium'
        : 'low';

      recs.push({
        id: `pidfs-i-dominance-${axis.short.toLowerCase()}`,
        domain: 'PID',
        axis: axis.short,
        severity,
        title: `${axis.name}: I-term dominates controller output`,
        summary:
          `${axis.name} I-term carries ${fmtPct(shares.I)} of mean-abs ` +
          `controller output (dominant term: ${shares.dominant ?? '—'}).`,
        detail:
          `Elevated I share means the integral term is carrying a large ` +
          `fraction of the controller's work — usually because P alone ` +
          `can't keep up with sustained error, so the integral accumulates ` +
          `and chases. This can present as:\n\n` +
          `· I-windup during sustained setpoint deviation (e.g. a banked ` +
          `turn the controller never quite catches up on)\n` +
          `· Lag and overshoot when the input changes suddenly and the ` +
          `accumulated I has to unwind\n` +
          `· On wings: this is exactly the pattern SPA's I_FREEZE / ` +
          `PD_I_FREEZE modes are designed to prevent. If you're seeing ` +
          `this on ${axis.name.toLowerCase()}, enabling SPA on that axis ` +
          `is one of the lower-risk corrective actions.\n\n` +
          `Confidence is yellow because elevated mean-abs share alone ` +
          `doesn't conclusively prove windup vs. a healthy I doing its ` +
          `job — windowed analysis (M2.x) will tighten this.`,
        current: undefined,
        suggested: undefined,
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `I share ${fmtPct(shares.I)} exceeds ${fmtPct(I_DOMINANCE_LOW)} threshold`,
          `I-term field axisI[${axis.id}] is logged + active`,
        ],
        criteria_failed: [
          `share-based heuristic — windup detection needs windowed ` +
          `event-segment analysis (M2.x)`,
        ],
      });
    }
  }

  return recs;
};
