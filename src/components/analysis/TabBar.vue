<script setup lang="ts">
// Top tab bar for the analysis view. Tabs are driven by view.activeTab.
// Recommend appears only when at least one rec is currently emitted —
// per `project-recommender-tab`, an empty Recommend tab reads as a
// broken feature, so we hide it until there's content. Spectrum and
// Step are always visible and route to the "module pending"
// placeholder until their analytics land.
//
// Servos sits next to Tracking because both are wing-actuator
// surfaces (see `project-servo-first-class`); putting them adjacent
// keeps the "what is my plane doing right now" tabs grouped.

import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useActiveLog } from '@/composables/useActiveLog';
import { useViewStore, type AnalysisTab } from '@/stores/view';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { gatherRecommendations } from '@/lib/recommendations';

const view = useViewStore();
const { activeTab } = storeToRefs(view);

const { scanReport, fields, time, gpsTimeSec } = useActiveLog();

const filterConfig = computed(() => scanReport.value?.filter_config ?? null);

type TabSpec = { id: AnalysisTab; label: string };

const BASE_TABS: TabSpec[] = [
  { id: 'summary',  label: 'Summary' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'servos',   label: 'Servos' },
  { id: 'airspeed', label: 'Airspeed' },
  { id: 'tpa',      label: 'TPA' },
  { id: 'spa',      label: 'SPA' },
  { id: 'sterm',    label: 'S-Term' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'step',     label: 'Step · FF' },
];

const recCount = computed(() => {
  const r = scanReport.value;
  if (!r) return 0;
  const modules = evaluateModules(r.capability);
  return gatherRecommendations({
    capability: r.capability,
    modules,
    fields: fields.value,
    time: time.value,
    gpsTimeSec: gpsTimeSec.value,
    filterConfig: filterConfig.value,
    headerParams: r.header_params,
    profile: view.tuneProfile,
  }).length;
});

const tabs = computed<TabSpec[]>(() => {
  if (recCount.value === 0) return BASE_TABS;
  return [
    ...BASE_TABS,
    { id: 'recommend', label: `Recommend · ${recCount.value}` },
  ];
});
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
