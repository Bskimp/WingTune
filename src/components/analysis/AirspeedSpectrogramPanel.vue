<script setup lang="ts">
// S2 — airspeed-resolved spectrogram.
//
// M4's whole-log Welch PSD averages every windowed periodogram into one
// spectrum — it assumes the gyro spectrum is stationary across the flight.
// On a wing it is not: the plant scales with airspeed, and control-surface
// buzz / flutter precursors onset AT A SPEED. This panel bins the STFT
// columns of the gyro by the airspeed at each column's centre time, so the
// result is an airspeed x frequency heatmap — a peak that climbs the
// airspeed axis is a speed-dependent resonance, exactly what a whole-log
// PSD smears away.
//
// Airspeed source toggle:
//   · model — the M3 BASIC physical estimate, re-integrated over the
//     whole log (continuous, full-rate, GPS-anchored via the fit).
//   · GPS   — gps:GPS_speed resampled onto the main frame (measured
//     groundspeed; laggy, stepped, and carries wind error).
// Both need GPS frames — the model is anchored to GPS by its fit.
//
// Single-log (useActiveLog) + per-axis — a focus-one task, like
// FilterSimPanel. Stacked on the Spectrum tab.

import { computed, onMounted, ref, watch } from 'vue';
import type uPlot from 'uplot';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useUPlot } from '@/composables/useUPlot';
import { estimateSampleRate } from '@/lib/spectrum';
import type { Axis } from '@/lib/signalRegistry';
import {
  binStftByAirspeed,
  type AirspeedSpectrogram,
} from '@/lib/airspeedSpectrogram';
import { buildWholeLogAirspeed, resolveAirspeedPitchField } from '@/lib/airspeedFit';
import { resampleToTimeAxis } from '@/lib/timeAlign';

const COLORS = {
  ink3: '#7a90b0',
  line: '#1f3a5a',
} as const;

type Tone = 'ok' | 'warn' | 'stamp';
const TONE_COLOR: Record<Tone, string> = {
  ok:    'var(--color-bp-ok)',
  warn:  'var(--color-bp-warn)',
  stamp: 'var(--color-bp-stamp)',
};

/** STFT window — 256 samples (~0.26 s / ~3.9 Hz bins at 1 kHz). Short
 *  enough to yield many columns for the airspeed binning. */
const WINDOW_SIZE = 256;
const HOP_SIZE = WINDOW_SIZE >> 1;
const AIRSPEED_BINS = 20;
/** Frequency ceiling for the heatmap — the wing band plus headroom. */
const MAX_FREQ_HZ = 250;
/** Colormap dynamic range cap, dB — keeps contrast on the meaningful band. */
const DB_SPAN = 60;
/** Frequency below which a bin is excluded from the colormap auto-range.
 *  Wing gyro carries huge sub-10 Hz energy (maneuver roll-rate, setpoint
 *  following — see the CLAUDE.md SCOPE box) that would otherwise stretch
 *  the dB range and wash out the resonance band above it. The low band is
 *  still DRAWN — it just clips to the top of the colormap. The sub-3 Hz
 *  airframe modes get their own dedicated view (S2 low-frequency modes). */
const COLORMAP_FLOOR_HZ = 8;

