<script setup lang="ts">
// M-Style — the tune-style dial.
//
// A three-way Cruise / Sport / 3D selector. The chosen profile
// reweights every recommender's thresholds + targets (filter-delay
// budget, cross-axis coupling significance, step-response peak bands,
// …) without changing any analysis math — see
// docs/wingtune-m-style-execution.md. Bound to the persisted view-store
// `tuneProfile`; flipping it re-runs the recommenders and re-tones the
// affected panels live.

import { useViewStore } from '@/stores/view';
import {
  TUNE_PROFILE_ORDER,
  PROFILE_META,
  type TuneProfile,
} from '@/lib/tuneProfile';

const view = useViewStore();

function select(p: TuneProfile) {
  view.setTuneProfile(p);
}
</script>

<template>
  <div class="flex items-center gap-2 mt-1.5">
    <span
      class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap cursor-help"
      title="Tune-style profile — reweights the recommendations and panel thresholds for a cruise / all-round / 3D-aggressive wing. Persists across sessions."
    >tune style</span>
    <div class="flex gap-px">
      <button
        v-for="p in TUNE_PROFILE_ORDER"
        :key="p"
        type="button"
        class="px-2.5 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer"
        :class="view.tuneProfile === p
          ? 'bg-bp-accent text-bp-bg border-bp-accent'
          : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
        :aria-pressed="view.tuneProfile === p"
        :title="PROFILE_META[p].blurb"
        @click="select(p)"
      >{{ PROFILE_META[p].label }}</button>
    </div>
  </div>
</template>
