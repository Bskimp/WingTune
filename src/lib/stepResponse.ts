// Layer 2 — closed-loop step response via Wiener deconvolution.
//
// Estimates the response of `gyro = h * setpoint` (convolution) by
// inverting the relation in the frequency domain:
//
//   H(f) = G(f) · conj(S(f))  /  (|S(f)|² + λ)
//
// where λ is a small regularization that suppresses blow-up at
// frequencies where the input setpoint has little energy. Inverse
// FFT of H(f) gives the closed-loop impulse response h(t); cumulative
// sum gives the step response (response of the system to a unit-step
// command at t=0).
//
// Windowed averaging (Welch-style on the deconvolution path): split
// the long flight into overlapping segments, drop segments where the
// setpoint is too quiet to constrain the inverse problem (deconvolving
// against near-zero input amplifies noise), Hann-window each kept
// segment, deconvolve, average impulse responses across kept segments.
//
// Why settling/overshoot metrics matter: peak ratio above 1.0 → PID
// is too aggressive (overshoot); ramp slower than expected → too
// sluggish. The metrics let the M-step recommender (slice 2 work)
// quantitatively flag bad tuning without the user having to read
// the curve themselves.

import { fftInPlace, hannWindow } from '@/lib/spectrum';

const DEFAULT_SEGMENT_LEN = 2048;
const DEFAULT_OVERLAP = 0.5;
const DEFAULT_WINDOW_SEC = 0.5;
/** Setpoint segments below this RMS (deg/s) are dropped — too quiet to
 *  yield a meaningful inverse. Tuned for wing setpoints (slower
 *  commands than quad sticks); the recommender can override. */
const DEFAULT_RMS_THRESHOLD = 30;
/** Wiener regularization as a fraction of the peak |S(f)|² value
 *  across the segment's spectrum. 1% is the standard textbook choice
 *  for closed-loop sysid; produces stable inverses without smearing
 *  the response curve. */
const WIENER_LAMBDA_FRAC = 0.01;

export interface StepResponseResult {
  /** Time axis in seconds, 0..windowSec. */
  time: Float32Array;
  /** Averaged step response amplitude at each time point. Unitless
   *  ratio: ideal closed-loop response is 1.0 throughout (perfect
   *  tracking). Values > 1.0 indicate overshoot; < 1.0 sluggish. */
  response: Float32Array;
  /** Segments that passed the setpoint-RMS gate and contributed to
   *  the averaged response. Zero means the gyro/setpoint pair never
   *  had enough excitation to deconvolve cleanly. */
  numSegments: number;
  /** Peak amplitude reached during the window (proxy for overshoot
   *  if > 1.0). */
  peakAmplitude: number;
  /** Time at which `peakAmplitude` occurred, in milliseconds. */
  peakTimeMs: number;
  /** Time to first reach 95% of the steady-state value, in
   *  milliseconds. -1 if the response never reaches 95%. */
  settlingTimeMs: number;
  /** Mean of the response over the last ~10% of the window — the
   *  practical "final value" estimate. */
  finalValue: number;
}

/** In-place inverse FFT. Implemented as FFT(conj(X)) / N (standard
 *  trick that avoids duplicating the radix-2 butterfly code). After
 *  return, re/im hold the time-domain inverse transform. */
export function ifftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Conjugate input.
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  // Conjugate output + normalize. Imaginary part of the output is
  // tiny for real-input ifft (round-off); we keep both populated so
  // callers that care about the complex result get correct values.
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= invN;
    im[i] = -im[i] * invN;
  }
}

function segmentRms(arr: Float32Array, start: number, len: number): number {
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const v = arr[start + i];
    sum += v * v;
  }
  return Math.sqrt(sum / len);
}

export interface ComputeStepResponseOptions {
  segmentLen?: number;
  overlap?: number;
  windowSec?: number;
  setpointRmsThreshold?: number;
}

