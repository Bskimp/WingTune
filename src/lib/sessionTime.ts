// Session-time projection utilities for M1.7.1 multi-log compare.
//
// Background: with per-log `timeOffsetSec` (the alignment hook), each
// log's data lives at `sessionTime = logLocalTime + log.timeOffsetSec`.
// Time-domain compare charts need a single shared session-time x-axis
// to overlay multiple logs coherently. These helpers do the projection.
//
// See [[project-m17-multi-log-architecture]] memory for the load-bearing
// design decisions captured during M1.7.1 — especially the Float32
// precision lesson (use Float64 for the aligned axis or edge samples
// drop at certain offsets like exactly -0.60 s) and the uPlot leading-
// NaN gotcha (clamp idx to [0, M-1] in resampleOntoRef rather than
// emitting NaN — uPlot's multi-series renderer blanks the entire chart
// when some series have leading NaN while others have valid data at
// index 0).

import { computed, type ComputedRef } from 'vue';

import { useSessionStore, type LogState } from '@/stores/session';
import { useViewStore } from '@/stores/view';

/** Per-log aligned time as Float64: `log.time[i] + log.timeOffsetSec`.
 *  ALWAYS allocates Float64, even at offset 0:
 *
 *  - Float32 round-trip otherwise introduces ~1e-8 epsilons that flip
 *    edge-sample bounds checks in `resampleOntoRef`, dropping samples
 *    and cascading into a blank uPlot chart at "round-number" offsets
 *    like exactly -0.60 s.
 *  - Mixing Float32 and Float64 typed arrays at the uPlot x-axis
 *    boundary breaks uPlot's renderer when the type swaps mid-drag
 *    (offset 0 → non-zero changes the typed-array constructor under
 *    uPlot's feet, manifesting as a blank chart at negative offsets).
 *
 *  The extra allocation per render is fine — typical 150k-sample logs
 *  cost ~1 MB each, GC handles it comfortably at drag rates. */
export function alignedTimeFor(log: LogState): Float64Array {
  const t = log.time;
  const off = log.timeOffsetSec;
  const out = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t[i] + off;
  return out;
}

/** Resample `valueArr` (indexed by `log.time`) onto session-time
 *  positions in `ref`. Uses uniform-rate index math for O(1) per
 *  sample (BF logs are uniform-rate; non-uniform would need binary
 *  search instead).
 *
 *  Out-of-range positions CLAMP to the nearest edge sample rather
 *  than emitting NaN — uPlot's multi-series renderer mishandles series
 *  with leading NaN when other series in the same chart have valid
 *  data at index 0 (chart goes entirely blank, no y-axis labels).
 *  Clamping produces a "flatline" extension at the log's boundaries,
 *  which is benign for continuous signals (PWM, gyro, setpoint); the
 *  meaningful compare region is still where both logs have real data.
 *
 *  For impulse-like or event-based signals where flat extension would
 *  be misleading, a different approach is needed (truncate refTime
 *  to the intersection of valid ranges, for instance). */
export function resampleOntoRef(
  log: LogState,
  ref: Float64Array,
  valueArr: Float32Array,
  /** Optional override for the local-time axis valueArr is indexed by.
   *  Defaults to `log.time`. Used by panels like AirspeedPanel where
   *  the data array is indexed by a sub-range of log.time (e.g. the
   *  GPS-trimmed fit window) rather than the full log axis. */
  localTimeOverride?: Float32Array,
): Float32Array {
  const localTime = localTimeOverride ?? log.time;
  const out = new Float32Array(ref.length);
  const N = localTime.length;
  if (N === 0 || valueArr.length === 0) {
    out.fill(NaN);
    return out;
  }
  const offset = log.timeOffsetSec;
  const t0 = localTime[0];
  const tLast = localTime[N - 1];
  const dt = (tLast - t0) / (N - 1);
  if (!isFinite(dt) || dt <= 0) {
    out.fill(NaN);
    return out;
  }
  const M = Math.min(valueArr.length, N);
  for (let i = 0; i < ref.length; i++) {
    const localT = ref[i] - offset;
    let idx = Math.round((localT - t0) / dt);
    if (idx < 0) idx = 0;
    else if (idx >= M) idx = M - 1;
    out[i] = valueArr[idx];
  }
  return out;
}

/** Longest aligned time axis among visible (non-eye-hidden) logs, as
 *  Float64. Used as the chart x in session time. Per-log data is
 *  resampled onto this axis via `resampleOntoRef`. */
export function useSessionRefTime(): ComputedRef<Float64Array> {
  const session = useSessionStore();
  const view = useViewStore();
  return computed(() => {
    let best: Float64Array = new Float64Array(0);
    let bestLen = 0;
    for (const log of session.logs.values()) {
      if (view.isLogHidden(log.id)) continue;
      const aligned = alignedTimeFor(log);
      if (aligned.length > bestLen) {
        bestLen = aligned.length;
        best = aligned;
      }
    }
    if (bestLen > 0) return best;
    // Fallback: first available log's time as Float64, even if hidden,
    // so the chart has a valid x array to init against. The chart
    // won't render data (no visible logs) but uPlot won't error.
    for (const log of session.logs.values()) {
      const t = log.time;
      const out = new Float64Array(t.length);
      for (let i = 0; i < t.length; i++) out[i] = t[i];
      return out;
    }
    return new Float64Array(0);
  });
}

/** Standard uPlot `scales.x.range` function for session-time charts —
 *  forces uPlot to refit x to the data's actual range on every setData.
 *  Without this, uPlot's cached cursor / zoom state can prevent the
 *  scale from updating when refTime shifts under an offset drag. */
export const sessionTimeRangeFn = (
  _u: unknown,
  dataMin: number,
  dataMax: number,
): [number, number] => [dataMin, dataMax];
