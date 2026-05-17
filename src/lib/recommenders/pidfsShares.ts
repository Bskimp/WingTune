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

import { pidfsShares, type PIDFSArrays, type PIDFSTerm } from '@/lib/pidfs';
import type {
  Recommendation,
  Recommender,
  AxisShort,
  EvidencePoint,
} from '@/lib/recommendations';
import type { CapabilityReport } from '@/lib/wasmBridge';

/** Index of the largest absolute value in a Float32Array. Single
 *  pass, no boxing. Used to anchor evidence chips to the moment
 *  each term peaked. */
function argMaxAbs(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let bestIdx = 0;
  let bestAbs = arr[0] < 0 ? -arr[0] : arr[0];
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i] < 0 ? -arr[i] : arr[i];
    if (a > bestAbs) {
      bestAbs = a;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Build a one-point evidence chip pointing at the moment the
 *  given term peaked (in absolute value). Returns empty array if
 *  the term array or time axis isn't usable. */
function peakEvidence(
  term: PIDFSTerm,
  arr: Float32Array | undefined,
  time: Float32Array,
): EvidencePoint[] {
  if (!arr || arr.length === 0 || time.length === 0) return [];
  const idx = argMaxAbs(arr);
  const safeIdx = Math.min(idx, time.length - 1);
  return [{
    time_sec: time[safeIdx],
    label: `max |${term}| @ ${time[safeIdx].toFixed(2)}s`,
  }];
}

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
const F_EXCESSIVE_THRESHOLD  = 0.40;  // F share > 40% → flag
const S_BARELY_THRESHOLD     = 0.02;  // S share < 2% AND S is logged + active

const fmtPct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

export const pidfsSharesRecommender: Recommender = ({ capability, fields, time }) => {
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
        evidence: peakEvidence('P', arrays.P, time),
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
        evidence: peakEvidence('I', arrays.I, time),
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

    // -------- check 3: F-term excessive --------
    //
    // Excessive feedforward shows up as crisp setpoint following at
    // the cost of overshoot on step inputs. Not always wrong — some
    // wing pilots tune F aggressively on purpose — but worth flagging.
    if (arrays.F && shares.F > F_EXCESSIVE_THRESHOLD) {
      recs.push({
        id: `pidfs-f-excessive-${axis.short.toLowerCase()}`,
        domain: 'PID',
        axis: axis.short,
        severity: 'low',
        title: `${axis.name}: F-term share elevated`,
        summary:
          `${axis.name} feedforward carries ${fmtPct(shares.F)} of mean-abs ` +
          `controller output.`,
        detail:
          `Aggressive F gives crisp setpoint tracking — the controller jumps ` +
          `to the new commanded rate ahead of the gyro catching up. Useful in ` +
          `acro contexts; can become a liability if step inputs are followed ` +
          `by overshoot the rest of the controller has to clean up.\n\n` +
          `What to investigate:\n` +
          `· Setpoint tracking on ${axis.name.toLowerCase()} — does the gyro ` +
          `overshoot the setpoint immediately after a step?\n` +
          `· Step response (M-step, future) — peak / settle metrics on ` +
          `${axis.name.toLowerCase()} steps\n` +
          `· If your flight style is smooth cruising rather than acro, F is ` +
          `often over-tuned by default for wings — leaning it back lets P + D ` +
          `do more of the work without the overshoot penalty.\n\n` +
          `Confidence is yellow — share-based heuristic. The real signal is ` +
          `post-step overshoot, which needs M-step analytics.`,
        current: undefined,
        suggested: undefined,
        cli: [],
        evidence: peakEvidence('F', arrays.F, time),
        confidence: 'yellow',
        criteria_met: [
          `F share ${fmtPct(shares.F)} exceeds ${fmtPct(F_EXCESSIVE_THRESHOLD)} threshold`,
          `F-term field axisF[${axis.id}] is logged + active`,
        ],
        criteria_failed: [
          `overshoot detection needs step-response analysis (M-step, future)`,
        ],
      });
    }

    // -------- check 4: S-term barely engaging --------
    //
    // S-term is the wing-specific PIDFS contribution. Logged + active
    // but with a tiny share suggests S gain may be set too
    // conservatively — the wing might benefit from more S. Skips axes
    // where S is missing or all-zero (those are firmware-disabled,
    // already surfaced by the capability layer).
    if (arrays.S && shares.S < S_BARELY_THRESHOLD) {
      recs.push({
        id: `pidfs-s-barely-${axis.short.toLowerCase()}`,
        domain: 'PID',
        axis: axis.short,
        severity: 'info',
        title: `${axis.name}: S-gain barely engaging`,
        summary:
          `${axis.name} S-term contributes only ${fmtPct(shares.S)} of ` +
          `mean-abs controller output, even though axisS[${axis.id}] is ` +
          `logged and active.`,
        detail:
          `S-term is the wing-specific PIDFS contribution — designed to ` +
          `share the load that D-term carries on quads. A very small S ` +
          `share usually means S gain is set conservatively, the wing isn't ` +
          `being flown aggressively enough to engage it, or both.\n\n` +
          `If this is a cruising-style flight, low S share is expected — ` +
          `S exists for aggressive setpoint changes. If you ARE flying ` +
          `aggressively and still seeing this, consider raising S gain ` +
          `incrementally to let it absorb more of the controller work.\n\n` +
          `Confidence is yellow because we can't distinguish "S gain low" ` +
          `from "pilot flying conservatively" without flight-style analysis. ` +
          `Worth checking if you've been getting overshoot or oscillation ` +
          `that D alone is struggling with.`,
        current: undefined,
        suggested: undefined,
        cli: [],
        evidence: peakEvidence('S', arrays.S, time),
        confidence: 'yellow',
        criteria_met: [
          `S share ${fmtPct(shares.S)} is below ${fmtPct(S_BARELY_THRESHOLD)} threshold`,
          `S-term field axisS[${axis.id}] is logged + active (S-gain not disabled in firmware)`,
        ],
        criteria_failed: [
          `can't distinguish "S gain too low" from "smooth flying style" ` +
          `without flight-style classification (future)`,
        ],
      });
    }
  }

  return recs;
};