export function computeStepResponse(
  setpoint: Float32Array,
  gyro: Float32Array,
  sampleRateHz: number,
  options: ComputeStepResponseOptions = {},
): StepResponseResult {
  const segmentLen = options.segmentLen ?? DEFAULT_SEGMENT_LEN;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const windowSec = options.windowSec ?? DEFAULT_WINDOW_SEC;
  const rmsThreshold = options.setpointRmsThreshold ?? DEFAULT_RMS_THRESHOLD;

  if (segmentLen < 2 || (segmentLen & (segmentLen - 1)) !== 0) {
    throw new Error(`computeStepResponse: segmentLen must be a power of 2, got ${segmentLen}`);
  }

  const windowSamples = Math.min(segmentLen, Math.max(2, Math.round(windowSec * sampleRateHz)));
  const time = new Float32Array(windowSamples);
  for (let i = 0; i < windowSamples; i++) time[i] = i / sampleRateHz;
  const response = new Float32Array(windowSamples);

  const empty = (): StepResponseResult => ({
    time, response, numSegments: 0,
    peakAmplitude: 0, peakTimeMs: 0, settlingTimeMs: -1, finalValue: 0,
  });

  if (setpoint.length !== gyro.length) {
    throw new Error(
      `computeStepResponse: setpoint (${setpoint.length}) and gyro (${gyro.length}) length mismatch`,
    );
  }
  if (sampleRateHz <= 0) return empty();
  if (setpoint.length < segmentLen) return empty();

  const step = Math.max(1, Math.floor(segmentLen * (1 - overlap)));
  const window = hannWindow(segmentLen);

  // Accumulator for averaged step response.
  const accumImpulse = new Float64Array(segmentLen);

  // Reusable per-segment buffers.
  const sRe = new Float32Array(segmentLen);
  const sIm = new Float32Array(segmentLen);
  const gRe = new Float32Array(segmentLen);
  const gIm = new Float32Array(segmentLen);
  const hRe = new Float32Array(segmentLen);
  const hIm = new Float32Array(segmentLen);

  let numSegments = 0;
  for (let start = 0; start + segmentLen <= setpoint.length; start += step) {
    if (segmentRms(setpoint, start, segmentLen) < rmsThreshold) continue;

    for (let i = 0; i < segmentLen; i++) {
      const w = window[i];
      sRe[i] = setpoint[start + i] * w;
      sIm[i] = 0;
      gRe[i] = gyro[start + i] * w;
      gIm[i] = 0;
    }
    fftInPlace(sRe, sIm);
    fftInPlace(gRe, gIm);

    // Wiener regularization: λ = WIENER_LAMBDA_FRAC × max |S(f)|².
    let sMaxSq = 0;
    for (let i = 0; i < segmentLen; i++) {
      const m = sRe[i] * sRe[i] + sIm[i] * sIm[i];
      if (m > sMaxSq) sMaxSq = m;
    }
    if (sMaxSq <= 0) continue;
    const lambda = WIENER_LAMBDA_FRAC * sMaxSq;

    // H(f) = G(f) · conj(S(f)) / (|S(f)|² + λ).
    // Note: conj(S) = (sRe, -sIm); (gRe + i·gIm)(sRe - i·sIm) =
    //   (gRe·sRe + gIm·sIm) + i·(gIm·sRe - gRe·sIm).
    for (let i = 0; i < segmentLen; i++) {
      const denom = sRe[i] * sRe[i] + sIm[i] * sIm[i] + lambda;
      hRe[i] = (gRe[i] * sRe[i] + gIm[i] * sIm[i]) / denom;
      hIm[i] = (gIm[i] * sRe[i] - gRe[i] * sIm[i]) / denom;
    }
    ifftInPlace(hRe, hIm);

    // Accumulate impulse response (real part only — imag is round-off).
    for (let i = 0; i < segmentLen; i++) accumImpulse[i] += hRe[i];
    numSegments++;
  }

  if (numSegments === 0) return empty();

  // Average impulse response across segments + cumulative-sum to step.
  // Hann window scaling: integrating cumsum of a windowed impulse
  // response under-estimates final value by the window's coherent
  // gain. Compensate so steady-state reads as ~1.0 for a perfect
  // tracker. Hann coherent gain = sum(window) / N = 0.5; the
  // deconvolved impulse is already symmetric so its cumsum naturally
  // doubles back through the gain — net correction factor 2.0 (the
  // 1/coherent-gain for Hann).
  const invNum = 1 / numSegments;
  let acc = 0;
  for (let i = 0; i < windowSamples; i++) {
    acc += (accumImpulse[i] * invNum) * 2;  // ×2 = 1/Hann-coherent-gain
    response[i] = acc;
  }

  // Metrics.
  let peakAmplitude = -Infinity;
  let peakIdx = 0;
  for (let i = 0; i < windowSamples; i++) {
    if (response[i] > peakAmplitude) {
      peakAmplitude = response[i];
      peakIdx = i;
    }
  }
  // Final-value: average over last 10% of window.
  const tailStart = Math.max(0, windowSamples - Math.max(1, Math.floor(windowSamples * 0.1)));
  let tailSum = 0;
  for (let i = tailStart; i < windowSamples; i++) tailSum += response[i];
  const finalValue = tailSum / Math.max(1, windowSamples - tailStart);

  // Settling: first time the response stays within 95-105% of finalValue
  // for the rest of the window. Simpler approximation: first crossing
  // of 0.95 × finalValue.
  let settlingTimeMs = -1;
  if (finalValue > 0) {
    const target = 0.95 * finalValue;
    for (let i = 0; i < windowSamples; i++) {
      if (response[i] >= target) {
        settlingTimeMs = (i / sampleRateHz) * 1000;
        break;
      }
    }
  }

  return {
    time,
    response,
    numSegments,
    peakAmplitude,
    peakTimeMs: (peakIdx / sampleRateHz) * 1000,
    settlingTimeMs,
    finalValue,
  };
}
