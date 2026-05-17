// Spectrum-based recommenders — emits two distinct recommendation
// types built on the M4 PSD + filter-config infrastructure:
//
//   1. NOTCH COVERAGE: scan the gyro PSD for prominent peaks falling
//      outside the current dyn-notch range, suggest extending the
//      range to cover the strongest uncovered peak. Yellow confidence
//      since peak detection is heuristic (transient noise, RPM-
//      following peaks, and harmonic artifacts can all trip false
//      positives — the detail body cautions the user to verify).
//
//   2. FILTER DELAY BUDGET: if total group delay through the filter
//      chain exceeds ~8 ms (the wing-tuning rule of thumb), emit an
//      informational rec naming the heaviest stage with the full
//      breakdown. No CLI emission — which stage to trim is a
//      judgment call depending on noise characteristics.

import { estimateSampleRate, welchPsd } from '@/lib/spectrum';
import { computeDelayBudget } from '@/lib/filterDelay';
import type { Recommendation, Recommender } from '@/lib/recommendations';

export const spectrumFilterRequiredFields: readonly string[] = [
  'gyroADC[0]',
  'gyroADC[1]',
  'gyroADC[2]',
];

const SEGMENT_LEN = 1024;
const PEAK_FLOOR_HZ = 30;       // skip DC/low-freq drift
const PEAK_CEILING_HZ = 400;    // most BF wings — peaks above this are typically not actionable
const PEAK_HEIGHT_DB = 6;       // peak must be ≥ this many dB above the local baseline
const NEIGHBORHOOD_BINS = 10;   // ± bins for local-baseline calc
const DELAY_BUDGET_LIMIT_MS = 8;

export interface SpectrumPeak {
  freqHz: number;
  db: number;
  axisShort: 'R' | 'P' | 'Y';
}

/** Identify locally-prominent PSD peaks in a meaningful frequency band.
 *  Exported for unit testability — the recommender's logic is gating
 *  on findings from this primitive. */
export function findSpectrumPeaks(
  psd: Float32Array,
  frequencies: Float32Array,
  axisShort: 'R' | 'P' | 'Y',
  opts: {
    floorHz?: number;
    ceilingHz?: number;
    minDbAboveBaseline?: number;
    neighborhoodBins?: number;
  } = {},
): SpectrumPeak[] {
  const floor   = opts.floorHz   ?? PEAK_FLOOR_HZ;
  const ceiling = opts.ceilingHz ?? PEAK_CEILING_HZ;
  const minDb   = opts.minDbAboveBaseline ?? PEAK_HEIGHT_DB;
  const nb      = opts.neighborhoodBins ?? NEIGHBORHOOD_BINS;
  const peaks: SpectrumPeak[] = [];
  const minRatio = Math.pow(10, minDb / 10);

  for (let i = nb; i < psd.length - nb; i++) {
    const f = frequencies[i];
    if (f < floor || f > ceiling) continue;
    if (!(psd[i] > psd[i - 1] && psd[i] > psd[i + 1])) continue;
    let neighborhoodSum = 0;
    let n = 0;
    for (let k = -nb; k <= nb; k++) {
      if (k === 0) continue;
      const j = i + k;
      const v = psd[j];
      if (!isFinite(v) || v <= 0) continue;
      neighborhoodSum += v;
      n++;
    }
    if (n === 0) continue;
    const baseline = neighborhoodSum / n;
    if (baseline <= 0) continue;
    if (psd[i] / baseline < minRatio) continue;
    peaks.push({ freqHz: f, db: 10 * Math.log10(psd[i]), axisShort });
  }
  return peaks;
}

function suggestedNotchRange(
  currentMin: number,
  currentMax: number,
  peakHz: number,
): { min: number; max: number } {
  // Round-up extension with a small buffer; preserves the user's
  // existing setting when the peak is already inside.
  if (peakHz > currentMax) {
    const max = Math.ceil((peakHz + 25) / 50) * 50;
    return { min: currentMin, max };
  }
  if (peakHz < currentMin) {
    const min = Math.max(20, Math.floor((peakHz - 10) / 10) * 10);
    return { min, max: currentMax };
  }
  return { min: currentMin, max: currentMax };
}

