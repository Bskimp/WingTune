// M-FF feedforward effectiveness recommender — diagnostic-only.
//
// Runs maneuver detection + per-axis FF analysis, emits a rec per axis
// whose verdict is 'undergained' or 'overgained'. No CLI: the
// proportional-adjustment formula (how much to raise/lower F for a
// given coverage gap) needs calibration against multiple real wing
// flights before paste-ready commands are safe. Per the
// wingtune-confidence-scoring cardinal rule, yellow-confidence
// diagnostic recs without CLI are correct here.

import { detectManeuvers } from '@/lib/maneuverDetect';
import { analyzeFFAxis } from '@/lib/ffEffectiveness';
import type { Recommendation, Recommender, AxisShort } from '@/lib/recommendations';

export const ffEffectivenessRequiredFields: readonly string[] = [
  'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
  'axisF[0]', 'axisF[1]', 'axisF[2]',
  'axisP[0]', 'axisP[1]', 'axisP[2]',
  'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]',
];

const AXIS_LABEL = ['Roll', 'Pitch', 'Yaw'] as const;
const AXIS_SHORT: Record<0 | 1 | 2, AxisShort> = { 0: 'R', 1: 'P', 2: 'Y' };
const F_PARAM = ['f_roll', 'f_pitch', 'f_yaw'] as const;

export const ffEffectivenessRecommender: Recommender = ({ fields, time }) => {
  const out: Recommendation[] = [];
  if (time.length < 3) return out;

  const sp = [0, 1, 2].map((a) => fields.get(`setpoint[${a}]`));
  if (!sp.some(Boolean)) return out;

  const maneuvers = detectManeuvers(sp, time);
  if (maneuvers.length === 0) return out;

  for (let a = 0 as 0 | 1 | 2; a <= 2; a = (a + 1) as 0 | 1 | 2) {
    const setpoint = sp[a];
    const axisF = fields.get(`axisF[${a}]`);
    const axisP = fields.get(`axisP[${a}]`);
    const gyro  = fields.get(`gyroADC[${a}]`);
    if (!setpoint || !axisF || !axisP || !gyro) continue;

    const r = analyzeFFAxis({ axis: a, setpoint, axisF, axisP, gyro, time, maneuvers });
    if (r.windowCount === 0) continue;

    const label = AXIS_LABEL[a];
    const coveragePct = (r.meanFFCoverage * 100).toFixed(0);

    // FF noise is orthogonal to gain — a well-gained axis can still
    // have a jittery F-term, and the fix is different (smoothing
    // params, not the gain). Emit independently of the verdict.
    if (r.noisy) {
      const noisePct = (r.meanFFNoise * 100).toFixed(0);
      out.push({
        id: `ff-noisy-${label.toLowerCase()}`,
        domain: 'PID',
        axis: AXIS_SHORT[a],
        severity: 'low',
        title: `${label}: feedforward is jittery`,
        summary: `F-term carries ${noisePct}% high-frequency content during fast inputs`,
        detail: [
          `Across ${r.windowCount} detected ${label.toLowerCase()} maneuver window(s),`,
          `the F-term's high-frequency content averaged ${noisePct}% of its`,
          `maneuver-envelope signal — the F-term is jittery, not a clean`,
          `response to stick velocity.`,
          ``,
          `Feedforward is a derivative-based term, so it amplifies any noise`,
          `in the stick signal (RC-link quantization, low RC update rate,`,
          `noisy gimbals). This is independent of the FF gain — lowering`,
          `\`${F_PARAM[a]}\` would just shrink a still-jittery signal.`,
          ``,
          `The fix is the FF SMOOTHING params, not the gain: raise`,
          `\`feedforward_smoothing\` (low-passes the FF output) and/or`,
          `\`feedforward_jitter_factor\` (attenuates FF near stick centre`,
          `where jitter dominates). Re-fly the same inputs and watch this`,
          `number drop. No paste-ready CLI yet — the smoothing-strength`,
          `values need calibration against more wing flights.`,
        ].join(' '),
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `${r.windowCount} maneuver window(s) analyzed on ${label.toLowerCase()}`,
          `mean F-term noise ratio ${noisePct}% exceeds the 35% jitter threshold`,
        ],
        criteria_failed: [
          'feedforward_smoothing / jitter_factor magnitude not yet calibrated — no CLI emitted',
        ],
      });
    }

    if (r.verdict === 'undergained') {
      out.push({
        id: `ff-undergained-${label.toLowerCase()}`,
        domain: 'PID',
        axis: AXIS_SHORT[a],
        severity: 'low',
        title: `${label}: feedforward undergained`,
        summary: `F coverage ${coveragePct}% during fast inputs — P is carrying the transient`,
        detail: [
          `Across ${r.windowCount} detected ${label.toLowerCase()} maneuver window(s),`,
          `feedforward provided only ${coveragePct}% of the controller output while`,
          `the stick was moving — the P-term carried the rest. Well-tuned FF does`,
          `the bulk of the transient push so P only cleans up residual error.`,
          ``,
          `Consider raising \`${F_PARAM[a]}\` and re-flying the same aggressive`,
          `inputs. Watch the F-coverage number climb toward ~70%+ and the Step`,
          `panel's leading-edge response sharpen. No paste-ready CLI yet — the`,
          `gain-adjustment size needs calibration against more wing flights.`,
        ].join(' '),
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `${r.windowCount} maneuver window(s) analyzed on ${label.toLowerCase()}`,
          `mean F coverage ${coveragePct}% is below the 50% undergained threshold`,
        ],
        criteria_failed: [
          'gain-adjustment magnitude not yet calibrated — no CLI emitted',
        ],
      });
    } else if (r.verdict === 'overgained') {
      out.push({
        id: `ff-overgained-${label.toLowerCase()}`,
        domain: 'PID',
        axis: AXIS_SHORT[a],
        severity: 'low',
        title: `${label}: feedforward overgained`,
        summary: `${r.overshootCount}/${r.windowCount} maneuvers overshoot on the leading edge`,
        detail: [
          `Across ${r.windowCount} detected ${label.toLowerCase()} maneuver window(s),`,
          `${r.overshootCount} showed the gyro punching past the commanded setpoint`,
          `in the ~150 ms right after the stick-velocity peak — the signature of`,
          `overgained feedforward. FF pushes the airframe too hard and PID then`,
          `has to rein it back, costing a clean transient.`,
          ``,
          `Consider lowering \`${F_PARAM[a]}\` and re-flying the same inputs. The`,
          `leading-edge overshoot count should drop. No paste-ready CLI yet — the`,
          `gain-reduction size needs calibration against more wing flights.`,
        ].join(' '),
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `${r.windowCount} maneuver window(s) analyzed on ${label.toLowerCase()}`,
          `${r.overshootCount} of them flagged for leading-edge overshoot (>50%)`,
        ],
        criteria_failed: [
          'gain-adjustment magnitude not yet calibrated — no CLI emitted',
        ],
      });
    }
  }

  return out;
};
