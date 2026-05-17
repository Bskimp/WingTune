// Cross-chart pinned-cursor read side.
//
// The chart's own setCursor hook already writes hover position into
// view.cursorTime; pinning happens on the TimeBar. This composable is
// the symmetric reader — it watches the store's pinned cursor and
// exposes a reactive pixel x position so the consuming chart can
// render an overlay div at that location.
//
// No feedback loop: this is read-only from the store. The chart's
// own write-side hook short-circuits when view.cursorPinned is true
// (see SetpointTrackingPanel / ServoPanel), so hover never updates
// the pinned position.
//
// Recomputes on:
//   · cursorTime / cursorPinned changes (TimeBar click, programmatic
//     setCursor from somewhere else, clear button)
//   · the uPlot instance going ready (covers the tab-switch case —
//     when the chart mounts fresh, the overlay snaps to the right x)
//   · host element resize (window resize, layout shift)

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useViewStore } from '@/stores/view';
import type { UseUPlotHandle } from '@/composables/useUPlot';

export interface UseChartPinnedCursorArgs {
  plot: UseUPlotHandle;
  /** The uPlot host element (so we can observe resize). */
  host: Readonly<Ref<HTMLDivElement | null>>;
}

export function useChartPinnedCursor({ plot, host }: UseChartPinnedCursorArgs) {
  const view = useViewStore();
  const { cursorTime, cursorPinned } = storeToRefs(view);

  /** Pixel x of the pinned cursor relative to the host element, or
   *  `null` when nothing should be drawn (no pin, no plot, or value
   *  outside the visible scale). */
  const pinnedPx = ref<number | null>(null);

  function recompute() {
    if (!cursorPinned.value || cursorTime.value === null) {
      pinnedPx.value = null;
      return;
    }
    const px = plot.timeToPos(cursorTime.value);
    pinnedPx.value = px !== null && isFinite(px) && px >= 0 ? px : null;
  }

  watch(
    [cursorTime, cursorPinned, plot.ready, plot.updateCount],
    recompute,
    { immediate: true },
  );

  let ro: ResizeObserver | null = null;
  onMounted(() => {
    const el = host.value;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => recompute());
      ro.observe(el);
    }
  });
  onBeforeUnmount(() => ro?.disconnect());

  return { pinnedPx };
}
