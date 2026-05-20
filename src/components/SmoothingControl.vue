<script setup lang="ts">
// Global trace-smoothing slider. Sets `view.smoothingStrength` (0..4);
// time-domain panels read it and boxcar-smooth the DISPLAY copy of
// their raw traces via `lib/displaySmooth`.
//
// DISPLAY-ONLY — the "metrics use raw data" note is load-bearing
// honesty: smoothing never touches the analysis layer, so header
// numbers (RMS, peak, coverage…) stay computed from raw arrays even
// when the chart is smoothed. See lib/displaySmooth header.

import { computed } from 'vue';

import { useViewStore } from '@/stores/view';
import { SMOOTHING_LABELS, MAX_SMOOTHING_STRENGTH } from '@/lib/displaySmooth';

const view = useViewStore();

const strength = computed<number>({
  get: () => view.smoothingStrength,
  set: (v) => view.setSmoothingStrength(v),
});

const label = computed(() => SMOOTHING_LABELS[view.smoothingStrength] ?? 'raw');
const isOn = computed(() => view.smoothingStrength > 0);
</script>

<template>
  <div
    class="flex items-center gap-2.5 bg-bp-surface border border-bp-line-2 border-t-0 px-3 py-1.5"
  >
    <span class="font-sans text-[9px] tracking-[0.2em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">
      trace smoothing
    </span>
    <input
      v-model.number="strength"
      type="range"
      min="0"
      :max="MAX_SMOOTHING_STRENGTH"
      step="1"
      class="w-32 cursor-pointer"
      style="accent-color: var(--color-bp-accent);"
      :aria-label="`Trace smoothing strength: ${label}`"
    />
    <span
      class="font-mono text-[11px] font-semibold w-14"
      :class="isOn ? 'text-bp-accent' : 'text-bp-ink-3'"
    >{{ label }}</span>
    <span class="font-mono text-[9.5px] text-bp-ink-3">
      display-only &middot; header metrics always use raw data
    </span>
  </div>
</template>
