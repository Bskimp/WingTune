// Lifecycle wrapper for a single uPlot instance bound to a Vue element ref.
//
// What it owns:
//   · construct uPlot in onMounted (after the host <div> is in the DOM)
//   · destroy in onBeforeUnmount
//   · ResizeObserver → uPlot.setSize so the chart tracks its container
//   · watch `data` and `opts` refs; rebuild via setData / instance recreation
//     when they change
//
// What callers own:
//   · the host element ref (template ref on a div)
//   · the AlignedData ref (Float32Array-friendly; uPlot accepts typed arrays
//     directly, no conversion needed at this seam — see
//     `wingtune-memory-model`)
//   · the Options ref (chart config; height is read off this)
//
// What this deliberately does NOT do:
//   · cross-chart cursor sync. The single-chart M1.4 case doesn't need it;
//     when the second chart lands, push view.cursorTime into uPlot via
//     `setCursorAtTime()` from a watcher on the consuming component.

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import uPlot, { type AlignedData, type Options } from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface UseUPlotArgs {
  target: Readonly<Ref<HTMLDivElement | null>>;
  data: Readonly<Ref<AlignedData>>;
  opts: Readonly<Ref<Options>>;
}

export interface UseUPlotHandle {
  /** Reactive: true once the uPlot instance is constructed, false after
   *  destroy. Consumers that need to recompute things from the plot
   *  (overlays, derived pixel positions) should watch this so their
   *  watchers re-fire at mount/rebuild time. */
  ready: Readonly<Ref<boolean>>;
  /** Pixel x position of a given time value, or `null` if no plot.
   *  CSS pixels relative to the host element. */
  timeToPos(t: number): number | null;
  /** Time value at a given pixel x position, or `null` if no plot. */
  posToTime(x: number): number | null;
  /** Move uPlot's cursor to (or away from) a given time. Pass `null` to
   *  park it off-canvas. */
  setCursorAtTime(t: number | null): void;
  /** Reset x-scale to the data's natural range. */
  resetZoom(): void;
  /** Force a redraw — useful when external state changes (e.g. the
   *  pinned cursor overlay) need uPlot to re-paint its own layers. */
  redraw(): void;
  /** Escape hatch for direct uPlot calls. Prefer the methods above. */
  instance(): uPlot | null;
}

export function useUPlot({ target, data, opts }: UseUPlotArgs): UseUPlotHandle {
  let plot: uPlot | null = null;
  let ro: ResizeObserver | null = null;
  const ready = ref(false);

  function destroy() {
    ro?.disconnect();
    ro = null;
    plot?.destroy();
    plot = null;
    ready.value = false;
  }

  function build() {
    const el = target.value;
    if (!el) return;
    destroy();
    const optsNow = { ...opts.value };
    if (optsNow.width == null) optsNow.width = el.clientWidth || 600;
    plot = new uPlot(optsNow, data.value, el);
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (!plot) return;
        const rect = el.getBoundingClientRect();
        plot.setSize({ width: rect.width, height: optsNow.height });
      });
      ro.observe(el);
    }
    ready.value = true;
  }

  onMounted(build);

  // Data refresh path — cheap, no recreate.
  watch(data, (next) => {
    plot?.setData(next);
  });

  // Opts changes (axis labels, series colors, etc.) require a full rebuild
  // since uPlot doesn't expose a clean "update options" mutator. Charts
  // should aim to keep opts stable in practice; this is the escape hatch.
  watch(opts, build, { deep: false });

  // Rebuild if the host element ref switches (rare in practice — defensive).
  watch(target, (el) => { if (el) build(); });

  onBeforeUnmount(destroy);

  return {
    ready,
    timeToPos(t) {
      if (!plot) return null;
      return plot.valToPos(t, 'x');
    },
    posToTime(x) {
      if (!plot) return null;
      return plot.posToVal(x, 'x');
    },
    setCursorAtTime(t) {
      if (!plot) return;
      if (t == null) {
        plot.setCursor({ left: -10, top: -10 });
      } else {
        const left = plot.valToPos(t, 'x');
        plot.setCursor({ left, top: 0 });
      }
    },
    resetZoom() {
      if (!plot) return;
      const xs = plot.data[0];
      if (!xs || xs.length < 2) return;
      plot.setScale('x', { min: xs[0] as number, max: xs[xs.length - 1] as number });
    },
    redraw() {
      plot?.redraw(false, true);
    },
    instance() {
      return plot;
    },
  };
}
