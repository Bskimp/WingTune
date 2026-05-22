<script setup lang="ts">
// Step tab — the transient-response analyses, grouped: closed-loop
// step response (Wiener deconvolution), the same response binned by
// airspeed, and feedforward effectiveness (M-FF). All characterize
// "what does the airframe do when the setpoint changes fast"; the
// airspeed-binned variant splits that by flight regime, and FFPanel
// auto-detects the maneuver windows.

import StepResponsePanel from '@/components/analysis/StepResponsePanel.vue';
import AirspeedStepResponsePanel from '@/components/analysis/AirspeedStepResponsePanel.vue';
import FFPanel from '@/components/analysis/FFPanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <StepResponsePanel />
    <AirspeedStepResponsePanel />
    <FFPanel />
  </div>
</template>
