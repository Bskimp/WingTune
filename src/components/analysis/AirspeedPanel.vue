<script setup lang="ts">
// Airspeed panel — fits BF's BASIC airspeed model against GPS 3D speed,
// renders the two traces overlaid, and exposes the recovered tuning
// params in the header.
//
// Required hydrated fields:
//   · rcCommand[3]  — throttle (BF 1000..2000 raw; normalised to 0..1)
//   · vbatLatest    — battery voltage (volts; unit-tagged by parser)
//   · gps:GPS_speed — GPS 3D speed in m/s (Velocity-tagged on parser side)
//
// Optional:
//   · attitude[1]   — pitch (Signed deci-degrees; converted to radians).
//                     When missing the panel falls back to assuming level
//                     flight (pitch=0) and surfaces a warning chip; the
//                     fit still runs but the gravity term is physically
//                     unconstrained.
//
// Fit window: trimmed to the time range where GPS samples exist. In
// real logs GPS lock arrives well after arm — LOG00113 only has GPS
// from t≈55s onward. Outside that window the model would extrapolate
// from a clamped GPS endpoint, which feeds the fit garbage.

import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options } from 'uplot';

import { useLogStore } from '@/stores/log';
import { useViewStore, type CursorSample } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { useChartPinnedCursor } from '@/composables/useChartPinnedCursor';
import { useCursorSamples } from '@/composables/useCursorSamples';
import { nearestTimeIndex } from '@/lib/dtype';
import {
  buildAirspeedFitInputs,
  fitBasicAirspeedModel,
  type AirspeedFitResult,
  type BuiltInputs,
} from '@/lib/airspeedFit';

const COLORS = {
  ink3:   '#7a90b0',
  ink2:   '#b6c7e0',
  line:   '#1f3a5a',
  accent: '#7ec8ff',
  warn:   '#ffc46a',
} as const;

const REQUIRED_AND_OPTIONAL = [
  'rcCommand[3]',
  'vbatLatest',
  'attitude[1]',
  'gps:GPS_speed',
] as const;

const logStore = useLogStore();
const view = useViewStore();
const { time, gpsTimeSec, fields, hydrating } = storeToRefs(logStore);

onMounted(() => {
  logStore.ensureFields([...REQUIRED_AND_OPTIONAL]);
});

const isHydrating = computed(
  () => REQUIRED_AND_OPTIONAL.some((f) => hydrating.value.has(f)),
);

const built = computed<BuiltInputs | null>(() => {
  return buildAirspeedFitInputs({
    time: time.value,
    gpsTimeSec: gpsTimeSec.value,
    fields: fields.value,
  });
});

const fitResult = computed<AirspeedFitResult | null>(() => {
  const b = built.value;
  if (!b) return null;
  return fitBasicAirspeedModel(b.inputs);
});

const ready = computed(() => fitResult.value !== null);

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    return [new Float32Array(0), new Float32Array(0), new Float32Array(0)] as unknown as AlignedData;
  }
  const b = built.value!;
  const result = fitResult.value!;
  return [b.inputs.time, b.inputs.gpsSpeed, result.predicted] as unknown as AlignedData;
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 280,
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
    { label: 'gps speed', stroke: COLORS.ink2,   width: 1,    dash: [4, 2] },
    { label: 'predicted', stroke: COLORS.accent, width: 1.25 },
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

function resetZoom() { plot.resetZoom(); }

const fitWindowText = computed(() => {
  const b = built.value;
  if (!b) return '';
  const t = b.inputs.time;
  return `${t[0].toFixed(1)}–${t[t.length - 1].toFixed(1)}s · ${t.length.toLocaleString()} samples`;
});

const { cursorTime } = storeToRefs(view);
const liveSamples = computed<CursorSample[]>(() => {
  const result = fitResult.value;
  const b = built.value;
  if (!result || !b || cursorTime.value === null) return [];
  const idx = nearestTimeIndex(b.inputs.time, cursorTime.value);
  if (idx === null) return [];
  const gps = b.inputs.gpsSpeed[idx];
  const pred = result.predicted[idx];
  const resid = pred - gps;
  return [
    {
      label: 'gps',
      value: `${gps.toFixed(1)} m/s`,
      tone: 'ink',
      hint: 'GPS 3D speed — ground truth from satellite',
    },
    {
      label: 'model',
      value: `${pred.toFixed(1)} m/s`,
      tone: 'accent',
      hint: 'Predicted airspeed from the fitted BASIC model',
    },
    {
      label: 'err',
      value: `${resid >= 0 ? '+' : ''}${resid.toFixed(1)} m/s`,
      tone: Math.abs(resid) > 5 ? 'warn' : 'ok',
      hint: 'Model − GPS (positive: model over-predicts speed)',
    },
  ];
});
useCursorSamples({ sourceKey: 'airspeed', samples: liveSamples });

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating airspeed-fit fields…';
  const throttle = fields.value.get('rcCommand[3]');
  const vbat     = fields.value.get('vbatLatest');
  const gps      = fields.value.get('gps:GPS_speed');
  const missing: string[] = [];
  if (!throttle?.length) missing.push('rcCommand[3] (throttle)');
  if (!vbat?.length)     missing.push('vbatLatest');
  if (!gps?.length) {
    if (gpsTimeSec.value.length === 0) {
      return 'no GPS frames in this log — log either has no GPS module or GPS never locked';
    }
    missing.push('gps:GPS_speed');
  }
  if (gpsTimeSec.value.length < 2) return 'GPS axis has < 2 samples — cannot fit';
  if (missing.length > 0) return `missing required fields: ${missing.join(', ')}`;
  return 'preparing fit…';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header
      class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3"
    >
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Airspeed estimator &middot; BASIC model fit
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          predicted vs GPS 3D speed
          <template v-if="fitResult"> &middot; fit window {{ fitWindowText }}</template>
          <template v-if="built?.pitchFromFallback">
            &middot;
            <span class="text-bp-warn">no pitch field — level flight assumed</span>
          </template>
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="fitResult" class="flex gap-3 items-baseline">
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">delay ms</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ Math.round(fitResult.params.delayMs) }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">gravity %</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ Math.round(fitResult.params.gravityPct) }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">max V&times;100</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ Math.round(fitResult.params.maxVoltageX100) }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">R&sup2;</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ fitResult.rSquared.toFixed(3) }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">RMS</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ fitResult.rmsResidual.toFixed(1) }}</div>
          </div>
        </div>

        <button
          type="button"
          class="px-2 py-[3px] bg-bp-surface-2 border border-bp-line-2 text-bp-ink-3 font-mono text-[11px] font-semibold cursor-pointer hover:text-bp-ink whitespace-nowrap"
          title="Reset zoom"
          @click="resetZoom"
        >&#10554;</button>
      </div>
    </header>

    <div class="relative px-3 py-3 min-h-[296px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        {{ pendingMessage }}
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
          predicted
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block w-3.5"
            style="border-top: 1.5px dashed var(--color-bp-ink-2);"
          />
          gps
        </span>
      </div>
      <div v-if="fitResult" class="font-mono text-bp-ink-3">
        {{ fitResult.iterations }} iter &middot; {{ fitResult.converged ? 'converged' : 'iter cap' }}
      </div>
    </footer>
  </section>
</template>
