import { describe, test, expect } from 'vitest';

import {
  evaluateHyperbolic,
  fitHyperbolicCurve,
  paramsToCli,
  type HyperbolicFitSample,
  type HyperbolicParams,
} from '@/lib/tpaCurveFit';

const REF_PARAMS: HyperbolicParams = {
  stallThrottle: 0.20,
  pidThr0: 3.0,
  pidThr100: 0.5,
  expoCli: 5,
};

describe('evaluateHyperbolic', () => {
  test('returns pidThr0 below stallThrottle (flat plateau)', () => {
    for (const x of [0, 0.05, 0.10, 0.19, 0.20]) {
      expect(evaluateHyperbolic(x, REF_PARAMS)).toBeCloseTo(REF_PARAMS.pidThr0, 5);
    }
  });

  test('endpoint at x=stallThrottle exactly equals pidThr0', () => {
    expect(evaluateHyperbolic(REF_PARAMS.stallThrottle, REF_PARAMS))
      .toBeCloseTo(REF_PARAMS.pidThr0, 5);
  });

  test('endpoint at x=1.0 exactly equals pidThr100', () => {
    expect(evaluateHyperbolic(1.0, REF_PARAMS)).toBeCloseTo(REF_PARAMS.pidThr100, 5);
  });

  test('monotonically decreasing on (stallThrottle, 1] when pidThr0 > pidThr100', () => {
    let prev = evaluateHyperbolic(REF_PARAMS.stallThrottle + 0.001, REF_PARAMS);
    for (let i = 1; i <= 100; i++) {
      const x = REF_PARAMS.stallThrottle + (1 - REF_PARAMS.stallThrottle) * (i / 100);
      const v = evaluateHyperbolic(x, REF_PARAMS);
      expect(v).toBeLessThanOrEqual(prev + 1e-6);
      prev = v;
    }
  });

  test('safe against out-of-range params (no NaN)', () => {
    const bad: HyperbolicParams = {
      stallThrottle: -1,    // out of range
      pidThr0: 0,           // degenerate
      pidThr100: 0,         // degenerate
      expoCli: 999,         // out of range
    };
    for (let i = 0; i <= 10; i++) {
      const v = evaluateHyperbolic(i / 10, bad);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('evaluateHyperbolic — firmware golden values', () => {
  // These literals are NOT produced by evaluateHyperbolic — they are
  // computed independently in Python from the firmware formula in
  // docs/firmware-reference/tpa-hyperbolic-spec.md §1 (BF pid_init.c::
  // tpaCurveHyperbolicFunction). They pin the curve shape against the
  // firmware, breaking the round-trip circularity of fitHyperbolicCurve's
  // synthetic tests (which generate their samples FROM evaluateHyperbolic).

  test('expo = -1 case collapses to exact linear interpolation', () => {
    // expoCli = -0.1 makes expo exactly -1, which reduces the formula to
    // f(x) = pidThr0 + (pidThr100 − pidThr0)·xShifted. Fully hand-
    // verifiable; pins the plateau branch, the xShifted remap, and the
    // ratio/base/divisor chain.
    const p: HyperbolicParams = {
      stallThrottle: 0.2, pidThr0: 2.0, pidThr100: 0.5, expoCli: -0.1,
    };
    expect(evaluateHyperbolic(0.2, p)).toBeCloseTo(2.0, 6);   // x = stall → pidThr0
    expect(evaluateHyperbolic(0.4, p)).toBeCloseTo(1.625, 6);
    expect(evaluateHyperbolic(0.6, p)).toBeCloseTo(1.25, 6);
    expect(evaluateHyperbolic(0.8, p)).toBeCloseTo(0.875, 6);
    expect(evaluateHyperbolic(1.0, p)).toBeCloseTo(0.5, 6);   // x = 1 → pidThr100
  });

  test('non-trivial expo matches firmware-derived golden values', () => {
    // REF_PARAMS has a genuinely non-integer expo (≈ -1.05374), so this
    // exercises the pow() curvature path. It also catches a 1/expo ↔ expo
    // swap — invisible in the test above, where expo = -1 makes the two
    // identical.
    expect(evaluateHyperbolic(0.35, REF_PARAMS)).toBeCloseTo(2.5176111201, 5);
    expect(evaluateHyperbolic(0.50, REF_PARAMS)).toBeCloseTo(2.0399167368, 5);
    expect(evaluateHyperbolic(0.65, REF_PARAMS)).toBeCloseTo(1.5679075398, 5);
    expect(evaluateHyperbolic(0.90, REF_PARAMS)).toBeCloseTo(0.7985967495, 5);
  });
});

describe('fitHyperbolicCurve', () => {
  function syntheticSamples(p: HyperbolicParams, n: number): HyperbolicFitSample[] {
    const out: HyperbolicFitSample[] = [];
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);  // 0 .. 1
      const y = evaluateHyperbolic(x, p);
      out.push({ x, y });
    }
    return out;
  }

  test('recovers params from clean synthetic samples to within tolerance', () => {
    const samples = syntheticSamples(REF_PARAMS, 200);
    const r = fitHyperbolicCurve(samples, {
      samples: 200, xMin: 0, xMax: 1,
      lowBandDwellSec: 5, midBandDwellSec: 5, highBandDwellSec: 5,
    });
    expect(r.converged).toBe(true);
    expect(r.rmsResidual).toBeLessThan(0.05);
    // Endpoints should be recovered closely (they're geometrically pinned).
    expect(r.params.pidThr100).toBeCloseTo(REF_PARAMS.pidThr100, 1);
    expect(r.params.pidThr0).toBeCloseTo(REF_PARAMS.pidThr0, 0);
  });

  test('produces low rms even on noisy synthetic data', () => {
    const samples = syntheticSamples(REF_PARAMS, 500).map((s) => ({
      x: s.x,
      y: s.y + (Math.random() - 0.5) * 0.05,  // ±2.5% noise
    }));
    const r = fitHyperbolicCurve(samples, {
      samples: 500, xMin: 0, xMax: 1,
      lowBandDwellSec: 5, midBandDwellSec: 5, highBandDwellSec: 5,
    });
    expect(r.rmsResidual).toBeLessThan(0.10);
  });
});

describe('paramsToCli', () => {
  test('scales params to BF CLI integer ranges', () => {
    const cli = paramsToCli(REF_PARAMS);
    expect(cli.tpa_curve_type).toBe('HYPERBOLIC');
    expect(cli.tpa_curve_stall_throttle).toBe(20);   // 0.20 × 100
    expect(cli.tpa_curve_pid_thr0).toBe(300);        // 3.00 × 100
    expect(cli.tpa_curve_pid_thr100).toBe(50);       // 0.50 × 100
    expect(cli.tpa_curve_expo).toBe(5);
  });

  test('clamps out-of-range params to CLI bounds', () => {
    const cli = paramsToCli({
      stallThrottle: 5.0,    // clamps to 1.0 → 100
      pidThr0: -1,           // clamps to 0
      pidThr100: 50,         // clamps to 10.0 → 1000
      expoCli: 9999,         // clamps to 100
    });
    expect(cli.tpa_curve_stall_throttle).toBe(100);
    expect(cli.tpa_curve_pid_thr0).toBe(0);
    expect(cli.tpa_curve_pid_thr100).toBe(1000);
    expect(cli.tpa_curve_expo).toBe(100);
  });
});
