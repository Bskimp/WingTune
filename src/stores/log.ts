// Pinia store for the active log: scan report + Float32 time axis + the
// lazily-hydrated field map. Follows the M1 doc's `wingtune-memory-model`
// rules: `shallowRef` for typed-array data, `shallowReactive` for the
// add/remove-but-don't-deep-proxy field map.

import { defineStore } from 'pinia';
import { ref, shallowReactive, shallowRef } from 'vue';

import {
  ParserClient,
  type EventFrame,
  type ScanReport,
  type SourceHandle,
} from '../lib/wasmBridge';

export const useLogStore = defineStore('log', () => {
  const client = new ParserClient();

  const scanReport = shallowRef<ScanReport | null>(null);
  const scanning = ref(false);
  const scanError = ref<unknown>(null);

  // Float32Array — built by the bridge from the worker's `time_sec`
  // payload at scan time and assigned in one transaction. Per the memory
  // model rule, NEVER `ref(typedArray)` — Vue's deep proxy would wrap
  // every sample.
  const time = shallowRef<Float32Array>(new Float32Array(0));

  // Hydrated fields keyed by name. `shallowReactive` so add/remove triggers
  // reactivity without deep-wrapping the typed arrays themselves.
  const fields = shallowReactive<Map<string, Float32Array>>(new Map());
  const hydrating = shallowReactive<Set<string>>(new Set());

  const events = shallowRef<EventFrame[]>([]);

  // Header strings the M1.5 inspector renders. Cheap to keep alongside.
  const firmwareRevision = ref<string | null>(null);
  const firmwareDate = ref<string | null>(null);
  const boardInfo = ref<string | null>(null);
  const craftName = ref<string | null>(null);

  function reset() {
    scanReport.value = null;
    scanError.value = null;
    time.value = new Float32Array(0);
    fields.clear();
    hydrating.clear();
    events.value = [];
    firmwareRevision.value = null;
    firmwareDate.value = null;
    boardInfo.value = null;
    craftName.value = null;
  }

  async function loadFile(input: File | string): Promise<void> {
    reset();
    scanning.value = true;
    try {
      const handle: SourceHandle = await client.openSource(input);
      const report = await client.scan(handle);
      scanReport.value = report;
      time.value = report.time_sec;
      events.value = report.events;
      firmwareRevision.value = report.firmware_revision;
      firmwareDate.value = report.firmware_date;
      boardInfo.value = report.board_info;
      craftName.value = report.craft_name;
    } catch (err) {
      scanError.value = err;
      throw err;
    } finally {
      scanning.value = false;
    }
  }

  /** Ensure each named field is present in `fields`. Already-resident or
   *  currently-hydrating fields are skipped. Returns when every requested
   *  field has either landed in `fields` or failed (failures throw). */
  async function ensureFields(names: string[]): Promise<void> {
    const missing = names.filter(
      (n) => !fields.has(n) && !hydrating.has(n),
    );
    if (missing.length === 0) return;
    for (const n of missing) hydrating.add(n);
    try {
      const hydrated = await client.hydrate(missing);
      for (const [name, arr] of hydrated) {
        fields.set(name, arr);
      }
    } finally {
      for (const n of missing) hydrating.delete(n);
    }
  }

  return {
    scanReport,
    scanning,
    scanError,
    time,
    fields,
    hydrating,
    events,
    firmwareRevision,
    firmwareDate,
    boardInfo,
    craftName,
    loadFile,
    ensureFields,
    reset,
  };
});
