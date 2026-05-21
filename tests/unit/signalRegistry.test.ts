// Tests for the signal registry's expected_range + min_firmware
// guards and the `out_of_range` resolution state added in this slice.
//
// Coverage:
//   · resolved when values inside expected_range
//   · out_of_range when sampled min < expected[0] or max > expected[1]
//   · resolved when expected_range absent (back-compat with old sources)
//   · resolved when sample_check has no value_min/max (parser ran on
//     a build that didn't track them — permissive)
//   · min_firmware skips ineligible source, walker tries next
//   · min_firmware permissive on parse failure
//   · resolveSignal fallback hierarchy: out_of_range > inactive > missing
//
// All fixtures build CapabilityReport literals directly — no WASM
// dependency, runs fast under vitest.

import { describe, it, expect } from 'vitest';

import {
  parseFirmwareVersion,
  resolveSignal,
  SIGNALS,
  type SignalDef,
} from '../../src/lib/signalRegistry';
import type { CapabilityReport, SampleCheck } from '../../src/lib/wasmBridge';

// Build a CapabilityReport for a given debug_mode + per-field
// sample_check overrides. Fields default to "present, active, no
// recorded min/max" (the back-compat case where range check passes
// because the parser didn't measure).
function makeCapability(opts: {
  debug_mode?: string | null;
  firmware_revision?: string | null;
  fields: Record<string, Partial<SampleCheck> & { present?: boolean }>;
}): CapabilityReport {
  const fields_present: string[] = [];
  const sample_check: Record<string, SampleCheck> = {};
  for (const [name, overrides] of Object.entries(opts.fields)) {
    const present = overrides.present ?? true;
    if (present) fields_present.push(name);
    sample_check[name] = {
      all_zero: overrides.all_zero ?? false,
      has_content: overrides.has_content ?? true,
      value_min: overrides.value_min ?? null,
      value_max: overrides.value_max ?? null,
    };
  }
  return {
    fields_present,
    debug_mode: opts.debug_mode ?? null,
    gps_present: false,
    sample_check,
    frame_index: { offsets: [], times_sec: [] },
    total_frames: 1000,
    voltage_sag_summary: null,
    firmware_revision: opts.firmware_revision ?? null,
  };
}

// Temporarily register a custom signal for tests that need bespoke
// source shapes. Restores on cleanup.
function withCustomSignal<T>(def: SignalDef, fn: () => T): T {
  const prev = SIGNALS[def.id];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (SIGNALS as any)[def.id] = def;
  try {
    return fn();
  } finally {
    if (prev) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (SIGNALS as any)[def.id] = prev;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (SIGNALS as any)[def.id];
    }
  }
}

describe('parseFirmwareVersion', () => {
  it('parses "Betaflight 4.6.0" into 4.6.0', () => {
    expect(parseFirmwareVersion('Betaflight 4.6.0')).toEqual({ major: 4, minor: 6, patch: 0 });
  });

  it('parses dev-suffix style "Betaflight/STM32F411 4.5.0 dev (abc123)"', () => {
    expect(parseFirmwareVersion('Betaflight/STM32F411 4.5.0 dev (abc123)')).toEqual({
      major: 4, minor: 5, patch: 0,
    });
  });

  it('parses year-versioned "Betaflight 2026.6.0-alpha"', () => {
    expect(parseFirmwareVersion('Betaflight 2026.6.0-alpha')).toEqual({
      major: 2026, minor: 6, patch: 0,
    });
  });

  it('parses bare "4.5" without patch into patch=0', () => {
    expect(parseFirmwareVersion('4.5')).toEqual({ major: 4, minor: 5, patch: 0 });
  });

  it('returns null for unparseable strings', () => {
    expect(parseFirmwareVersion('no version here')).toBeNull();
    expect(parseFirmwareVersion('')).toBeNull();
    expect(parseFirmwareVersion(null)).toBeNull();
    expect(parseFirmwareVersion(undefined)).toBeNull();
  });
});

