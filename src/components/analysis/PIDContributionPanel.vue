<script setup lang="ts">
// First real M2 analytics surface: per-term PIDFS decomposition.
//
// Reads the controller-output traces (axisP/I/D/F/S) for the selected
// axis, renders each as its own series, and computes mean-abs term
// shares via Layer 2's `lib/pidfs.ts`. Toggle chips in the header:
// click to show/hide a term, shift-click to solo (show only that term;
// shift-click again to restore all).
//
// Missing terms (e.g. axisD/axisS on yaw — wings commonly log neither)
// are skipped: no chip, no chart series, share counted as 0. Shared
// pinned cursor overlay arrives via useChartPinnedCursor, same as the
// other time-domain panels.

import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options, Series } from 'uplot';

import { useLogStore } from '@/stores/log';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { useChartPinnedCursor } from '@/composables/useChartPinnedCursor';
import { pidfsShares, type PIDFSArrays, type PIDFSTerm } from '@/lib/pidfs';

type AxisId = 0 | 1 | 2;
type AxisSpec = {
  id: AxisId;
  short: 'R' | 'P' | 'Y';
  label: string;
};

const AXES: AxisSpec[] = [
  { id: 0, short: 'R', label: 'Roll' },
  { id: 1, short: 'P', label: 'Pitch' },
  { id: 2, short: 'Y', label: 'Yaw' },
];

type TermSpec = {
  term: PIDFSTerm;
  color: string;
  /** Tooltip-ish hover description on the chip. */
  hint: string;
};

// Per-term colors — five distinct strokes against Blueprint navy.
// P leads with accent (cool blue, "primary"), I in ink-2 (calm light),
// D in stamp/coral (derivative spikiness), F in ok-green (calm
// feedforward), S in warn-amber (saturation / static gain — the term
// most likely to surprise a quad pilot moving to wings).
const TERM_SPECS: TermSpec[] = [
  { term: 'P', color: '#7ec8ff', hint: 'Proportional to error' },
  { term: 'I', color: '#b6c7e0', hint: 'Integral of error over time' },
  { term: 'D', color: '#ff8a7a', hint: 'Derivative of error' },
  { term: 'F', color: '#6ed3a0', hint: 'Feedforward from setpoint' },
  { term: 'S', color: '#ffc46a', hint: 'Static / saturation gain (PIDFS)' },
];

const COLORS = {
  ink3:  '#7a90b0',
  line:  '#1f3a5a',
  dim:   '#4a5e7e',
} as const;

const selectedAxis = ref<AxisId>(0);
const axisSpec = computed(() => AXES[selectedAxis.value]);

const logStore = useLogStore();
const view = useViewStore();
const { time, fields, hydrating } = storeToRefs(logStore);

const fieldNameFor = (term: PIDFSTerm, axis: AxisId) => `axis${term}[${axis}]`;

const requestedFieldNames = computed(() =>
  TERM_SPECS.map((t) => fieldNameFor(t.term, selectedAxis.value)),
);

async function hydrateForAxis(id: AxisId) {
  // ensureFields tolerates missing-in-log entries (they come back empty);
  // we just request the full PIDFS quintet and surface whichever lands.
  await logStore.ensureFields(TERM_SPECS.map((t) => fieldNameFor(t.term, id)));
}

onMounted(() => hydrateForAxis(selectedAxis.value));
watch(selectedAxis, hydrateForAxis);

// Per-term presence after hydration. A term is "present" if its
// hydrated array has at least one sample. Missing terms get skipped
// in the chip row and the chart series list.
const present = computed<Record<PIDFSTerm, boolean>>(() => {
  const out = { P: false, I: false, D: false, F: false, S: false };
  for (const spec of TERM_SPECS) {
    const arr = fields.value.get(fieldNameFor(spec.term, selectedAxis.value));
    if (arr && arr.length > 0) out[spec.term] = true;
  }
  return out;
});

const presentTerms = computed(() => TERM_SPECS.filter((t) => present.value[t.term]));

