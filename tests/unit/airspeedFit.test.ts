import { describe, test, expect } from 'vitest';

import {
  integrateBasicAirspeedModel,
  fitBasicAirspeedModel,
  computeCoverage,
  buildAirspeedFitInputs,
  resolveMaxVoltageX100,
  resolveAirspeedPitchField,
  type BasicAirspeedParams,
  type ModelInputs,
  type AirspeedFitInputs,
} from '@/lib/airspeedFit';
import type { CapabilityReport } from '@/lib/wasmBridge';

const G = 9.81;
const ATANH_HALF = 0.5493061443340549;

function makeTimeAxis(durationSec: number, sampleRateHz: number): Float32Array {
  const n = Math.max(1, Math.floor(durationSec * sampleRateHz));
  const t = new Float32Array(n);
  const dt = 1 / sampleRateHz;
  for (let i = 0; i < n; i++) t[i] = i * dt;
  return t;
}

function fill(n: number, v: number): Float32Array {
  const a = new Float32Array(n);
  a.fill(v);
  return a;
}

// maxVoltageX100 is now a fixed model INPUT (not a fitted param). The
// default 2520 (= 25.2 V) means vbat == 25.2 V drives tEff to 1.
function constantInputs(
  t: Float32Array,
  throttle: number,
  vbat: number,
  pitchRad: number,
  maxVoltageX100 = 2520,
): ModelInputs {
  return {
    time: t,
    throttle: fill(t.length, throttle),
    vbat: fill(t.length, vbat),
    pitch: fill(t.length, pitchRad),
    maxVoltageX100,
  };
}

describe('integrateBasicAirspeedModel', () => {
  test('horizontal full throttle approaches the closed-form terminal velocity', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50 };
    const t = makeTimeAxis(30, 200);
    const inputs = constantInputs(t, 1.0, 25.2, 0);
    const v = integrateBasicAirspeedModel(params, inputs);

    // Closed-form: v_term = τ · TWR · g, τ = delay_sec / atanh(0.5).
    const twr = (100 / params.gravityPct) ** 2;
    const tau = (params.delayMs / 1000) / ATANH_HALF;
    const vTerm = tau * twr * G;

    expect(v[v.length - 1]).toBeCloseTo(vTerm, 0);
  });

  test('half-velocity occurs near the delay_ms parameter', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50 };
    const t = makeTimeAxis(10, 400);
    const inputs = constantInputs(t, 1.0, 25.2, 0);
    const v = integrateBasicAirspeedModel(params, inputs);

    const twr = (100 / params.gravityPct) ** 2;
    const tau = (params.delayMs / 1000) / ATANH_HALF;
    const vTerm = tau * twr * G;
    const halfIdx = Math.floor((params.delayMs / 1000) * 400);

    expect(v[halfIdx]).toBeGreaterThan(vTerm * 0.45);
    expect(v[halfIdx]).toBeLessThan(vTerm * 0.55);
  });

  test('zero throttle starting from rest stays at rest', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50 };
    const t = makeTimeAxis(20, 100);
    const inputs = constantInputs(t, 0, 16.8, 0);
    const v = integrateBasicAirspeedModel(params, inputs);
    expect(v[v.length - 1]).toBeCloseTo(0, 2);
  });

  test('climb pitch decelerates relative to level flight', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50 };
    const t = makeTimeAxis(20, 200);
    const horiz = constantInputs(t, 1.0, 25.2, 0);
    const climb = constantInputs(t, 1.0, 25.2, 0.3);
    const vH = integrateBasicAirspeedModel(params, horiz);
    const vC = integrateBasicAirspeedModel(params, climb);
    expect(vC[vC.length - 1]).toBeLessThan(vH[vH.length - 1]);
  });

  test('voltage scaling: half-voltage halves effective throttle', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50 };
    const t = makeTimeAxis(20, 200);
    // Same fixed maxVoltageX100 (2520 → 25.2 V); only the logged vbat
    // differs, so tEff = throttle · vbat / 25.2.
    const full = constantInputs(t, 1.0, 25.2, 0);
    const half = constantInputs(t, 1.0, 12.6, 0);
    const vF = integrateBasicAirspeedModel(params, full);
    const vH = integrateBasicAirspeedModel(params, half);
    expect(vH[vH.length - 1]).toBeLessThan(vF[vF.length - 1]);
  });

  test('returns empty for empty input', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50 };
    const v = integrateBasicAirspeedModel(params, {
      time: new Float32Array(0),
      throttle: new Float32Array(0),
      vbat: new Float32Array(0),
      pitch: new Float32Array(0),
      maxVoltageX100: 2520,
    });
    expect(v.length).toBe(0);
  });

  test('matches the closed-form tanh trajectory across the whole rise', () => {
    // At full effective throttle (vbat == max_voltage) and level flight
    // the model reduces to dv/dt = A − B·v² with A = TWR·g, B = k, whose
    // exact solution from rest is v(t) = vTerm·tanh(t/τ). Comparing the
    // integrator against this analytic curve — rather than against its
    // own output — is what catches an Euler-stepping implementation bug.
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50 };
    const t = makeTimeAxis(15, 400);
    const inputs = constantInputs(t, 1.0, 25.2, 0); // vbat == maxVoltage → tEff = 1
    const v = integrateBasicAirspeedModel(params, inputs);

    // Constants derived here independently of the module's deriveConstants().
    const twr = (100 / params.gravityPct) ** 2;
    const tau = (params.delayMs / 1000) / ATANH_HALF;
    const vTerm = tau * twr * G;

    let maxDev = 0;
    for (let i = 0; i < t.length; i++) {
      const analytic = vTerm * Math.tanh(t[i] / tau);
      maxDev = Math.max(maxDev, Math.abs(v[i] - analytic));
    }
    // Bound covers explicit-Euler discretization error at 400 Hz.
    expect(maxDev).toBeLessThan(0.5);
  });
});

