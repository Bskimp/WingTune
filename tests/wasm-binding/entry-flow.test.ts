// M1.3.5 end-to-end integration test for the entry-page flow:
//
//   real .bbl bytes → Node WASM scanLog() → useSessionStore() populated
//   via __test_seedLog (bypasses worker, Node has no Worker) →
//   CapabilitySummary.vue mounted against the live store →
//   assert the rendered DOM shows real values from the actual log
//
// Bypasses the Web Worker (Node has no Worker) and the file-drop event
// (no real DOM file events here). The worker boundary is covered by
// decode-smoke.test.ts; the drop-handler wiring is exercised by
// FileDropZone.vue calling `store.loadFile(file)` in the browser. This
// test covers the seam in the middle — the ScanReport-shape contract
// between the parser and the components.
//
// Gated on log availability via the `WINGTUNE_TEST_LOG` env var, which
// must point at a real BF wing log. Skipped if the var isn't set or
// the file doesn't exist — keeps the test suite green on machines
// without a local corpus (fresh checkouts, CI).
//
// Per-user convenience: set the env var persistently in your shell
// profile so the test "just runs" locally. On Windows powershell:
//
//   setx WINGTUNE_TEST_LOG "C:\path\to\LOG00113.BFL"
//
// On POSIX shells, add `export WINGTUNE_TEST_LOG=...` to ~/.bashrc
// or ~/.zshrc. No hardcoded path in this file — that lived in an
// earlier revision and was flagged in a security pass as awkward for
// public distribution (private logs shouldn't be encoded into source).

// @vitest-environment happy-dom

import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { scanLog } from './pkg/wingtune_parser';
import CapabilitySummary from '../../src/components/CapabilitySummary.vue';
import { useSessionStore } from '../../src/stores/session';

const ENV_LOG = process.env.WINGTUNE_TEST_LOG;
const LOG_PATH = ENV_LOG && existsSync(ENV_LOG) ? ENV_LOG : null;

const describeIfLog = LOG_PATH ? describe : describe.skip;

describeIfLog('entry-flow (real wing log → store → CapabilitySummary)', () => {
  it('renders real headers and fields from LOG00113.BFL', async () => {
    const bytes = new Uint8Array(readFileSync(LOG_PATH!));

    // Mirror what `wasmBridge.scan()` does: scan the bytes, then convert
    // `time_sec` to Float32Array at the Layer 1 boundary so the store
    // ever only sees the typed-array shape.
    const raw = scanLog(bytes) as {
      capability: {
        fields_present: string[];
        debug_mode: string | null;
        gps_present: boolean;
        sample_check: Record<string, { all_zero: boolean; has_content: boolean }>;
        frame_index: { offsets: number[]; times_sec: number[] };
        total_frames: number;
        voltage_sag_summary: null | {
          min_v: number; max_v: number; p99_v: number; pct_below_threshold: number;
        };
      };
      time_sec: number[];
      events: unknown[];
      firmware_revision: string | null;
      firmware_date: string | null;
      board_info: string | null;
      craft_name: string | null;
    };

    expect(raw.capability.fields_present.length).toBeGreaterThan(0);
    expect(raw.capability.total_frames).toBeGreaterThan(0);
    expect(raw.time_sec.length).toBe(raw.capability.total_frames);
    expect(raw.firmware_revision).toBeTruthy();

    const scanReport = {
      ...raw,
      time_sec: Float32Array.from(raw.time_sec),
      events: raw.events as never[],
    };

    setActivePinia(createPinia());
    // Seed via the session's TEST-ONLY helper so we bypass the worker
    // round-trip (Node has no Worker). CapabilitySummary reads through
    // `useActiveLog()` which projects from the session's first log, so
    // the seeded log surfaces in the rendered DOM.
    const session = useSessionStore();
    session.__test_seedLog({
      name: 'LOG00113.BFL',
      fileSize: bytes.byteLength,
      scanReport,
      time: scanReport.time_sec,
      events: scanReport.events,
      firmwareRevision: scanReport.firmware_revision,
      firmwareDate: scanReport.firmware_date,
      boardInfo: scanReport.board_info,
      craftName: scanReport.craft_name,
      parseTimeMs: 42,
    });

    const wrapper = mount(CapabilitySummary);
    await wrapper.vm.$nextTick();
    const html = wrapper.html();

    // Flight strip surfaces — file name, real firmware string, MB-formatted size.
    expect(html).toContain('LOG00113.BFL');
    expect(html).toContain(scanReport.firmware_revision!);
    expect(html).toContain('MB');
    expect(html).toContain('Swap');

    // Divider headings + counts.
    expect(html).toContain('SCAN CAPABILITY');
    expect(html).toContain('MAIN-FRAME FIELDS');
    expect(html).toContain(String(scanReport.capability.fields_present.length));

    // The field table should render every present field's name.
    for (const name of scanReport.capability.fields_present) {
      expect(html, `field ${name} missing from rendered table`).toContain(name);
    }

    // Wing-build sentinel: LOG00113 is a USE_WING flight, so at least
    // one axisS slot should be present (memory entry says S[0..1] are
    // populated). If the parser ever loses these we want to know loudly.
    const presentSet = new Set(scanReport.capability.fields_present);
    expect(
      ['axisS[0]', 'axisS[1]', 'axisS[2]'].some((s) => presentSet.has(s)),
      'expected at least one axisS slot — LOG00113.BFL is a USE_WING build',
    ).toBe(true);

    // The header WASM-ready pill is on App.vue (not CapabilitySummary),
    // so no assertion on that here. CapabilitySummary's own duty is the
    // post-load surface, and the assertions above cover its contract.
  });

  it('FlightStrip Swap button resets the store back to drop-zone state', async () => {
    const bytes = new Uint8Array(readFileSync(LOG_PATH!));
    const raw = scanLog(bytes) as {
      capability: { fields_present: string[]; total_frames: number };
      time_sec: number[];
      events: unknown[];
      firmware_revision: string | null;
    };

    setActivePinia(createPinia());
    const session = useSessionStore();
    const timeArr = Float32Array.from(raw.time_sec);
    session.__test_seedLog({
      name: 'LOG00113.BFL',
      fileSize: bytes.byteLength,
      scanReport: { ...raw, time_sec: timeArr } as never,
      time: timeArr,
      firmwareRevision: raw.firmware_revision,
    });

    const wrapper = mount(CapabilitySummary);
    await wrapper.vm.$nextTick();

    const swapBtn = wrapper.find('button[title="Reset and load another log"]');
    expect(swapBtn.exists()).toBe(true);
    await swapBtn.trigger('click');

    // Swap calls session.reset(), which clears every loaded log.
    // Empty session map is the canonical "back to drop zone" state.
    expect(session.logs.size).toBe(0);
  });
});
