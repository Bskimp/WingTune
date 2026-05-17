// M5 recommender — fits BF's HYPERBOLIC TPA curve against the
// (tpa_arg, tpa_factor) DEBUG_TPA channel pair and emits paste-ready
// `set tpa_curve_*` CLI when confidence clears the green bar.
//
// Confidence criteria (must ALL be met for green, per the firmware
// spec's coverage guidance — docs/firmware-reference/tpa-hyperbolic-spec.md):
//   · RMS residual ≤ 0.08          — fit explains the scatter cleanly
//   · low-band dwell ≥ 5 s          — pins pidThr0
//   · high-band dwell ≥ 5 s         — pins pidThr100
//   · x range ≥ 0.6                 — fit isn't extrapolating
//   · ≥ 200 samples                 — enough signal for Nelder-Mead
//   · optimiser converged           — not iter-cap quit
//
// Yellow when up to 2 fail AND RMS ≤ 0.20. Red otherwise. Per the
// cardinal rule (wingtune-confidence-scoring), red removes the CLI
// list entirely — the rec body still ships for diagnostic value but
// no paste-ready CLI when the fit is unreliable.
//
// The `tpa_curve_expo` recommendation is promoted from informational
// to CLI only when the |expo| > 5 after fit AND the fit converged
// cleanly — bow that small isn't worth bothering the user with.

import { resolveSignal } from '@/lib/signalRegistry';
import {
  buildTpaFitInputs,
  fitHyperbolicCurve,
  paramsToCli,
} from '@/lib/tpaCurveFit';
import type { ConfidenceLevel } from '@/lib/confidence';
import type { EvidencePoint, Recommendation, Recommender } from '@/lib/recommendations';

export const tpaCurveRequiredFields: readonly string[] = [
  // DEBUG_TPA channels — present only on `debug_mode = TPA` logs.
  // Hydration fails silently when absent.
  'debug[0]', 'debug[1]', 'debug[2]',
];

const TUNING_HINTS = [
  'Tuning hints (from BF discussion #13786):',
  '  · Mushy / sluggish at low speed → raise `tpa_curve_pid_thr0`.',
  '  · Oscillates / HF buzz at high speed → lower `tpa_curve_pid_thr100`.',
  '  · `tpa_curve_stall_throttle` should sit just below the slowest sustained-cruise tpa_arg observed in the log.',
  '  · Leave `tpa_curve_expo = 0` unless the residual after a two-endpoint fit shows systematic bow (positive bends down, negative bends up).',
].join('\n');

