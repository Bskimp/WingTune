<script setup lang="ts">
// Recommend tab orchestration. Derives recs from a single log's
// scan report + the module capability evaluation, then hands the
// list to RecommendList. Header shows count + severity breakdown,
// where each severity chip doubles as a click-to-toggle filter
// (all four severities active by default).
//
// Multi-log (M1.7 Push 3c): when 2+ logs are loaded, a pager at the
// top lets the user step through logs one at a time. Recs are
// fundamentally a single-log concept (each log gets its own rec
// set, no cross-log aggregation per scope decision), so the pager
// is the multi-log surface here. Pager state is local to this
// component and independent of the roster eye toggle — the eye
// toggle drives global focus, but you can flip through rec sets
// without changing what the chart panels are showing.
//
// Filter state is component-local — no cross-session persistence
// (per the M1.7-era no-persistence policy). Different logs have
// different rec profiles, so a remembered filter would more often
// confuse than help. Same goes for the selected log index: reset
// on a fresh session.
//
// Per `project-recommender-tab`, this tab is HIDDEN by the TabBar
// when recs is empty — so the all-empty state here is just a
// defensive fallback that should never render in practice.

import { computed, ref, watch } from 'vue';

import { useSessionStore } from '@/stores/session';
import { useViewStore } from '@/stores/view';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { gatherRecommendations, type Severity } from '@/lib/recommendations';
import RecommendList from '@/components/analysis/RecommendList.vue';

const session = useSessionStore();
const view = useViewStore();

/** Logs in insertion order (matches roster ordering). Recomputed
 *  reactively when logs are added or removed. */
const allLogs = computed(() => Array.from(session.logs.values()));

/** Pager state — which log's recs are being shown. Clamped reactively
 *  if the selection falls out of bounds (e.g. user removes the
 *  currently-shown log). Defaults to 0 so the first-loaded log is
 *  the initial pick. */
const selectedIndex = ref(0);

watch(allLogs, (logs) => {
  if (logs.length === 0) {
    selectedIndex.value = 0;
    return;
  }
  if (selectedIndex.value >= logs.length) {
    selectedIndex.value = logs.length - 1;
  }
});

const selectedLog = computed(() =>
  allLogs.value[selectedIndex.value] ?? null,
);

function next() {
  if (allLogs.value.length === 0) return;
  selectedIndex.value =
    (selectedIndex.value + 1) % allLogs.value.length;
}

function prev() {
  if (allLogs.value.length === 0) return;
  selectedIndex.value =
    (selectedIndex.value - 1 + allLogs.value.length) % allLogs.value.length;
}

const recs = computed(() => {
  const log = selectedLog.value;
  if (!log || !log.scanReport) return [];
  const modules = evaluateModules(log.scanReport.capability);
  return gatherRecommendations({
    capability: log.scanReport.capability,
    modules,
    fields: log.fields,
    time: log.time,
    gpsTimeSec: log.gpsTimeSec,
    filterConfig: log.scanReport.filter_config,
    headerParams: log.scanReport.header_params,
    profile: view.tuneProfile,
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

const showPager = computed(() => allLogs.value.length >= 2);
const pagerLabel = computed(() => {
  if (allLogs.value.length === 0) return '';
  return `log ${selectedIndex.value + 1} of ${allLogs.value.length}`;
});
</script>

<template>
  <section>
    <!-- Multi-log pager — only renders at N >= 2. Lets the user step
         through recs one log at a time. Independent of the roster
         eye toggle. -->
    <div
      v-if="showPager && selectedLog"
      class="flex items-center justify-between bg-bp-surface border border-bp-line-2 px-3 py-2 mb-2.5 font-mono text-[11px] text-bp-ink-2"
    >
      <div class="flex items-center gap-3 min-w-0">
        <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">
          showing recs for
        </span>
        <span class="font-mono text-bp-ink truncate" :title="selectedLog.name">
          {{ selectedLog.name }}
        </span>
        <span class="font-mono text-bp-ink-3 whitespace-nowrap">
          {{ pagerLabel }}
        </span>
      </div>
      <div class="flex gap-px">
        <button
          type="button"
          class="px-2.5 py-1 bg-bp-surface-2 border border-bp-line-2 text-bp-ink-3 cursor-pointer hover:text-bp-ink"
          :title="`Previous log (${pagerLabel})`"
          @click="prev"
        >
          ←
        </button>
        <button
          type="button"
          class="px-2.5 py-1 bg-bp-surface-2 border border-bp-line-2 border-l-0 text-bp-ink-3 cursor-pointer hover:text-bp-ink"
          :title="`Next log (${pagerLabel})`"
          @click="next"
        >
          →
        </button>
      </div>
    </div>

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
