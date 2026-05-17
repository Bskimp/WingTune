<script setup lang="ts">
// Spectrum panel — gyro power spectral density per axis via Welch's
// method. The first frequency-domain surface in WingTune; useful for
// filter tuning (find resonance peaks, evaluate notch coverage) and
// diagnosing oscillation sources.
//
// What's real: every sample of hydrated `gyroADC[i]` goes through a
// 1024-point Hann-windowed Welch periodogram (50% overlap) for clean
// resonance peaks on noisy real-world data. PSD plotted in dB
// (10·log10) on linear y, linear x in Hz.
//
// Why no cursor integration: this panel is frequency-domain, not
// time-domain. The shared cursor (which tracks time-since-log-start)
// doesn't have a meaningful mapping here. Hovering reads the bin's
// frequency + dB from uPlot's own legend.
//
// Reserved for later (M4 slice 2): airspeed-binned spectra (per-bin
// PSD across the airspeed range — diagnoses speed-dependent
// resonance behaviour). Needs validated M3 airspeed first.

import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options } from 'uplot';

import { useLogStore } from '@/stores/log';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { welchPsd, psdToDb, estimateSampleRate } from '@/lib/spectrum';

const COLORS = {
  ink3:   '#7a90b0',
  ink2:   '#b6c7e0',
  line:   '#1f3a5a',
  accent: '#7ec8ff',
  warn:   '#ffc46a',
  stamp:  '#ff6a6a',
} as const;

const SEGMENT_LEN = 1024;

interface AxisSpec {
  id: 0 | 1 | 2;
  label: string;
  short: 'R' | 'P' | 'Y';
  field: string;
  color: string;
}

const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R', field: 'gyroADC[0]', color: COLORS.accent },
  { id: 1, label: 'Pitch', short: 'P', field: 'gyroADC[1]', color: COLORS.warn },
  { id: 2, label: 'Yaw',   short: 'Y', field: 'gyroADC[2]', color: COLORS.stamp },
];

const logStore = useLogStore();
const view = useViewStore();
const { time, fields, hydrating } = storeToRefs(logStore);

onMounted(() => {
  logStore.ensureFields(AXES.map((a) => a.field));
});

const isHydrating = computed(
  () => AXES.some((a) => hydrating.value.has(a.field)),
);

const sampleRateHz = computed(() => estimateSampleRate(time.value));

interface AxisPsd {
  spec: AxisSpec;
  frequencies: Float32Array;
  db: Float32Array;
  numSegments: number;
}

const psdResults = computed<AxisPsd[]>(() => {
  const sr = sampleRateHz.value;
  if (sr <= 0) return [];
  const out: AxisPsd[] = [];
  for (const a of AXES) {
    const arr = fields.value.get(a.field);
    if (!arr || arr.length === 0) continue;
    const r = welchPsd(arr, sr, SEGMENT_LEN, 0.5);
    out.push({
      spec: a,
      frequencies: r.frequencies,
      db: psdToDb(r.psd),
      numSegments: r.numSegments,
    });
  }
  return out;
});

const ready = computed(() => {
  if (psdResults.value.length === 0) return false;
  // At least one axis must have had enough samples to produce segments.
  return psdResults.value.some((r) => r.numSegments > 0);
});

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    return [new Float32Array(0)] as unknown as AlignedData;
  }
  // All axes share the same frequency axis (same sample rate + segment
  // length), so series align to psdResults[0].frequencies. We always
  // emit the real db values for every axis — the show/hide toggle is
  // applied through uPlot's `series[i].show` imperatively below, which
  // doesn't pollute the data array with NaN (NaN-fill breaks uPlot's
  // y-auto-range: all-NaN series produce NaN min/max which propagates
  // to the other series and blanks the whole chart).
  const base = psdResults.value[0];
  const axes: Float32Array[] = AXES.map((a) => {
    const found = psdResults.value.find((r) => r.spec.id === a.id);
    if (found) return found.db;
    // Axis genuinely has no data (e.g. gyroADC[2] missing) — NaN-fill
    // is OK here because the series will be set to show=false too.
    const blank = new Float32Array(base.frequencies.length);
    blank.fill(NaN);
    return blank;
  });
  return [base.frequencies, ...axes] as unknown as AlignedData;
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 300,
  legend: { show: false },
  scales: {
    // auto:false on x so setData doesn't re-stretch the scale to the
    // full Nyquist data extent on every refresh — leaves our imperative
    // setScale (and the user's drag-zoom, which also uses setScale)
    // as the only things that move the x bounds. y stays auto so
    // toggling an axis can rescale to the visible peaks.
    x: { time: false, auto: false },
    y: { auto: true },
  },
  cursor: {
    drag: { x: true, y: false, uni: 50 },
    focus: { prox: 30 },
    points: { show: true, size: 4 },
  },
  series: [
    {},
    { label: 'roll',  stroke: COLORS.accent, width: 1.25 },
    { label: 'pitch', stroke: COLORS.warn,   width: 1.25 },
    { label: 'yaw',   stroke: COLORS.stamp,  width: 1.25 },
  ],
  axes: [
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} Hz`),
    },
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      size:   50,
      values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} dB`),
    },
  ],
}));

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