describe('resolveSignal expected_range guard', () => {
  it('resolves when sampled values are inside expected_range', () => {
    // tpa_factor expects [0, 3000] (wing TPA raises gains > 1.0); use a
    // sample range well inside — including factor > 1.0 (encoded > 1000).
    const cap = makeCapability({
      debug_mode: 'TPA',
      fields: {
        'debug[0]': { value_min: 100, value_max: 1800 },
      },
    });
    const r = resolveSignal('tpa_factor', null, cap);
    expect(r.state).toBe('resolved');
  });

  it('returns out_of_range when max exceeds expected[1]', () => {
    // tpa_factor expects [0, 3000]; simulate a channel-index mismatch
    // where ch0 isn't tpaFactor but something on a much wider scale.
    const cap = makeCapability({
      debug_mode: 'TPA',
      fields: {
        'debug[0]': { value_min: 0, value_max: 50000 },
      },
    });
    const r = resolveSignal('tpa_factor', null, cap);
    expect(r.state).toBe('out_of_range');
    if (r.state === 'out_of_range') {
      expect(r.expected).toEqual([0, 3000]);
      expect(r.observed).toEqual([0, 50000]);
      expect(r.via).toBe('debug');
    }
  });

  it('returns out_of_range when min is below expected[0]', () => {
    // tpa_arg lives at DEBUG_TPA ch5 (BF-encoded 0..1000 = 0..1.0).
    const cap = makeCapability({
      debug_mode: 'TPA',
      fields: {
        'debug[5]': { value_min: -500, value_max: 800 },
      },
    });
    const r = resolveSignal('tpa_arg', null, cap);
    expect(r.state).toBe('out_of_range');
    if (r.state === 'out_of_range') {
      expect(r.observed).toEqual([-500, 800]);
    }
  });

  it('resolves (does not flag out_of_range) when sample_check has null min/max', () => {
    // Permissive — older scan output without range tracking shouldn't
    // start failing all the new range guards.
    const cap = makeCapability({
      debug_mode: 'TPA',
      fields: {
        'debug[0]': { value_min: null, value_max: null },
      },
    });
    const r = resolveSignal('tpa_factor', null, cap);
    expect(r.state).toBe('resolved');
  });

  it('returns inactive (not out_of_range) when all_zero, even if zero is outside expected_range', () => {
    // Active-disabled-in-firmware is more user-meaningful than
    // out_of_range when the values are all zero.
    withCustomSignal(
      {
        id: 'test_signal_inactive_vs_oor',
        perAxis: false,
        sources: () => [
          { kind: 'debug', mode: 'TEST', channel: 0, expected_range: [10, 100] },
        ],
      },
      () => {
        const cap = makeCapability({
          debug_mode: 'TEST',
          fields: {
            'debug[0]': { all_zero: true, value_min: 0, value_max: 0 },
          },
        });
        const r = resolveSignal('test_signal_inactive_vs_oor', null, cap);
        expect(r.state).toBe('inactive');
      },
    );
  });
});

