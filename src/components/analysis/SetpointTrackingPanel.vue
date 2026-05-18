<script setup lang="ts">
// Tracking panel — gyro vs setpoint overlay for a single axis.
//
// What's real here: every sample of the hydrated `gyroADC[i]` /
// `setpoint[i]` field arrays goes straight into uPlot, no decimation.
// The chart-rendering-fidelity invariant is the whole reason we use
// uPlot — see `project-chart-rendering-fidelity` memory if tempted to
// downsample upstream.
//
// What's wired now: axis selector, full-log render, hover → shared
// cursor (other panels read it via view.cursorTime), RMS / peak error
// computed in Layer 2 (`lib/trackingStats.ts`). Brush-to-zoom is uPlot's
// native cursor.drag.x.
//
// Reserved for later: chart-side rendering of the pinned cursor
// (needs cross-chart sync hook; deferred until the second time-domain
// panel lands).

import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useViewStore, type CursorSample } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { useChartPinnedCursor } from '@/composables/useChartPinnedCursor';
import { useCursorSamples } from '@/composables/useCursorSamples';
import { nearestTimeIndex } from '@/lib/dtype';
import { trackingStats } from '@/lib/trackingStats';

type AxisSpec = {
  id: 0 | 1 | 2;
  label: string;
  short: 'R' | 'P' | 'Y';
  setpoint: string;
  gyro: string;
};

const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R', setpoint: 'setpoint[0]', gyro: 'gyroADC[0]' },
  { id: 1, label: 'Pitch', short: 'P', setpoint: 'setpoint[1]', gyro: 'gyroADC[1]' },
  { id: 2, label: 'Yaw',   short: 'Y', setpoint: 'setpoint[2]', gyro: 'gyroADC[2]' },
];

// Blueprint palette — duplicated as literal CSS strings because uPlot
// needs concrete colors (it doesn't read CSS variables). Keep in sync
// with tailwind.css `@theme` block if Blueprint ever shifts.
const COLORS = {
  ink3:    '#7a90b0',
  ink2:    '#b6c7e0',
  line:    '#1f3a5a',
  line2:   '#2b4d72',
  accent:  '#7ec8ff',
  warn:    '#ffc46a',
} as const;

const selectedAxis = ref<0 | 1 | 2>(0);

const logStore = useActiveLog();
const view = useViewStore();
const { time, fields, hydrating } = logStore;

const axisSpec = computed(() => AXES[selectedAxis.value]);

async function hydrateForAxis(id: 0 | 1 | 2) {
  const a = AXES[id];
  await logStore.ensureFields([a.setpoint, a.gyro]);
}
onMounted(() => hydrateForAxis(selectedAxis.value));
watch(selectedAxis, hydrateForAxis);

const setpointArr = computed<Float32Array | undefined>(() => fields.value.get(axisSpec.value.setpoint));
const gyroArr = computed<Float32Array | undefined>(() => fields.value.get(axisSpec.value.gyro));

const isHydrating = computed(() =>
  hydrating.value.has(axisSpec.value.setpoint) || hydrating.value.has(axisSpec.value.gyro),
);

const ready = computed(() =>
  time.value.length > 0 &&
  setpointArr.value !== undefined && setpointArr.value.length > 0 &&
  gyroArr.value !== undefined && gyroArr.value.length > 0,
);

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    // uPlot tolerates empty arrays at construction; this branch is only
    // exercised before the first hydrate resolves.
    return [new Float32Array(0), new Float32Array(0), new Float32Array(0)] as unknown as AlignedData;
  }
  return [time.value, setpointArr.value!, gyroArr.value!] as unknown as AlignedData;
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 300,
  legend: { show: false },
  scales: {
    x: { time: false },
    y: { auto: true },
  },
  cursor: {
    drag: { x: true, y: false, uni: 50 },
    focus: { prox: 30 },
    points: { show: true, size: 5 },
  },
  series: [
    {},
    { label: 'setpoint', stroke: COLORS.ink2,   width: 1,    dash: [4, 2] },
    { label: 'gyro',     stroke: COLORS.accent, width: 1.25 },
  ],
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
      // Must match TimeBar's PLOT_AXIS_LEFT_PX so the time-bar cursor
      // visually aligns with this chart's cursor at the same time t.
      size:   50,
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
}));

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });
const { pinnedPx } = useChartPinnedCursor({ plot, host: hostRef });

