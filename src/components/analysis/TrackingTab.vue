<script setup lang="ts">
// Tracking tab — gyro vs setpoint headline panel, the M-Coupling
// cross-axis matrix, and the M2 PIDFS contribution panel stacked
// vertically, all full-width. The design
// originally had a 2-column layout, but stacking aligns the panels
// with the full-width TimeBar + CursorReadout above, so the pinned
// cursor reads as one continuous vertical line through everything at
// time t. Better mental model than a side-by-side where the cursor is
// only on one side, and side-steps the horizontal-overflow issue from
// trying to squeeze 5 chip groups into a narrow column.
//
// Future time-domain panels (FilterDelayPanel from M4, SaturationPanel
// from M-Servo, etc.) stack into this column as those modules land.

import SetpointTrackingPanel from '@/components/analysis/SetpointTrackingPanel.vue';
import CouplingPanel from '@/components/analysis/CouplingPanel.vue';
import PIDContributionPanel from '@/components/analysis/PIDContributionPanel.vue';
import TrimDiagnosticsPanel from '@/components/analysis/TrimDiagnosticsPanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SetpointTrackingPanel />
    <CouplingPanel />
    <PIDContributionPanel />
    <TrimDiagnosticsPanel />
  </div>
</template>
