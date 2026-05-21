<script setup lang="ts">
// S2 — low-frequency airframe-mode detection.
//
// The Spectrum tab's other panels live in the 3-500 Hz band — noise,
// filters, buzz. This one looks BELOW 3 Hz, where a fixed-wing
// aircraft's slow rigid-body modes oscillate: phugoid, dutch roll,
// short period. A peak here is an AIRFRAME dynamic mode — a CG /
// tail-volume / dihedral diagnostic — not motor noise.
//
// Resolving these needs a long analysis window (a 0.02 Hz phugoid
// needs ~100 s of flight), so lib/lowFreqModes runs a single decimated
// whole-flight FFT. Each named band carries a `resolved` flag — when
// the log is too short the band is drawn faint and a footer note says
// so, rather than presenting an unresolvable peak as fact.
//
// Pure diagnostic visualization — no recommender. Every aircraft HAS
// these modes; a mode is only a problem when poorly damped, and damping
// estimation is out of S2 scope. Single-log (useActiveLog) + per-axis.

import { computed, onMounted, ref, watch } from 'vue';
import type uPlot from 'uplot';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useUPlot } from '@/composables/useUPlot';
import { estimateSampleRate } from '@/lib/spectrum';
import type { Axis } from '@/lib/signalRegistry';
import {
  detectLowFreqModes,
  type ControlAxis,
  type LowFreqModeResult,
} from '@/lib/lowFreqModes';

const COLORS = {
  ink3:  '#7a90b0',
  line:  '#1f3a5a',
  trace: '#b6c7e0',
} as const;

/** Per-mode colour — peak markers, band shading, footer chips. */
const MODE_COLOR: Record<string, string> = {
  'phugoid':      '#7ec8ff',
  'dutch-roll':   '#6fd98a',
  'short-period': '#ffc46a',
  'unclassified': '#7a90b0',
};

const MODE_LABEL: Record<string, string> = {
  'phugoid':      'phugoid',
  'dutch-roll':   'dutch roll',
  'short-period': 'short period',
  'unclassified': 'unclassified',
};

/** x-axis tick positions, Hz — decade + half-decade marks across the
 *  sub-3 Hz band. The axis plots log10(Hz), so these are log-transformed
 *  before placement and relabelled back to Hz. */
const X_TICK_HZ = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 3];

interface AxisSpec { id: Axis; label: string; short: 'R' | 'P' | 'Y'; ctl: ControlAxis; }
const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R', ctl: 'roll'  },
  { id: 1, label: 'Pitch', short: 'P', ctl: 'pitch' },
  { id: 2, label: 'Yaw',   short: 'Y', ctl: 'yaw'   },
];
const selectedAxis = ref<Axis>(1); // pitch — phugoid + short-period both live here
const axisSpec = computed(() => AXES[selectedAxis.value]);

const logStore = useActiveLog();
const { scanReport, time, fields, hydrating } = logStore;

const sampleRateHz = computed(() => estimateSampleRate(time.value));

const gyroField = computed(() => `gyroADC[${selectedAxis.value}]`);
async function hydrate() {
  await logStore.ensureFields([gyroField.value]);
}
onMounted(hydrate);
watch(gyroField, hydrate);

const isHydrating = computed(() => hydrating.value.has(gyroField.value));
const gyro = computed<Float32Array | null>(
  () => fields.value.get(gyroField.value) ?? null,
);

const result = computed<LowFreqModeResult>(() =>
  detectLowFreqModes(
    gyro.value ?? new Float32Array(0),
    sampleRateHz.value,
    axisSpec.value.ctl,
  ),
);

const ready = computed(
  () => gyro.value != null && sampleRateHz.value > 0 && !result.value.tooShort,
);

/** Bands that can appear on the selected axis (phugoid + short-period
 *  on pitch; dutch roll on roll/yaw). */
const axisBands = computed(() =>
  result.value.bands.filter((b) => b.axes.includes(axisSpec.value.ctl)),
);

// --- chart ------------------------------------------------------------

// Both overlays run in the `draw` hook (after uPlot has drawn the axes
// + the PSD line). The band fills are faint enough (≤0.07 alpha) that
// painting them over the line rather than under it is imperceptible —
// and `draw` is the only draw-stage hook the rest of the codebase
// trusts (a throw in the earlier `drawClear` hook aborts the whole
// draw cycle, axes included).
function drawBands(u: uPlot): void {
  if (!ready.value) return;
  const ctx = u.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  ctx.clip();
  ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'bottom';
  for (const b of axisBands.value) {
    const xL = u.valToPos(Math.log10(b.loHz), 'x', true);
    const xR = u.valToPos(Math.log10(b.hiHz), 'x', true);
    const colour = MODE_COLOR[b.name];
    // Resolved band → faint fill; unresolved → fainter still (the
    // window can't pin a peak here — see the footer note).
    ctx.fillStyle = colour;
    ctx.globalAlpha = b.resolved ? 0.07 : 0.03;
    ctx.fillRect(xL, u.bbox.top, xR - xL, u.bbox.height);
    ctx.globalAlpha = b.resolved ? 0.5 : 0.28;
    ctx.fillText(b.name, xL + 3, u.bbox.top + u.bbox.height - 3);
  }
  ctx.restore();
}

