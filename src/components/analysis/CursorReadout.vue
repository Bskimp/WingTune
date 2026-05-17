<script setup lang="ts">
// Strip directly below the time bar. When the cursor is null, shows a
// hint. When set, shows the time clock and any values the tracking
// panel has registered. Per-tab readouts (setpoint/gyro at cursor,
// FFT bin at cursor, etc.) will plug additional samples in via the
// `samples` prop as those tabs come online.

import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useViewStore } from '@/stores/view';

defineProps<{
  /** Per-tab cursor samples, e.g. [['gyro R', '12.4 °/s'], …]. */
  samples?: Array<{ label: string; value: string; tone?: 'ink' | 'accent' | 'ok' | 'warn' | 'stamp' }>;
}>();

const view = useViewStore();
const { cursorTime, cursorPinned } = storeToRefs(view);

function formatClock(seconds: number | null): string {
  if (seconds == null) return '—';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const ms = Math.round((seconds - total) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0').slice(0, 2)}`;
}

const clock = computed(() => formatClock(cursorTime.value));

function toneToClass(tone: 'ink' | 'accent' | 'ok' | 'warn' | 'stamp' | undefined): string {
  switch (tone) {
    case 'accent': return 'text-bp-accent';
    case 'ok':     return 'text-bp-ok';
    case 'warn':   return 'text-bp-warn';
    case 'stamp':  return 'text-bp-stamp';
    case 'ink':
    default:       return 'text-bp-ink';
  }
}
</script>

<template>
  <div
    class="flex justify-between items-center px-3.5 py-1.5 bg-bp-surface border border-bp-line-2 border-t-0 font-mono text-[11.5px]"
  >
    <div v-if="cursorTime === null" class="text-bp-ink-3">
      hover a time-domain chart to read values · click the time bar to pin
    </div>

    <div v-else class="flex gap-4 items-baseline">
      <span class="flex gap-1.5 items-baseline">
        <span class="font-sans text-[9.5px] tracking-[0.16em] font-bold uppercase text-bp-ink-3">t</span>
        <span class="text-bp-ink">{{ clock }}</span>
      </span>
      <span
        v-for="s in samples ?? []"
        :key="s.label"
        class="flex gap-1.5 items-baseline"
      >
        <span class="font-sans text-[9.5px] tracking-[0.16em] font-bold uppercase text-bp-ink-3">
          {{ s.label }}
        </span>
        <span :class="toneToClass(s.tone)">{{ s.value }}</span>
      </span>
    </div>

    <div class="flex items-center gap-2.5">
      <span
        v-if="cursorPinned"
        class="px-1.5 py-px border border-bp-accent text-bp-accent font-sans text-[9px] tracking-[0.18em] font-bold uppercase"
      >PINNED</span>
      <button
        type="button"
        class="px-2 py-0.5 bg-transparent border border-bp-line-2 text-bp-ink-3 font-mono text-[10.5px] cursor-pointer hover:text-bp-ink"
        :disabled="cursorTime === null"
        :class="cursorTime === null ? 'opacity-40 cursor-not-allowed' : ''"
        @click="view.clearCursor"
      >clear</button>
    </div>
  </div>
</template>
