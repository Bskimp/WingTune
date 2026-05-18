// M-Servo recommender — surfaces per-axis input-chain lag with
// stage attribution.
//
// Emits one rec per axis whose total lag clears a wing-tuning
// threshold AND has a clearly dominant stage (>50% of total).
// "Well-distributed lag" (no single stage dominant) doesn't produce
// a rec — there's no specific lever to pull.
//
// Stage attribution drives the tuning hint:
//   stage A dominant → rate curves / rc_smoothing
//   stage B dominant → PID + filter delay
//   stage C dominant → mechanical chain (lower D to compensate)
//
// CLI emission is deferred for the MVP. The wing thresholds + the
// proportional D-reduction formula need calibration against multiple
// real wing flights before we ship paste-ready commands. Per the
// `wingtune-confidence-scoring` cardinal rule, no CLI is correct
// here — diagnostic recs are still useful even without commands.

import { correlateServosToAxes } from '@/lib/servoClassifier';
import {
  AXIS_LABELS,
  AXIS_SHORTS,
  buildPerAxisServoAggregate,
  computeInputChain,
  type Stage,
} from '@/lib/inputChain';
import type {
  Recommendation,
  Recommender,
} from '@/lib/recommendations';

export const inputChainRequiredFields: readonly string[] = [
  'rcCommand[0]', 'rcCommand[1]', 'rcCommand[2]',
  'setpoint[0]',  'setpoint[1]',  'setpoint[2]',
  'gyroADC[0]',   'gyroADC[1]',   'gyroADC[2]',
  // servo[0..7] / motor[0..7] hydration is the InputChainPanel's
  // responsibility — recommender reads whatever's already in fields.
];

/** Same noise-correlation threshold the panel uses. Channels whose
 *  strongest correlation with a setpoint axis is below this are
 *  treated as unclassified (excluded from the aggregate). */
const MIN_DOMINANT_SIGNED = 0.25;

// Severity gates (ms).
const YELLOW_TOTAL_MS = 40;
const RED_TOTAL_MS    = 100;
// Stage dominance: emit only when dominant stage accounts for ≥ this
// fraction of total lag. Otherwise lag is spread across the chain and
// there's no specific stage to target.
const DOMINANCE_FRACTION = 0.5;
// Minimum confidence floor — peak correlation below this is too noisy
// to act on regardless of windowCount.
const MIN_PEAK_CORR = 0.4;

const STAGE_NAME: Record<Stage, string> = {
  A: 'rate curves (rcCommand → setpoint)',
  B: 'PID loop + mixer (setpoint → servo command)',
  C: 'mechanical chain (servo command → gyro)',
};

const STAGE_HINT: Record<Stage, string> = {
  A: [
    'Rate curves should be near-instant. Lag here suggests either',
    'aggressive rc_smoothing, an unusual rates_v3 configuration, or a',
    'logging artifact. Check `rc_smoothing_*` CLI values and `rates_*`',
    'curves; both should resolve faster than 5 ms on a sensible setup.',
  ].join(' '),
  B: [
    'The PID loop + mixer is taking longer than expected to translate',
    'setpoint into a servo command. Most often: filter chain delay is',
    'eating headroom (check the spectrum panel filter-delay badge),',
    'D-term smoothing is too aggressive, or PID gains are too soft.',
    'Tighten D-LPF and/or raise P gain before chasing servo hardware.',
  ].join(' '),
  C: [
    'The mechanical chain (servo response + linkage backlash + aero',
    'damping) is dominating closed-loop lag. No PID change recovers',
    'this — the servo physically cannot respond faster. Practical',
    'remedies: lower D gain on this axis by ~15% to reduce ringing,',
    'consider a faster servo if you have one, check linkage for slop.',
  ].join(' '),
};

interface AxisSummary {
  axis: 0 | 1 | 2;
  short: string;
  label: string;
  totalMs: number;
  dominantStage: Stage;
  dominantStageMs: number;
  dominantFraction: number;
  peakCorrMin: number;
  windowCountMin: number;
}

