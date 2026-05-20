<script setup lang="ts">
// Tracking panel — gyro vs setpoint overlay for a single axis.
//
// M1.7.1 multi-log: chart x is SESSION time; each visible log
// contributes a (setpoint, gyro) pair, tinted toward its family color.
// Per-log data is resampled onto the longest visible aligned-time
// axis via `resampleOntoRef`. Stats (RMS err, peak err) + cursor
// readout remain anchored to the active (first visible) log so the
// header stays a stable single-value surface at N≥2 — flip the eye
// to inspect another log's stats.
//
// What's real here: every sample of each log's hydrated `gyroADC[i]` /
// `setpoint[i]` field arrays goes straight into uPlot via the
// session-time resample, no decimation. The chart-rendering-fidelity
// invariant is the whole reason we use uPlot — see
// `project-chart-rendering-fidelity` memory if tempted to downsample
// upstream.

import { computed, ref, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options, Series } from 'uplot';

import { useSessionStore, type LogState } from '@/stores/session';
import { useActiveLog } from '@/composables/useActiveLog';
import { useAlignedTime } from '@/composables/useAlignedTime';
import { useViewStore, type CursorSample } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { useChartPinnedCursor } from '@/composables/useChartPinnedCursor';
import { useCursorSamples } from '@/composables/useCursorSamples';
import { nearestTimeIndex } from '@/lib/dtype';
import { trackingStats } from '@/lib/trackingStats';
import {
  resampleOntoRef,
  sessionTimeRangeFn,
  useSessionRefTime,
} from '@/lib/sessionTime';
import {
  familyForIndex,
  tintTowardFamily,
  type FamilySpec,
} from '@/lib/logColors';

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

// Base colors — tinted toward each log's family for the per-log strokes.
// Setpoint reads as the dim dashed lead, gyro as the brighter measured trace.
const COLORS = {
  ink3:    '#7a90b0',
  line:    '#1f3a5a',
  setpoint: '#b6c7e0',
  gyro:    '#7ec8ff',
} as const;

const selectedAxis = ref<0 | 1 | 2>(0);

const session = useSessionStore();
const view = useViewStore();
const activeLog = useActiveLog();

const axisSpec = computed(() => AXES[selectedAxis.value]);

interface LogEntry {
  log: LogState;
  family: FamilySpec;
  hidden: boolean;
}

const logEntries = computed<LogEntry[]>(() => {
  const out: LogEntry[] = [];
  let idx = 0;
  for (const log of session.logs.values()) {
    out.push({
      log,
      family: familyForIndex(idx),
      hidden: view.isLogHidden(log.id),
    });
    idx += 1;
  }
  return out;
});

const visibleEntries = computed(() =>
  logEntries.value.filter((e) => !e.hidden),
);

// Hydrate the selected axis's setpoint + gyro across every loaded log.
// watchEffect re-fires when selectedAxis changes OR when the set of
// logs changes (add/remove), so newly-added logs auto-hydrate.
watchEffect(() => {
  const a = AXES[selectedAxis.value];
  for (const { log } of logEntries.value) {
    session.ensureFields(log.id, [a.setpoint, a.gyro]).catch(() => {
      // Hydration failures recorded on the log's scanError; the chart
      // just renders without that log's data.
    });
  }
});

const activeSetpointArr = computed<Float32Array | undefined>(() =>
  activeLog.fields.value.get(axisSpec.value.setpoint),
);
const activeGyroArr = computed<Float32Array | undefined>(() =>
  activeLog.fields.value.get(axisSpec.value.gyro),
);

const isHydrating = computed(() =>
  activeLog.hydrating.value.has(axisSpec.value.setpoint) ||
  activeLog.hydrating.value.has(axisSpec.value.gyro),
);

const ready = computed(() =>
  activeLog.time.value.length > 0 &&
  activeSetpointArr.value !== undefined && activeSetpointArr.value.length > 0 &&
  activeGyroArr.value !== undefined && activeGyroArr.value.length > 0,
);

const refTime = useSessionRefTime();

interface LogTraces {
  entry: LogEntry;
  setpointArr: Float32Array;
  gyroArr: Float32Array;
}

