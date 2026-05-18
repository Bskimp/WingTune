<script setup lang="ts">
// Recommend tab orchestration. Derives recs from the loaded log's
// scan report + the module capability evaluation, then hands the
// list to RecommendList. Header shows count + severity breakdown,
// where each severity chip doubles as a click-to-toggle filter
// (all four severities active by default).
//
// Filter state is component-local — no cross-session persistence
// (per the M1.7-era no-persistence policy). Different logs have
// different rec profiles, so a remembered filter would more often
// confuse than help.
//
// Per `project-recommender-tab`, this tab is HIDDEN by the TabBar
// when recs is empty — so the all-empty state here is just a
// defensive fallback that should never render in practice.

import { computed, ref } from 'vue';
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

const activeSeverities = ref<Set<Severity>>(
  new Set<Severity>(['high', 'medium', 'low', 'info']),
);

function toggleSeverity(s: Severity) {
  const next = new Set(activeSeverities.value);
  if (next.has(s)) next.delete(s);
  else next.add(s);
  activeSeverities.value = next;
}

const filteredRecs = computed(() =>
  recs.value.filter((r) => activeSeverities.value.has(r.severity)),
);

const isFiltered = computed(() =>
  activeSeverities.value.size < 4 && recs.value.length > 0,
);

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
          Tuning suggestions ·
          <template v-if="isFiltered">{{ filteredRecs.length }} of {{ recs.length }} shown</template>
          <template v-else>{{ recs.length }} {{ recs.length === 1 ? 'item' : 'items' }}</template>
        </div>
        <div class="font-mono text-[11px] text-bp-ink-3 mt-1">
          <template v-if="isFiltered">click chips to toggle severity filters</template>
          <template v-else>generated from this log · expand a card for details + paste-ready CLI</template>
        </div>
      </div>
      <div class="flex bg-bp-bg border border-bp-line-2">
        <button
          v-for="chip in SEVERITY_CHIPS"
          :key="chip.key"
          type="button"
          class="px-3.5 py-1.5 first:border-l-0 border-l border-bp-line-2 text-center min-w-[60px] cursor-pointer transition-opacity bg-transparent"
          :class="activeSeverities.has(chip.key) ? 'opacity-100' : 'opacity-35 hover:opacity-60'"
          :title="activeSeverities.has(chip.key)
            ? `Hide ${chip.label} recommendations`
            : `Show ${chip.label} recommendations`"
          @click="toggleSeverity(chip.key)"
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
        </button>
      </div>
    </header>

    <RecommendList v-if="filteredRecs.length > 0" :recs="filteredRecs" />
    <div
      v-else-if="recs.length > 0"
      class="bg-bp-surface border border-bp-line-2 p-10 text-center font-mono text-[12px] text-bp-ink-3"
    >
      no recommendations match the active filters — click a dimmed chip to show more
    </div>
    <div
      v-else
      class="bg-bp-surface border border-bp-line-2 p-10 text-center font-mono text-[12px] text-bp-ink-3"
    >
      no recommendations for this log — everything looks clean
    </div>
  </section>
</template>