const termArrays = computed<PIDFSArrays>(() => {
  const out: PIDFSArrays = {};
  for (const t of presentTerms.value) {
    out[t.term] = fields.value.get(fieldNameFor(t.term, selectedAxis.value));
  }
  return out;
});

const shares = computed(() => pidfsShares(termArrays.value));

const isHydrating = computed(() =>
  requestedFieldNames.value.some((n) => hydrating.value.has(n)),
);

const ready = computed(() => time.value.length > 0 && presentTerms.value.length > 0);

// --- chart data + opts ---

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    return [new Float32Array(0)] as unknown as AlignedData;
  }
  const arrs = presentTerms.value.map((t) => termArrays.value[t.term]!);
  return [time.value, ...arrs] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const series: Series[] = [
    {},
    ...presentTerms.value.map((t) => ({
      label:  t.term,
      stroke: t.color,
      width:  1.1,
    })),
  ];
  return {
    width: 600,
    height: 240,
    legend: { show: false },
    scales: {
      x: { time: false },
      y: { auto: true },
    },
    cursor: {
      drag: { x: true, y: false, uni: 50 },
      focus: { prox: 30 },
      points: { show: true, size: 4 },
    },
    series,
    axes: [
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
      },
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        size:   46,
      },
    ],
    hooks: {
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          if (idx == null) {
            view.clearCursorIfNotPinned();
            return;
          }
          if (view.cursorPinned) return;
          const t = u.data[0][idx];
          if (typeof t === 'number') view.setCursor(t);
        },
      ],
    },
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });
const { pinnedPx } = useChartPinnedCursor({ plot, host: hostRef });

// --- per-term toggle (click = toggle, shift-click = solo) ---
//
// Uses the same view.hiddenSeries set as ServoPanel — keyed by full
// field name (axisP[0] etc.), so different axes / panels don't
// collide. Survives tab switches.

const { hiddenSeries } = storeToRefs(view);

function isHidden(term: PIDFSTerm): boolean {
  return hiddenSeries.value.has(fieldNameFor(term, selectedAxis.value));
}

function onChipClick(term: PIDFSTerm, ev: MouseEvent) {
  const myField = fieldNameFor(term, selectedAxis.value);
  if (ev.shiftKey) {
    // Solo: hide every present term except this one. If we're already
    // soloed on this term, restore all.
    const otherFields = presentTerms.value
      .filter((t) => t.term !== term)
      .map((t) => fieldNameFor(t.term, selectedAxis.value));
    const alreadySoloed =
      !hiddenSeries.value.has(myField) &&
      otherFields.every((f) => hiddenSeries.value.has(f));
    const next = new Set(hiddenSeries.value);
    if (alreadySoloed) {
      // restore: clear hidden for this axis's terms
      for (const f of [myField, ...otherFields]) next.delete(f);
    } else {
      next.delete(myField);
      for (const f of otherFields) next.add(f);
    }
    view.hiddenSeries = next;
  } else {
    view.toggleSeries(myField);
  }
}

function syncSeriesVisibility() {
  const u = plot.instance();
  if (!u) return;
  presentTerms.value.forEach((t, i) => {
    u.setSeries(i + 1, { show: !isHidden(t.term) });
  });
}

watch(plot.ready, (isReady) => { if (isReady) syncSeriesVisibility(); }, { immediate: true });
watch(hiddenSeries, syncSeriesVisibility);
watch(presentTerms, syncSeriesVisibility, { deep: false });

function selectAxis(id: AxisId) {
  selectedAxis.value = id;
}

function resetZoom() {
  plot.resetZoom();
}

const allHidden = computed(() =>
  presentTerms.value.length > 0 && presentTerms.value.every((t) => isHidden(t.term)),
);

