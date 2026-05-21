// M-Coupling cross-axis coupling recommender — diagnostic-only.
//
// Runs maneuver detection + the 3x3 coupling analysis, emits a yellow
// rec per off-diagonal cell whose coupling clears the significance
// threshold on a commanded axis with enough single-axis snaps to
// trust the row. No CLI — ever: cross-axis coupling has no firmware
// `set` fix. The cause is an asymmetric mixer, an off-spec CG, or a
// mechanical bind, all diagnosed and corrected off-tool. Per
// wingtune-recommender I7, a yellow diagnostic rec carrying no
// paste-ready CLI is the correct shape here.

import { detectManeuvers } from '@/lib/maneuverDetect';
import {
  analyzeCoupling,
  MIN_WINDOWS_FOR_COUPLING,
} from '@/lib/coupling';
import { resolveTuneProfile, thresholdsFor } from '@/lib/tuneProfile';
import type { Recommendation, Recommender, AxisShort } from '@/lib/recommendations';

export const couplingRequiredFields: readonly string[] = [
  'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
  'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]',
];

const AXIS_LABEL = ['Roll', 'Pitch', 'Yaw'] as const;
const AXIS_SHORT: Record<0 | 1 | 2, AxisShort> = { 0: 'R', 1: 'P', 2: 'Y' };

export const couplingRecommender: Recommender = ({ fields, time, profile }) => {
  const out: Recommendation[] = [];
  if (time.length < 3) return out;

  const sp = [0, 1, 2].map((a) => fields.get(`setpoint[${a}]`));
  if (!sp.some(Boolean)) return out;
  const gyro = [0, 1, 2].map((a) => fields.get(`gyroADC[${a}]`));
  if (!gyro.some(Boolean)) return out;

  const maneuvers = detectManeuvers(sp, time);
  if (maneuvers.length === 0) return out;

  const result = analyzeCoupling({ gyro, time, maneuvers });
  // M-Style: the significance threshold tracks the tune-style dial — a
  // 3D plane tolerates more cross-axis coupling than a cruiser.
  const sig = thresholdsFor(resolveTuneProfile(profile)).couplingSignificance;
  const flagPct = Math.round(sig * 100);

  for (let c = 0 as 0 | 1 | 2; c <= 2; c = (c + 1) as 0 | 1 | 2) {
    const windows = result.sampleCount[c];
    if (windows < MIN_WINDOWS_FOR_COUPLING) continue; // row not trustworthy

    for (let r = 0 as 0 | 1 | 2; r <= 2; r = (r + 1) as 0 | 1 | 2) {
      if (c === r) continue;
      const value = result.matrix[c][r];
      if (!Number.isFinite(value)) continue;
      const magnitude = Math.abs(value);
      if (magnitude < sig) continue;

      const cmd = AXIS_LABEL[c];
      const resp = AXIS_LABEL[r];
      const respLower = resp.toLowerCase();
      const cmdLower = cmd.toLowerCase();
      const pct = Math.round(magnitude * 100);
      const strong = magnitude >= 2 * sig;

      out.push({
        id: `coupling-${AXIS_SHORT[c].toLowerCase()}-${AXIS_SHORT[r].toLowerCase()}`,
        domain: 'Setup',
        axis: AXIS_SHORT[c],
        severity: strong ? 'medium' : 'low',
        title: `${cmd} inputs perturb ${respLower}`,
        summary: `${cmd} commands move ${respLower} by ${pct}% of the commanded response`,
        detail: [
          `Across ${windows} detected single-axis ${cmdLower} snap(s), the ${respLower}`,
          `gyro deviated ${pct}% as hard as the ${cmdLower} axis itself — a ${cmdLower}`,
          `command is visibly disturbing ${respLower}.`,
          ``,
          `This is measured only inside fast single-axis snaps, so it is the`,
          `transient cross-axis response — not the ${respLower} authority a banked`,
          `turn naturally trades away.`,
          ``,
          `Likely causes, in rough order to check: an asymmetric or mis-scaled`,
          `mixer (servo throws not matched, or an elevon mix bleeding into the`,
          `other axis); a CG off the build's spec (couples pitch into roll`,
          `inputs and vice-versa); or a mechanical bind — a stiff or worn`,
          `linkage, a control horn fouling at deflection.`,
          ``,
          `No paste-ready CLI: there is no firmware parameter that corrects`,
          `cross-axis coupling. Check the mixer in the BF Configurator, verify`,
          `CG against the build spec, inspect the linkages on the bench, then`,
          `re-fly the same single-axis snaps and watch this number drop.`,
        ].join(' '),
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `${windows} single-axis ${cmdLower} snap window(s) analyzed`
            + ` (≥ ${MIN_WINDOWS_FOR_COUPLING} required to trust the row)`,
          `${cmd}→${respLower} coupling ${pct}% exceeds the ${flagPct}% significance threshold`,
        ],
        criteria_failed: [
          'cross-axis coupling has no firmware fix — diagnosis is mixer / CG / mechanical,'
            + ' corrected off-tool, so no CLI is emitted',
          'the significance threshold tracks the Cruise/Sport/3D tune-style dial — the'
            + ' per-style values are first guesses, not yet corpus-calibrated',
        ],
      });
    }
  }

  return out;
};
