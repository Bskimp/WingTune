<script setup lang="ts">
// Tracking tab — for M1.4 it's a single SetpointTrackingPanel for the
// selected axis. Future panels (per-axis side-by-side, FFT under the
// trace, filter-delay overlay) plug in as M2/M3/M4 modules emit their
// derived signals.

import SetpointTrackingPanel from '@/components/analysis/SetpointTrackingPanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SetpointTrackingPanel />
  </div>
</template>
