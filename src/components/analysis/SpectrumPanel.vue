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
// M1.7 Push 3b — multi-log: every loaded log gets its own PSD per
// axis. Series stroke color is the per-axis hue tinted toward the
// log's family (warm/cool/neutral) so each (log × axis) is visually
// distinct. Filter overlays + sample-rate readout come from the
// first visible log (multi-log filter compare is future polish).
// Per-axis chips toggle the axis across EVERY loaded log via
// `view.toggleSeriesForAllLogs` — clicking R hides roll on every
// log at once, matching the single-log mental model. Logs hidden
// via the roster eye toggle are skipped entirely.
//
// Frequency-axis reconciliation: each log may have a different
// freq axis length (different sample rates or different durations).
// We pick the longest as the reference; shorter logs get their PSD
// padded with NaN past their Nyquist so uPlot doesn't draw a tail.
// Same-plane comparison flights typically share sample rates so
// padding is rare in practice.
//
// Why no cursor integration: this panel is frequency-domain, not
// time-domain. The shared cursor (which tracks time-since-log-start)
// doesn't have a meaningful mapping here. Hovering reads the bin's
// frequency + dB from uPlot's own legend.
//
// Reserved for later (M4 slice 2): airspeed-binned spectra (per-bin
// PSD across the airspeed range — diagnoses speed-dependent
// resonance behaviour). Needs validated M3 airspeed first.

import { computed, ref, watch, watchEffect } from 'vue';
import type { AlignedData, Options, Series } from 'uplot';

import { useSessionStore, type LogState } from '@/stores/session';
import { useActiveLog } from '@/composables/useActiveLog';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { welchPsd, psdToDb, estimateSampleRate } from '@/lib/spectrum';
import { computeDelayBudget, type FilterDelayBudget } from '@/lib/filterDelay';
import { resolveSignal, type Axis } from '@/lib/signalRegistry';
import {
  familyForIndex,
  tintTowardFamily,
  type FamilySpec,
} from '@/lib/logColors';
import { thresholdsFor } from '@/lib/tuneProfile';
import type { FilterConfig, LowPassConfig } from '@/lib/wasmBridge';

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
  /** Base axis hue. The actual stroke color is this tinted toward
   *  the log's family — see `tintTowardFamily`. */
  color: string;
}

const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R', field: 'gyroADC[0]', color: COLORS.accent },
  { id: 1, label: 'Pitch', short: 'P', field: 'gyroADC[1]', color: COLORS.warn },
  { id: 2, label: 'Yaw',   short: 'Y', field: 'gyroADC[2]', color: COLORS.stamp },
];

type DisplayMode = 'filt' | 'raw' | 'both';

const MODE_CHIPS: Array<{ key: DisplayMode; label: string; title: string }> = [
  { key: 'filt', label: 'filt', title: 'Filtered gyro only (gyroADC main-frame)' },
  { key: 'raw',  label: 'raw',  title: 'Raw gyro only (gyroUnfilt main-frame, or DEBUG_GYRO_RAW)' },
  { key: 'both', label: 'both', title: 'Filtered (solid) + raw (dashed) overlaid' },
];

const displayMode = ref<DisplayMode>('filt');

const session = useSessionStore();
const view = useViewStore();
const activeLog = useActiveLog();

// Filter overlay sourced from active (first) log. Multi-log filter
// compare is future polish — would need per-log overlay layers and
// per-log filter chip rows, neither in the Push 3b scope.
const filterConfig = computed<FilterConfig | null>(
  () => activeLog.scanReport.value?.filter_config ?? null,
);
const delayBudget = computed<FilterDelayBudget | null>(() => {
  const fc = filterConfig.value;
  if (!fc) return null;
  return computeDelayBudget(fc);
});

/** Filter-delay badge tone — the warn / red bands track the tune-style
 *  dial (M-Style): a 3D plane tolerates less delay than a cruiser. */
