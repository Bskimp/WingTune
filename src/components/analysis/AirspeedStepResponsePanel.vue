<script setup lang="ts">
// Airspeed-binned closed-loop step response.
//
// The StepResponsePanel above deconvolves ONE step response from the
// whole flight. On a wing that averages together regimes the pilot
// actually feels as different aircraft: the SAME PID gains track
// crisply at 30 m/s and wallow at 15 m/s, because control authority
// scales with airspeed. This panel bins the flight by airspeed and
// overlays a separate step response per bin — sluggish-at-low-speed
// vs ringy-at-high-speed reads straight off the chart. It is the
// DIAGNOSIS the M5 hyperbolic TPA curve fitter is the response to.
//
// Airspeed source toggle mirrors the S2 spectrogram: the M3 BASIC
// physical estimate (continuous, GPS-anchored by its fit) or GPS
// groundspeed (measured, laggy, wind-affected). Both need GPS frames.
//
// Single-log (useActiveLog) + per-axis. Diagnostic only — no CLI.

import { computed, onMounted, ref, watch } from 'vue';
import type uPlot from 'uplot';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useUPlot } from '@/composables/useUPlot';
import { estimateSampleRate } from '@/lib/spectrum';
import type { Axis } from '@/lib/signalRegistry';
import { buildWholeLogAirspeed, resolveAirspeedPitchField } from '@/lib/airspeedFit';
import { resampleToTimeAxis } from '@/lib/timeAlign';
import {
  computeAirspeedStepResponse,
  type AirspeedStepResponseResult,
} from '@/lib/airspeedStepResponse';

const COLORS = {
  ink3: '#7a90b0',
  line: '#1f3a5a',
} as const;

/** Three airspeed bins — low / mid / high. Cool → warm = slow → fast. */
const BIN_COUNT = 3;
const BIN_COLORS = ['#7ec8ff', '#6fd98a', '#ffc46a'] as const;

interface AxisSpec { id: Axis; label: string; short: 'R' | 'P' | 'Y'; }
const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R' },
  { id: 1, label: 'Pitch', short: 'P' },
  { id: 2, label: 'Yaw',   short: 'Y' },
];
const selectedAxis = ref<Axis>(0);
const axisSpec = computed(() => AXES[selectedAxis.value]);

type Source = 'model' | 'gps';
const airspeedSource = ref<Source>('model');

const logStore = useActiveLog();
const { scanReport, time, gpsTimeSec, fields, hydrating } = logStore;

const sampleRateHz = computed(() => estimateSampleRate(time.value));

const pitchField = computed(() =>
  resolveAirspeedPitchField(scanReport.value?.capability),
);
const wantedFields = computed(() => [
  `gyroADC[${selectedAxis.value}]`,
  `setpoint[${selectedAxis.value}]`,
  'rcCommand[3]',
  'vbatLatest',
  'gps:GPS_speed',
  pitchField.value,
]);

async function hydrate() {
  await logStore.ensureFields(wantedFields.value);
}
onMounted(hydrate);
watch(wantedFields, hydrate);

const isHydrating = computed(() =>
  wantedFields.value.some((f) => hydrating.value.has(f)),
);

const gyro = computed<Float32Array | null>(
  () => fields.value.get(`gyroADC[${selectedAxis.value}]`) ?? null,
);
const setpoint = computed<Float32Array | null>(
  () => fields.value.get(`setpoint[${selectedAxis.value}]`) ?? null,
);

// --- airspeed series (whole-log, main-frame-aligned) -----------------

const modelAirspeed = computed(() => {
  const sr = scanReport.value;
  return buildWholeLogAirspeed({
    time: time.value,
    gpsTimeSec: gpsTimeSec.value,
    fields: fields.value,
    headerParams: sr?.header_params,
    capability: sr?.capability,
  });
});

const gpsAirspeed = computed<Float32Array | null>(() => {
  const gps = fields.value.get('gps:GPS_speed');
  if (!gps || gps.length === 0 || gpsTimeSec.value.length < 2) return null;
  return resampleToTimeAxis(gpsTimeSec.value, gps, time.value);
});

