<script setup lang="ts">
// Closed-loop step response — per-axis "what does the plane do when
// commanded a step in setpoint?" via Wiener deconvolution
// (lib/stepResponse.ts). Single-axis view matches PIDtoolbox /
// Plasmatree convention since R/P/Y curves often differ enough that
// overlay obscures detail.
//
// Reference line at y=1.0 = perfect tracking (the plane responds
// instantly to the commanded setpoint and holds). Real responses ramp
// up to 1.0 (sluggish) or overshoot above (aggressive PID). Settling
// time = first crossing of 0.95·finalValue. Peak amplitude > 1.0 →
// overshoot indicator. numSegments = how many manoeuvre windows
// passed the setpoint-RMS gate.

import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options } from 'uplot';

import { useLogStore } from '@/stores/log';
import { useUPlot } from '@/composables/useUPlot';
import { estimateSampleRate } from '@/lib/spectrum';
import { computeStepResponse, type StepResponseResult } from '@/lib/stepResponse';

const COLORS = {
  ink3:   '#7a90b0',
  ink2:   '#b6c7e0',
  line:   '#1f3a5a',
  accent: '#7ec8ff',
  warn:   '#ffc46a',
  stamp:  '#ff6a6a',
  ok:     '#7ee0a8',
} as const;

interface AxisSpec {
  id: 0 | 1 | 2;
  label: string;
  short: 'R' | 'P' | 'Y';
  setpoint: string;
  gyro: string;
  color: string;
}

const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R', setpoint: 'setpoint[0]', gyro: 'gyroADC[0]', color: COLORS.accent },
  { id: 1, label: 'Pitch', short: 'P', setpoint: 'setpoint[1]', gyro: 'gyroADC[1]', color: COLORS.warn   },
  { id: 2, label: 'Yaw',   short: 'Y', setpoint: 'setpoint[2]', gyro: 'gyroADC[2]', color: COLORS.stamp  },
];

const SEGMENT_LEN = 2048;
const WINDOW_SEC = 0.5;

const selectedAxis = ref<0 | 1 | 2>(0);

const logStore = useLogStore();
const { time, fields, hydrating } = storeToRefs(logStore);

const axisSpec = computed(() => AXES[selectedAxis.value]);

async function hydrateForAxis(id: 0 | 1 | 2) {
  const a = AXES[id];
  await logStore.ensureFields([a.setpoint, a.gyro]);
}
onMounted(() => hydrateForAxis(selectedAxis.value));
watch(selectedAxis, hydrateForAxis);

const setpointArr = computed<Float32Array | undefined>(
  () => fields.value.get(axisSpec.value.setpoint),
);
const gyroArr = computed<Float32Array | undefined>(
  () => fields.value.get(axisSpec.value.gyro),
);

const isHydrating = computed(
  () => hydrating.value.has(axisSpec.value.setpoint) ||
        hydrating.value.has(axisSpec.value.gyro),
);

const sampleRateHz = computed(() => estimateSampleRate(time.value));

const stepResult = computed<StepResponseResult | null>(() => {
  const sp = setpointArr.value;
  const gy = gyroArr.value;
  const sr = sampleRateHz.value;
  if (!sp || !gy || sr <= 0) return null;
  if (sp.length < SEGMENT_LEN || gy.length < SEGMENT_LEN) return null;
  return computeStepResponse(sp, gy, sr, {
    segmentLen: SEGMENT_LEN,
    windowSec: WINDOW_SEC,
  });
});