describe('fitBasicAirspeedModel', () => {
  test('recovers planted params from noise-free synthetic data', () => {
    const truth: BasicAirspeedParams = { delayMs: 1200, gravityPct: 45 };
    const t = makeTimeAxis(40, 100);
    const throttle = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) {
      const phase = Math.floor(t[i] / 4) % 2;
      throttle[i] = phase === 0 ? 1.0 : 0.35;
    }
    const vbat = fill(t.length, 25.2);
    const pitch = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) pitch[i] = Math.sin(t[i] / 6) * 0.15;

    const target = integrateBasicAirspeedModel(truth, {
      time: t, throttle, vbat, pitch, maxVoltageX100: 2520,
    });

    const fit = fitBasicAirspeedModel({
      time: t, throttle, vbat, pitch, gpsSpeed: target, maxVoltageX100: 2520,
    }, { initialParams: { delayMs: 1000, gravityPct: 50 } });

    expect(fit.rSquared).toBeGreaterThan(0.99);
    expect(fit.rmsResidual).toBeLessThan(1.0);
    expect(fit.params.delayMs).toBeGreaterThan(1000);
    expect(fit.params.delayMs).toBeLessThan(1400);
    expect(fit.params.gravityPct).toBeGreaterThan(40);
    expect(fit.params.gravityPct).toBeLessThan(50);
  });

  test('reports high rSquared on a clean fit', () => {
    const truth: BasicAirspeedParams = { delayMs: 800, gravityPct: 60 };
    const t = makeTimeAxis(25, 100);
    const throttle = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) throttle[i] = 0.4 + 0.5 * (i % 600 < 300 ? 1 : 0);
    const vbat = fill(t.length, 25.2);
    const pitch = new Float32Array(t.length);
    const target = integrateBasicAirspeedModel(truth, {
      time: t, throttle, vbat, pitch, maxVoltageX100: 2520,
    });

    const fit = fitBasicAirspeedModel({
      time: t, throttle, vbat, pitch, gpsSpeed: target, maxVoltageX100: 2520,
    });
    expect(fit.rSquared).toBeGreaterThan(0.95);
  });

  test('returns predicted + residual arrays of correct length', () => {
    const t = makeTimeAxis(10, 100);
    const inputs: AirspeedFitInputs = {
      time: t,
      throttle: fill(t.length, 0.5),
      vbat: fill(t.length, 25.2),
      pitch: new Float32Array(t.length),
      gpsSpeed: fill(t.length, 20),
      maxVoltageX100: 2520,
    };
    const fit = fitBasicAirspeedModel(inputs);
    expect(fit.predicted.length).toBe(t.length);
    expect(fit.residuals.length).toBe(t.length);
    expect(fit.iterations).toBeGreaterThan(0);
  });

  test('recovers planted params when the target is the analytic tanh solution', () => {
    // The 'recovers planted params' test above generates its target with
    // integrateBasicAirspeedModel — the same function the fit minimizes
    // against — so a shared integrator bug would pass unnoticed. Here the
    // synthetic GPS speed is instead the exact analytic ODE solution
    // v(t) = vTerm·tanh(t/τ); the fit's internal integrator must
    // reproduce that to converge, so an integrator bug surfaces.
    const truth: BasicAirspeedParams = { delayMs: 900, gravityPct: 55 };
    const twr = (100 / truth.gravityPct) ** 2;
    const tau = (truth.delayMs / 1000) / ATANH_HALF;
    const vTerm = tau * twr * G;

    const t = makeTimeAxis(20, 200);
    const gpsSpeed = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) gpsSpeed[i] = vTerm * Math.tanh(t[i] / tau);

    const fit = fitBasicAirspeedModel(
      {
        time: t,
        throttle: fill(t.length, 1.0),
        vbat: fill(t.length, 25.2), // == maxVoltage → tEff pinned at 1
        pitch: new Float32Array(t.length),
        gpsSpeed,
        maxVoltageX100: 2520,
      },
      { initialParams: { delayMs: 1200, gravityPct: 45 }, maxIterations: 400 },
    );

    expect(fit.rSquared).toBeGreaterThan(0.999);
    // delay + gravity are the only fitted params; both are identifiable
    // from a constant-input tanh rise.
    expect(fit.params.delayMs).toBeGreaterThan(850);
    expect(fit.params.delayMs).toBeLessThan(950);
    expect(fit.params.gravityPct).toBeGreaterThan(52);
    expect(fit.params.gravityPct).toBeLessThan(58);
  });
});

