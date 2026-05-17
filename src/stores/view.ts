// Pinia store for view state — active tab, shared cursor, scrub window,
// hydration cache policy. The shared cursor is what makes the analysis
// screen feel coherent: hover the Tracking chart and the cursor line
// moves on every other time-domain chart; click the time bar to pin
// the cursor; tab away and back, the pin persists. M1.4 lands the
// state; per-tab readouts plug into it as their charts come online.

import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

/** One row of the cursor readout strip. Panels push these into the
 *  view store via `useCursorSamples`; the readout aggregates and
 *  renders. Tones map to the design palette — keep in sync with
 *  CursorReadout's `toneToClass`. `hint` becomes the row's native
 *  `title` tooltip — useful for the abbreviated chip labels
 *  ("PR" → "P-term · Roll"). */
export interface CursorSample {
  label: string;
  value: string;
  tone?: 'ink' | 'accent' | 'ok' | 'warn' | 'stamp';
  hint?: string;
}

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
  | 'servos'
  | 'airspeed'
  | 'spa'
  | 'sterm'
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

  /** Field names the user has hidden from chart legends (click-to-toggle
   *  on a series). Lives at the view layer (not per-panel state) so
   *  hidden channels stay hidden when the user switches tabs and back.
   *  Session-scoped — not persisted across log loads; resetting per
   *  craft is a future polish if it turns out to matter. Stored as a
   *  Set value (replaced wholesale on toggle) so Vue's ref reactivity
   *  fires on changes. */
  const hiddenSeries = ref<Set<string>>(new Set());

  /** Per-panel sample contributions to the cursor readout, keyed by a
   *  panel-chosen `sourceKey` (e.g. "tracking-roll", "pid-roll",
   *  "servos"). The readout flattens this map into a single ordered
   *  strip. Entries clear on panel unmount via `useCursorSamples`. */
  const cursorSamples = shallowRef<Map<string, CursorSample[]>>(new Map());

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

  /** Flip a series' hidden state. Immutable-update via Set replacement
   *  so the watcher chain fires (`ref<Set>` doesn't track mutations
   *  on the contained set object). */
  function toggleSeries(fieldName: string) {
    const next = new Set(hiddenSeries.value);
    if (next.has(fieldName)) next.delete(fieldName);
    else next.add(fieldName);
    hiddenSeries.value = next;
  }

  /** Whether a given series is currently hidden. */
  function isSeriesHidden(fieldName: string): boolean {
    return hiddenSeries.value.has(fieldName);
  }

  /** Register or update a panel's contribution to the cursor readout. */
  function setCursorSamples(sourceKey: string, samples: CursorSample[]) {
    const next = new Map(cursorSamples.value);
    next.set(sourceKey, samples);
    cursorSamples.value = next;
  }

  /** Remove a panel's contribution — call on unmount. */
  function clearCursorSamples(sourceKey: string) {
    if (!cursorSamples.value.has(sourceKey)) return;
    const next = new Map(cursorSamples.value);
    next.delete(sourceKey);
    cursorSamples.value = next;
  }

  return {
    activeTab,
    cursorTime,
    cursorPinned,
    hiddenSeries,
    cursorSamples,
    activeWorkspace,
    scrubStart,
    scrubEnd,
    fieldCacheBytesCap,
    setTab,
    setCursor,
    pinCursorAt,
    clearCursorIfNotPinned,
    clearCursor,
    toggleSeries,
    isSeriesHidden,
    setCursorSamples,
    clearCursorSamples,
  };
});