const stats = computed(() => {
  if (!ready.value) return null;
  return trackingStats(setpointArr.value!, gyroArr.value!);
});

const peakErrorTime = computed(() => {
  const s = stats.value;
  if (!s || time.value.length === 0) return null;
  return time.value[Math.min(s.peakErrorIndex, time.value.length - 1)];
});

function selectAxis(id: 0 | 1 | 2) {
  selectedAxis.value = id;
}

function resetZoom() {
  plot.resetZoom();
}

// --- live cursor sample contributions ---
const { cursorTime } = storeToRefs(view);
const liveSamples = computed<CursorSample[]>(() => {
  if (!ready.value || cursorTime.value === null) return [];
  const idx = nearestTimeIndex(time.value, cursorTime.value);
  if (idx === null) return [];
  const sp = setpointArr.value![idx];
  const gy = gyroArr.value![idx];
  const err = gy - sp;
  const ax = axisSpec.value.label;
  return [
    {
      label: `sp ${axisSpec.value.short}`,
      value: sp.toFixed(1),
      tone: 'ink',
      hint: `Setpoint · ${ax} — commanded rate from the mixer`,
    },
    {
      label: `gyro ${axisSpec.value.short}`,
      value: gy.toFixed(1),
      tone: 'accent',
      hint: `Gyro · ${ax} — measured angular rate`,
    },
    {
      label: `err ${axisSpec.value.short}`,
      value: `${err >= 0 ? '+' : ''}${err.toFixed(1)}`,
      tone: Math.abs(err) > 100 ? 'stamp' : Math.abs(err) > 30 ? 'warn' : 'ok',
      hint: `Tracking error · ${ax} — gyro minus setpoint (sign = direction of lag/overshoot)`,
    },
  ];
});
useCursorSamples({ sourceKey: 'tracking', samples: liveSamples });
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header
      class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3"
    >
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Setpoint tracking · {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          gyro vs setpoint · drag to zoom
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="stats" class="flex gap-3 items-baseline">
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">RMS err</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ stats.rmsError.toFixed(2) }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">peak err</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ stats.peakError.toFixed(2) }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">samples</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ stats.sampleCount.toLocaleString() }}</div>
          </div>
        </div>

        <!-- axis selector chips -->
        <div class="flex gap-px">
          <button
            v-for="ax in AXES"
            :key="ax.id"
            type="button"
            class="px-2.5 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer"
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
          class="px-2 py-[3px] bg-bp-surface-2 border border-bp-line-2 text-bp-ink-3 font-mono text-[11px] font-semibold cursor-pointer hover:text-bp-ink whitespace-nowrap"
          title="Reset zoom"
          @click="resetZoom"
        >⤺</button>
      </div>
    </header>

    <div class="relative px-3 py-3 min-h-[316px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3"
      >
        <span v-if="isHydrating">hydrating {{ axisSpec.label.toLowerCase() }} fields…</span>
        <span v-else>{{ axisSpec.label.toLowerCase() }} fields not present in this log</span>
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
    </div>

    <footer
      class="flex justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px]"
    >
      <div class="flex gap-4 items-center font-sans text-bp-ink-2">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5 bg-bp-accent" />
          gyro
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block w-3.5"
            style="border-top: 1.5px dashed var(--color-bp-ink-2);"
          />
          setpoint
        </span>
      </div>
      <div v-if="peakErrorTime !== null" class="font-mono text-bp-ink-3">
        peak err @ {{ peakErrorTime.toFixed(2) }} s
      </div>
    </footer>
  </section>
</template>