const delayTone = computed(() => {
  const b = delayBudget.value;
  if (!b) return 'text-bp-ink';
  const t = thresholdsFor(view.tuneProfile);
  if (b.totalMs > t.filterDelayBadMs) return 'text-bp-stamp';
  if (b.totalMs > t.filterDelayWarnMs) return 'text-bp-warn';
  return 'text-bp-ink';
});

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

/** Resolve raw-gyro field names per axis for a given log. Each log
 *  may have a different debug_mode → different raw-gyro source. */
function rawGyroNamesFor(log: LogState): (string | null)[] {
  const sr = log.scanReport;
  if (!sr) return [null, null, null];
  return ([0, 1, 2] as Axis[]).map((axis) => {
    const r = resolveSignal('gyro_raw', axis, sr.capability);
    if (r.state !== 'resolved') return null;
    return r.source.kind === 'main_frame'
      ? r.source.field
      : `debug[${r.source.channel}]`;
  });
}

// Eager-hydrate gyro + raw-gyro per log. Re-runs when logs are
// added (visibleEntries changes). `ensureFields` is idempotent so
// re-running on a log whose fields already hydrated is cheap.
watchEffect(() => {
  for (const { log } of logEntries.value) {
    const toHydrate: string[] = [...AXES.map((a) => a.field)];
    for (const n of rawGyroNamesFor(log)) if (n) toHydrate.push(n);
    session.ensureFields(log.id, toHydrate).catch(() => {
      // Hydration failures are surfaced by the session store; the
      // chart just renders without that log's data.
    });
  }
});

type OverlayKey = 'notch' | 'gyro' | 'dterm' | 'rpm';

interface OverlayChip {
  key: OverlayKey;
  label: string;
  color: string;
  present: boolean;
}

const overlayShow = ref<Record<OverlayKey, boolean>>({
  notch: true,
  gyro:  true,
  dterm: true,
  rpm:   true,
});

const OVERLAY_COLORS: Record<OverlayKey, string> = {
  notch: '#ffc46a',
  gyro:  '#b6c7e0',
  dterm: '#7a90b0',
  rpm:   '#7ee0a8',
};

const overlayChips = computed<OverlayChip[]>(() => {
  const fc = filterConfig.value;
  if (!fc) return [];
  const all: OverlayChip[] = [
    { key: 'notch', label: 'notch', color: OVERLAY_COLORS.notch, present: fc.dyn_notch != null },
    { key: 'gyro',  label: 'gyro',  color: OVERLAY_COLORS.gyro,  present: fc.gyro_lpf1 != null || fc.gyro_lpf2 != null },
    { key: 'dterm', label: 'dterm', color: OVERLAY_COLORS.dterm, present: fc.dterm_lpf1 != null || fc.dterm_lpf2 != null },
    { key: 'rpm',   label: 'rpm',   color: OVERLAY_COLORS.rpm,   present: fc.rpm_filter != null },
  ];
  return all.filter((c) => c.present);
});

const rawGyroAvailable = computed(() => {
  for (const { log } of visibleEntries.value) {
    if (rawGyroNamesFor(log).some((n) => n !== null)) return true;
  }
  return false;
});

/** Sample rate of the first visible log. Drives the initial 0-300 Hz
 *  zoom and is used for the header readout. Multi-log compare flights
 *  typically share sample rates; mixed-rate logs would just show the
 *  first log's rate (with each log's own PSD still computed against
 *  its own rate). */
const sampleRateHz = computed(() => {
  const e = visibleEntries.value[0];
  return e ? estimateSampleRate(e.log.time) : 0;
});

const isHydrating = computed(() => {
  for (const { log } of visibleEntries.value) {
    for (const a of AXES) if (log.hydrating.has(a.field)) return true;
    for (const n of rawGyroNamesFor(log)) {
      if (n && log.hydrating.has(n)) return true;
    }
  }
  return false;
});

interface AxisPsd {
  spec: AxisSpec;
  frequencies: Float32Array;
  filteredDb: Float32Array | null;
  rawDb: Float32Array | null;
  numSegments: number;
}

