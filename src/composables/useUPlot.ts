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
  /** Monotonic counter that ticks each time setData is called (i.e.
   *  whenever the underlying data ref changes and uPlot has rescaled).
   *  Overlay consumers should include this in their watcher deps so
   *  pixel-position recomputes fire AFTER uPlot has updated its
   *  scales — important on fresh tab-switch mounts where the chart
   *  is built with empty stub data, then setData lands real arrays
   *  and rescales x. */
  updateCount: Readonly<Ref<number>>;
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
  /** Zoom the x-scale to an explicit [min, max] range. No-op if the
   *  range is degenerate or no plot exists. */
  zoomToRange(min: number, max: number): void;
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
  const updateCount = ref(0);

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
        updateCount.value += 1; // resize → axis layout may shift → pinned overlays recompute
      });
      ro.observe(el);
    }
    ready.value = true;
    updateCount.value += 1;
  }

  onMounted(build);

  // Data refresh path — cheap, no recreate. Bump updateCount so
  // downstream overlay consumers re-read the now-rescaled plot
  // (important on fresh tab-switch mounts where uPlot is built with
  // empty stub data then setData lands real arrays).
  watch(data, (next) => {
    plot?.setData(next);
    updateCount.value += 1;
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
    updateCount,
    timeToPos(t) {
      if (!plot) return null;
      // uPlot's valToPos returns CSS pixels relative to the PLOTTING
      // AREA's left edge (not the canvas/host's left edge — see uPlot
      // source ~line 5207, where offset is hardcoded 0 in CSS mode).
      // Add `plot.over.offsetLeft` to translate into host-relative
      // pixels so overlay divs positioned inside the host land on the
      // same column as the trace.
      const local = plot.valToPos(t, 'x');
      const offset = plot.over?.offsetLeft ?? 0;
      return local + offset;
    },
    posToTime(x) {
      if (!plot) return null;
      // Inverse of timeToPos — subtract the offset to translate back
      // into plotting-area-local pixels before handing to uPlot.
      const offset = plot.over?.offsetLeft ?? 0;
      return plot.posToVal(x - offset, 'x');
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
    zoomToRange(min, max) {
      if (!plot) return;
      if (!(max > min)) return;
      plot.setScale('x', { min, max });
    },
    redraw() {
      plot?.redraw(false, true);
    },
    instance() {
      return plot;
    },
  };
}