const airspeed = computed<Float32Array | null>(() =>
  airspeedSource.value === 'model'
    ? modelAirspeed.value?.airspeed ?? null
    : gpsAirspeed.value,
);

// --- per-bin step response -------------------------------------------

const result = computed<AirspeedStepResponseResult | null>(() => {
  const g = gyro.value;
  const sp = setpoint.value;
  const a = airspeed.value;
  const sr = sampleRateHz.value;
  if (!g || !sp || !a || sr <= 0 || g.length !== sp.length) return null;
  return computeAirspeedStepResponse(sp, g, a, sr, { binCount: BIN_COUNT });
});

/** Bins that actually caught step inputs at their airspeed. */
const populatedBins = computed(() =>
  result.value
    ? result.value.bins.filter((b) => b.response.numSegments > 0)
    : [],
);

const ready = computed(
  () => result.value !== null && result.value.hasAirspeed && populatedBins.value.length > 0,
);

const fitRSquared = computed(() => modelAirspeed.value?.rSquared);

// --- chart -----------------------------------------------------------

/** A bin with no segments contributes a NaN trace (no line) rather
 *  than a flat-zero line that would read as a real response. */
function nanLike(n: number): Float32Array {
  return new Float32Array(n).fill(NaN);
}

const data = computed<AlignedData>(() => {
  const r = result.value;
  if (!r || !ready.value || r.time.length === 0) {
    const stub = new Float32Array([0, 0.5]);
    return [stub, nanLike(2), nanLike(2), nanLike(2)] as unknown as AlignedData;
  }
  const series = r.bins.map((b) =>
    b.response.numSegments > 0 ? b.response.response : nanLike(r.time.length),
  );
  return [r.time, ...series] as unknown as AlignedData;
});

/** y = 1.0 ideal-step reference, drawn faint in the `draw` hook. */
function drawReference(u: uPlot): void {
  if (!ready.value) return;
  const y = u.valToPos(1, 'y', true);
  if (!Number.isFinite(y)) return;
  const ctx = u.ctx;
  ctx.save();
  ctx.strokeStyle = COLORS.ink3;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(u.bbox.left, y);
  ctx.lineTo(u.bbox.left + u.bbox.width, y);
  ctx.stroke();
  ctx.restore();
}

const opts = computed<Options>(() => ({
  width: 800,
  height: 300,
  legend: { show: false },
  scales: {
    x: { time: false },
    y: { auto: true },
  },
  cursor: { drag: { x: true, y: false, uni: 50 }, points: { show: true, size: 4 } },
  series: [
    {},
    { label: 'low', stroke: BIN_COLORS[0], width: 1.5 },
    { label: 'mid', stroke: BIN_COLORS[1], width: 1.5 },
    { label: 'high', stroke: BIN_COLORS[2], width: 1.5 },
  ],
  axes: [
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => `${(v * 1000).toFixed(0)} ms`),
    },
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      size:   46,
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => v.toFixed(2)),
    },
  ],
  hooks: { draw: [drawReference] },
}));

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

function resetZoom() { plot.resetZoom(); }
function selectAxis(id: Axis) { selectedAxis.value = id; }
function selectSource(s: Source) { airspeedSource.value = s; }

// --- footer per-bin rows ---------------------------------------------

interface BinRow {
  key: number;
  color: string;
  speedText: string;
  detail: string;
  populated: boolean;
}
const binRows = computed<BinRow[]>(() => {
  const r = result.value;
  if (!r) return [];
  return r.bins.map((b, i) => {
    const speedText = `${b.midSpeed.toFixed(0)} m/s`;
    if (b.response.numSegments === 0) {
      return { key: i, color: BIN_COLORS[i], speedText, detail: 'no step inputs flown', populated: false };
    }
    const peak = b.response.peakAmplitude.toFixed(2);
    const lat = Number.isFinite(b.response.latencyMs)
      ? `${b.response.latencyMs.toFixed(0)} ms`
      : '—';
    return {
      key: i,
      color: BIN_COLORS[i],
      speedText,
      detail: `peak ${peak} · lat ${lat} · ${b.response.numSegments} seg`,
      populated: true,
    };
  });
});

