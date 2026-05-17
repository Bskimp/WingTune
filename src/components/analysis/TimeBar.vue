<script setup lang="ts">
// Flight-time anchor strip. Click-to-pin the shared cursor, drag to
// scrub. Renders tick marks at minute boundaries (or sub-minute if the
// log is short). Phase shading from the design is deliberately omitted
// here — phase detection is an M2+ analytics module; rather than mock
// phases, we show the bare time axis until that lands.

import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import { useViewStore } from '@/stores/view';

const logStore = useLogStore();
const view = useViewStore();
const { time } = storeToRefs(logStore);
const { cursorTime, cursorPinned } = storeToRefs(view);

const barRef = ref<HTMLDivElement | null>(null);

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
  const el = barRef.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
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
    ref="barRef"
    class="relative h-7 bg-bp-surface border border-bp-line-2 border-t-0 select-none"
    :class="totalSeconds > 0 ? 'cursor-crosshair' : 'cursor-default'"
    @mousedown="onDown"
  >
    <!-- minute / interval tick marks -->
    <div
      v-for="stop in tickStops"
      :key="stop.seconds"
      class="absolute top-[18px] font-mono text-[9.5px] text-bp-ink-3 pointer-events-none"
      :style="{
        left: totalSeconds > 0 ? `${(stop.seconds / totalSeconds) * 100}%` : '0',
        transform: 'translateX(-50%)',
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

    <span
      v-if="totalSeconds <= 0"
      class="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] text-bp-ink-3"
    >
      no time axis yet
    </span>
  </div>
</template>
