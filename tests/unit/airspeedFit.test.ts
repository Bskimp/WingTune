import { describe, test, expect } from 'vitest';

import {
  integrateBasicAirspeedModel,
  fitBasicAirspeedModel,
  computeCoverage,
  type BasicAirspeedParams,
  type ModelInputs,
  type AirspeedFitInputs,
} from '@/lib/airspeedFit';

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

function constantInputs(t: Float32Array, throttle: number, vbat: number, pitchRad: number): ModelInputs {
  return {
    time: t,
    throttle: fill(t.length, throttle),
    vbat: fill(t.length, vbat),
    pitch: fill(t.length, pitchRad),
  };
}

describe('integrateBasicAirspeedModel', () => {
  test('horizontal full throttle approaches the closed-form terminal velocity', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 };
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
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 };
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
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 };
    const t = makeTimeAxis(20, 100);
    const inputs = constantInputs(t, 0, 16.8, 0);
    const v = integrateBasicAirspeedModel(params, inputs);
    expect(v[v.length - 1]).toBeCloseTo(0, 2);
  });

  test('climb pitch decelerates relative to level flight', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 };
    const t = makeTimeAxis(20, 200);
    const horiz = constantInputs(t, 1.0, 25.2, 0);
    const climb = constantInputs(t, 1.0, 25.2, 0.3);
    const vH = integrateBasicAirspeedModel(params, horiz);
    const vC = integrateBasicAirspeedModel(params, climb);
    expect(vC[vC.length - 1]).toBeLessThan(vH[vH.length - 1]);
  });

  test('voltage scaling: half-voltage halves effective throttle', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 };
    const t = makeTimeAxis(20, 200);
    const full = constantInputs(t, 1.0, 25.2, 0);
    const half = constantInputs(t, 1.0, 12.6, 0);
    const vF = integrateBasicAirspeedModel(params, full);
    const vH = integrateBasicAirspeedModel(params, half);
    expect(vH[vH.length - 1]).toBeLessThan(vF[vF.length - 1]);
  });

  test('returns empty for empty input', () => {
    const params: BasicAirspeedParams = { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 };
    const v = integrateBasicAirspeedModel(params, {
      time: new Float32Array(0),
      throttle: new Float32Array(0),
      vbat: new Float32Array(0),
      pitch: new Float32Array(0),
    });
    expect(v.length).toBe(0);
  });
});

describe('fitBasicAirspeedModel', () => {
  test('recovers planted params from noise-free synthetic data', () => {
    const truth: BasicAirspeedParams = { delayMs: 1200, gravityPct: 45, maxVoltageX100: 2520 };
    const t = makeTimeAxis(40, 100);
    const throttle = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) {
      const phase = Math.floor(t[i] / 4) % 2;
      throttle[i] = phase === 0 ? 1.0 : 0.35;
    }
    const vbat = fill(t.length, 25.2);
    const pitch = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) pitch[i] = Math.sin(t[i] / 6) * 0.15;

    const target = integrateBasicAirspeedModel(truth, { time: t, throttle, vbat, pitch });

    const fit = fitBasicAirspeedModel({
      time: t, throttle, vbat, pitch, gpsSpeed: target,
    }, { initialParams: { delayMs: 1000, gravityPct: 50, maxVoltageX100: 2520 } });

    expect(fit.rSquared).toBeGreaterThan(0.99);
    expect(fit.rmsResidual).toBeLessThan(1.0);
    expect(fit.params.delayMs).toBeGreaterThan(1000);
    expect(fit.params.delayMs).toBeLessThan(1400);
    expect(fit.params.gravityPct).toBeGreaterThan(40);
    expect(fit.params.gravityPct).toBeLessThan(50);
  });

  test('reports high rSquared on a clean fit', () => {
    const truth: BasicAirspeedParams = { delayMs: 800, gravityPct: 60, maxVoltageX100: 2520 };
    const t = makeTimeAxis(25, 100);
    const throttle = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) throttle[i] = 0.4 + 0.5 * (i % 600 < 300 ? 1 : 0);
    const vbat = fill(t.length, 25.2);
    const pitch = new Float32Array(t.length);
    const target = integrateBasicAirspeedModel(truth, { time: t, throttle, vbat, pitch });

    const fit = fitBasicAirspeedModel({ time: t, throttle, vbat, pitch, gpsSpeed: target });
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
    };
    const fit = fitBasicAirspeedModel(inputs);
    expect(fit.predicted.length).toBe(t.length);
    expect(fit.residuals.length).toBe(t.length);
    expect(fit.iterations).toBeGreaterThan(0);
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
    });
    expect(cov.speedMin).toBe(0);
    expect(cov.speedMax).toBe(0);
    expect(cov.throttleTransitionsPerMin).toBe(0);
  });
});