function drawPeaks(u: uPlot): void {
  if (!ready.value) return;
  const ctx = u.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  ctx.clip();
  for (const p of result.value.peaks) {
    const x = u.valToPos(Math.log10(p.freqHz), 'x', true);
    const y = u.valToPos(p.powerDb, 'y', true);
    const colour = MODE_COLOR[p.mode];
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    // A peak in an unresolved band is suspect — dash its marker.
    ctx.setLineDash(p.bandResolved ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, u.bbox.top);
    ctx.lineTo(x, u.bbox.top + u.bbox.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

const data = computed<AlignedData>(() => {
  const r = result.value;
  if (!ready.value || r.frequencies.length === 0) {
    return [
      new Float32Array([Math.log10(0.02), Math.log10(3)]),
      new Float32Array([0, 0]),
    ] as unknown as AlignedData;
  }
  // x is plotted as log10(Hz) on a LINEAR uPlot scale — uPlot's native
  // log distr renders blank in this build, so the decade spacing is done
  // by transforming the data + relabelling ticks. The sub-3 Hz band
  // spans 2+ decades; a linear axis would bury the phugoid at the edge.
  const logF = new Float32Array(r.frequencies.length);
  for (let i = 0; i < r.frequencies.length; i++) {
    logF[i] = Math.log10(r.frequencies[i]);
  }
  return [logF, r.psdDb] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const r = result.value;
  const xMinHz = r.frequencies.length > 0 ? r.frequencies[0] : 0.02;
  const xMaxHz = r.frequencies.length > 0 ? r.frequencies[r.frequencies.length - 1] : 3;
  return {
    width: 800,
    height: 300,
    legend: { show: false },
    scales: {
      // x is log10(Hz) on a LINEAR scale — see the `data` computed.
      x: { time: false, range: [Math.log10(xMinHz), Math.log10(xMaxHz)] },
      y: { auto: true },
    },
    cursor: { drag: { x: true, y: false, uni: 50 }, points: { show: true, size: 4 } },
    series: [
      {},
      { label: 'gyro PSD', stroke: COLORS.trace, width: 1.25 },
    ],
    axes: [
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        // x values are log10(Hz) — pin ticks at decade / half-decade Hz
        // marks, relabelled back to Hz.
        splits: (_u, _axisIdx, scaleMin, scaleMax) =>
          X_TICK_HZ
            .map((hz) => Math.log10(hz))
            .filter((v) => v >= scaleMin - 1e-6 && v <= scaleMax + 1e-6),
        values: (_u, splits) =>
          splits.map((v) => {
            const hz = 10 ** v;
            return hz >= 1 ? `${hz.toFixed(0)} Hz` : `${hz.toFixed(2)} Hz`;
          }),
      },
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        size:   50,
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} dB`),
      },
    ],
    hooks: {
      draw: [drawBands, drawPeaks],
    },
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

function resetZoom() { plot.resetZoom(); }
function selectAxis(id: Axis) { selectedAxis.value = id; }

// --- header / footer text --------------------------------------------

const windowNote = computed(() => {
  const r = result.value;
  if (!ready.value) return '';
  return `window ${r.windowSec.toFixed(0)} s · decimated ${r.decimatedRateHz.toFixed(0)} Hz`;
});

const pendingMessage = computed(() => {
  if (isHydrating.value) return `hydrating ${axisSpec.value.label.toLowerCase()} gyro…`;
  if (!scanReport.value) return 'load a log to scan for airframe modes';
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  if (result.value.tooShort) {
    return 'log too short for low-frequency analysis — airframe modes need '
      + 'a continuous flight segment (tens of seconds minimum; a phugoid needs ~100 s)';
  }
  return 'scanning the sub-3 Hz band…';
});

interface PeakRow {
  key: string;
  mode: string;
  label: string;
  colour: string;
  detail: string;
  suspect: boolean;
}
const peakRows = computed<PeakRow[]>(() =>
  result.value.peaks.map((p, i) => ({
    key: `${p.freqHz}-${i}`,
    mode: p.mode,
    label: MODE_LABEL[p.mode],
    colour: MODE_COLOR[p.mode],
    detail: `${p.freqHz.toFixed(p.freqHz < 1 ? 3 : 2)} Hz · ${p.prominenceDb.toFixed(0)} dB`,
    suspect: !p.bandResolved,
  })),
);
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Airframe modes &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          rigid-body oscillation modes below 3 Hz
          <template v-if="windowNote"> &middot; {{ windowNote }}</template>
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
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
      <!-- detected peaks -->
      <div class="flex flex-wrap gap-1.5 items-center">
        <template v-if="ready && peakRows.length > 0">
          <span
            v-for="row in peakRows"
            :key="row.key"
            class="flex items-center gap-1.5 px-1.5 py-[2px] border font-mono"
            :class="row.suspect ? 'border-dashed' : 'border-solid'"
            :style="{ borderColor: row.colour }"
            :title="row.suspect
              ? 'This peak sits in a band the analysis window was too short to resolve — treat it as suspect.'
              : `Detected ${row.label} mode`"
          >
            <span class="w-2 h-2 inline-block" :style="{ backgroundColor: row.colour }" />
            <span class="text-bp-ink-2">{{ row.label }}</span>
            <span class="text-bp-ink-3">{{ row.detail }}</span>
            <span v-if="row.suspect" class="text-bp-ink-3">· unresolved</span>
          </span>
        </template>
        <span v-else-if="ready" class="font-mono text-bp-ink-3">
          no airframe-mode peaks &middot; clean low-frequency response
        </span>
      </div>

      <!-- per-band resolution -->
      <div v-if="ready" class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-bp-ink-3">
        <span
          v-for="b in axisBands"
          :key="b.name"
          :title="b.resolved
            ? `${b.name} band resolved (needs ${b.requiredWindowSec.toFixed(0)} s, have ${result.windowSec.toFixed(0)} s)`
            : `${b.name} band NOT resolved — needs ${b.requiredWindowSec.toFixed(0)} s of flight, log has ${result.windowSec.toFixed(0)} s`"
        >
          {{ b.name }} {{ b.resolved ? '✓' : '✗' }}
        </span>
      </div>
    </footer>
  </section>
</template>
