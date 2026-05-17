// M1.3.5 end-to-end integration test for the entry-page flow:
//
//   real .bbl bytes → Node WASM scanLog() → useLogStore() populated as
//   ParserClient.scan() would populate it → CapabilitySummary.vue mounted
//   against the live store → assert the rendered DOM shows real values
//   from the actual log
//
// Bypasses the Web Worker (Node has no Worker) and the file-drop event
// (no real DOM file events here). The worker boundary is covered by
// decode-smoke.test.ts; the drop-handler wiring is exercised by
// FileDropZone.vue calling `store.loadFile(file)` in the browser. This
// test covers the seam in the middle — the ScanReport-shape contract
// between the parser and the components.
//
// Gated on log availability: defaults to LOG00113.BFL on Brian's box,
// overridable via WINGTUNE_TEST_LOG, skipped if neither exists. The
// hard-coded fallback is intentional — it's documented in the
// `reference-test-logs` memory entry and lets the test "just run" in
// the primary dev environment without env-var setup.

// @vitest-environment happy-dom

import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { scanLog } from './pkg/wingtune_parser';
import CapabilitySummary from '../../src/components/CapabilitySummary.vue';
import { useLogStore } from '../../src/stores/log';

const ENV_LOG = process.env.WINGTUNE_TEST_LOG;
const DEFAULT_LOG = 'C:/Users/Sista/Desktop/al logs/LOG00113.BFL';
const LOG_PATH = ENV_LOG ?? (existsSync(DEFAULT_LOG) ? DEFAULT_LOG : null);

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
    const store = useLogStore();

    // Mutate the store the same way `loadFile()` does internally, minus
    // the worker round-trip. Setup-store refs are writable.
    store.scanReport = scanReport;
    store.time = scanReport.time_sec;
    store.events = scanReport.events;
    store.firmwareRevision = scanReport.firmware_revision;
    store.firmwareDate = scanReport.firmware_date;
    store.boardInfo = scanReport.board_info;
    store.craftName = scanReport.craft_name;
    store.fileName = 'LOG00113.BFL';
    store.fileSize = bytes.byteLength;
    store.parseTimeMs = 42;

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
    const store = useLogStore();
    store.scanReport = { ...raw, time_sec: Float32Array.from(raw.time_sec) } as never;
    store.time = Float32Array.from(raw.time_sec);
    store.firmwareRevision = raw.firmware_revision;
    store.fileName = 'LOG00113.BFL';
    store.fileSize = bytes.byteLength;

    const wrapper = mount(CapabilitySummary);
    await wrapper.vm.$nextTick();

    const swapBtn = wrapper.find('button[title="Reset and load another log"]');
    expect(swapBtn.exists()).toBe(true);
    await swapBtn.trigger('click');

    expect(store.scanReport).toBeNull();
    expect(store.fileName).toBeNull();
    expect(store.fileSize).toBeNull();
    expect(store.time.length).toBe(0);
  });
});
