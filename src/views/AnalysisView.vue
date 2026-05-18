<script setup lang="ts">
// Outer wrapper for the post-load analysis screen.
//
//   ┌─ AppHeader ──────────────────────────────────────────────────────┐
//   │ TabBar (Summary / Tracking / Servos / Airspeed / Spectrum /      │
//   │         Step / Recommend·N)                                      │
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
// Eager recommender hydration (M1.7 Approach A): a `watchEffect` iterates
// `session.logs` and for any log that has a scanReport but hasn't been
// kicked yet, pins the recommender-required field set on that logId and
// fires ensureFields. The `eagerlyHydrated` set prevents re-kicking.
// Each log is independent — dropping log B while log A's hydration is
// still in flight doesn't block B. Lazy hydration cardinal rule is
// preserved: only fields that are actually in `fields_present` get
// hydrated, just eagerly rather than on tab mount.

import { watchEffect } from 'vue';
import { storeToRefs } from 'pinia';

import { useSessionStore } from '@/stores/session';
import { useViewStore } from '@/stores/view';
import { ALL_RECOMMENDER_REQUIRED_FIELDS } from '@/lib/recommendations';
import TabBar from '@/components/analysis/TabBar.vue';
import LogRoster from '@/components/LogRoster.vue';
import TimeBar from '@/components/analysis/TimeBar.vue';
import CursorReadout from '@/components/analysis/CursorReadout.vue';
import TrackingTab from '@/components/analysis/TrackingTab.vue';
import ServosTab from '@/components/analysis/ServosTab.vue';
import AirspeedPanel from '@/components/analysis/AirspeedPanel.vue';
import TpaCurvePanel from '@/components/analysis/TpaCurvePanel.vue';
import SpaPanel from '@/components/analysis/SpaPanel.vue';
import STermPanel from '@/components/analysis/STermPanel.vue';
import SpectrumPanel from '@/components/analysis/SpectrumPanel.vue';
import StepResponsePanel from '@/components/analysis/StepResponsePanel.vue';
import RecommendTab from '@/components/analysis/RecommendTab.vue';
import CapabilitySummary from '@/components/CapabilitySummary.vue';

const view = useViewStore();
const { activeTab } = storeToRefs(view);

const session = useSessionStore();

/** logIds we've already kicked eager hydration for. Module-scope so
 *  re-mounting AnalysisView (tab navigation, etc.) doesn't re-hydrate
 *  the same set. Not a ref — only read inside the effect. */
const eagerlyHydrated = new Set<string>();

watchEffect(() => {
  // Iterate every loaded log; for each with a scanReport that hasn't
  // been kicked yet, pin + ensure the recommender-required field set
  // for THAT log. Reading `log.scanReport` registers a dep so this
  // effect re-fires when a freshly-added log's scan completes.
  for (const log of session.logs.values()) {
    const report = log.scanReport;
    if (!report) continue;
    if (eagerlyHydrated.has(log.id)) continue;
    eagerlyHydrated.add(log.id);

    const present = new Set(report.capability.fields_present);
    const wanted = ALL_RECOMMENDER_REQUIRED_FIELDS.filter((f) =>
      present.has(f),
    );
    if (wanted.length === 0) continue;
    // Pin BEFORE hydrating so the LRU sweep at end of hydrate doesn't
    // evict them. pinFields is per-log; the session store's per-log
    // pinned set is preserved until removeLog clears the log entirely.
    session.pinFields(log.id, wanted);
    session.ensureFields(log.id, wanted).catch(() => {
      // Hydration failures don't propagate — recs that needed those
      // fields just won't emit. The session store already surfaces
      // the per-log scanError if it was the scan that failed.
    });
  }
});
</script>

<template>
  <div class="flex flex-col gap-0">
    <TabBar />
    <!-- Multi-log roster — visible whenever a log is loaded so the
         "+" button is always discoverable as the multi-log entry
         point. At N=1 the single chip is mildly redundant with
         FlightStrip; at N>=2 it's the canonical compare surface.
         Sits between TabBar and TimeBar so the timeline stays
         adjacent to the cursor readout. -->
    <LogRoster v-if="session.logs.size >= 1" class="mt-px" />
    <div class="mt-2.5">
      <TimeBar />
      <CursorReadout />
    </div>

    <div class="mt-4">
      <CapabilitySummary v-if="activeTab === 'summary'" />
      <TrackingTab v-else-if="activeTab === 'tracking'" />
      <ServosTab v-else-if="activeTab === 'servos'" />
      <AirspeedPanel v-else-if="activeTab === 'airspeed'" />
      <TpaCurvePanel v-else-if="activeTab === 'tpa'" />
      <SpaPanel v-else-if="activeTab === 'spa'" />
      <STermPanel v-else-if="activeTab === 'sterm'" />
      <SpectrumPanel v-else-if="activeTab === 'spectrum'" />
      <StepResponsePanel v-else-if="activeTab === 'step'" />
      <RecommendTab v-else-if="activeTab === 'recommend'" />
    </div>
  </div>
</template>
