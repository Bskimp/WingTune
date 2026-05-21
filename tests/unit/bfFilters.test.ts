import { describe, test, expect } from 'vitest';

import {
  BIQUAD_Q,
  PT2_CUTOFF_CORRECTION,
  PT3_CUTOFF_CORRECTION,
  biquadLowpassCoeffs,
  applyBiquadLowpass,
  applyBiquadNotch,
  applyPtLowpass,
  ptLowpassGain,
  applyRpmFilter,
  applyGyroLpf1,
  trackDynNotchPeaks,
  applyDynNotch,
  simulateChain,
  validateChain,
  parseFilterParams,
  type BfFilterParams,
} from '@/lib/bfFilters';

const SR = 1000;
const DT = 1 / SR;
const N = 8000;

function tone(freqHz: number, amp = 1): Float32Array {
  const s = new Float32Array(N);
  for (let i = 0; i < N; i++) s[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / SR);
  return s;
}
function constant(value: number): Float32Array {
  return new Float32Array(N).fill(value);
}
/** Peak amplitude over the settled tail (second half of the signal). */
function tailAmplitude(s: Float32Array): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = N >> 1; i < N; i++) {
    if (s[i] < min) min = s[i];
    if (s[i] > max) max = s[i];
  }
  return (max - min) / 2;
}
/** Mean over the settled tail. */
function tailMean(s: Float32Array): number {
  let sum = 0;
  for (let i = N >> 1; i < N; i++) sum += s[i];
  return sum / (N - (N >> 1));
}

describe('biquad lowpass', () => {
  test('passes a tone well below cutoff at ~unity gain', () => {
    expect(tailAmplitude(applyBiquadLowpass(tone(10), 100, DT))).toBeCloseTo(1, 1);
  });

  test('is -3 dB (gain ~0.707) at the cutoff frequency', () => {
    expect(tailAmplitude(applyBiquadLowpass(tone(50), 50, DT))).toBeCloseTo(0.707, 1);
  });

  test('strongly attenuates a tone well above cutoff', () => {
    expect(tailAmplitude(applyBiquadLowpass(tone(300), 50, DT))).toBeLessThan(0.2);
  });

  test('passes DC at unity gain', () => {
    expect(tailMean(applyBiquadLowpass(constant(1), 50, DT))).toBeCloseTo(1, 3);
  });

  test('lowpass coefficients give exactly unity DC gain', () => {
    const c = biquadLowpassCoeffs(50, DT);
    const dcGain = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
    expect(dcGain).toBeCloseTo(1, 6);
  });
});

describe('biquad notch', () => {
  test('deeply attenuates a tone at the notch centre', () => {
    expect(tailAmplitude(applyBiquadNotch(tone(80), 80, DT, 5))).toBeLessThan(0.1);
  });

  test('passes a tone far from the notch centre', () => {
    expect(tailAmplitude(applyBiquadNotch(tone(20), 200, DT, 5))).toBeGreaterThan(0.9);
  });

  test('passes DC — the notch only kills its centre', () => {
    expect(tailMean(applyBiquadNotch(constant(1), 200, DT, 5))).toBeCloseTo(1, 3);
  });
});

describe('PT lowpass', () => {
  // BF's PTn use the gain approximation k = omega / (omega + 1); it
  // only lands on the ideal -3 dB at the nominal cutoff in the low
  // fc/SR regime (at fc = 50 Hz / SR = 1 kHz the discrete one-pole is
  // ~0.66, not 0.707 — by design, not a port bug). Test at 5 Hz / 1 kHz
  // where discrete ~= continuous — also where the PT2/PT3 cutoff
  // correction must hold: without it the cascade reads ~0.5, not ~0.707.
  test('PT1 is -3 dB at the cutoff frequency', () => {
    expect(tailAmplitude(applyPtLowpass(tone(5), 5, DT, 1))).toBeCloseTo(0.707, 1);
  });

  test('PT2 is -3 dB at the cutoff frequency (cutoff correction applied)', () => {
    expect(tailAmplitude(applyPtLowpass(tone(5), 5, DT, 2))).toBeCloseTo(0.707, 1);
  });

  test('PT3 is -3 dB at the cutoff frequency (cutoff correction applied)', () => {
    expect(tailAmplitude(applyPtLowpass(tone(5), 5, DT, 3))).toBeCloseTo(0.707, 1);
  });

  test('higher order rolls off steeper above the cutoff', () => {
    const a1 = tailAmplitude(applyPtLowpass(tone(200), 50, DT, 1));
    const a2 = tailAmplitude(applyPtLowpass(tone(200), 50, DT, 2));
    const a3 = tailAmplitude(applyPtLowpass(tone(200), 50, DT, 3));
    expect(a3).toBeLessThan(a2);
    expect(a2).toBeLessThan(a1);
  });

  test('passes DC at unity gain', () => {
    expect(tailMean(applyPtLowpass(constant(1), 50, DT, 3))).toBeCloseTo(1, 3);
  });
});

