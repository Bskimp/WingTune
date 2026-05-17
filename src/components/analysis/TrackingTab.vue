<script setup lang="ts">
// Tracking tab — gyro vs setpoint headline panel plus the M2 PIDFS
// contribution panel side by side on wide viewports, stacking on
// narrower ones. Matches the design's two-column TrackingTab layout
// (analysis-screen.jsx) with the M2 PIDFS panel slotting into the
// right column where the design had it.
//
// Future panels (FilterDelayPanel from M4, SaturationPanel from
// M-Servo, etc.) extend the right column as those modules land.

import SetpointTrackingPanel from '@/components/analysis/SetpointTrackingPanel.vue';
import PIDContributionPanel from '@/components/analysis/PIDContributionPanel.vue';
</script>

<template>
  <div
    class="grid gap-2.5 grid-cols-1 xl:grid-cols-[1.55fr_1fr]"
  >
    <SetpointTrackingPanel />
    <PIDContributionPanel />
  </div>
</template>