/** Per-log, per-axis PSD computation. Returns one AxisPsd per axis
 *  that has enough samples to produce at least one Welch segment. */
function psdResultsFor(log: LogState): AxisPsd[] {
  const sr = estimateSampleRate(log.time);
  if (sr <= 0) return [];
  const rawNames = rawGyroNamesFor(log);
  const out: AxisPsd[] = [];
  for (const a of AXES) {
    const filteredArr = log.fields.get(a.field);
    const rawName = rawNames[a.id];
    const rawArr = rawName ? log.fields.get(rawName) : undefined;
    const fHas = filteredArr && filteredArr.length >= SEGMENT_LEN;
    const rHas = rawArr && rawArr.length >= SEGMENT_LEN;
    if (!fHas && !rHas) continue;
    const filteredRes = fHas ? welchPsd(filteredArr!, sr, SEGMENT_LEN, 0.5) : null;
    const rawRes      = rHas ? welchPsd(rawArr!, sr, SEGMENT_LEN, 0.5)      : null;
    out.push({
      spec: a,
      frequencies: (filteredRes ?? rawRes!).frequencies,
      filteredDb: filteredRes ? psdToDb(filteredRes.psd) : null,
      rawDb:      rawRes      ? psdToDb(rawRes.psd)      : null,
      numSegments: (filteredRes ?? rawRes!).numSegments,
    });
  }
  return out;
}

interface LogPsd {
  entry: LogEntry;
  results: AxisPsd[];
}

const allPsd = computed<LogPsd[]>(() =>
  visibleEntries.value.map((entry) => ({
    entry,
    results: psdResultsFor(entry.log),
  })),
);

const ready = computed(() =>
  allPsd.value.some((lp) => lp.results.some((r) => r.numSegments > 0)),
);

/** Longest frequency axis across visible logs — used as the shared x.
 *  Shorter logs' PSDs get NaN-padded past their Nyquist. */
const refFrequencies = computed<Float32Array>(() => {
  let best: Float32Array | null = null;
  for (const lp of allPsd.value) {
    for (const r of lp.results) {
      if (!best || r.frequencies.length > best.length) best = r.frequencies;
    }
  }
  return best ?? new Float32Array(0);
});

// Per-log block of series: 3 filtered + 3 raw, in axis order.
// Total series count = 1 (x) + 6 × visibleEntries.length.
const PER_LOG_SERIES = AXES.length * 2;

