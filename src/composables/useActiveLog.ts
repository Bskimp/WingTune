// Convenience view over `useSessionStore()` exposing the first
// VISIBLE log (skipping any the user has eye-toggled off via the
// roster) as a flat bag of computed refs.
//
// The "first visible log" semantics make the roster eye toggle a true
// focus mechanism in multi-log mode: hide every log except the one
// you're inspecting, and panels that read this composable (FlightStrip,
// ServoPanel chips/strips, cursor readouts, etc.) re-anchor to that
// log. Eye-toggle to the next log → panels follow.
//
// Single-log behaviour is unchanged: the one loaded log is always
// visible, so `active` always returns it.
//
// Surface mirrors the legacy `useLogStore` (scanReport, time, fields,
// etc.) so panels that haven't yet adopted full
// `session.logs.values()` iteration (Push 3b compare panels) keep
// working with a single-log mental model — they just see whichever
// log the user has focused via the eye toggle.
//
// Note: this is NOT a Pinia store — it's a per-call factory that pulls
// from the session store. Each panel using it gets its own instance,
// but they all read the same shared session-store state. Computeds
// inside cache per-call; cheap.

import { computed } from 'vue';

import { useSessionStore } from '@/stores/session';
import { useViewStore } from '@/stores/view';

export function useActiveLog() {
  const session = useSessionStore();
  const view = useViewStore();

  /** First VISIBLE log in the session map — skips any log the user
   *  has eye-toggled off via the roster. Returns null when no log
   *  is loaded OR every loaded log is currently hidden. */
  const active = computed(() => {
    for (const log of session.logs.values()) {
      if (!view.isLogHidden(log.id)) return log;
    }
    return null;
  });

  return {
    /** Pinia-style state surface — every panel's storeToRefs(useLogStore())
     *  destructure maps onto these one-for-one. */
    activeId: computed(() => active.value?.id ?? null),
    scanReport: computed(() => active.value?.scanReport ?? null),
    time: computed(() => active.value?.time ?? new Float32Array(0)),
    gpsTimeSec: computed(
      () => active.value?.gpsTimeSec ?? new Float32Array(0),
    ),
    fields: computed(
      () => active.value?.fields ?? new Map<string, Float32Array>(),
    ),
    hydrating: computed(() => active.value?.hydrating ?? new Set<string>()),
    events: computed(() => active.value?.events ?? []),
    firmwareRevision: computed(() => active.value?.firmwareRevision ?? null),
    firmwareDate: computed(() => active.value?.firmwareDate ?? null),
    boardInfo: computed(() => active.value?.boardInfo ?? null),
    craftName: computed(() => active.value?.craftName ?? null),
    fileName: computed(() => active.value?.name ?? null),
    fileSize: computed(() => active.value?.fileSize ?? null),
    parseTimeMs: computed(() => active.value?.parseTimeMs ?? null),
    scanProgress: computed(() => active.value?.scanProgress ?? 0),
    scanError: computed(
      () => active.value?.scanError ?? session.lastScanError,
    ),
    scanning: computed(() => session.scanning),

    /** Action methods. Same call sites as today's logStore.method() —
     *  these dispatch against the active logId. No-op pre-load. */
    ensureFields(names: string[]): Promise<void> {
      if (!active.value) return Promise.resolve();
      return session.ensureFields(active.value.id, names);
    },
    pinFields(names: readonly string[]): void {
      if (!active.value) return;
      session.pinFields(active.value.id, names);
    },
  };
}
