// M3 recommender — fits BF's BASIC airspeed model against logged GPS
// 3D speed and emits `set tpa_speed_basic_*` CLI when the fit confidence
// clears the green bar.
//
// Confidence criteria (must ALL be met for green):
//   · R² ≥ 0.85           — fit explains most of the variance
//   · Speed range ≥ 8 m/s — enough dynamic range to constrain TWR/drag
//   · Throttle transitions ≥ 3/min — enough delay-signal in the input
//   · Voltage sag ≤ 15%   — sag confounds throttle→thrust mapping
//   · Optimizer converged — not iter-cap quit
//   · Fit window ≥ 15s    — too-short windows can't recover all 3 params
//   · Pitch field present — otherwise gravity term is unconstrained
//
// Yellow when up to 2 fail AND R² ≥ 0.6; red otherwise. Per the
// cardinal rule (wingtune-confidence-scoring) red removes the CLI list
// entirely — the user gets the rec for analysis/awareness but no
// paste-ready commands. Source-of-truth detail body cites BF's tuning
// heuristics so the user understands what to change if a param feels
// wrong.

import {
  buildAirspeedFitInputs,
  fitBasicAirspeedModel,
} from '@/lib/airspeedFit';
import type { ConfidenceLevel } from '@/lib/confidence';
import type {
  EvidencePoint,
  Recommendation,
  Recommender,
} from '@/lib/recommendations';

export const airspeedBasicRequiredFields: readonly string[] = [
  'rcCommand[3]',
  'vbatLatest',
  // Pitch — every candidate the signal registry's `attitude_pitch`
  // can resolve to, so whichever one this log has is hydrated.
  'attitude[1]',
  'wingTpaPitch',
  'debug[2]',
  'gps:GPS_speed',
];

const TUNING_HEURISTICS = [
  'Tuning heuristics (Betaflight wing tuning docs):',
  '  · Oscillates on quick throttle ramp-up → decrease tpa_speed_basic_delay.',
  '  · Oscillates on quick throttle cut → increase tpa_speed_basic_delay.',
  '  · Oscillates during dive at zero throttle → increase tpa_speed_basic_gravity.',
  '  · Too loose during zero-throttle dive → decrease tpa_speed_basic_gravity.',
].join('\n');

