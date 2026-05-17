<script setup lang="ts">
// Outer wrapper for the post-load analysis screen.
//
//   ┌─ AppHeader ──────────────────────────────────────────────────────┐
//   │ TabBar (Summary / Tracking / Spectrum / Step / Recommend·N)      │
//   │ TimeBar (click-to-pin cursor anchor)                             │
//   │ CursorReadout (values @ cursor — empty hint otherwise)           │
//   │ <active tab content>                                             │
//   └──────────────────────────────────────────────────────────────────┘
//
// Tab routing is driven by view.activeTab. Summary keeps the entry-page
// capability surface accessible (file headers, field table, debug mode);
// Tracking is the first real chart tab (M1.4); Spectrum and Step show
// the "pending" placeholder until their analytics ship.
//
// Eager recommender hydration: as soon as a log loads, kick off
// hydration of every field every registered recommender wants. The
// rec computed in TabBar / RecommendTab re-fires reactively when
// fields arrive, so PIDFS recs land seconds after scan without
// needing the user to navigate to the Recommend tab first. Lazy
// hydration cardinal rule preserved — we still only hydrate fields
// that are actually in `fields_present`, just eagerly rather than
// on-tab-mount.

import { watch } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import { useViewStore } from '@/stores/view';
import { ALL_RECOMMENDER_REQUIRED_FIELDS } from '@/lib/recommendations';
import TabBar from '@/components/analysis/TabBar.vue';
import TimeBar from '@/components/analysis/TimeBar.vue';
import CursorReadout from '@/components/analysis/CursorReadout.vue';
import TrackingTab from '@/components/analysis/TrackingTab.vue';
import ServosTab from '@/components/analysis/ServosTab.vue';
import RecommendTab from '@/components/analysis/RecommendTab.vue';
import TabPlaceholder from '@/components/analysis/TabPlaceholder.vue';
import CapabilitySummary from '@/components/CapabilitySummary.vue';

const view = useViewStore();
const { activeTab } = storeToRefs(view);

const logStore = useLogStore();
const { scanReport } = storeToRefs(logStore);

watch(
  scanReport,
  async (report) => {
    if (!report) return;
    const present = new Set(report.capability.fields_present);
    const wanted = ALL_RECOMMENDER_REQUIRED_FIELDS.filter((f) => present.has(f));
    if (wanted.length > 0) {
      logStore.ensureFields(wanted).catch(() => {
        // Hydration failures are surfaced by the store; recs
        // that needed those fields just won't emit. No-op here.
      });
    }
  },
  { immediate: true },
);
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
      <ServosTab v-else-if="activeTab === 'servos'" />
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
      <RecommendTab v-else-if="activeTab === 'recommend'" />
    </div>
  </div>
</template>