const data = computed<AlignedData>(() => {
  if (!ready.value || refFrequencies.value.length === 0) {
    return [new Float32Array(0)] as unknown as AlignedData;
  }
  const xLen = refFrequencies.value.length;
  const blank = (): Float32Array => {
    const b = new Float32Array(xLen);
    b.fill(NaN);
    return b;
  };
  const padToRef = (src: Float32Array | null): Float32Array => {
    if (!src) return blank();
    if (src.length === xLen) return src;
    // Source is shorter (lower-Nyquist log) — copy what we have and
    // leave the tail as NaN so uPlot doesn't draw a wrap.
    const out = blank();
    for (let i = 0; i < Math.min(src.length, xLen); i++) out[i] = src[i];
    return out;
  };

  const series: Float32Array[] = [];
  for (const lp of allPsd.value) {
    // filtered block (axis order)
    for (const ax of AXES) {
      const res = lp.results.find((r) => r.spec.id === ax.id);
      series.push(padToRef(res?.filteredDb ?? null));
    }
    // raw block (axis order)
    for (const ax of AXES) {
      const res = lp.results.find((r) => r.spec.id === ax.id);
      series.push(padToRef(res?.rawDb ?? null));
    }
  }
  return [refFrequencies.value, ...series] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const series: Series[] = [{}];
  for (const lp of allPsd.value) {
    const fam = lp.entry.family;
    // filtered traces (solid)
    for (const ax of AXES) {
      const tinted = tintTowardFamily(ax.color, fam);
      series.push({
        label: `${lp.entry.log.name} ${ax.short}`,
        stroke: tinted,
        width: 1.25,
      });
    }
    // raw traces (dashed)
    for (const ax of AXES) {
      const tinted = tintTowardFamily(ax.color, fam);
      series.push({
        label: `${lp.entry.log.name} ${ax.short} raw`,
        stroke: tinted,
        width: 1,
        dash: [4, 3],
      });
    }
  }
  return {
    width: 800,
    height: 300,
    legend: { show: false },
    scales: {
      x: { time: false, auto: false },
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
    hooks: {
      // Filter overlay renderer — sources from the active log's
      // filter config. Reads overlayShow at draw time so chip
      // toggling just needs plot.redraw().
      draw: [
        (u) => {
          const fc = filterConfig.value;
          if (!fc) return;
          const show = overlayShow.value;
          const ctx = u.ctx;
          const top = u.bbox.top;
          const height = u.bbox.height;

          ctx.save();

          if (show.notch && fc.dyn_notch && fc.dyn_notch.min_hz > 0 && fc.dyn_notch.max_hz > fc.dyn_notch.min_hz) {
            const x1 = u.valToPos(fc.dyn_notch.min_hz, 'x', true);
            const x2 = u.valToPos(fc.dyn_notch.max_hz, 'x', true);
            ctx.fillStyle = 'rgba(255, 196, 106, 0.10)';
            ctx.fillRect(x1, top, x2 - x1, height);
            ctx.strokeStyle = 'rgba(255, 196, 106, 0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, top); ctx.lineTo(x1, top + height);
            ctx.moveTo(x2, top); ctx.lineTo(x2, top + height);
            ctx.stroke();
          }

          const drawLpf = (lpf: LowPassConfig | null, color: string) => {
            if (!lpf) return;
            const dynMin = lpf.dyn_min_hz;
            const dynMax = lpf.dyn_max_hz;
            if (dynMin != null && dynMax != null && dynMax > dynMin) {
              const x1 = u.valToPos(dynMin, 'x', true);
              const x2 = u.valToPos(dynMax, 'x', true);
              ctx.fillStyle = color + '1c';
              ctx.fillRect(x1, top, x2 - x1, height);
              ctx.strokeStyle = color + 'aa';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x1, top); ctx.lineTo(x1, top + height);
              ctx.moveTo(x2, top); ctx.lineTo(x2, top + height);
              ctx.stroke();
            } else {
              const fcHz = lpf.static_hz ?? 0;
              if (fcHz <= 0) return;
              const x = u.valToPos(fcHz, 'x', true);
              ctx.strokeStyle = color + 'cc';
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 3]);
              ctx.beginPath();
              ctx.moveTo(x, top); ctx.lineTo(x, top + height);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          };
          if (show.gyro) {
            drawLpf(fc.gyro_lpf1, OVERLAY_COLORS.gyro);
            drawLpf(fc.gyro_lpf2, OVERLAY_COLORS.gyro);
          }
          if (show.dterm) {
            drawLpf(fc.dterm_lpf1, OVERLAY_COLORS.dterm);
            drawLpf(fc.dterm_lpf2, OVERLAY_COLORS.dterm);
          }

          if (show.rpm && fc.rpm_filter) {
            const rpm = fc.rpm_filter;
            const color = OVERLAY_COLORS.rpm;
            if (rpm.min_hz > 0) {
              const x = u.valToPos(rpm.min_hz, 'x', true);
              ctx.strokeStyle = color + 'cc';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x, top); ctx.lineTo(x, top + height);
              ctx.stroke();
            }
            if (rpm.lpf_hz > 0) {
              const x = u.valToPos(rpm.lpf_hz, 'x', true);
              ctx.strokeStyle = color + 'aa';
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 3]);
              ctx.beginPath();
              ctx.moveTo(x, top); ctx.lineTo(x, top + height);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }

          ctx.restore();
        },
      ],
    },
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

