// Display-only trace smoothing for the global smoothing slider.
//
// HARD RULE — this is a render-layer transform and must NEVER feed the
// analysis layer. Step peak, RMS error, FF coverage, filter delay are
// all computed from raw field arrays; smoothing only the DISPLAY copy
// of a trace keeps the chart and its own header metrics honest. A
// smoothing slider that fed the analytics could make a bad tune look
// fine — see the wingtune-confidence-scoring skill +
// docs/wingtune-analytics-plan.md.
//
// Panels opt in by wrapping their display y-traces with `smoothTrace`.
// Panels where smoothing is meaningless or wrong (Spectrum PSD, Step
// response, the TPA scatter) simply don't call it.

/** Boxcar widths indexed by smoothing strength 0..4. Strength 0 is a
 *  no-op (raw trace). Odd widths centre cleanly on each sample. */
export const SMOOTHING_WIDTHS = [1, 7, 15, 31, 61] as const;

export const MAX_SMOOTHING_STRENGTH = SMOOTHING_WIDTHS.length - 1;

/** Human labels for the slider stops. */
export const SMOOTHING_LABELS = ['raw', 'light', 'medium', 'strong', 'max'] as const;

/** Boxcar-smooth a display trace. Returns the input array UNCHANGED at
 *  strength 0 (no allocation — the common case). Otherwise returns a
 *  new Float32Array.
 *
 *  NaN-aware: NaN samples are skipped in the window average, and a
 *  window that is entirely NaN stays NaN — so gap rendering (S-term
 *  factor gaps, NaN-padded multi-log compare traces) survives. */
export function smoothTrace(arr: Float32Array, strength: number): Float32Array {
  const idx = Math.max(0, Math.min(MAX_SMOOTHING_STRENGTH, Math.round(strength)));
  const width = SMOOTHING_WIDTHS[idx];
  if (width <= 1) return arr;
  const n = arr.length;
  if (n === 0) return arr;
  const half = (width - 1) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= n) continue;
      const v = arr[j];
      if (!Number.isFinite(v)) continue;
      sum += v;
      count += 1;
    }
    out[i] = count > 0 ? sum / count : NaN;
  }
  return out;
}