const allTraces = computed<LogTraces[]>(() => {
  const out: LogTraces[] = [];
  const a = axisSpec.value;
  for (const entry of visibleEntries.value) {
    const sp = entry.log.fields.get(a.setpoint);
    const gy = entry.log.fields.get(a.gyro);
    if (!sp || !gy || sp.length === 0 || gy.length === 0) continue;
    out.push({ entry, setpointArr: sp, gyroArr: gy });
  }
  return out;
});

const data = computed<AlignedData>(() => {
  if (!ready.value || refTime.value.length === 0 || allTraces.value.length === 0) {
    return [new Float32Array(0)] as unknown as AlignedData;
  }
  const series: Float32Array[] = [];
  for (const t of allTraces.value) {
    series.push(resampleOntoRef(t.entry.log, refTime.value, t.setpointArr));
    series.push(resampleOntoRef(t.entry.log, refTime.value, t.gyroArr));
  }
  return [refTime.value, ...series] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const series: Series[] = [{}];
  for (const t of allTraces.value) {
    const fam = t.entry.family;
    series.push({
      label: `${t.entry.log.name} setpoint`,
      stroke: tintTowardFamily(COLORS.setpoint, fam),
      width: 1,
      dash: [4, 2],
    });
    series.push({
      label: `${t.entry.log.name} gyro`,
      stroke: tintTowardFamily(COLORS.gyro, fam),
      width: 1.25,
    });
  }
  return {
    width: 800,
    height: 300,
    legend: { show: false },
    scales: {
      x: { time: false, range: sessionTimeRangeFn },
      y: { auto: true },
    },
    cursor: {
      drag: { x: true, y: false, uni: 50 },
      focus: { prox: 30 },
      points: { show: true, size: 5 },
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
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });
const { pinnedPx } = useChartPinnedCursor({ plot, host: hostRef });

// M1.7.1 — project session-time cursor back to the active log's local
// axis for the readout below. Stable across activeId changes (eye
// toggle) and the active log's `timeOffsetSec` (drag-shift).
const activeAlign = useAlignedTime(() => activeLog.activeId.value);

// Stats from active log only — single-log readout keeps the header
// surface stable. Flip the eye to inspect another log's RMS/peak.
const stats = computed(() => {
  if (!ready.value) return null;
  return trackingStats(activeSetpointArr.value!, activeGyroArr.value!);
});

const peakErrorTime = computed(() => {
  const s = stats.value;
  if (!s || activeLog.time.value.length === 0) return null;
  const t = activeLog.time.value[Math.min(s.peakErrorIndex, activeLog.time.value.length - 1)];
  // Project to session time so the displayed timestamp matches the
  // chart's x-axis when the active log has an offset.
  return t + activeAlign.offsetSec.value;
});

function selectAxis(id: 0 | 1 | 2) {
  selectedAxis.value = id;
}

function resetZoom() {
  plot.resetZoom();
}

const { cursorTime } = storeToRefs(view);
const liveSamples = computed<CursorSample[]>(() => {
  if (!ready.value || cursorTime.value === null) return [];
  const localCursor = activeAlign.alignedCursor.value;
  if (localCursor === null) return [];
  const idx = nearestTimeIndex(activeLog.time.value, localCursor);
  if (idx === null) return [];
  const sp = activeSetpointArr.value![idx];
  const gy = activeGyroArr.value![idx];
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

const multiLogNote = computed(() => {
  const n = visibleEntries.value.length;
  if (n <= 1) return '';
  return `${n} logs · session time · stats + readout shown for active log only`;
});
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
          {{ multiLogNote || 'gyro vs setpoint · drag to zoom' }}
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="stats" class="flex gap-3 items-baseline">
          <div
            class="text-right cursor-help"
            title="Root-mean-square of (gyro − setpoint) across the flight, in deg/s — the typical tracking error. Lower = the airframe follows the commanded rate more closely."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">RMS err</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ stats.rmsError.toFixed(2) }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="The single worst tracking error (gyro vs setpoint), in deg/s — the moment the airframe fell furthest behind the command."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">peak err</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ stats.peakError.toFixed(2) }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Number of samples in the comparison — the length of the log's main-frame data on this axis."
          >
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