// Apply the initial 0-300 Hz view (or up to Nyquist) once per loaded
// log set. Triggers when sampleRateHz changes (new log loaded);
// leaves user zoom alone otherwise.
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

// Sync per-(log × axis × mode) show/hide via uPlot's setSeries.
// Each log block contributes PER_LOG_SERIES = 6 traces (3 filt + 3 raw)
// in stable order: filt R/P/Y then raw R/P/Y.
watch(
  [
    plot.updateCount,
    () => visibleEntries.value.map((e) => e.log.id).join(','),
    () => visibleEntries.value.flatMap((e) =>
      AXES.map((a) => view.isSeriesHidden(e.log.id, a.field)),
    ),
    displayMode,
  ],
  () => {
    const u = plot.instance();
    if (!u) return;
    const mode = displayMode.value;
    const filtAllowed = mode === 'filt' || mode === 'both';
    const rawAllowed  = mode === 'raw'  || mode === 'both';
    let seriesIdx = 1;
    for (const lp of allPsd.value) {
      const logId = lp.entry.log.id;
      // filtered block (3 series)
      for (const ax of AXES) {
        const axisShown = !view.isSeriesHidden(logId, ax.field);
        const show = axisShown && filtAllowed;
        if (u.series[seriesIdx] && u.series[seriesIdx].show !== show) {
          u.setSeries(seriesIdx, { show });
        }
        seriesIdx += 1;
      }
      // raw block (3 series)
      for (const ax of AXES) {
        const axisShown = !view.isSeriesHidden(logId, ax.field);
        const show = axisShown && rawAllowed;
        if (u.series[seriesIdx] && u.series[seriesIdx].show !== show) {
          u.setSeries(seriesIdx, { show });
        }
        seriesIdx += 1;
      }
    }
  },
  { immediate: true },
);

watch([overlayShow, filterConfig], () => plot.redraw(), { deep: true });

function resetZoom() {
  const sr = sampleRateHz.value;
  if (sr <= 0) { plot.resetZoom(); return; }
  plot.instance()?.setScale('x', { min: 0, max: Math.min(300, sr / 2) });
}

/** Per-axis chip click: toggle this axis across EVERY visible log so
 *  the chip stays a single-axis-wide toggle (not "hide R on log 1
 *  only" — that's not what the chip suggests). */
function toggleAxis(field: string) {
  const ids = visibleEntries.value.map((e) => e.log.id);
  view.toggleSeriesForAllLogs(field, ids);
}

/** Axis chip "on" state — true if any visible log shows this axis.
 *  Mirrors the chip's mental model: "any of my logs showing R?" */
function isAxisVisible(field: string): boolean {
  for (const e of visibleEntries.value) {
    if (!view.isSeriesHidden(e.log.id, field)) return true;
  }
  return false;
}

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating gyroADC fields…';
  if (visibleEntries.value.length === 0) return 'no logs loaded';
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  if (allPsd.value.every((lp) => lp.results.length === 0)) {
    return 'no gyroADC fields in the loaded log(s)';
  }
  if (allPsd.value.every((lp) => lp.results.every((r) => r.numSegments === 0))) {
    return `log(s) too short for ${SEGMENT_LEN}-sample window — need ≥ ${SEGMENT_LEN} samples per axis`;
  }
  return 'computing spectrum…';
});

const rawMissingHint = computed(() => {
  if (displayMode.value === 'filt') return null;
  if (rawGyroAvailable.value) return null;
  return 'raw gyro not in this log — enable Blackbox `Gyro (Unfiltered)` (preferred) or set `debug_mode = GYRO_RAW` to log pre-filter gyro for comparison';
});