const dominantColor = computed(() => {
  const d = shares.value.dominant;
  if (!d) return COLORS.dim;
  return TERM_SPECS.find((t) => t.term === d)!.color;
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex justify-between items-center px-3 py-2 border-b border-bp-line gap-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink">
          PID contribution · {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          click a term to toggle · shift-click to solo
        </div>
      </div>

      <div class="flex gap-2 items-center">
        <div class="flex gap-1 items-center">
          <button
            v-for="t in presentTerms"
            :key="t.term"
            type="button"
            class="flex items-center gap-1.5 px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer transition-colors"
            :style="{
              background: isHidden(t.term) ? 'transparent' : `${t.color}1f`,
              borderColor: isHidden(t.term) ? 'var(--color-bp-line-2)' : t.color,
              color: isHidden(t.term) ? 'var(--color-bp-ink-3)' : t.color,
            }"
            :title="t.hint + (isHidden(t.term) ? ' · hidden' : '')"
            :aria-pressed="!isHidden(t.term)"
            @click="(ev) => onChipClick(t.term, ev)"
          >
            <span
              class="inline-block w-2.5 h-0.5"
              :style="{ background: isHidden(t.term) ? 'var(--color-bp-line-2)' : t.color }"
            />
            {{ t.term }}
          </button>
        </div>

        <div class="flex gap-px ml-1">
          <button
            v-for="ax in AXES"
            :key="ax.id"
            type="button"
            class="px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer"
            :class="selectedAxis === ax.id
              ? 'bg-bp-accent text-bp-bg border-bp-accent'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :aria-pressed="selectedAxis === ax.id"
            @click="selectAxis(ax.id)"
          >
            {{ ax.short }}
          </button>
        </div>

        <button
          type="button"
          class="px-2 py-[3px] bg-bp-surface-2 border border-bp-line-2 text-bp-ink-3 font-mono text-[11px] font-semibold cursor-pointer hover:text-bp-ink ml-1"
          title="Reset zoom"
          @click="resetZoom"
        >⤺</button>
      </div>
    </header>

    <div class="relative px-3 py-3 min-h-[260px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        <span v-if="isHydrating">hydrating {{ axisSpec.label.toLowerCase() }} PIDFS terms…</span>
        <span v-else>no PIDFS terms present on {{ axisSpec.label.toLowerCase() }} — try another axis</span>
      </div>

      <div ref="hostRef" class="w-full relative">
        <div
          v-if="pinnedPx !== null"
          class="absolute top-0 bottom-0 w-px bg-bp-accent pointer-events-none z-10"
          :style="{
            left: `${pinnedPx}px`,
            boxShadow: '0 0 6px var(--color-bp-accent)',
          }"
        />
      </div>

      <div
        v-if="allHidden"
        class="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-bp-ink-3 pointer-events-none"
      >
        all terms hidden — click a chip above
      </div>
    </div>

    <!-- per-term share strip -->
    <footer
      v-if="ready && shares.totalAbs > 0"
      class="border-t border-bp-line px-3 py-2"
    >
      <div class="flex justify-between items-baseline mb-1.5">
        <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3">
          mean-abs share
        </span>
        <span class="font-mono text-[10.5px] text-bp-ink-3">
          dominant ·
          <span class="font-bold" :style="{ color: dominantColor }">
            {{ shares.dominant ?? '—' }}
          </span>
        </span>
      </div>
      <div class="flex h-2 overflow-hidden bg-bp-surface-2 border border-bp-line-2 rounded-sm">
        <div
          v-for="t in presentTerms"
          :key="t.term"
          class="h-full"
          :style="{
            width: `${(shares[t.term] * 100).toFixed(2)}%`,
            background: isHidden(t.term) ? 'var(--color-bp-line-2)' : t.color,
            opacity: isHidden(t.term) ? 0.4 : 1,
          }"
          :title="`${t.term} · ${(shares[t.term] * 100).toFixed(1)}%`"
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 font-mono text-[10.5px]">
        <span
          v-for="t in presentTerms"
          :key="t.term"
          :style="{ color: isHidden(t.term) ? 'var(--color-bp-dim)' : t.color }"
        >
          {{ t.term }} {{ (shares[t.term] * 100).toFixed(1) }}%
        </span>
      </div>
    </footer>
  </section>
</template>