describe('computeCoverage', () => {
  test('counts throttle transitions per minute', () => {
    const t = makeTimeAxis(60, 100);
    const throttle = new Float32Array(t.length);
    let phase = 0;
    for (let i = 0; i < t.length; i++) {
      if (i % 600 === 0) phase = 1 - phase;
      throttle[i] = phase === 0 ? 0.2 : 0.8;
    }
    const cov = computeCoverage({
      time: t,
      throttle,
      vbat: fill(t.length, 25.2),
      pitch: new Float32Array(t.length),
      gpsSpeed: fill(t.length, 20),
      maxVoltageX100: 2520,
    });
    expect(cov.throttleTransitionsPerMin).toBeGreaterThan(5);
    expect(cov.throttleTransitionsPerMin).toBeLessThan(15);
  });

  test('dive/climb balance saturates to +1 when only diving', () => {
    const t = makeTimeAxis(10, 100);
    const cov = computeCoverage({
      time: t,
      throttle: fill(t.length, 0.5),
      vbat: fill(t.length, 25.2),
      pitch: fill(t.length, -0.4),
      gpsSpeed: fill(t.length, 20),
      maxVoltageX100: 2520,
    });
    expect(cov.diveClimbBalance).toBeCloseTo(1, 2);
  });

  test('dive/climb balance is 0 when level', () => {
    const t = makeTimeAxis(10, 100);
    const cov = computeCoverage({
      time: t,
      throttle: fill(t.length, 0.5),
      vbat: fill(t.length, 25.2),
      pitch: new Float32Array(t.length),
      gpsSpeed: fill(t.length, 20),
      maxVoltageX100: 2520,
    });
    expect(cov.diveClimbBalance).toBe(0);
  });

  test('voltage sag fraction tracks (vMax - vMin) / vMax', () => {
    const t = makeTimeAxis(10, 100);
    const vbat = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) vbat[i] = 25.2 - (i / t.length) * 2.0;
    const cov = computeCoverage({
      time: t,
      throttle: fill(t.length, 0.5),
      vbat,
      pitch: new Float32Array(t.length),
      gpsSpeed: fill(t.length, 20),
      maxVoltageX100: 2520,
    });
    expect(cov.voltageSagFraction).toBeCloseTo(2.0 / 25.2, 2);
  });

  test('speed bins sum to total samples', () => {
    const t = makeTimeAxis(10, 100);
    const gpsSpeed = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) gpsSpeed[i] = (i / t.length) * 30;
    const cov = computeCoverage({
      time: t,
      throttle: fill(t.length, 0.5),
      vbat: fill(t.length, 25.2),
      pitch: new Float32Array(t.length),
      gpsSpeed,
      maxVoltageX100: 2520,
    });
    let total = 0;
    for (const c of cov.samplesPerSpeedBin) total += c;
    expect(total).toBe(t.length);
  });

  test('empty inputs return zeroed metrics', () => {
    const cov = computeCoverage({
      time: new Float32Array(0),
      throttle: new Float32Array(0),
      vbat: new Float32Array(0),
      pitch: new Float32Array(0),
      gpsSpeed: new Float32Array(0),
      maxVoltageX100: 2520,
    });
    expect(cov.speedMin).toBe(0);
    expect(cov.speedMax).toBe(0);
    expect(cov.throttleTransitionsPerMin).toBe(0);
  });
});

