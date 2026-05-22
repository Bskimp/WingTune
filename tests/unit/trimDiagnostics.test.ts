import { describe, test, expect } from 'vitest';

import { computeTrimDiagnostics } from '@/lib/trimDiagnostics';

const FS = 1000;

function timeAxis(n: number): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = i / FS;
  return t;
}

function filled(n: number, v: number): Float32Array {
  return new Float32Array(n).fill(v);
}

/** Constant offset `c` plus a zero-mean sine of amplitude `amp`. */
function offsetPlusSine(n: number, c: number, amp: number, freqHz: number): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = c + amp * Math.sin((2 * Math.PI * freqHz * i) / FS);
  }
  return s;
}

/** Three zeroed setpoint axes — a whole-flight steady cruise. */
function steadySetpoint(n: number): Float32Array[] {
  return [filled(n, 0), filled(n, 0), filled(n, 0)];
}

describe('computeTrimDiagnostics', () => {
  const N = 30_000; // 30 s

  test('constant steady-cruise I-term offset → trim-error', () => {
    const r = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [filled(N, 50), filled(N, 0), filled(N, 0)],
      setpoint: steadySetpoint(N),
    });
    const roll = r.axes[0];
    expect(roll.meanITerm).toBeCloseTo(50, 1);
    expect(roll.trimFraction).toBeGreaterThan(0.9);
    expect(roll.severity).toBe('trim-error');
  });

  test('zero-mean oscillating I-term → balanced', () => {
    const r = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [offsetPlusSine(N, 0, 50, 3), filled(N, 0), filled(N, 0)],
      setpoint: steadySetpoint(N),
    });
    expect(Math.abs(r.axes[0].meanITerm)).toBeLessThan(2);
    expect(r.axes[0].trimFraction).toBeLessThan(0.1);
    expect(r.axes[0].severity).toBe('balanced');
  });

  test('partial offset lands in the slight band', () => {
    // c = 10, amp = 38 → trimFraction = 10/√(100 + 38²/2) ≈ 0.35.
    const r = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [offsetPlusSine(N, 10, 38, 3), filled(N, 0), filled(N, 0)],
      setpoint: steadySetpoint(N),
    });
    expect(r.axes[0].trimFraction).toBeGreaterThan(0.25);
    expect(r.axes[0].trimFraction).toBeLessThan(0.5);
    expect(r.axes[0].severity).toBe('slight');
  });

  test('no steady cruise (always commanding) → unknown', () => {
    const r = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [filled(N, 50), filled(N, 50), filled(N, 50)],
      // roll setpoint pinned above the floor for the whole flight
      setpoint: [filled(N, 100), filled(N, 0), filled(N, 0)],
    });
    expect(r.steadySampleCount).toBe(0);
    for (const ax of r.axes) expect(ax.severity).toBe('unknown');
  });

  test('axes are scored independently', () => {
    const r = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [
        filled(N, 50),                  // roll: hard offset
        offsetPlusSine(N, 0, 50, 3),    // pitch: zero-mean
        filled(N, 0),                   // yaw: inert
      ],
      setpoint: steadySetpoint(N),
    });
    expect(r.axes[0].severity).toBe('trim-error');
    expect(r.axes[1].severity).toBe('balanced');
    expect(r.axes[2].severity).toBe('balanced');
  });

  test('inert (flat-zero) I-term → balanced, trimFraction 0', () => {
    const r = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [filled(N, 0), filled(N, 0), filled(N, 0)],
      setpoint: steadySetpoint(N),
    });
    expect(r.axes[0].itermRms).toBe(0);
    expect(r.axes[0].trimFraction).toBe(0);
    expect(r.axes[0].severity).toBe('balanced');
  });

  test('missing I-term for an axis → that axis unknown', () => {
    const r = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [filled(N, 50), undefined, filled(N, 50)],
      setpoint: steadySetpoint(N),
    });
    expect(r.axes[1].severity).toBe('unknown');
    expect(Number.isNaN(r.axes[1].meanITerm)).toBe(true);
    expect(r.axes[0].severity).toBe('trim-error');
  });

  test('attitude-roll gate excludes a sustained banked turn', () => {
    // Level for the first half, 80° banked for the second.
    const attitudeRoll = new Float32Array(N);
    attitudeRoll.fill(0, 0, N / 2);
    attitudeRoll.fill(800, N / 2, N);
    const common = {
      time: timeAxis(N),
      iTerm: [filled(N, 30), filled(N, 0), filled(N, 0)],
      setpoint: steadySetpoint(N),
    };
    const gated = computeTrimDiagnostics({ ...common, attitudeRoll });
    const ungated = computeTrimDiagnostics(common);

    expect(gated.usedAttitudeGate).toBe(true);
    expect(ungated.usedAttitudeGate).toBe(false);
    // The banked half is dropped — roughly half the coverage.
    expect(gated.steadySampleCount).toBeLessThan(16_000);
    expect(gated.steadySampleCount).toBeGreaterThan(11_000);
    expect(ungated.steadySampleCount).toBeGreaterThan(27_000);
  });

  test('settle erosion drops the window after a mid-flight input', () => {
    const clean = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [filled(N, 30), filled(N, 0), filled(N, 0)],
      setpoint: steadySetpoint(N),
    });
    const spiked = steadySetpoint(N);
    spiked[0].fill(100, 15_000, 15_200); // 0.2 s input mid-flight
    const withSpike = computeTrimDiagnostics({
      time: timeAxis(N),
      iTerm: [filled(N, 30), filled(N, 0), filled(N, 0)],
      setpoint: spiked,
    });
    const lost = clean.steadyCoverageSec - withSpike.steadyCoverageSec;
    // Lost ≈ the spike (0.2 s) + one settle window (1.5 s).
    expect(lost).toBeGreaterThan(1.5);
    expect(lost).toBeLessThan(2.5);
    expect(withSpike.axes[0].severity).toBe('trim-error');
  });

  test('empty input → graceful unknown', () => {
    const r = computeTrimDiagnostics({
      time: new Float32Array(0),
      iTerm: [undefined, undefined, undefined],
      setpoint: [undefined, undefined, undefined],
    });
    expect(r.steadySampleCount).toBe(0);
    for (const ax of r.axes) expect(ax.severity).toBe('unknown');
  });
});