const segmentInfo = computed(() => {
  const first = allPsd.value[0];
  if (!first || first.results.length === 0) return '';
  const r = first.results[0];
  const sr = estimateSampleRate(first.entry.log.time);
  if (sr <= 0) return '';
  const resolutionHz = sr / SEGMENT_LEN;
  const base = `${SEGMENT_LEN}-pt Welch · ${r.numSegments.toLocaleString()} segments · ${resolutionHz.toFixed(2)} Hz/bin`;
  const n = visibleEntries.value.length;
  if (n > 1) return `${base} · ${n} logs overlaid`;
  return base;
});

const delayBudgetTooltip = computed(() => {
  const b = delayBudget.value;
  if (!b || b.stages.length === 0) return '';
  const lines = b.stages.map(
    (s) => `${s.name} (${s.detail}): ${s.delayMs.toFixed(2)} ms`,
  );
  lines.push(`────────────`);
  lines.push(`total: ${b.totalMs.toFixed(2)} ms`);
  return lines.join('\n');
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

        <div
          v-if="delayBudget && delayBudget.stages.length > 0"
          class="text-right"
          :title="delayBudgetTooltip"
        >
          <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">filter delay</div>
          <div
            class="font-mono text-[13px]"
            :class="delayTone"
          >{{ delayBudget.totalMs.toFixed(1) }} ms</div>
        </div>

        <div v-if="overlayChips.length > 0" class="flex gap-px">
          <button
            v-for="chip in overlayChips"
            :key="chip.key"
            type="button"
            class="px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer whitespace-nowrap"
            :class="overlayShow[chip.key]
              ? 'text-bp-bg border-current'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :style="overlayShow[chip.key] ? { backgroundColor: chip.color, borderColor: chip.color } : {}"
            :aria-pressed="overlayShow[chip.key]"
            :title="`Toggle ${chip.label} overlay`"
            @click="overlayShow[chip.key] = !overlayShow[chip.key]"
          >{{ chip.label }}</button>
        </div>

        <div class="flex gap-px">
          <button
            v-for="chip in MODE_CHIPS"
            :key="chip.key"
            type="button"
            class="px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer whitespace-nowrap"
            :class="displayMode === chip.key
              ? 'bg-bp-accent text-bp-bg border-bp-accent'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :aria-pressed="displayMode === chip.key"
            :title="chip.title"
            @click="displayMode = chip.key"
          >{{ chip.label }}</button>
        </div>

        <!-- axis toggle chips — toggle this axis across every loaded log -->
        <div class="flex gap-px">
          <button
            v-for="ax in AXES"
            :key="ax.id"
            type="button"
            class="px-2.5 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer"
            :class="isAxisVisible(ax.field)
              ? 'text-bp-bg border-current'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :style="isAxisVisible(ax.field) ? { backgroundColor: ax.color, borderColor: ax.color } : {}"
            :aria-pressed="isAxisVisible(ax.field)"
            :title="`Toggle ${ax.label} (across all loaded logs)`"
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
      <div
        v-else-if="rawMissingHint"
        class="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 bg-bp-surface-2 border border-bp-warn font-mono text-[10.5px] text-bp-warn"
      >
        {{ rawMissingHint }}
      </div>
      <div ref="hostRef" class="w-full relative" />
    </div>

    <footer
      class="flex flex-wrap justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px] gap-y-1"
    >
      <div class="flex flex-wrap gap-x-4 gap-y-1 items-center font-sans text-bp-ink-2">
        <!-- per-log legend: family-tinted dot + filename -->
        <span
          v-for="lp in allPsd"
          :key="lp.entry.log.id"
          class="flex items-center gap-1.5"
        >
          <span
            class="inline-block w-2 h-2 rounded-full"
            :style="{ background: lp.entry.family.primary }"
          />
          <span class="font-mono text-bp-ink-3 truncate max-w-[160px]">
            {{ lp.entry.log.name }}
          </span>
        </span>
        <span v-if="allPsd.length === 0" class="text-bp-ink-3">no visible logs</span>
      </div>
      <div class="font-mono text-bp-ink-3">
        drag to zoom &middot; axis chips toggle every log
      </div>
    </footer>
  </section>
</template>
