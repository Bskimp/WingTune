// Typed-array primitives. Per `wingtune-memory-model`, all log signals
// live in `Float32Array` and the time axis is `Float32Array` of
// seconds-since-log-start. Number arrays are only acceptable at the JS
// boundary while crossing serde-wasm-bindgen, and the conversion to
// typed arrays happens inside Layer 1 (`wasmBridge.ts`) before reaching
// any store.

/** Concatenate one or more `Float32Array`s into a single contiguous
 *  backing buffer. Used when hydration arrives in multiple chunks. */
export function concatFloat32(arrays: Float32Array[]): Float32Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** Microseconds → seconds. Accepts `number` (Rust `u64` ≤ 2^53) or
 *  `bigint` (post-`time_raw()` for very long flights). The bigint path
 *  splits seconds vs. remainder to keep the integer-seconds part exact
 *  before dropping into f64 — direct `Number(big) / 1e6` loses
 *  microsecond precision for any flight beyond a few hours. */
export function secondsFromMicros(micros: number | bigint): number {
  if (typeof micros === 'bigint') {
    const sec = Number(micros / 1_000_000n);
    const rem = Number(micros % 1_000_000n) / 1_000_000;
    return sec + rem;
  }
  return micros / 1_000_000;
}

/** Byte footprint of a `Float32Array`. Stable wrapper for the M1.3+
 *  LRU-cache accounting that lives in `stores/view.ts`. */
export function float32ArrayBytes(arr: Float32Array): number {
  return arr.byteLength;
}

/** Binary search for the index in a sorted ascending `time` array whose
 *  value is nearest to `t`. Returns `null` for an empty array. Out-of-
 *  range values clamp to the nearest endpoint. Used by the cursor-live
 *  readouts to pick the sample under the user's cursor without a
 *  linear scan per chart per hover. */
export function nearestTimeIndex(time: Float32Array, t: number): number | null {
  const n = time.length;
  if (n === 0) return null;
  if (t <= time[0]) return 0;
  if (t >= time[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (time[mid] > t) hi = mid;
    else lo = mid;
  }
  return Math.abs(time[lo] - t) <= Math.abs(time[hi] - t) ? lo : hi;
}
