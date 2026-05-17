// Pinia store for view state — active tab, shared cursor, scrub window,
// hydration cache policy. The shared cursor is what makes the analysis
// screen feel coherent: hover the Tracking chart and the cursor line
// moves on every other time-domain chart; click the time bar to pin
// the cursor; tab away and back, the pin persists. M1.4 lands the
// state; per-tab readouts plug into it as their charts come online.

import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

/** Default LRU cache cap on hydrated fields. The eviction policy itself
 *  is deferred to M1.7 (multi-log multiplies pressure); for M1.3 this is
 *  a documented constant that `view.ts` exposes for later use. */
export const DEFAULT_FIELD_CACHE_BYTES = 256 * 1024 * 1024;

/** Top-level analysis tab. Order matches the tab bar. Recommend stays
 *  hidden until M2+ analytics emit anything (per
 *  `project-recommender-tab` memory) — it's listed here so the type is
 *  stable, but the tab bar component filters it out until then. */
export type AnalysisTab =
  | 'summary'
  | 'tracking'
  | 'spectrum'
  | 'step'
  | 'recommend';

export const useViewStore = defineStore('view', () => {
  /** Active analysis tab. Defaults to `summary` so the entry-page
   *  capability surface is the first thing the user lands on after
   *  a successful scan. */
  const activeTab = ref<AnalysisTab>('summary');

  /** Shared cursor time (seconds-since-log-start). `null` means "no
   *  cursor active." Set by chart hover or time-bar interaction. */
  const cursorTime = shallowRef<number | null>(null);

  /** When true, hover-out on a chart does NOT clear the cursor — the
   *  cursor stays put until explicitly cleared. Pin is what makes
   *  cross-tab navigation preserve the user's interest point. */
  const cursorPinned = ref(false);

  /** Active workspace identifier — M1.4+ will populate this from the
   *  curated workspace registry. `null` means "no workspace selected yet". */
  const activeWorkspace = ref<string | null>(null);

  /** Scrub window in seconds-since-log-start. `null` for either bound means
   *  "use the log's natural bound." The time-series panels own this. */
  const scrubStart = ref<number | null>(null);
  const scrubEnd = ref<number | null>(null);

  /** Hydration cache byte cap. Defaults to `DEFAULT_FIELD_CACHE_BYTES`;
   *  user-tunable later. M1.7 wires the eviction policy itself. */
  const fieldCacheBytesCap = ref<number>(DEFAULT_FIELD_CACHE_BYTES);

  function setTab(id: AnalysisTab) {
    activeTab.value = id;
  }

  function setCursor(t: number | null) {
    cursorTime.value = t;
  }

  /** Set the cursor AND pin it — the time bar's click-to-pin gesture. */
  function pinCursorAt(t: number) {
    cursorTime.value = t;
    cursorPinned.value = true;
  }

  /** Hover-out behaviour: clear the cursor only if it isn't pinned. */
  function clearCursorIfNotPinned() {
    if (!cursorPinned.value) cursorTime.value = null;
  }

  /** Explicit "clear" — drops the cursor and the pin together. */
  function clearCursor() {
    cursorTime.value = null;
    cursorPinned.value = false;
  }

  return {
    activeTab,
    cursorTime,
    cursorPinned,
    activeWorkspace,
    scrubStart,
    scrubEnd,
    fieldCacheBytesCap,
    setTab,
    setCursor,
    pinCursorAt,
    clearCursorIfNotPinned,
    clearCursor,
  };
});
