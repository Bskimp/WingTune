<script setup lang="ts">
// Top tab bar for the analysis view. Tabs are driven by view.activeTab.
// The Recommend tab is hidden in M1 (per `project-recommender-tab`
// memory: empty surfaces read as broken; hidden until M2+ analytics
// emit at least one rec). Spectrum and Step are visible but route to
// the "analytics pending" placeholder until their modules land.

import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useViewStore, type AnalysisTab } from '@/stores/view';

const view = useViewStore();
const { activeTab } = storeToRefs(view);

type TabSpec = { id: AnalysisTab; label: string };

// Recommend is intentionally absent — see top-of-file comment.
// Servos sits next to Tracking because both are wing-actuator surfaces
// (see `project-servo-first-class`); putting them adjacent keeps the
// "what is my plane doing right now" tabs grouped.
const TABS: TabSpec[] = [
  { id: 'summary',  label: 'Summary' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'servos',   label: 'Servos' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'step',     label: 'Step' },
];

const tabs = computed(() => TABS);
</script>

<template>
  <nav class="flex gap-px" aria-label="Analysis tabs">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="px-3 py-1.5 font-sans text-[11.5px] font-semibold border cursor-pointer"
      :class="activeTab === tab.id
        ? 'bg-bp-accent text-bp-bg border-bp-accent'
        : 'bg-bp-surface-2 text-bp-ink-2 border-bp-line-2 hover:text-bp-ink'"
      :aria-current="activeTab === tab.id ? 'page' : undefined"
      @click="view.setTab(tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>
