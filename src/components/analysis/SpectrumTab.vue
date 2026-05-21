<script setup lang="ts">
// Spectrum tab — stacked spectral panels, full-width, the way the Servos
// tab stacks its panels:
//   · SpectrumPanel        — multi-log gyro-PSD compare (M4).
//   · FilterSimPanel       — per-stage BF filter-chain replay (roadmap S1).
//   · AirspeedSpectrogramPanel — gyro PSD binned by airspeed (roadmap S2).
//   · LowFreqModePanel     — sub-3 Hz airframe-mode detection (roadmap S2).
// The tab is getting heavy; an internal sub-nav is deferred to the
// tab-IA design pass (see docs/wingtune-spectrum-roadmap.md).

import SpectrumPanel from '@/components/analysis/SpectrumPanel.vue';
import FilterSimPanel from '@/components/analysis/FilterSimPanel.vue';
import AirspeedSpectrogramPanel from '@/components/analysis/AirspeedSpectrogramPanel.vue';
import LowFreqModePanel from '@/components/analysis/LowFreqModePanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SpectrumPanel />
    <FilterSimPanel />
    <AirspeedSpectrogramPanel />
    <LowFreqModePanel />
  </div>
</template>
