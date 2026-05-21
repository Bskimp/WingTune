<script setup lang="ts">
// Spectrum tab — the multi-log gyro-PSD compare panel (M4), with the
// M-FilterSim per-stage filter simulator (Spectrum roadmap S1) stacked
// below it. Both full-width, stacked the way the Servos tab stacks its
// panels. SpectrumPanel compares PSDs across loaded logs; FilterSimPanel
// is single-log and replays the BF filter chain stage by stage.

import SpectrumPanel from '@/components/analysis/SpectrumPanel.vue';
import FilterSimPanel from '@/components/analysis/FilterSimPanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SpectrumPanel />
    <FilterSimPanel />
  </div>
</template>
