import { describe, expect, test } from 'vitest';

import { analyzeServoAsymmetry } from '@/lib/servoAsymmetry';
import type { AxisCorrelations } from '@/lib/servoClassifier';

/** Synthesize a paired-aileron-like signal: ref centered on 1500
 *  with a sinusoidal swing, other = ref shifted by lagSamples and
 *  scaled by ampFactor. */
function makePaired(
  n: number,
  freqHz: number,
  ampPwm: number,
  lagSamples: number,
  ampFactor: number,
  sampleRateHz: number,
): { ref: Float32Array; other: Float32Array } {
  const ref = new Float32Array(n);
  const other = new Float32Array(n);
  const omega = 2 * Math.PI * freqHz / sampleRateHz;
  for (let i = 0; i < n; i++) {
    ref[i] = 1500 + ampPwm * Math.sin(omega * i);
    // lagSamples positive → other is the same signal but DELAYED in
    // its own index — at index i, other matches ref at index i-lag.
    const otherIdx = i - lagSamples;
    other[i] = 1500 + ampPwm * ampFactor * Math.sin(omega * otherIdx);
  }
  return { ref, other };
}

function makeCorrelations(
  fields: string[],
  axis: 0 | 1 | 2,
  signedValue: number,
): AxisCorrelations[] {
  return fields.map((fieldName) => ({
    fieldName,
    roll:  axis === 0 ? signedValue : 0,
    pitch: axis === 1 ? signedValue : 0,
    yaw:   axis === 2 ? signedValue : 0,
    dominantAxis: axis,
    dominantSigned: signedValue,
  }));
}

describe('analyzeServoAsymmetry', () => {
  const SR = 1000;

  test('healthy paired servos detect as ok with near-zero lag + ratio ~1', () => {
    const { ref, other } = makePaired(4096, 5, 300, 0, 1.0, SR);
    const motors = new Map<string, Float32Array>([
      ['motor[3]', ref],
      ['motor[4]', other],
    ]);
    const axisCorrelations = makeCorrelations(['motor[3]', 'motor[4]'], 0, 0.9);

    const result = analyzeServoAsymmetry({ motors, axisCorrelations, sampleRateHz: SR });
    expect(result).toHaveLength(1);
    expect(result[0].axis).toBe(0);
    expect(result[0].referenceFieldName).toBe('motor[3]');
    expect(result[0].pairs).toHaveLength(1);
    expect(result[0].pairs[0].severity).toBe('ok');
    expect(Math.abs(result[0].pairs[0].peakLagMs)).toBeLessThanOrEqual(1);
    expect(result[0].pairs[0].amplitudeRatio).toBeCloseTo(1.0, 1);
  });

  test('lagged servo recovers correct sign + magnitude', () => {
    const lagSamples = 18; // 18 ms at 1 kHz
    const { ref, other } = makePaired(4096, 5, 300, lagSamples, 1.0, SR);
    const motors = new Map<string, Float32Array>([
      ['motor[3]', ref],
      ['motor[4]', other],
    ]);
    const axisCorrelations = makeCorrelations(['motor[3]', 'motor[4]'], 0, 0.9);

    const result = analyzeServoAsymmetry({ motors, axisCorrelations, sampleRateHz: SR });
    const pair = result[0].pairs[0];
    // Positive lag = other lags ref. We delayed other by 18 samples → ~18 ms.
    expect(pair.peakLagMs).toBeGreaterThan(15);
    expect(pair.peakLagMs).toBeLessThan(22);
    expect(pair.severity).toBe('warn'); // > 10 ms threshold
  });

  test('amplitude-mismatched servo recovers ratio', () => {
    const { ref, other } = makePaired(4096, 5, 300, 0, 0.5, SR);
    const motors = new Map<string, Float32Array>([
      ['motor[3]', ref],
      ['motor[4]', other],
    ]);
    const axisCorrelations = makeCorrelations(['motor[3]', 'motor[4]'], 0, 0.9);

    const result = analyzeServoAsymmetry({ motors, axisCorrelations, sampleRateHz: SR });
    const pair = result[0].pairs[0];
    expect(pair.amplitudeRatio).toBeCloseTo(0.5, 1);
    expect(pair.severity).toBe('warn'); // < 0.7 threshold
  });

  test('single-servo axis returns no entry (nothing to compare)', () => {
    const motors = new Map<string, Float32Array>([
      ['motor[3]', new Float32Array(4096).fill(1500)],
    ]);
    const axisCorrelations = makeCorrelations(['motor[3]'], 0, 0.9);
    const result = analyzeServoAsymmetry({ motors, axisCorrelations, sampleRateHz: SR });
    expect(result).toHaveLength(0);
  });

  test('uncorrelated noise pairs as inconclusive', () => {
    const ref = new Float32Array(4096);
    const other = new Float32Array(4096);
    // Two independent random-ish signals — won't correlate.
    for (let i = 0; i < 4096; i++) {
      ref[i] = 1500 + (Math.sin(i * 0.137) + Math.sin(i * 0.291)) * 100;
      other[i] = 1500 + (Math.sin(i * 1.731) + Math.sin(i * 2.913)) * 100;
    }
    const motors = new Map<string, Float32Array>([
      ['motor[3]', ref],
      ['motor[4]', other],
    ]);
    const axisCorrelations = makeCorrelations(['motor[3]', 'motor[4]'], 0, 0.9);
    const result = analyzeServoAsymmetry({ motors, axisCorrelations, sampleRateHz: SR });
    expect(result[0].pairs[0].severity).toBe('inconclusive');
  });

  test('largest |dominantSigned| becomes the reference', () => {
    const { ref, other } = makePaired(4096, 5, 300, 0, 1.0, SR);
    const motors = new Map<string, Float32Array>([
      ['motor[3]', other], // motor[3] gets the lower signal
      ['motor[4]', ref],   // motor[4] gets the higher signal
    ]);
    const axisCorrelations: AxisCorrelations[] = [
      { fieldName: 'motor[3]', roll: 0.5, pitch: 0, yaw: 0, dominantAxis: 0, dominantSigned: 0.5 },
      { fieldName: 'motor[4]', roll: 0.9, pitch: 0, yaw: 0, dominantAxis: 0, dominantSigned: 0.9 },
    ];
    const result = analyzeServoAsymmetry({ motors, axisCorrelations, sampleRateHz: SR });
    // motor[4] has higher |dominantSigned| → should be reference.
    expect(result[0].referenceFieldName).toBe('motor[4]');
    expect(result[0].pairs[0].fieldName).toBe('motor[3]');
  });
});
