// Servo asymmetry recommender — diagnostic-only.
//
// Wraps `analyzeServoAsymmetry` and emits a rec per (axis, servo-pair)
// whose severity is 'warn' (|lag| > 10ms OR amplitude ratio outside
// [0.7, 1.3]). No CLI lines — mechanical drift has no firmware fix.
// The user-actionable workflow lives in the `detail` text: check
// linkage backlash, sub-trim, mechanical endpoints, servo gain match.
//
// Yellow confidence by construction. The asymmetry IS observable in
// the log data (we computed it), but inferring "this is a linkage
// issue" vs "the radio sub-trim is offset" is judgment-side. The rec
// flags the symptom; the pilot diagnoses the cause.

import { correlateServosToAxes } from '@/lib/servoClassifier';
import {
  analyzeServoAsymmetry,
  type AxisAsymmetry,
} from '@/lib/servoAsymmetry';
import { estimateSampleRate } from '@/lib/spectrum';
import type { Recommendation, Recommender } from '@/lib/recommendations';

export const servoAsymmetryRequiredFields: readonly string[] = [
  'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
  // motor[0..7] / servo[0..7] hydration is shared with InputChainPanel.
];

const MIN_DOMINANT_SIGNED = 0.25;

const AXIS_SHORT: Record<0 | 1 | 2, 'R' | 'P' | 'Y'> = { 0: 'R', 1: 'P', 2: 'Y' };

export const servoAsymmetryRecommender: Recommender = ({ fields, time }) => {
  const out: Recommendation[] = [];
  if (time.length === 0) return out;

  // Same hydration probe the panel does — gather motor/servo channels
  // already in fields (lazy hydration shares the InputChainPanel's set).
  const actuators = new Map<string, Float32Array>();
  for (let i = 0; i <= 7; i++) {
    for (const fam of ['motor', 'servo'] as const) {
      const name = `${fam}[${i}]`;
      const arr = fields.get(name);
      if (arr && arr.length > 0) actuators.set(name, arr);
    }
  }
  if (actuators.size === 0) return out;

  const setR = fields.get('setpoint[0]');
  const setP = fields.get('setpoint[1]');
  const setY = fields.get('setpoint[2]');
  if (!setR || !setP || !setY) return out;

  const correlations = correlateServosToAxes(actuators, setR, setP, setY)
    .filter((c) => Math.abs(c.dominantSigned) >= MIN_DOMINANT_SIGNED);
  if (correlations.length === 0) return out;

  const sampleRateHz = estimateSampleRate(time);
  const axes: AxisAsymmetry[] = analyzeServoAsymmetry({
    motors: actuators,
    axisCorrelations: correlations,
    sampleRateHz,
  });

  for (const ax of axes) {
    for (const pair of ax.pairs) {
      if (pair.severity !== 'warn') continue;

      const lagAbs = Math.abs(pair.peakLagMs);
      const lagSign = pair.peakLagMs > 0 ? 'lags' : 'leads';
      const lagPart = lagAbs > 10
        ? `${lagSign} the reference by ${lagAbs.toFixed(1)} ms`
        : null;
      const ratioPart = (pair.amplitudeRatio < 0.7 || pair.amplitudeRatio > 1.3)
        ? `amplitude ${pair.amplitudeRatio.toFixed(2)}× the reference`
        : null;
      const summary = `${ax.axisLabel} pair · ${pair.fieldName} ${[lagPart, ratioPart].filter(Boolean).join(' + ')}`;

      out.push({
        id: `servo-asym-${ax.axisLabel.toLowerCase()}-${pair.fieldName.replace(/[\[\]]/g, '')}`,
        domain: 'Servo',
        axis: AXIS_SHORT[ax.axis],
        severity: 'low',
        title: `${ax.axisLabel} servo asymmetry · ${pair.fieldName}`,
        summary,
        detail: [
          `Reference servo (highest per-axis correlation): ${ax.referenceFieldName}.`,
          `Compared servo: ${pair.fieldName}.`,
          `Observed: lag ${pair.peakLagMs.toFixed(1)} ms, amplitude ratio ${pair.amplitudeRatio.toFixed(2)}×, peak correlation ${pair.peakCorr.toFixed(2)}.`,
          ``,
          `Healthy paired servos sit within |lag| ≤ 10 ms and ratio ∈ [0.7, 1.3] —`,
          `this pair is outside one or both bounds. No CLI fix: mechanical drift`,
          `is a check-your-linkage workflow, not a firmware change. Likely causes,`,
          `in order of typical frequency:`,
          ``,
          `  · Loose horn / clevis on the slower servo (causes lag without ratio change).`,
          `  · Sub-trim or endpoint mismatch in the radio (causes ratio without lag).`,
          `  · Mechanical bind, linkage compliance, or servo gain mismatch.`,
          `  · Servo aging / different unit batches (slower transient response on one).`,
          ``,
          `Inspect the linkage on ${pair.fieldName}; re-zero sub-trim from BF Configurator`,
          `with both servos held mechanically; verify endpoints with a deflection gauge.`,
        ].join(' '),
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `pair correlates at ${pair.peakCorr.toFixed(2)} (above 0.5 inconclusive gate)`,
          ...(lagAbs > 10 ? [`|lag| ${lagAbs.toFixed(1)} ms exceeds 10 ms healthy band`] : []),
          ...((pair.amplitudeRatio < 0.7 || pair.amplitudeRatio > 1.3)
            ? [`amplitude ratio ${pair.amplitudeRatio.toFixed(2)}× outside [0.7, 1.3] band`]
            : []),
        ],
        criteria_failed: [
          `mechanical cause inference is pilot-side (lag/ratio symptom observed; root cause requires bench inspection)`,
        ],
      });
    }
  }

  return out;
};