export const airspeedBasicRecommender: Recommender = ({ fields, time, gpsTimeSec, headerParams, capability }) => {
  const built = buildAirspeedFitInputs({ time, gpsTimeSec, fields, headerParams, capability });
  if (!built) return [];

  const result = fitBasicAirspeedModel(built.inputs);
  const fitWindowSec = built.inputs.time[built.inputs.time.length - 1] - built.inputs.time[0];

  const criteria_met: string[] = [];
  const criteria_failed: string[] = [];

  if (result.rSquared >= 0.85) {
    criteria_met.push(`R² = ${result.rSquared.toFixed(3)} (≥ 0.85)`);
  } else {
    criteria_failed.push(`R² = ${result.rSquared.toFixed(3)} (need ≥ 0.85)`);
  }

  const speedRange = result.coverage.speedMax - result.coverage.speedMin;
  if (speedRange >= 8) {
    criteria_met.push(`Speed range ${speedRange.toFixed(1)} m/s (≥ 8)`);
  } else {
    criteria_failed.push(`Speed range only ${speedRange.toFixed(1)} m/s — need ≥ 8 m/s to constrain TWR/drag`);
  }

  if (result.coverage.throttleTransitionsPerMin >= 3) {
    criteria_met.push(`${result.coverage.throttleTransitionsPerMin.toFixed(1)} throttle transitions/min (≥ 3)`);
  } else {
    criteria_failed.push(`Only ${result.coverage.throttleTransitionsPerMin.toFixed(1)} throttle transitions/min — need ≥ 3 for delay-parameter recovery`);
  }

  if (result.coverage.voltageSagFraction <= 0.15) {
    criteria_met.push(`Voltage sag ${(result.coverage.voltageSagFraction * 100).toFixed(1)}% (≤ 15%)`);
  } else {
    criteria_failed.push(`Voltage sag ${(result.coverage.voltageSagFraction * 100).toFixed(1)}% — high sag confounds throttle→thrust mapping`);
  }

  if (result.converged) {
    criteria_met.push(`Optimizer converged in ${result.iterations} iters`);
  } else {
    criteria_failed.push(`Optimizer hit iteration cap (${result.iterations}) without converging`);
  }

  if (fitWindowSec >= 15) {
    criteria_met.push(`Fit window ${fitWindowSec.toFixed(1)}s (≥ 15s)`);
  } else {
    criteria_failed.push(`Fit window only ${fitWindowSec.toFixed(1)}s — need ≥ 15s for confident params`);
  }

  if (built.pitchFromFallback) {
    criteria_failed.push('No pitch field (attitude[1]) — assumed level flight; tpa_speed_basic_gravity is physically unconstrained');
  } else {
    criteria_met.push('Pitch field present — gravity term physically constrained');
  }

  let confidence: ConfidenceLevel;
  if (criteria_failed.length === 0) {
    confidence = 'green';
  } else if (criteria_failed.length <= 2 && result.rSquared >= 0.6) {
    confidence = 'yellow';
  } else {
    confidence = 'red';
  }

  // Cardinal rule: red removes the CLI entirely (not just disabled).
  // `tpa_speed_max_voltage` is NOT emitted — it is a known battery fact
  // pinned from the log header, not a fitted output (see airspeedFit.ts
  // file header for why fitting it produces unphysical params).
  const cli = confidence === 'red' ? [] : [
    'set tpa_speed_type = BASIC',
    `set tpa_speed_basic_delay = ${Math.round(result.params.delayMs)}`,
    `set tpa_speed_basic_gravity = ${Math.round(result.params.gravityPct)}`,
  ];

  const maxVNote =
    built.maxVoltageSource === 'header'
      ? `Max voltage pinned at ${built.inputs.maxVoltageX100} (V×100) from the log's saved tpa_speed_max_voltage — a known battery fact, not fitted.`
      : `Max voltage estimated at ${built.inputs.maxVoltageX100} (V×100) from peak battery voltage (log header had no tpa_speed_max_voltage) — not fitted. If wrong, set tpa_speed_max_voltage to your pack's full-charge voltage ×100.`;

  const detail = [
    `Fitted BF's BASIC airspeed model against GPS 3D speed across ${fitWindowSec.toFixed(1)}s of flight (${built.inputs.time.length.toLocaleString()} aligned samples).`,
    `Recovered params: delay=${Math.round(result.params.delayMs)} ms, gravity=${Math.round(result.params.gravityPct)} %.`,
    maxVNote,
    `Fit quality: R²=${result.rSquared.toFixed(3)}, RMS residual ${result.rmsResidual.toFixed(2)} m/s.`,
    '',
    TUNING_HEURISTICS,
  ].join('\n');

  // Evidence chip: where the model disagrees with GPS most.
  let peakIdx = 0;
  let peakAbs = 0;
  for (let i = 0; i < result.residuals.length; i++) {
    const a = Math.abs(result.residuals[i]);
    if (a > peakAbs) { peakAbs = a; peakIdx = i; }
  }
  const evidence: EvidencePoint[] | undefined = peakAbs > 0 ? [{
    time_sec: built.inputs.time[peakIdx],
    label: `peak err ${result.residuals[peakIdx] >= 0 ? '+' : ''}${result.residuals[peakIdx].toFixed(1)} m/s`,
  }] : undefined;

  const severity = confidence === 'green' ? 'medium' : confidence === 'yellow' ? 'medium' : 'low';

  const summary =
    confidence === 'green'
      ? `Confident fit (R²=${result.rSquared.toFixed(2)}); paste-ready params below.`
      : confidence === 'yellow'
        ? `Fit converged with caveats (R²=${result.rSquared.toFixed(2)}); verify before applying.`
        : `Fit unreliable for this log (R²=${result.rSquared.toFixed(2)}); analysis-only.`;

  return [{
    id: 'airspeed-basic-model-fit',
    domain: 'TPA',
    axis: null,
    severity,
    title: 'BF BASIC airspeed model fit',
    summary,
    detail,
    suggested: [
      ['tpa_speed_type',         'BASIC'],
      ['tpa_speed_basic_delay',  Math.round(result.params.delayMs).toString()],
      ['tpa_speed_basic_gravity', Math.round(result.params.gravityPct).toString()],
    ] as const,
    cli,
    evidence,
    confidence,
    criteria_met,
    criteria_failed,
  }];
};