export const inputChainRecommender: Recommender = ({ fields, time }) => {
  if (time.length === 0) return [];

  // Pull both servo[i] and motor[i] candidates — control surfaces
  // can live in either depending on the BF wing mixer setup. Weakly-
  // correlated channels (throttle, mixer artifacts) get filtered out
  // by the MIN_DOMINANT_SIGNED threshold below.
  const actuators = new Map<string, Float32Array>();
  for (let i = 0; i <= 7; i++) {
    for (const family of ['servo', 'motor']) {
      const name = `${family}[${i}]`;
      const arr = fields.get(name);
      if (arr && arr.length > 0) actuators.set(name, arr);
    }
  }
  if (actuators.size === 0) return [];

  const setR = fields.get('setpoint[0]');
  const setP = fields.get('setpoint[1]');
  const setY = fields.get('setpoint[2]');
  if (!setR || !setP || !setY) return [];

  const rawCorrelations = correlateServosToAxes(actuators, setR, setP, setY);
  const axisCorrelations = rawCorrelations.filter(
    (c) => Math.abs(c.dominantSigned) >= MIN_DOMINANT_SIGNED,
  );
  const servoAgg = buildPerAxisServoAggregate({
    motors: actuators,
    axisCorrelations,
    length: time.length,
  });

  const rcCommand = [0, 1, 2].map((a) => fields.get(`rcCommand[${a}]`));
  const setpoint  = [setR, setP, setY];
  const gyro      = [0, 1, 2].map((a) => fields.get(`gyroADC[${a}]`));

  const chain = computeInputChain({
    time,
    rcCommand,
    setpoint,
    servoAgg,
    gyro,
  });

  const summaries: AxisSummary[] = [];
  for (const ax of chain.axes) {
    if (!ax.hasData) continue;
    if (!Number.isFinite(ax.totalLagMs)) continue;
    if (ax.totalLagMs < YELLOW_TOTAL_MS) continue;

    // Pick dominant stage.
    const stages: Stage[] = ['A', 'B', 'C'];
    let dominantStage: Stage = 'A';
    let dominantStageMs = -Infinity;
    let peakCorrMin = 1;
    let windowCountMin = Infinity;
    for (const s of stages) {
      const r = ax.stages[s];
      if (!Number.isFinite(r.lagMs)) continue;
      if (r.lagMs > dominantStageMs) {
        dominantStageMs = r.lagMs;
        dominantStage = s;
      }
      if (r.peakCorr < peakCorrMin) peakCorrMin = r.peakCorr;
      if (r.windowCount < windowCountMin) windowCountMin = r.windowCount;
    }
    if (!Number.isFinite(dominantStageMs)) continue;
    const dominantFraction = dominantStageMs / ax.totalLagMs;
    if (dominantFraction < DOMINANCE_FRACTION) continue;
    if (peakCorrMin < MIN_PEAK_CORR) continue;

    summaries.push({
      axis: ax.axis,
      short: AXIS_SHORTS[ax.axis],
      label: AXIS_LABELS[ax.axis],
      totalMs: ax.totalLagMs,
      dominantStage,
      dominantStageMs,
      dominantFraction,
      peakCorrMin,
      windowCountMin,
    });
  }

  const recs: Recommendation[] = [];
  for (const s of summaries) {
    const severity = s.totalMs >= RED_TOTAL_MS ? 'high' : 'medium';

    const criteria_met: string[] = [
      `Total lag ${s.totalMs.toFixed(0)} ms exceeds ${YELLOW_TOTAL_MS} ms threshold`,
      `Stage ${s.dominantStage} accounts for ${(s.dominantFraction * 100).toFixed(0)}% of total lag (≥ 50% dominance)`,
      `Min peak correlation ${s.peakCorrMin.toFixed(2)} (≥ ${MIN_PEAK_CORR})`,
      `Min window count ${s.windowCountMin}`,
    ];
    const criteria_failed: string[] = [];

    // CLI emission deferred — wing thresholds + delta formulas need
    // calibration against real flights. Diagnostic only.
    const recDetail = [
      `${s.label} axis total input-chain lag: ${s.totalMs.toFixed(0)} ms`,
      `Dominant stage: ${s.dominantStage} (${s.dominantStageMs.toFixed(0)} ms, ${(s.dominantFraction * 100).toFixed(0)}% of total) — ${STAGE_NAME[s.dominantStage]}`,
      '',
      STAGE_HINT[s.dominantStage],
    ].join('\n');

    recs.push({
      id: `input-chain.${s.short.toLowerCase()}.stage-${s.dominantStage.toLowerCase()}`,
      domain: 'Servo',
      axis: s.short as 'R' | 'P' | 'Y',
      severity,
      title: `${s.label} input-chain lag ${s.totalMs.toFixed(0)} ms · stage ${s.dominantStage} dominant`,
      summary: `${(s.dominantFraction * 100).toFixed(0)}% of lag comes from ${STAGE_NAME[s.dominantStage]}.`,
      detail: recDetail,
      cli: [],
      // Yellow confidence — wing thresholds are best-guess pending
      // multi-flight calibration. When thresholds are calibrated and
      // a delta formula is validated, this can promote to green +
      // gain a CLI payload.
      confidence: 'yellow',
      criteria_met,
      criteria_failed,
    });
  }

  return recs;
};