// Spectrogram colormap — dark navy (quiet) through to orange-red (loud).
const COLORMAP: ReadonlyArray<readonly [number, number, number]> = [
  [10, 24, 48],    // navy
  [31, 74, 138],   // blue
  [43, 176, 200],  // cyan
  [111, 217, 138], // green
  [255, 210, 74],  // yellow
  [255, 122, 74],  // orange-red
];
const COLORMAP_STOPS = [0, 0.25, 0.5, 0.7, 0.85, 1] as const;
const COLORBAR_CSS = `linear-gradient(to right, ${COLORMAP.map(
  (c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${COLORMAP_STOPS[i] * 100}%`,
).join(', ')})`;

function heatColor(t: number): [number, number, number] {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let i = 0;
  while (i < COLORMAP_STOPS.length - 2 && x > COLORMAP_STOPS[i + 1]) i++;
  const lo = COLORMAP_STOPS[i];
  const hi = COLORMAP_STOPS[i + 1];
  const f = hi > lo ? (x - lo) / (hi - lo) : 0;
  const a = COLORMAP[i];
  const b = COLORMAP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Linear PSD → decibels, floored to avoid −Infinity on zero bins. */
function toDb(v: number): number {
  return v > 1e-12 ? 10 * Math.log10(v) : -120;
}

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
  // resampleToTimeAxis endpoint-clamps outside the GPS-lock window — the
  // pre-/post-lock columns inherit the edge speed (a minor wart vs the
  // model source, which is continuous everywhere).
  return resampleToTimeAxis(gpsTimeSec.value, gps, time.value);
});

const airspeed = computed<Float32Array | null>(() =>
  airspeedSource.value === 'model'
    ? modelAirspeed.value?.airspeed ?? null
    : gpsAirspeed.value,
);

const spectrogram = computed<AirspeedSpectrogram | null>(() => {
  const g = gyro.value;
  const a = airspeed.value;
  const sr = sampleRateHz.value;
  if (!g || !a || sr <= 0 || g.length < WINDOW_SIZE) return null;
  return binStftByAirspeed(g, a, sr, {
    windowSize: WINDOW_SIZE,
    hopSize: HOP_SIZE,
    airspeedBinCount: AIRSPEED_BINS,
  });
});

const ready = computed(
  () => spectrogram.value !== null && spectrogram.value.columnsBinned > 0,
);

const maxFreq = computed(() => {
  const ny = sampleRateHz.value / 2;
  return ny > 0 ? Math.min(MAX_FREQ_HZ, ny) : MAX_FREQ_HZ;
});

/** dB range over the finite cells in the resonance band — drives the
 *  colormap normalisation + the colorbar labels. Bins between
 *  COLORMAP_FLOOR_HZ and maxFreq only: the sub-8 Hz wing-maneuver energy
 *  is excluded so it can't stretch the range and wash out the resonances
 *  above it (those low bins still render — they just clip to full-red). */
const dbRange = computed<{ min: number; max: number }>(() => {
  const sg = spectrogram.value;
  if (!sg) return { min: -DB_SPAN, max: 0 };
  let mn = Infinity;
  let mx = -Infinity;
  for (const row of sg.grid) {
    for (let f = 0; f < row.length; f++) {
      const fv = sg.frequencies[f];
      if (fv > maxFreq.value) break;
      if (fv < COLORMAP_FLOOR_HZ) continue;
      const v = row[f];
      if (!Number.isFinite(v)) continue;
      const db = toDb(v);
      if (db < mn) mn = db;
      if (db > mx) mx = db;
    }
  }
  if (!Number.isFinite(mx)) return { min: -DB_SPAN, max: 0 };
  return { min: Math.max(mn, mx - DB_SPAN), max: mx };
});

// --- honesty: a poor airspeed fit makes the x-axis unreliable --------

const fitTone = computed<Tone>(() => {
  if (airspeedSource.value !== 'model') return 'ok';
  const r = modelAirspeed.value?.rSquared;
  if (r === undefined) return 'ok';
  return r >= 0.7 ? 'ok' : r >= 0.4 ? 'warn' : 'stamp';
});

// --- heatmap rendering (uPlot draw hook) -----------------------------

function drawHeatmap(u: uPlot): void {
  const sg = spectrogram.value;
  if (!sg) return;
  const { min: dbMin, max: dbMax } = dbRange.value;
  const span = dbMax - dbMin;
  if (!(span > 0)) return;
  const ctx = u.ctx;
  const half = sg.binHz / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  ctx.clip();

  for (let a = 0; a < sg.grid.length; a++) {
    const xL = u.valToPos(sg.airspeedEdges[a], 'x', true);
    const xR = u.valToPos(sg.airspeedEdges[a + 1], 'x', true);
    const row = sg.grid[a];
    // Under-sampled airspeed bins drawn faint — the coverage honesty
    // signal (too few STFT columns to trust the average).
    const alpha = sg.underSampled[a] ? 0.28 : 1;
    for (let f = 0; f < row.length; f++) {
      const fv = sg.frequencies[f];
      if (fv > maxFreq.value) break;
      const v = row[f];
      if (!Number.isFinite(v)) continue; // empty bin → leave blank
      const t = (toDb(v) - dbMin) / span;
      const [r, g, b] = heatColor(t);
      const yT = u.valToPos(fv + half, 'y', true);
      const yB = u.valToPos(fv - half, 'y', true);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(xL, yT, xR - xL + 0.6, yB - yT + 0.6);
    }
  }
  ctx.restore();
}

// --- hover readout ----------------------------------------------------

const readout = ref<string | null>(null);

function onCursor(u: uPlot): void {
  const sg = spectrogram.value;
  const left = u.cursor.left;
  const top = u.cursor.top;
  if (!sg || left == null || top == null || left < 0 || top < 0) {
    readout.value = null;
    return;
  }
  const spd = u.posToVal(left, 'x');
  const frq = u.posToVal(top, 'y');
  // Locate the airspeed bin (edges are ascending).
  let a = -1;
  for (let i = 0; i < sg.grid.length; i++) {
    if (spd >= sg.airspeedEdges[i] && spd <= sg.airspeedEdges[i + 1]) { a = i; break; }
  }
  const f = sg.binHz > 0 ? Math.round(frq / sg.binHz) : -1;
  if (a < 0 || f < 0 || f >= sg.frequencies.length) {
    readout.value = null;
    return;
  }
  const v = sg.grid[a][f];
  const dbTxt = Number.isFinite(v) ? `${toDb(v).toFixed(1)} dB` : 'no data';
  readout.value = `${spd.toFixed(1)} m/s · ${sg.frequencies[f].toFixed(0)} Hz · ${dbTxt}`;
}

// --- chart wiring -----------------------------------------------------

const data = computed<AlignedData>(() => {
  const sg = spectrogram.value;
  if (!sg) return [new Float32Array([0, 1]), new Float32Array([0, 1])] as unknown as AlignedData;
  // Two anchor points only — the heatmap itself is painted in the draw
  // hook; the dummy series exists purely to give uPlot data to mount.
  return [
    new Float32Array([sg.airspeedEdges[0], sg.airspeedEdges[sg.airspeedEdges.length - 1]]),
    new Float32Array([0, maxFreq.value]),
  ] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const sg = spectrogram.value;
  const xRange: [number, number] = sg
    ? [sg.airspeedEdges[0], sg.airspeedEdges[sg.airspeedEdges.length - 1]]
    : [0, 1];
  return {
    width: 800,
    height: 320,
    legend: { show: false },
    scales: {
      x: { time: false, range: xRange },
      y: { range: [0, maxFreq.value] },
    },
    cursor: { drag: { x: false, y: false }, points: { show: false } },
    series: [
      {},
      { stroke: 'transparent', width: 0, points: { show: false }, scale: 'y' },
    ],
    axes: [
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} m/s`),
      },
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        size:   54,
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} Hz`),
      },
    ],
    hooks: {
      draw: [drawHeatmap],
      setCursor: [onCursor],
    },
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
useUPlot({ target: hostRef, data, opts });

function selectAxis(id: Axis) { selectedAxis.value = id; }
function selectSource(s: Source) { airspeedSource.value = s; }

// --- header / footer text --------------------------------------------

const coverageNote = computed(() => {
  const sg = spectrogram.value;
  if (!sg) return '';
  let occupied = 0;
  let under = 0;
  for (let i = 0; i < sg.columnsPerBin.length; i++) {
    if (sg.columnsPerBin[i] > 0) {
      occupied++;
      if (sg.underSampled[i]) under++;
    }
  }
  const parts = [`${sg.columnsBinned} STFT columns`, `${occupied}/${AIRSPEED_BINS} speed bins`];
  if (under > 0) parts.push(`${under} under-sampled (faded)`);
  return parts.join(' · ');
});

const fitNote = computed(() => {
  if (airspeedSource.value !== 'model') return '';
  const m = modelAirspeed.value;
  if (!m) return '';
  const bits = [`BASIC fit R² ${m.rSquared.toFixed(2)}`];
  if (m.pitchFromFallback) bits.push('no pitch — level flight assumed');
  return bits.join(' · ');
});

const pendingMessage = computed(() => {
  if (isHydrating.value) return `hydrating ${axisSpec.value.label.toLowerCase()} gyro + airspeed fields…`;
  if (!scanReport.value) return 'load a log to build the airspeed spectrogram';
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  if (gyro.value && gyro.value.length < WINDOW_SIZE) {
    return `log too short for a ${WINDOW_SIZE}-sample STFT window`;
  }
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
  if (spectrogram.value && spectrogram.value.columnsBinned === 0) {
    return 'no airspeed-resolved columns — every STFT window fell on a GPS dropout';
  }
  return 'binning the spectrogram…';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Airspeed spectrogram &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          gyro PSD binned by airspeed &middot; a peak that climbs the speed axis is a speed-dependent resonance
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div
          v-if="ready && readout"
          class="font-mono text-[11px] text-bp-ink-2 whitespace-nowrap"
        >{{ readout }}</div>

        <!-- airspeed source -->
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
              ? 'M3 BASIC physical airspeed estimate, re-integrated over the whole log (continuous, GPS-anchored)'
              : 'GPS groundspeed resampled onto the main frame (measured, but laggy and wind-affected)'"
            @click="selectSource(s)"
          >{{ s === 'model' ? 'model' : 'GPS' }}</button>
        </div>

        <!-- axis selector -->
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
      </div>
    </header>

    <div class="relative px-3 py-3 min-h-[336px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        {{ pendingMessage }}
      </div>
      <div
        v-else-if="fitTone === 'stamp'"
        class="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 bg-bp-surface-2 border border-bp-stamp font-mono text-[10.5px] text-bp-stamp text-center"
      >
        BASIC airspeed fit is poor — the airspeed axis is unreliable on this log
      </div>
      <div ref="hostRef" class="w-full relative" />
    </div>

    <footer class="flex flex-wrap justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px] gap-y-1.5 gap-x-3">
      <div
        class="flex items-center gap-2 font-sans text-bp-ink-2 cursor-help"
        title="Colour scale spans the resonance band (8 Hz and up). The louder sub-8 Hz wing-maneuver energy is excluded from the range so it can't wash out the resonances — those low bins still render, clipped to full red."
      >
        <span class="text-bp-ink-3">quiet</span>
        <span
          class="inline-block w-24 h-2.5 border border-bp-line-2"
          :style="{ background: COLORBAR_CSS }"
        />
        <span class="text-bp-ink-3">loud</span>
        <span v-if="ready" class="font-mono text-bp-ink-3">
          {{ dbRange.min.toFixed(0) }} … {{ dbRange.max.toFixed(0) }} dB &middot; &gt;8 Hz
        </span>
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 items-center font-mono text-bp-ink-3">
        <span v-if="fitNote" :style="fitTone !== 'ok' ? { color: TONE_COLOR[fitTone] } : undefined">
          {{ fitNote }}
        </span>
        <span v-if="coverageNote">{{ coverageNote }}</span>
        <span>STFT {{ WINDOW_SIZE }} &middot; hop {{ HOP_SIZE }}</span>
      </div>
    </footer>
  </section>
</template>
