// Layer 2 (Analytics) — pure stats over an aligned (setpoint, gyro) pair.
// Used by the Tracking panel today; M2 PIDFS decomp will reuse these.
//
// Sized to operate on the full hydrated Float32Array without intermediate
// allocations (no `.map` / `.reduce` over the typed array — those box
// every element through JS-number land and balloon the working set for
// long logs).

export interface TrackingStats {
  /** RMS of `gyro − setpoint`, in the same units as the inputs. */
  rmsError: number;
  /** Largest absolute value of `gyro − setpoint` seen across the range. */
  peakError: number;
  /** Index (into the inputs) where `peakError` was observed. */
  peakErrorIndex: number;
  /** Number of samples actually compared (= min of the two input lengths). */
  sampleCount: number;
}

export function trackingStats(
  setpoint: Float32Array,
  gyro: Float32Array,
): TrackingStats {
  const n = Math.min(setpoint.length, gyro.length);
  if (n === 0) {
    return { rmsError: 0, peakError: 0, peakErrorIndex: 0, sampleCount: 0 };
  }
  let sumSq = 0;
  let peakAbs = 0;
  let peakIdx = 0;
  for (let i = 0; i < n; i++) {
    const e = gyro[i] - setpoint[i];
    sumSq += e * e;
    const abs = e < 0 ? -e : e;
    if (abs > peakAbs) {
      peakAbs = abs;
      peakIdx = i;
    }
  }
  return {
    rmsError: Math.sqrt(sumSq / n),
    peakError: peakAbs,
    peakErrorIndex: peakIdx,
    sampleCount: n,
  };
}
