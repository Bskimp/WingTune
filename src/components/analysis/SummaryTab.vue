<script setup lang="ts">
// Summary tab — the "what is this log" surfaces, stacked vertically:
// CapabilitySummary covers headers / firmware / debug-mode / readiness
// + recommender scoreboard; PilotStylePanel characterises HOW the log
// was flown (M-Pilot). Both are diagnostic-only.
//
// Placement note: M-Pilot's panel slot may move during the tab-IA pass
// (it's a candidate for a dedicated "flight character" surface). For
// now it belongs with the other "what is this log" content so the user
// has one tab to read before drilling into the analysis tabs.

import CapabilitySummary from '@/components/CapabilitySummary.vue';
import PilotStylePanel from '@/components/analysis/PilotStylePanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <CapabilitySummary />
    <PilotStylePanel />
  </div>
</template>