describe('resolveSignal min_firmware gate', () => {
  it('skips source on older firmware, falls through to next', () => {
    // Two sources: first requires 5.0+, second is the fallback.
    withCustomSignal(
      {
        id: 'test_signal_min_fw',
        perAxis: false,
        sources: () => [
          { kind: 'main_frame', field: 'newField', min_firmware: '5.0' },
          { kind: 'debug', mode: 'OLD_FALLBACK', channel: 0 },
        ],
      },
      () => {
        const cap = makeCapability({
          debug_mode: 'OLD_FALLBACK',
          firmware_revision: 'Betaflight 4.6.0',
          fields: {
            'newField': {},
            'debug[0]': {},
          },
        });
        const r = resolveSignal('test_signal_min_fw', null, cap);
        expect(r.state).toBe('resolved');
        if (r.state === 'resolved') {
          expect(r.via).toBe('debug');
          expect(r.source.kind).toBe('debug');
        }
      },
    );
  });

  it('keeps source when firmware meets the gate', () => {
    withCustomSignal(
      {
        id: 'test_signal_min_fw_ok',
        perAxis: false,
        sources: () => [
          { kind: 'main_frame', field: 'newField', min_firmware: '5.0' },
          { kind: 'debug', mode: 'OLD_FALLBACK', channel: 0 },
        ],
      },
      () => {
        const cap = makeCapability({
          firmware_revision: 'Betaflight 5.0.0',
          fields: {
            'newField': {},
          },
        });
        const r = resolveSignal('test_signal_min_fw_ok', null, cap);
        expect(r.state).toBe('resolved');
        if (r.state === 'resolved') {
          expect(r.via).toBe('main_frame');
        }
      },
    );
  });

  it('is permissive when firmware_revision cannot be parsed', () => {
    // Unrecognised firmware string → don't filter, try the source anyway.
    withCustomSignal(
      {
        id: 'test_signal_fw_unparseable',
        perAxis: false,
        sources: () => [
          { kind: 'main_frame', field: 'newField', min_firmware: '5.0' },
        ],
      },
      () => {
        const cap = makeCapability({
          firmware_revision: 'some weird unrecognised string',
          fields: {
            'newField': {},
          },
        });
        const r = resolveSignal('test_signal_fw_unparseable', null, cap);
        expect(r.state).toBe('resolved');
      },
    );
  });

  it('compares major version correctly (2026.6 > 5.0)', () => {
    withCustomSignal(
      {
        id: 'test_signal_year_versioned',
        perAxis: false,
        sources: () => [
          { kind: 'main_frame', field: 'futureField', min_firmware: '2026.6' },
        ],
      },
      () => {
        const okCap = makeCapability({
          firmware_revision: 'Betaflight 2026.6.0-alpha',
          fields: { 'futureField': {} },
        });
        expect(resolveSignal('test_signal_year_versioned', null, okCap).state).toBe('resolved');

        const oldCap = makeCapability({
          firmware_revision: 'Betaflight 5.0.0',
          fields: { 'futureField': {} },
        });
        expect(resolveSignal('test_signal_year_versioned', null, oldCap).state).toBe('missing');
      },
    );
  });
});

describe('resolveSignal fallback hierarchy', () => {
  it('prefers out_of_range over missing in fallback', () => {
    // Two sources: first source has present-but-OOR debug channel,
    // second source is missing. Expect out_of_range to bubble up.
    withCustomSignal(
      {
        id: 'test_fallback_hierarchy',
        perAxis: false,
        sources: () => [
          { kind: 'debug', mode: 'FIRST', channel: 0, expected_range: [0, 10] },
          { kind: 'main_frame', field: 'absentField' },
        ],
      },
      () => {
        const cap = makeCapability({
          debug_mode: 'FIRST',
          fields: {
            'debug[0]': { value_min: 1000, value_max: 2000 },
            'absentField': { present: false },
          },
        });
        const r = resolveSignal('test_fallback_hierarchy', null, cap);
        expect(r.state).toBe('out_of_range');
      },
    );
  });

  it('prefers inactive over missing in fallback', () => {
    withCustomSignal(
      {
        id: 'test_fallback_inactive',
        perAxis: false,
        sources: () => [
          { kind: 'debug', mode: 'FIRST', channel: 0 },
          { kind: 'main_frame', field: 'absentField' },
        ],
      },
      () => {
        const cap = makeCapability({
          debug_mode: 'FIRST',
          fields: {
            'debug[0]': { all_zero: true },
            'absentField': { present: false },
          },
        });
        const r = resolveSignal('test_fallback_inactive', null, cap);
        expect(r.state).toBe('inactive');
      },
    );
  });

  it('resolved trumps any fallback (returns immediately)', () => {
    // First source is OOR; second source resolves clean. Should
    // return the second's resolved state, NOT the first's OOR.
    withCustomSignal(
      {
        id: 'test_resolved_wins',
        perAxis: false,
        sources: () => [
          { kind: 'debug', mode: 'FIRST', channel: 0, expected_range: [0, 10] },
          { kind: 'main_frame', field: 'cleanField' },
        ],
      },
      () => {
        const cap = makeCapability({
          debug_mode: 'FIRST',
          fields: {
            'debug[0]': { value_min: 1000, value_max: 2000 }, // OOR
            'cleanField': {}, // resolves
          },
        });
        // Note: the walker returns on first resolved, but the FIRST
        // source is OOR (not resolved), so it should continue to the
        // second and return resolved.
        const r = resolveSignal('test_resolved_wins', null, cap);
        expect(r.state).toBe('resolved');
        if (r.state === 'resolved') {
          expect(r.via).toBe('main_frame');
        }
      },
    );
  });
});