export const spectrumFilterRecommender: Recommender = ({ filterConfig, fields, time }) => {
  const recs: Recommendation[] = [];

  // ---- (1) Notch coverage check ------------------------------------------
  // Only runs when we actually know what notch range the user is on.
  if (filterConfig?.dyn_notch && filterConfig.dyn_notch.max_hz > filterConfig.dyn_notch.min_hz) {
    const sr = estimateSampleRate(time);
    const gyro = [
      fields.get('gyroADC[0]'),
      fields.get('gyroADC[1]'),
      fields.get('gyroADC[2]'),
    ];
    const allReady = sr > 0 && gyro.every((g) => g && g.length >= SEGMENT_LEN);

    if (allReady) {
      const dn = filterConfig.dyn_notch;
      const axisShorts: ('R' | 'P' | 'Y')[] = ['R', 'P', 'Y'];
      const allPeaks: SpectrumPeak[] = [];
      for (let a = 0; a < 3; a++) {
        const r = welchPsd(gyro[a]!, sr, SEGMENT_LEN, 0.5);
        if (r.numSegments === 0) continue;
        allPeaks.push(...findSpectrumPeaks(r.psd, r.frequencies, axisShorts[a]));
      }
      const uncovered = allPeaks.filter(
        (p) => p.freqHz < dn.min_hz || p.freqHz > dn.max_hz,
      );
      if (uncovered.length > 0) {
        uncovered.sort((a, b) => b.db - a.db);
        const top = uncovered[0];
        const sug = suggestedNotchRange(dn.min_hz, dn.max_hz, top.freqHz);
        const otherList = uncovered
          .slice(1, 4)
          .map((p) => `${p.freqHz.toFixed(0)} Hz on ${p.axisShort}`)
          .join(', ') || 'none';
        recs.push({
          id: 'spectrum-notch-coverage',
          domain: 'Filters',
          axis: null,
          severity: 'medium',
          title: `Extend dyn-notch range to cover ${top.freqHz.toFixed(0)} Hz peak`,
          summary:
            `Gyro peak at ${top.freqHz.toFixed(0)} Hz on the ${top.axisShort} axis ` +
            `(${top.db.toFixed(1)} dB) sits outside the current dyn-notch range ` +
            `(${dn.min_hz}–${dn.max_hz} Hz).`,
          detail:
            `Suggested range: ${sug.min}–${sug.max} Hz — extends the dyn-notch hunting band to cover ` +
            `the strongest uncovered peak with a small buffer.\n\n` +
            `Other peaks detected outside the current range: ${otherList}.\n\n` +
            `Caveats:\n` +
            `  · Peaks may be transient (manoeuvre artifacts, brief gusts) — verify the peak persists across the flight before changing the range.\n` +
            `  · If the peak follows motor RPM, the RPM filter (not the dyn-notch) is the right tool — widening dyn-notch into RPM territory wastes filter delay budget.\n` +
            `  · Peaks below the current min_hz (low-frequency airframe modes) may not be safe to notch — these often need a mechanical fix instead.`,
          current: [
            ['dyn_notch_min_hz', dn.min_hz.toString()],
            ['dyn_notch_max_hz', dn.max_hz.toString()],
          ] as const,
          suggested: [
            ['dyn_notch_min_hz', sug.min.toString()],
            ['dyn_notch_max_hz', sug.max.toString()],
          ] as const,
          cli: [
            `set dyn_notch_min_hz = ${sug.min}`,
            `set dyn_notch_max_hz = ${sug.max}`,
          ],
          confidence: 'yellow',
          criteria_met: [
            `Peak at ${top.freqHz.toFixed(0)} Hz on ${top.axisShort} is ≥ ${PEAK_HEIGHT_DB} dB above local baseline`,
            `Peak frequency falls outside ${dn.min_hz}–${dn.max_hz} Hz dyn-notch range`,
          ],
          criteria_failed: [
            'Peak detection is heuristic — transient noise / RPM-following peaks may produce false positives',
          ],
        });
      }
    }
  }

  // ---- (2) Filter delay budget check -------------------------------------
  if (filterConfig) {
    const budget = computeDelayBudget(filterConfig);
    if (budget.totalMs > DELAY_BUDGET_LIMIT_MS && budget.stages.length > 0) {
      const sorted = [...budget.stages].sort((a, b) => b.delayMs - a.delayMs);
      const heaviest = sorted[0];
      const breakdown = budget.stages
        .map((s) => `  · ${s.name} (${s.detail}): ${s.delayMs.toFixed(2)} ms`)
        .join('\n');
      recs.push({
        id: 'spectrum-filter-delay',
        domain: 'Filters',
        axis: null,
        severity: budget.totalMs > 15 ? 'high' : 'medium',
        title: `Filter chain delay is ${budget.totalMs.toFixed(1)} ms — consider trimming`,
        summary:
          `Total group delay through the gyro + D-term filter chain is ${budget.totalMs.toFixed(1)} ms ` +
          `(target ≤ ${DELAY_BUDGET_LIMIT_MS} ms). Heaviest stage: ${heaviest.name} (${heaviest.delayMs.toFixed(1)} ms).`,
        detail:
          `Per-stage breakdown:\n${breakdown}\n  ────────────\n  total: ${budget.totalMs.toFixed(2)} ms\n\n` +
          `Excess filter delay degrades closed-loop responsiveness — the PID controller is reacting to ` +
          `older gyro samples than necessary. Wing tuning rule of thumb: keep total under ~${DELAY_BUDGET_LIMIT_MS} ms.\n\n` +
          `Common levers (each is a tradeoff — depends on what noise you actually have):\n` +
          `  · Reduce dyn-notch count if peaks are concentrated rather than spread across the band.\n` +
          `  · Lower dyn-notch Q (faster but lets more noise through).\n` +
          `  · Raise LPF cutoffs if your gyro is clean above the current cutoff.\n` +
          `  · Disable a redundant LPF stage (e.g. gyro_lpf2 if gyro_lpf1 already clean).\n\n` +
          `No single CLI here — the right reduction depends on which noise sources you actually need to filter.`,
        cli: [],
        confidence: 'yellow',
        criteria_met: [
          `Total filter delay ${budget.totalMs.toFixed(1)} ms exceeds ${DELAY_BUDGET_LIMIT_MS} ms target`,
          `Heaviest stage identified: ${heaviest.name}`,
        ],
        criteria_failed: [
          'Specific CLI reduction depends on noise characteristics — no auto-emitted setting change',
        ],
      });
    }
  }

  return recs;
};
