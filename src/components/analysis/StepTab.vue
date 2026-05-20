<script setup lang="ts">
// Step tab — the two transient-response analyses, grouped: closed-loop
// step response (Wiener deconvolution) + feedforward effectiveness
// (M-FF). Both characterize "what does the airframe do when the
// setpoint changes fast," and both key off aggressive stick inputs —
// FFPanel auto-detects the maneuver windows.

import StepResponsePanel from '@/components/analysis/StepResponsePanel.vue';
import FFPanel from '@/components/analysis/FFPanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <StepResponsePanel />
    <FFPanel />
  </div>
</template>
