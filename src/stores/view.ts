// Pinia store for view state — scrub window, active workspace, hydration
// cache policy. Minimal scaffold for M1.3; the surfaces that consume each
// field arrive across M1.4 (charts), M1.5 (inspector), M1.6 (readiness),
// and M1.7 (multi-log + alignment).

import { defineStore } from 'pinia';
import { ref } from 'vue';

/** Default LRU cache cap on hydrated fields. The eviction policy itself
 *  is deferred to M1.7 (multi-log multiplies pressure); for M1.3 this is
 *  a documented constant that `view.ts` exposes for later use. */
export const DEFAULT_FIELD_CACHE_BYTES = 256 * 1024 * 1024;

export const useViewStore = defineStore('view', () => {
  /** Active workspace identifier — M1.4 will populate this from the
   *  curated workspace registry. `null` means "no workspace selected yet". */
  const activeWorkspace = ref<string | null>(null);

  /** Scrub window in seconds-since-log-start. `null` for either bound means
   *  "use the log's natural bound." M1.4's time-series owns this. */
  const scrubStart = ref<number | null>(null);
  const scrubEnd = ref<number | null>(null);

  /** Hydration cache byte cap. Defaults to `DEFAULT_FIELD_CACHE_BYTES`;
   *  user-tunable later. M1.7 wires the eviction policy itself. */
  const fieldCacheBytesCap = ref<number>(DEFAULT_FIELD_CACHE_BYTES);

  return {
    activeWorkspace,
    scrubStart,
    scrubEnd,
    fieldCacheBytesCap,
  };
});
