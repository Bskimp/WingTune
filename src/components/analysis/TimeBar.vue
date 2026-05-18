<script setup lang="ts">
// Flight-time anchor strip. Click-to-pin the shared cursor, drag to
// scrub. Renders tick marks at minute boundaries (or sub-minute if the
// log is short). Phase shading from the design is deliberately omitted
// here — phase detection is an M2+ analytics module; rather than mock
// phases, we show the bare time axis until that lands.
//
// Visual alignment with the chart panels below: each panel reserves
// PLOT_AXIS_LEFT_PX pixels on the left for y-axis labels (uPlot
// `axes[1].size` — keep all panels in sync at this same value). The
// time bar pads its CONTENT area by the same amount so a cursor at
// time t lines up vertically with where that t lands on the chart's
// plotting area. Right side gets a small matching pad for uPlot's
// default right margin.

import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useActiveLog } from '@/composables/useActiveLog';
import { useViewStore } from '@/stores/view';

/** Must match `axes[1].size` on every uPlot chart panel
 *  (SetpointTrackingPanel, PIDContributionPanel, ServoPanel). If a
 *  panel uses a different y-axis size, its cursor won't visually
 *  align with the time bar's cursor at the same time value. */
const PLOT_AXIS_LEFT_PX = 50;
const PLOT_PADDING_RIGHT_PX = 10;

const view = useViewStore();
const { time } = useActiveLog();
const { cursorTime, cursorPinned } = storeToRefs(view);

const contentRef = ref<HTMLDivElement | null>(null);

const totalSeconds = computed(() => {
  const t = time.value;
  return t.length ? t[t.length - 1] : 0;
});

const tickStops = computed<Array<{ seconds: number; label: string }>>(() => {
  const total = totalSeconds.value;
  if (total <= 0) return [];
  // Pick a tick interval that yields 4-12 labels.
  const candidates = [1, 5, 10, 15, 30, 60, 120, 300, 600];
  const interval = candidates.find((c) => total / c <= 12) ?? 600;
  const stops: Array<{ seconds: number; label: string }> = [];
  for (let s = 0; s <= total + 1e-6; s += interval) {
    stops.push({ seconds: s, label: formatClock(s) });
  }
  return stops;
});

function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatCursorReadout(seconds: number | null): string {
  if (seconds == null) return '—';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const ms = Math.round((seconds - total) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0').slice(0, 2)}`;
}

function fracToSeconds(frac: number): number {
  return Math.max(0, Math.min(1, frac)) * totalSeconds.value;
}

function xFracFromEvent(ev: MouseEvent): number {
  const el = contentRef.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  if (r.width <= 0) return 0;
  return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
}

function onDown(ev: MouseEvent) {
  if (totalSeconds.value <= 0) return;
  ev.preventDefault();
  const t = fracToSeconds(xFracFromEvent(ev));
  view.pinCursorAt(t);
  const onMove = (m: MouseEvent) => view.setCursor(fracToSeconds(xFracFromEvent(m)));
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

const cursorLeftPct = computed(() => {
  const t = cursorTime.value;
  const total = totalSeconds.value;
  if (t == null || total <= 0) return null;
  return Math.max(0, Math.min(100, (t / total) * 100));
});
</script>

<template>
  <div
    class="relative h-7 bg-bp-surface border border-bp-line-2 border-t-0 select-none"
    :class="totalSeconds > 0 ? 'cursor-crosshair' : 'cursor-default'"
    @mousedown="onDown"
  >
    <!-- Inner content area that visually aligns with the chart panels'
         plotting area. All percent-based positioning (ticks + cursor)
         is relative to this inner div, NOT the outer bar. -->
    <div
      ref="contentRef"
      class="absolute top-0 bottom-0"
      :style="{
        left:  `${PLOT_AXIS_LEFT_PX}px`,
        right: `${PLOT_PADDING_RIGHT_PX}px`,
      }"
    >
      <!-- minute / interval tick marks. First tick left-aligns to avoid
           half-clipping its label past the content's left edge; last
           tick right-aligns symmetrically; middle ticks center. -->
      <div
        v-for="(stop, i) in tickStops"
        :key="stop.seconds"
        class="absolute top-[18px] font-mono text-[9.5px] text-bp-ink-3 pointer-events-none"
        :style="{
          left: totalSeconds > 0 ? `${(stop.seconds / totalSeconds) * 100}%` : '0',
          transform: i === 0
            ? 'translateX(0)'
            : i === tickStops.length - 1
              ? 'translateX(-100%)'
              : 'translateX(-50%)',
        }"
      >
        {{ stop.label }}
      </div>

      <!-- cursor line -->
      <template v-if="cursorLeftPct !== null">
        <div
          class="absolute top-0 bottom-0 w-px pointer-events-none"
          :class="cursorPinned ? 'bg-bp-accent' : 'bg-bp-ink'"
          :style="{
            left: `${cursorLeftPct}%`,
            boxShadow: cursorPinned ? '0 0 6px var(--color-bp-accent)' : 'none',
          }"
        />
        <div
          class="absolute -top-px px-[5px] py-px font-mono text-[9px] font-semibold pointer-events-none whitespace-nowrap"
          :class="cursorPinned ? 'bg-bp-accent text-bp-bg' : 'bg-bp-ink text-bp-bg'"
          :style="{ left: `${cursorLeftPct}%`, transform: 'translateX(-50%)' }"
        >
          {{ formatCursorReadout(cursorTime) }}
        </div>
      </template>
    </div>

    <span
      v-if="totalSeconds <= 0"
      class="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] text-bp-ink-3"
    >
      no time axis yet
    </span>
  </div>
</template>