export const tpaCurveRecommender: Recommender = ({ capability, fields, time }) => {
  // Resolve signal sources — bail early if DEBUG_TPA isn't on this log.
  const arg    = resolveSignal('tpa_arg', null, capability);
  const factor = resolveSignal('tpa_factor', null, capability);
  if (arg.state !== 'resolved' || factor.state !== 'resolved') return [];
  if (arg.source.kind !== 'debug' || factor.source.kind !== 'debug') return [];

  const built = buildTpaFitInputs({
    time,
    fields,
    tpaArgField: `debug[${arg.source.channel}]`,
    tpaFactorField: `debug[${factor.source.channel}]`,
  });
  if (!built || built.samples.length === 0) return [];

  const result = fitHyperbolicCurve(built.samples, built.coverage);
  const cli = paramsToCli(result.params);

  const criteria_met: string[] = [];
  const criteria_failed: string[] = [];

  if (result.rmsResidual <= 0.08) {
    criteria_met.push(`RMS = ${result.rmsResidual.toFixed(3)} (≤ 0.08)`);
  } else {
    criteria_failed.push(`RMS = ${result.rmsResidual.toFixed(3)} (need ≤ 0.08)`);
  }

  if (result.coverage.lowBandDwellSec >= 5) {
    criteria_met.push(`Low-band dwell ${result.coverage.lowBandDwellSec.toFixed(1)}s (≥ 5s)`);
  } else {
    criteria_failed.push(`Low-band dwell only ${result.coverage.lowBandDwellSec.toFixed(1)}s — need ≥ 5s to pin pidThr0`);
  }

  if (result.coverage.highBandDwellSec >= 5) {
    criteria_met.push(`High-band dwell ${result.coverage.highBandDwellSec.toFixed(1)}s (≥ 5s)`);
  } else {
    criteria_failed.push(`High-band dwell only ${result.coverage.highBandDwellSec.toFixed(1)}s — need ≥ 5s to pin pidThr100`);
  }

  const xRange = result.coverage.xMax - result.coverage.xMin;
  if (xRange >= 0.6) {
    criteria_met.push(`x range ${xRange.toFixed(2)} (≥ 0.60)`);
  } else {
    criteria_failed.push(`x range only ${xRange.toFixed(2)} — need ≥ 0.60 across [stallThrottle, 1.0]`);
  }

  if (result.coverage.samples >= 200) {
    criteria_met.push(`${result.coverage.samples.toLocaleString()} samples (≥ 200)`);
  } else {
    criteria_failed.push(`Only ${result.coverage.samples.toLocaleString()} samples — need ≥ 200`);
  }

  if (result.converged) {
    criteria_met.push(`Optimiser converged in ${result.iterations} iters`);
  } else {
    criteria_failed.push(`Optimiser hit iteration cap (${result.iterations}) without converging`);
  }

  let confidence: ConfidenceLevel;
  if (criteria_failed.length === 0) {
    confidence = 'green';
  } else if (criteria_failed.length <= 2 && result.rmsResidual <= 0.20) {
    confidence = 'yellow';
  } else {
    confidence = 'red';
  }

  // Build CLI lines. Always emit type + endpoints + stall threshold;
  // emit expo only when meaningfully non-zero (|expo| > 5) AND we
  // converged. Cardinal rule: red removes CLI entirely.
  const baseCli = [
    'set tpa_curve_type = HYPERBOLIC',
    `set tpa_curve_stall_throttle = ${cli.tpa_curve_stall_throttle}`,
    `set tpa_curve_pid_thr0 = ${cli.tpa_curve_pid_thr0}`,
    `set tpa_curve_pid_thr100 = ${cli.tpa_curve_pid_thr100}`,
  ];
  const includeExpo = result.converged && Math.abs(cli.tpa_curve_expo) > 5;
  if (includeExpo) baseCli.push(`set tpa_curve_expo = ${cli.tpa_curve_expo}`);
  const finalCli = confidence === 'red' ? [] : baseCli;

  // Evidence chip: peak |residual| sample — where the fit disagrees most.
  let peakIdx = 0;
  let peakAbs = 0;
  for (let i = 0; i < result.residuals.length; i++) {
    const a = Math.abs(result.residuals[i]);
    if (a > peakAbs) { peakAbs = a; peakIdx = i; }
  }
  const evidence: EvidencePoint[] | undefined = peakAbs > 0 ? [{
    // The fit's residual indices line up with the input sample order,
    // but the time axis they came from is the main-frame time axis;
    // since the sample index is the main-frame index (modulo gates),
    // approximate the time location via the proportion-of-samples.
    // Better cross-ref would carry the source index back through the
    // builder, but for first slice this lands close enough.
    time_sec: time.length > 0
      ? time[Math.min(time.length - 1, Math.floor((peakIdx / result.residuals.length) * time.length))]
      : 0,
    label: `peak residual ${result.residuals[peakIdx] >= 0 ? '+' : ''}${result.residuals[peakIdx].toFixed(2)}`,
  }] : undefined;

  const severity = confidence === 'green' ? 'medium' : confidence === 'yellow' ? 'medium' : 'low';

  const summary =
    confidence === 'green'
      ? `Confident HYPERBOLIC fit (RMS=${result.rmsResidual.toFixed(3)}); paste-ready params below.`
      : confidence === 'yellow'
        ? `Fit converged with caveats (RMS=${result.rmsResidual.toFixed(3)}); verify before applying.`
        : `Fit unreliable for this log (RMS=${result.rmsResidual.toFixed(3)}); analysis-only.`;

  const detail = [
    `Fitted BF's HYPERBOLIC TPA curve (PR #13805) against ${result.coverage.samples.toLocaleString()} (tpa_arg, tpa_factor) samples covering tpa_arg = ${result.coverage.xMin.toFixed(2)}–${result.coverage.xMax.toFixed(2)}.`,
    `Recovered params: pidThr0=${result.params.pidThr0.toFixed(2)}, pidThr100=${result.params.pidThr100.toFixed(2)}, stallThrottle=${result.params.stallThrottle.toFixed(2)}, expo=${Math.round(result.params.expoCli)}.`,
    `Fit quality: RMS residual ${result.rmsResidual.toFixed(3)} across the active scatter (excludes flat-plateau zone below stallThrottle).`,
    '',
    TUNING_HINTS,
  ].join('\n');

  return [{
    id: 'tpa-curve-hyperbolic-fit',
    domain: 'TPA',
    axis: null,
    severity,
    title: 'BF HYPERBOLIC TPA curve fit',
    summary,
    detail,
    suggested: [
      ['tpa_curve_type',           'HYPERBOLIC'],
      ['tpa_curve_stall_throttle', cli.tpa_curve_stall_throttle.toString()],
      ['tpa_curve_pid_thr0',       cli.tpa_curve_pid_thr0.toString()],
      ['tpa_curve_pid_thr100',     cli.tpa_curve_pid_thr100.toString()],
      ...(includeExpo
        ? [['tpa_curve_expo', cli.tpa_curve_expo.toString()] as const]
        : []),
    ] as const,
    cli: finalCli,
    evidence,
    confidence,
    criteria_met,
    criteria_failed,
  }];
};