describe('filter constants', () => {
  test('BIQUAD_Q is the Butterworth value', () => {
    expect(BIQUAD_Q).toBeCloseTo(0.7071, 4);
  });

  test('PTn cutoff corrections equal 1 / sqrt(2^(1/n) - 1)', () => {
    expect(PT2_CUTOFF_CORRECTION).toBeCloseTo(1 / Math.sqrt(2 ** (1 / 2) - 1), 5);
    expect(PT3_CUTOFF_CORRECTION).toBeCloseTo(1 / Math.sqrt(2 ** (1 / 3) - 1), 5);
  });

  test('ptLowpassGain rises with cutoff and stays within (0, 1)', () => {
    const lo = ptLowpassGain(20, DT, 1);
    const hi = ptLowpassGain(200, DT, 1);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
    expect(hi).toBeGreaterThan(lo);
  });
});

function chainParams(overrides: Partial<BfFilterParams> = {}): BfFilterParams {
  return {
    lpf1Type: 'PT1',
    lpf1StaticHz: 100,
    lpf1DynMinHz: 0,
    lpf1DynMaxHz: 0,
    lpf1DynExpo: 5,
    dynNotchCount: 0,
    dynNotchQ: 3,
    dynNotchMinHz: 100,
    dynNotchMaxHz: 600,
    rpmHarmonics: 0,
    rpmQ: 5,
    rpmMinHz: 100,
    rpmFadeRangeHz: 50,
    rpmLpfHz: 150,
    rpmWeights: [1, 1, 1],
    motorPoles: 14,
    ...overrides,
  };
}

/** eRPM LSB value that yields a given motor frequency at motorPoles 14
 *  (erpmToHz = 100 / 60 / 7). */
function erpmForHz(hz: number): number {
  return hz / (100 / 60 / 7);
}

describe('applyRpmFilter', () => {
  test('notches out a tone at the motor fundamental frequency', () => {
    const out = applyRpmFilter(
      tone(200),
      chainParams({ rpmHarmonics: 1 }),
      [constant(erpmForHz(200))],
      SR,
    );
    expect(tailAmplitude(out)).toBeLessThan(0.2);
  });

  test('leaves a tone well away from any harmonic alone', () => {
    const out = applyRpmFilter(
      tone(350),
      chainParams({ rpmHarmonics: 1 }),
      [constant(erpmForHz(200))],
      SR,
    );
    expect(tailAmplitude(out)).toBeGreaterThan(0.85);
  });

  test('inactive (no harmonics) — returns the input unchanged', () => {
    const sig = tone(200);
    expect(
      applyRpmFilter(sig, chainParams({ rpmHarmonics: 0 }), [constant(erpmForHz(200))], SR),
    ).toBe(sig);
  });

  test('inactive (no eRPM) — returns the input unchanged', () => {
    const sig = tone(200);
    expect(applyRpmFilter(sig, chainParams({ rpmHarmonics: 3 }), [], SR)).toBe(sig);
  });
});

describe('applyGyroLpf1', () => {
  test('static cutoff attenuates a tone above it', () => {
    const out = applyGyroLpf1(tone(300), chainParams({ lpf1StaticHz: 60 }), null, SR);
    expect(tailAmplitude(out)).toBeLessThan(0.5);
  });

  test('dynamic cutoff tracks throttle — higher throttle passes more', () => {
    const p = chainParams({
      lpf1StaticHz: 0,
      lpf1DynMinHz: 250,
      lpf1DynMaxHz: 500,
      lpf1DynExpo: 5,
    });
    const lowThr = applyGyroLpf1(tone(400), p, constant(0.1), SR);
    const highThr = applyGyroLpf1(tone(400), p, constant(0.9), SR);
    expect(tailAmplitude(highThr)).toBeGreaterThan(tailAmplitude(lowThr));
  });

  test('LPF1 off (static 0, no dynamic) — returns the input unchanged', () => {
    const sig = tone(300);
    expect(
      applyGyroLpf1(sig, chainParams({ lpf1StaticHz: 0, lpf1DynMinHz: 0 }), null, SR),
    ).toBe(sig);
  });
});

describe('dynamic notch', () => {
  test('trackDynNotchPeaks parks a slot on a steady spectral peak', () => {
    const tracks = trackDynNotchPeaks(tone(125), chainParams({ dynNotchCount: 1 }), SR);
    expect(tracks).toHaveLength(1);
    expect(tracks[0][N >> 1]).toBeCloseTo(125, 0);
  });

  test('applyDynNotch attenuates a steady tracked peak', () => {
    const out = applyDynNotch(tone(125), chainParams({ dynNotchCount: 1 }), SR);
    expect(tailAmplitude(out)).toBeLessThan(0.3);
  });

  test('count 0 — returns the input unchanged', () => {
    const sig = tone(125);
    expect(applyDynNotch(sig, chainParams({ dynNotchCount: 0 }), SR)).toBe(sig);
  });
});