const pendingMessage = computed(() => {
  if (isHydrating.value) {
    return `hydrating ${axisSpec.value.label.toLowerCase()} setpoint / gyro + airspeed fields…`;
  }
  if (!scanReport.value) return 'load a log to bin the step response by airspeed';
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  if (gpsTimeSec.value.length < 2) {
    return 'no GPS lock in this log — the airspeed axis needs GPS frames '
      + '(the model source is GPS-anchored by its fit; the GPS source reads GPS speed directly)';
  }
  if (airspeedSource.value === 'model' && !modelAirspeed.value) {
    return 'BASIC airspeed fit could not run — needs rcCommand[3] (throttle) + vbatLatest + a GPS lock';
  }
  if (airspeedSource.value === 'gps' && !gpsAirspeed.value) {
    return 'gps:GPS_speed is not in this log — switch to the model source';
  }
  if (result.value && !result.value.hasAirspeed) {
    return 'airspeed barely varied across this flight — fly a throttle-sweep cruise '
      + '(slow passes through to fast) so the bins span a real speed range';
  }
  if (result.value && populatedBins.value.length === 0) {
    return 'airspeed varied but no step inputs were flown — fly crisp setpoint steps '
      + 'across the speed range so each bin has a response to deconvolve';
  }
  return 'binning the step response…';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Step response by airspeed &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          the same gains, deconvolved per airspeed bin — slow-vs-fast response divergence
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div class="flex gap-px" title="Airspeed axis source">
          <button
            v-for="s in (['model', 'gps'] as const)"
            :key="s"
            type="button"
            class="px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer whitespace-nowrap"
            :class="airspeedSource === s
              ? 'bg-bp-accent text-bp-bg border-bp-accent'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :aria-pressed="airspeedSource === s"
            :title="s === 'model'
              ? 'M3 BASIC physical airspeed estimate (continuous, GPS-anchored)'
              : 'GPS groundspeed resampled onto the main frame (measured, laggy, wind-affected)'"
            @click="selectSource(s)"
          >{{ s === 'model' ? 'model' : 'GPS' }}</button>
        </div>
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
          >{{ ax.short }}</button>
        </div>
        <button
          type="button"
          class="px-2 py-[3px] bg-bp-surface-2 border border-bp-line-2 text-bp-ink-3 font-mono text-[11px] font-semibold cursor-pointer hover:text-bp-ink whitespace-nowrap"
          title="Reset zoom"
          @click="resetZoom"
        >&#10554;</button>
      </div>
    </header>

    <div class="relative px-3 py-3 min-h-[316px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        {{ pendingMessage }}
      </div>
      <div ref="hostRef" class="w-full relative" />
    </div>

    <footer class="flex flex-wrap justify-between items-start px-3 py-2 border-t border-bp-line text-[10.5px] gap-y-1.5 gap-x-3">
      <div class="flex flex-wrap gap-1.5 items-center">
        <span
          v-for="row in binRows"
          :key="row.key"
          class="flex items-center gap-1.5 px-1.5 py-[2px] border font-mono"
          :class="row.populated ? 'border-solid' : 'border-dashed opacity-55'"
          :style="{ borderColor: row.color }"
        >
          <span class="w-3 h-px inline-block" :style="{ backgroundColor: row.color }" />
          <span class="text-bp-ink-2">{{ row.speedText }}</span>
          <span class="text-bp-ink-3">{{ row.detail }}</span>
        </span>
      </div>
      <div
        v-if="ready && airspeedSource === 'model' && fitRSquared !== undefined"
        class="font-mono text-bp-ink-3"
        :class="{ 'text-bp-warn': fitRSquared < 0.7 }"
      >
        BASIC fit R² {{ fitRSquared.toFixed(2) }}
      </div>
    </footer>

    <div class="px-3 pb-2 font-mono text-[10px] text-bp-ink-3 leading-snug">
      <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-accent mr-1.5">
        reading it
      </span>
      Each trace is the closed-loop step response deconvolved only from
      segments flown inside that airspeed bin. Curves diverging — slow
      sluggish, fast ringy — means the airframe needs airspeed-scheduled
      gains (the M5 TPA curve); curves overlapping means one gain set
      covers the range. The dashed line is the ideal unit step.
      Diagnostic only — no CLI.
    </div>
  </section>
</template>
