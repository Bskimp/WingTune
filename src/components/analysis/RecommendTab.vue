<script setup lang="ts">
// Recommend tab orchestration. Derives recs from the loaded log's
// scan report + the module capability evaluation, then hands the
// list to RecommendList. Header shows count + severity breakdown.
//
// Per `project-recommender-tab`, this tab is HIDDEN by the TabBar
// when recs is empty — so the empty state here is just a defensive
// fallback that should never render in practice.

import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { gatherRecommendations, type Severity } from '@/lib/recommendations';
import RecommendList from '@/components/analysis/RecommendList.vue';

const logStore = useLogStore();
const { scanReport, fields, time, gpsTimeSec } = storeToRefs(logStore);

const recs = computed(() => {
  const r = scanReport.value;
  if (!r) return [];
  const modules = evaluateModules(r.capability);
  return gatherRecommendations({
    capability: r.capability,
    modules,
    fields: fields.value,
    time: time.value,
    gpsTimeSec: gpsTimeSec.value,
    filterConfig: r.filter_config,
  });
});

const counts = computed(() => {
  const out: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const rec of recs.value) out[rec.severity] += 1;
  return out;
});

const SEVERITY_CHIPS: Array<{ key: Severity; label: string; tone: string }> = [
  { key: 'high',   label: 'must',   tone: 'text-bp-stamp border-bp-stamp' },
  { key: 'medium', label: 'should', tone: 'text-bp-warn border-bp-warn' },
  { key: 'low',    label: 'could',  tone: 'text-bp-ok border-bp-ok' },
  { key: 'info',   label: 'ok',     tone: 'text-bp-ink-3 border-bp-ink-3' },
];
</script>

<template>
  <section>
    <header class="bg-bp-surface border border-bp-line-2 p-4 mb-2.5 flex justify-between items-start gap-4 flex-wrap">
      <div class="min-w-0">
        <div class="font-slab text-[15px] font-semibold text-bp-ink">
          Tuning suggestions · {{ recs.length }} {{ recs.length === 1 ? 'item' : 'items' }}
        </div>
        <div class="font-mono text-[11px] text-bp-ink-3 mt-1">
          generated from this log · expand a card for details + paste-ready CLI
        </div>
      </div>
      <div class="flex bg-bp-bg border border-bp-line-2">
        <div
          v-for="chip in SEVERITY_CHIPS"
          :key="chip.key"
          class="px-3.5 py-1.5 first:border-l-0 border-l border-bp-line-2 text-center min-w-[60px]"
        >
          <div
            class="font-mono text-[18px] font-semibold leading-none"
            :class="chip.tone.split(' ')[0]"
          >
            {{ counts[chip.key] }}
          </div>
          <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 mt-1">
            {{ chip.label }}
          </div>
        </div>
      </div>
    </header>

    <RecommendList v-if="recs.length > 0" :recs="recs" />
    <div
      v-else
      class="bg-bp-surface border border-bp-line-2 p-10 text-center font-mono text-[12px] text-bp-ink-3"
    >
      no recommendations for this log — everything looks clean
    </div>
  </section>
</template>
