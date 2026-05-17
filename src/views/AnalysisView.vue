<script setup lang="ts">
// Outer wrapper for the post-load analysis screen.
//
//   ┌─ AppHeader ──────────────────────────────────────────────────────┐
//   │ TabBar (Summary / Tracking / Spectrum / Step)                    │
//   │ TimeBar (click-to-pin cursor anchor)                             │
//   │ CursorReadout (values @ cursor — empty hint otherwise)           │
//   │ <active tab content>                                             │
//   └──────────────────────────────────────────────────────────────────┘
//
// Tab routing is driven by view.activeTab. Summary keeps the entry-page
// capability surface accessible (file headers, field table, debug mode);
// Tracking is the first real chart tab (M1.4); Spectrum and Step show
// the "pending" placeholder until their analytics ship.

import { storeToRefs } from 'pinia';

import { useViewStore } from '@/stores/view';
import TabBar from '@/components/analysis/TabBar.vue';
import TimeBar from '@/components/analysis/TimeBar.vue';
import CursorReadout from '@/components/analysis/CursorReadout.vue';
import TrackingTab from '@/components/analysis/TrackingTab.vue';
import TabPlaceholder from '@/components/analysis/TabPlaceholder.vue';
import CapabilitySummary from '@/components/CapabilitySummary.vue';

const view = useViewStore();
const { activeTab } = storeToRefs(view);
</script>

<template>
  <div class="flex flex-col gap-0">
    <TabBar />
    <div class="mt-2.5">
      <TimeBar />
      <CursorReadout />
    </div>

    <div class="mt-4">
      <CapabilitySummary v-if="activeTab === 'summary'" />
      <TrackingTab v-else-if="activeTab === 'tracking'" />
      <TabPlaceholder
        v-else-if="activeTab === 'spectrum'"
        tab="Spectrum"
        milestone="M4 (filter analysis)"
        blurb="FFT spectra of gyro/D-term, dynamic notch overlays, and filter-delay budget. Lights up once the FFT primitive and the filter-analysis module land."
      />
      <TabPlaceholder
        v-else-if="activeTab === 'step'"
        tab="Step response"
        milestone="M2 (PIDFS decomp) + M-step (closed-loop deconv)"
        blurb="Per-axis peak / latency scatters across detected setpoint steps. Needs the step-window detector and the frequency-domain deconvolution primitives — neither is in M1 scope."
      />
    </div>
  </div>
</template>