// Apply the initial 0-300 Hz view (or up to Nyquist) once per loaded
// log. Triggers when sampleRateHz changes (new log load); leaves user
// zoom alone otherwise. updateCount in the dep list ensures we fire
// AFTER setData has populated the chart — calling setScale on a
// pre-data plot is harmless but the post-data call is the one that
// sticks.
let lastAppliedSampleRate = 0;
watch(
  [plot.updateCount, sampleRateHz],
  () => {
    const sr = sampleRateHz.value;
    if (sr <= 0) return;
    if (!ready.value) return;
    if (sr === lastAppliedSampleRate) return;
    const maxHz = Math.min(300, sr / 2);
    plot.instance()?.setScale('x', { min: 0, max: maxHz });
    lastAppliedSampleRate = sr;
  },
);

// Sync per-axis show/hide via uPlot's setSeries — keeps data clean and
// doesn't trigger a chart rebuild (vs flipping series.show via opts).
// Re-applies on plot.updateCount in case a rebuild reset the series
// state to its default (show=true).
watch(
  [plot.updateCount, () => AXES.map((a) => view.isSeriesHidden(a.field))],
  () => {
    const u = plot.instance();
    if (!u) return;
    AXES.forEach((a, i) => {
      const hidden = view.isSeriesHidden(a.field);
      const idx = i + 1; // series 0 is the x axis
      if (!u.series[idx]) return;
      const shouldShow = !hidden;
      if (u.series[idx].show !== shouldShow) {
        u.setSeries(idx, { show: shouldShow });
      }
    });
  },
  { immediate: true },
);

function resetZoom() {
  // Override the default resetZoom (which resets to data extent) so
  // the reset goes back to the initial 0-300 Hz view, not the full
  // 0-Nyquist data range — that's what the user expects from the
  // chip-corner button.
  const sr = sampleRateHz.value;
  if (sr <= 0) { plot.resetZoom(); return; }
  plot.instance()?.setScale('x', { min: 0, max: Math.min(300, sr / 2) });
}

function toggleAxis(field: string) {
  view.toggleSeries(field);
}

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating gyroADC fields…';
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  const missing = AXES.filter((a) => {
    const arr = fields.value.get(a.field);
    return !arr || arr.length === 0;
  });
  if (missing.length === AXES.length) return 'no gyroADC fields in this log';
  if (psdResults.value.every((r) => r.numSegments === 0)) {
    return `log too short for ${SEGMENT_LEN}-sample window — need ≥ ${SEGMENT_LEN} samples per axis`;
  }
  return 'computing spectrum…';
});

const segmentInfo = computed(() => {
  const r = psdResults.value[0];
  if (!r || sampleRateHz.value <= 0) return '';
  const resolutionHz = sampleRateHz.value / SEGMENT_LEN;
  return `${SEGMENT_LEN}-pt Welch · ${r.numSegments.toLocaleString()} segments · ${resolutionHz.toFixed(2)} Hz/bin`;
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header
      class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3"
    >
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Gyro spectrum &middot; PSD per axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          {{ ready ? segmentInfo : 'Hann window · 50% overlap' }}
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="sampleRateHz > 0" class="text-right">
          <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">sample rate</div>
          <div class="font-mono text-[13px] text-bp-ink">{{ sampleRateHz.toFixed(0) }} Hz</div>
        </div>

        <!-- axis toggle chips (per-axis show/hide via view.hiddenSeries) -->
        <div class="flex gap-px">
          <button
            v-for="ax in AXES"
            :key="ax.id"
            type="button"
            class="px-2.5 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer"
            :class="!view.isSeriesHidden(ax.field)
              ? 'text-bp-bg border-current'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :style="!view.isSeriesHidden(ax.field) ? { backgroundColor: ax.color, borderColor: ax.color } : {}"
            :aria-pressed="!view.isSeriesHidden(ax.field)"
            :title="`Toggle ${ax.label}`"
            @click="toggleAxis(ax.field)"
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

    <div class="relative px-3 py-3 min-h-[316px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        {{ pendingMessage }}
      </div>
      <div ref="hostRef" class="w-full relative" />
    </div>

    <footer
      class="flex justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px]"
    >
      <div class="flex gap-4 items-center font-sans text-bp-ink-2">
        <span
          v-for="ax in AXES"
          :key="ax.id"
          class="flex items-center gap-1.5"
          :class="view.isSeriesHidden(ax.field) ? 'opacity-40' : ''"
        >
          <span
            class="inline-block w-3.5 h-0.5"
            :style="{ backgroundColor: ax.color }"
          />
          {{ ax.label.toLowerCase() }}
        </span>
      </div>
      <div class="font-mono text-bp-ink-3">
        drag to zoom &middot; click an axis chip to toggle
      </div>
    </footer>
  </section>
</template>
