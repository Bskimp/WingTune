// M6 recommender — surfaces SPA gate activity and wind-up / bounce-back
// events per axis. First slice ships diagnostic recs only (no CLI),
// matching the cardinal-rule discipline: there's no validated wing
// calibration flight in the corpus yet to ground confidence-scored
// `set spa_*` emissions against. CLI recs follow once we have a SPA
// flight to compare predicted vs measured tuning deltas.
//
// Per-axis emission rules:
//   · gate-active ≥ 1% AND events.length === 0 → info rec
//       ("SPA holding back I-term cleanly on X axis")
//   · events.length > 0 → low-severity rec listing event counts
//       and offering tuning direction hints (spa_width up/down) in
//       the detail body — but no CLI
//   · gate-active < 1% AND events.length === 0 → no rec
//       (gate is effectively idle; nothing to surface)
//
// Cross-axis: if all three axes silent, no recs at all. We do NOT
// emit a "SPA disabled, consider enabling it" rec — that's a config
// suggestion not a log-derived insight, and would be wrong on aircraft
// where SPA is intentionally off (e.g. pure manual mode).

import { resolveSignal, type Axis } from '@/lib/signalRegistry';
import { analyzeSpaAxis, debugSpaToMultiplier } from '@/lib/spaAnalysis';
import type {
  EvidencePoint,
  Recommendation,
  Recommender,
} from '@/lib/recommendations';

export const spaRequiredFields: readonly string[] = [
  'axisI[0]', 'axisI[1]', 'axisI[2]',
  // SPA debug channels — present only on `debug_mode = SPA` logs;
  // hydration fails silently when absent.
  'debug[0]', 'debug[1]', 'debug[2]',
];

const AXIS_LABEL: Record<Axis, 'roll' | 'pitch' | 'yaw'> = {
  0: 'roll', 1: 'pitch', 2: 'yaw',
};
const AXIS_SHORT: Record<Axis, 'R' | 'P' | 'Y'> = {
  0: 'R', 1: 'P', 2: 'Y',
};

const TUNING_HINTS = [
  'Tuning hints (BF wing tuning docs):',
  '  · Repeated wind-up + gate at floor → spa_width too narrow; gate clamps too hard. Widen it.',
  '  · Bounce-back after release → spa_width too narrow OR spa_center too low; the I-term escapes too fast. Try widening spa_width first.',
  '  · Wind-up but gate rarely floors → spa_center too high; gate triggers but not strongly enough. Lower spa_center.',
  '  · No events and gate active < 1% → SPA is essentially idle; verify spa_mode is ON and spa_center sits at a reasonable rate threshold for your airframe.',
].join('\n');

export const spaRecommender: Recommender = ({ capability, fields, time }) => {
  const recs: Recommendation[] = [];

  for (const axis of [0, 1, 2] as Axis[]) {
    const spaResolution = resolveSignal('spa', axis, capability);
    if (spaResolution.state !== 'resolved') continue;
    if (spaResolution.source.kind !== 'debug') continue;
    const spaFieldName = `debug[${spaResolution.source.channel}]`;
    const iTermFieldName = `axisI[${axis}]`;

    const rawSpa = fields.get(spaFieldName);
    const iTerm = fields.get(iTermFieldName);
    if (!rawSpa || !iTerm || !time.length) continue;

    const spa = debugSpaToMultiplier(rawSpa);
    const ana = analyzeSpaAxis(axis, spa, iTerm, time);

    const ax = AXIS_LABEL[axis];
    const axShort = AXIS_SHORT[axis];

    // No interesting signal on this axis — skip.
    if (ana.gateActivePct < 1 && ana.events.length === 0) continue;

    // Build evidence chips: up to 3 most-severe events.
    const evidence: EvidencePoint[] | undefined = ana.events.length > 0
      ? [...ana.events]
          .sort((a, b) => b.severity - a.severity)
          .slice(0, 3)
          .map((ev) => ({
            time_sec: ev.timeSec,
            label: `${ev.kind === 'wind_up' ? 'wind-up' : 'bounce'} (${(ev.severity * 100).toFixed(0)}%)`,
          }))
      : undefined;

    if (ana.events.length === 0) {
      // Quiet gate, just active — informational.
      recs.push({
        id: `spa-clean-${ax}`,
        domain: 'SPA',
        axis: axShort,
        severity: 'info',
        title: `SPA holding I-term cleanly on ${ax} axis`,
        summary: `Gate active ${ana.gateActivePct.toFixed(1)}% of flight, no wind-up or bounce-back.`,
        detail: [
          `SPA on ${ax} attenuated I-term across ${ana.gateActivePct.toFixed(1)}% of the flight (min SPA reached ${ana.minSpa.toFixed(2)}, mean ${ana.meanSpa.toFixed(2)}).`,
          'No wind-up or bounce-back events detected — current `spa_width` / `spa_center` look well-matched to your stick inputs on this axis.',
        ].join('\n'),
        cli: [],
        confidence: 'green',
        criteria_met: [
          `gate active ${ana.gateActivePct.toFixed(1)}% (≥ 1%)`,
          'no wind-up events',
          'no bounce-back events',
        ],
        criteria_failed: [],
      });
      continue;
    }

    // Events present — diagnostic rec with tuning hints, no CLI yet.
    const windups = ana.events.filter((e) => e.kind === 'wind_up').length;
    const bouncebacks = ana.events.filter((e) => e.kind === 'bounce_back').length;
    const severity = ana.events.length >= 5 ? 'medium' : 'low';

    recs.push({
      id: `spa-events-${ax}`,
      domain: 'SPA',
      axis: axShort,
      severity,
      title: `SPA wind-up / bounce-back on ${ax} axis`,
      summary: `${windups} wind-up · ${bouncebacks} bounce-back events. Gate active ${ana.gateActivePct.toFixed(1)}%.`,
      detail: [
        `Detected ${windups} wind-up event(s) (I-term grew while SPA was at floor) and ${bouncebacks} bounce-back event(s) (I-term peaked sharply within 200 ms of gate release) on the ${ax} axis.`,
        `Gate active ${ana.gateActivePct.toFixed(1)}% of flight; min SPA reached ${ana.minSpa.toFixed(2)}; mean ${ana.meanSpa.toFixed(2)}.`,
        '',
        'These are heuristic flags — pin the cursor on an event chip to scrub to the moment and verify against your stick input + I-term trace before changing tuning.',
        '',
        TUNING_HINTS,
        '',
        'No paste-ready CLI in this slice — SPA tuning recs need a validated wing flight to calibrate against, and the WingTune corpus doesn\'t have one yet. Track the count over a tuning progression as you adjust `spa_*` params in BF.',
      ].join('\n'),
      cli: [],
      evidence,
      confidence: 'yellow',
      criteria_met: [
        `gate active ${ana.gateActivePct.toFixed(1)}%`,
        `min SPA ${ana.minSpa.toFixed(2)}`,
      ],
      criteria_failed: [
        ...(windups > 0 ? [`${windups} wind-up event(s)`] : []),
        ...(bouncebacks > 0 ? [`${bouncebacks} bounce-back event(s)`] : []),
      ],
    });
  }

  return recs;
};