const ready = computed(() => {
  const r = stepResult.value;
  return r !== null && r.numSegments > 0;
});

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    return [new Float32Array(0), new Float32Array(0)] as unknown as AlignedData;
  }
  const r = stepResult.value!;
  return [r.time, r.response] as unknown as AlignedData;
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
    { label: 'step response', stroke: axisSpec.value.color, width: 1.5 },
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
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      size:   50,
      values: (_u, splits) => splits.map((v) => v.toFixed(2)),
    },
  ],
  hooks: {
    // Reference markers: dashed horizontal at y=1.0 (perfect tracking
    // target) + dashed at y=0 baseline. uPlot's bbox is in device
    // pixels; valToPos with canPx=true matches that frame.
    draw: [
      (u) => {
        const ctx = u.ctx;
        const left = u.bbox.left;
        const width = u.bbox.width;
        ctx.save();
        ctx.strokeStyle = '#7a90b066';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        const y1 = u.valToPos(1.0, 'y', true);
        ctx.beginPath();
        ctx.moveTo(left, y1); ctx.lineTo(left + width, y1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      },
    ],
  },
}));

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

function resetZoom() { plot.resetZoom(); }
function selectAxis(id: 0 | 1 | 2) { selectedAxis.value = id; }

const pendingMessage = computed(() => {
  if (isHydrating.value) return `hydrating ${axisSpec.value.label.toLowerCase()} setpoint + gyro…`;
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  if (!setpointArr.value?.length || !gyroArr.value?.length) {
    return `${axisSpec.value.label.toLowerCase()} setpoint or gyro field missing from this log`;
  }
  if (setpointArr.value.length < SEGMENT_LEN) {
    return `log too short for ${SEGMENT_LEN}-sample analysis window — need ≥ ${SEGMENT_LEN} samples`;
  }
  if (stepResult.value && stepResult.value.numSegments === 0) {
    return `setpoint never exceeded the deconvolution gate — fly more aggressive manoeuvres on ${axisSpec.value.label.toLowerCase()} to characterize the step response`;
  }
  return 'computing step response…';
});

const settlingText = computed(() => {
  const r = stepResult.value;
  if (!r || r.settlingTimeMs < 0) return '—';
  return `${r.settlingTimeMs.toFixed(0)} ms`;
});

const peakPctText = computed(() => {
  const r = stepResult.value;
  if (!r) return '—';
  return `${(r.peakAmplitude * 100).toFixed(0)} %`;
});

const segmentInfo = computed(() => {
  const r = stepResult.value;
  if (!r) return '';
  return `${SEGMENT_LEN}-pt Wiener deconv · ${r.numSegments.toLocaleString()} segments · ${(WINDOW_SEC * 1000).toFixed(0)} ms window`;
});

const peakToneClass = computed(() => {
  const r = stepResult.value;
  if (!r) return 'text-bp-ink';
  if (r.peakAmplitude > 1.30) return 'text-bp-stamp';   // hard overshoot
  if (r.peakAmplitude > 1.10) return 'text-bp-warn';    // mild overshoot
  if (r.peakAmplitude < 0.85) return 'text-bp-warn';    // sluggish
  return 'text-bp-ink';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header
      class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3"
    >
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Step response &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          {{ ready ? segmentInfo : 'closed-loop response via Wiener deconvolution' }}
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="stepResult && ready" class="flex gap-3 items-baseline">
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">peak</div>
            <div class="font-mono text-[13px]" :class="peakToneClass">{{ peakPctText }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">settle 95%</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ settlingText }}</div>
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
              ? 'text-bp-bg border-current'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :style="selectedAxis === ax.id ? { backgroundColor: ax.color, borderColor: ax.color } : {}"
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
      <div ref="hostRef" class="w-full" />
    </div>

    <footer
      class="flex justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px]"
    >
      <div class="flex gap-4 items-center font-sans text-bp-ink-2">
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block w-3.5 h-0.5"
            :style="{ backgroundColor: axisSpec.color }"
          />
          response
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block w-3.5"
            style="border-top: 1px dashed var(--color-bp-ink-3);"
          />
          y=1.0 ideal tracking
        </span>
      </div>
      <div class="font-mono text-bp-ink-3">
        peak &lt; 1.10 = clean &middot; 1.10–1.30 = mild overshoot &middot; &gt; 1.30 = hard overshoot
      </div>
    </footer>
  </section>
</template>
