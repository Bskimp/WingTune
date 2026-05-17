// Layer 2 — resample an irregular sample series onto a target time axis
// via linear interpolation. Used to project GPS-frame values (logged at
// ~5–10 Hz on a separate frame stream) onto the main-frame time axis so
// analytics modules see length-matched typed arrays.
//
// Single forward sweep, O(m + n). Both axes must be monotonically
// increasing — the function assumes BBL frame-time ordering and does
// not sort. Out-of-range dst samples clamp to the nearest src value
// (extrapolation by repeating the endpoint). Choosing clamp over NaN
// or zero matters: the M3 airspeed fit can't consume NaN, and the
// plane had *some* speed before the first GPS fix, so repeating the
// first GPS value over the pre-fix window is the least-misleading
// choice for time-series fits.

export function resampleToTimeAxis(
  srcTime: Float32Array,
  srcValues: Float32Array,
  dstTime: Float32Array,
): Float32Array {
  const m = srcTime.length;
  const n = dstTime.length;
  const out = new Float32Array(n);
  if (n === 0 || m === 0) return out;
  if (m !== srcValues.length) {
    throw new Error(
      `resampleToTimeAxis: srcTime (${m}) and srcValues (${srcValues.length}) length mismatch`,
    );
  }

  let i = 0;
  for (let j = 0; j < n; j++) {
    const t = dstTime[j];
    if (t <= srcTime[0]) {
      out[j] = srcValues[0];
      continue;
    }
    if (t >= srcTime[m - 1]) {
      out[j] = srcValues[m - 1];
      continue;
    }
    while (i < m - 1 && srcTime[i + 1] < t) i++;
    const t0 = srcTime[i];
    const t1 = srcTime[i + 1];
    const denom = t1 - t0;
    if (denom <= 0) {
      out[j] = srcValues[i];
    } else {
      const u = (t - t0) / denom;
      out[j] = srcValues[i] + u * (srcValues[i + 1] - srcValues[i]);
    }
  }
  return out;
}