describe('resolveMaxVoltageX100', () => {
  test('uses the header value when present and in physical range', () => {
    const r = resolveMaxVoltageX100({ tpa_speed_max_voltage: '1260' }, fill(5, 12));
    expect(r.maxVoltageSource).toBe('header');
    expect(r.maxVoltageX100).toBe(1260);
  });

  test('falls back to peak vbat when the header key is absent', () => {
    const r = resolveMaxVoltageX100(undefined, fill(5, 12.4));
    expect(r.maxVoltageSource).toBe('vbat-fallback');
    expect(r.maxVoltageX100).toBe(1240);
  });

  test('falls back when the header value is non-numeric', () => {
    const r = resolveMaxVoltageX100({ tpa_speed_max_voltage: 'BASIC' }, fill(5, 11.8));
    expect(r.maxVoltageSource).toBe('vbat-fallback');
    expect(r.maxVoltageX100).toBe(1180);
  });

  test('falls back when the header value is out of physical range', () => {
    const r = resolveMaxVoltageX100({ tpa_speed_max_voltage: '99999' }, fill(5, 16.8));
    expect(r.maxVoltageSource).toBe('vbat-fallback');
    expect(r.maxVoltageX100).toBe(1680);
  });

  test('clamps the fallback to the minimum when vbat is empty', () => {
    const r = resolveMaxVoltageX100(undefined, new Float32Array(0));
    expect(r.maxVoltageSource).toBe('vbat-fallback');
    expect(r.maxVoltageX100).toBe(420);
  });
});

describe('buildAirspeedFitInputs max-voltage pinning', () => {
  // Minimal field set: 100 Hz main frame, a GPS window strictly inside
  // the main-frame span so the trim leaves a healthy sample count.
  function makeAirspeedFields(opts: { n: number; vbat: number }): {
    time: Float32Array;
    gpsTimeSec: Float32Array;
    fields: Map<string, Float32Array>;
  } {
    const time = makeTimeAxis(opts.n / 100, 100);
    const throttle = fill(time.length, 1500); // BF PWM mid-stick
    const vb = fill(time.length, opts.vbat);
    const gpsCount = 21;
    const gpsTimeSec = new Float32Array(gpsCount);
    const gpsSpeed = new Float32Array(gpsCount);
    const span = time[time.length - 1];
    for (let j = 0; j < gpsCount; j++) {
      gpsTimeSec[j] = span * 0.2 + (j / (gpsCount - 1)) * span * 0.6;
      gpsSpeed[j] = 15;
    }
    const fields = new Map<string, Float32Array>([
      ['rcCommand[3]', throttle],
      ['vbatLatest', vb],
      ['gps:GPS_speed', gpsSpeed],
    ]);
    return { time, gpsTimeSec, fields };
  }

  test('reads tpa_speed_max_voltage from the log header', () => {
    const { time, gpsTimeSec, fields } = makeAirspeedFields({ n: 300, vbat: 12.0 });
    const built = buildAirspeedFitInputs({
      time, gpsTimeSec, fields,
      headerParams: { tpa_speed_max_voltage: '1260' },
    });
    expect(built).not.toBeNull();
    expect(built!.maxVoltageSource).toBe('header');
    expect(built!.inputs.maxVoltageX100).toBe(1260);
  });

  test('falls back to peak vbat when the header lacks the key', () => {
    const { time, gpsTimeSec, fields } = makeAirspeedFields({ n: 300, vbat: 12.5 });
    const built = buildAirspeedFitInputs({ time, gpsTimeSec, fields });
    expect(built).not.toBeNull();
    expect(built!.maxVoltageSource).toBe('vbat-fallback');
    expect(built!.inputs.maxVoltageX100).toBe(1250);
  });
});

describe('resolveAirspeedPitchField', () => {
  // resolveSignal only reads these four CapabilityReport fields; the
  // rest are stubbed so the fixture stays minimal.
  function makeCapability(
    fieldsPresent: string[],
    debugMode: string | null = null,
  ): CapabilityReport {
    return {
      fields_present: fieldsPresent,
      debug_mode: debugMode,
      gps_present: false,
      sample_check: {},
      frame_index: {} as CapabilityReport['frame_index'],
      firmware_revision: null,
    };
  }

  test('returns the raw attitude[1] default when no capability is given', () => {
    expect(resolveAirspeedPitchField(undefined)).toBe('attitude[1]');
  });

  test('resolves USE_WING wingTpaPitch when present', () => {
    const cap = makeCapability(['wingTpaPitch', 'attitude[1]']);
    expect(resolveAirspeedPitchField(cap)).toBe('wingTpaPitch');
  });

  test('falls back to raw attitude[1] when wingTpaPitch is absent', () => {
    const cap = makeCapability(['attitude[1]']);
    expect(resolveAirspeedPitchField(cap)).toBe('attitude[1]');
  });

  test('resolves DEBUG_TPA channel 2 when only the debug source is present', () => {
    const cap = makeCapability(['debug[2]'], 'TPA');
    expect(resolveAirspeedPitchField(cap)).toBe('debug[2]');
  });

  test('returns the attitude[1] default when nothing resolves', () => {
    const cap = makeCapability(['gyroADC[0]']);
    expect(resolveAirspeedPitchField(cap)).toBe('attitude[1]');
  });
});