describe('simulateChain', () => {
  test('all stages disabled — output is the raw gyro untouched', () => {
    const raw = tone(200);
    const out = simulateChain({
      rawGyro: raw,
      sampleRateHz: SR,
      params: chainParams(),
      stages: { rpm: false, lpf1: false, dynNotch: false },
    });
    expect(out).toBe(raw);
  });

  test('RPM stage alone removes the motor tone', () => {
    const out = simulateChain({
      rawGyro: tone(200),
      sampleRateHz: SR,
      params: chainParams({ rpmHarmonics: 1 }),
      eRPM: [constant(erpmForHz(200))],
      stages: { rpm: true, lpf1: false, dynNotch: false },
    });
    expect(tailAmplitude(out)).toBeLessThan(0.2);
  });

  test('full chain attenuates both an RPM tone and a high-frequency tone', () => {
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      raw[i] =
        Math.sin((2 * Math.PI * 200 * i) / SR) + Math.sin((2 * Math.PI * 350 * i) / SR);
    }
    const out = simulateChain({
      rawGyro: raw,
      sampleRateHz: SR,
      params: chainParams({ rpmHarmonics: 1, lpf1StaticHz: 80, lpf1Type: 'PT2' }),
      eRPM: [constant(erpmForHz(200))],
    });
    expect(tailAmplitude(out)).toBeLessThan(tailAmplitude(raw) * 0.5);
  });
});

describe('validateChain', () => {
  test('identical signals — fidelity 1, zero residual', () => {
    const s = tone(50);
    const v = validateChain(s, s);
    expect(v.simFidelity).toBeCloseTo(1, 6);
    expect(v.nrmse).toBeCloseTo(0, 6);
  });

  test('totally mismatched signals — low fidelity', () => {
    const v = validateChain(new Float32Array(N), tone(50));
    expect(v.simFidelity).toBeLessThan(0.1);
  });

  test('warm-up skip excludes the leading samples from the comparison', () => {
    const v = validateChain(tone(50), tone(50), 1000);
    expect(v.samplesCompared).toBe(N - 1000);
  });
});

describe('parseFilterParams', () => {
  test('empty header → BF defaults', () => {
    const p = parseFilterParams({});
    expect(p.lpf1Type).toBe('PT1');
    expect(p.dynNotchCount).toBe(0);
    expect(p.dynNotchQ).toBeCloseTo(3, 6);
    expect(p.rpmQ).toBeCloseTo(5, 6);
    expect(p.motorPoles).toBe(14);
  });

  test('parses explicit scalar params', () => {
    const p = parseFilterParams({
      gyro_lpf1_static_hz: '120',
      dyn_notch_count: '4',
      dyn_notch_q: '350',
      rpm_filter_harmonics: '3',
      motor_poles: '12',
    });
    expect(p.lpf1StaticHz).toBe(120);
    expect(p.dynNotchCount).toBe(4);
    expect(p.dynNotchQ).toBeCloseTo(3.5, 6);
    expect(p.rpmHarmonics).toBe(3);
    expect(p.motorPoles).toBe(12);
  });

  test('parses the dynamic-LPF range comma pair', () => {
    const p = parseFilterParams({ gyro_lpf1_dyn_hz: '250,500' });
    expect(p.lpf1DynMinHz).toBe(250);
    expect(p.lpf1DynMaxHz).toBe(500);
  });

  test('parses the RPM weights triple and scales to 0..1', () => {
    const p = parseFilterParams({ rpm_filter_weights: '80,60,40' });
    expect(p.rpmWeights[0]).toBeCloseTo(0.8, 6);
    expect(p.rpmWeights[1]).toBeCloseTo(0.6, 6);
    expect(p.rpmWeights[2]).toBeCloseTo(0.4, 6);
  });

  test('reads the filter type as a name or a lookup index', () => {
    expect(parseFilterParams({ gyro_lpf1_type: 'PT3' }).lpf1Type).toBe('PT3');
    expect(parseFilterParams({ gyro_lpf1_type: '2' }).lpf1Type).toBe('PT2');
    expect(parseFilterParams({ gyro_lpf1_type: '1' }).lpf1Type).toBe('BIQUAD');
    expect(parseFilterParams({ gyro_lpf1_type: '0' }).lpf1Type).toBe('PT1');
  });

  test('a malformed value falls back to the default', () => {
    expect(parseFilterParams({ dyn_notch_count: 'xyz' }).dynNotchCount).toBe(0);
  });
});
