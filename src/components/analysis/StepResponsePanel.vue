<script setup lang="ts">
// Closed-loop step response — per-axis "what does the plane do when
// commanded a step in setpoint?" via Wiener deconvolution
// (lib/stepResponse.ts). Single-axis view matches PIDtoolbox /
// Plasmatree convention since R/P/Y curves often differ enough that
// overlay obscures detail.
//
// M1.7 Push 3b — multi-log: every loaded log produces its own step
// response for the selected axis; curves are overlaid with per-log
// tinted colors (axis base hue → log family). Stats in the header
// (peak %, settle time) belong to the FIRST visible log because
// per-log columns blow out at N≥3 and the dominant tuning question
// is usually "is THIS log's response cleaner than that one?" —
// answered by visual overlay, not by a table.
//
// Reference line at y=1.0 = perfect tracking (the plane responds
// instantly to the commanded setpoint and holds). Real responses ramp
// up to 1.0 (sluggish) or overshoot above (aggressive PID).
//
// Metrics (PIDscope-aligned, wing-scaled — see lib/stepResponse.ts):
// · peak = max(response within first 400 ms after t=0). NOT global
//   max. PIDscope uses 150 ms for quads; wing closed-loop is 200-500
//   ms so 400 ms captures actual overshoot, not the rising shoulder.
// · latency = first time response crosses 0.5 (50% of unit-step ideal).
//   NaN when response never reaches 0.5 within the peak window.
// · numSegments = how many manoeuvre windows passed the setpoint-peak
//   gate (50 deg/s).
//
// FF / S caveat: this panel measures FULL closed-loop response as
// flown — P/I/D/F/S all contributing. For PIDtoolbox/PIDscope
// PD-isolation workflow comparability, F and S gains must be zeroed
// in BF before flight. A yellow caveat stamp surfaces when the
// selected axis has non-zero axisF or axisS in the log so the user
// knows whether they're looking at a PD-isolated curve or a real
// flying-config response.

import { computed, ref, watch, watchEffect } from 'vue';
import type { AlignedData, Options, Series } from 'uplot';

import { useSessionStore, type LogState } from '@/stores/session';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { estimateSampleRate } from '@/lib/spectrum';
import { computeStepResponse, type StepResponseResult } from '@/lib/stepResponse';
import {
  familyForIndex,
  tintTowardFamily,
  type FamilySpec,
} from '@/lib/logColors';

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
  /** Base axis hue. Per-log render tints toward family. */
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

const session = useSessionStore();
const view = useViewStore();

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

// Eager-hydrate setpoint + gyro for the selected axis on every loaded
// log. Re-runs when selectedAxis changes or logs are added.
watchEffect(() => {
  const a = axisSpec.value;
  for (const { log } of logEntries.value) {
    session.ensureFields(log.id, [a.setpoint, a.gyro]).catch(() => {
      // Hydration failures surface on the log's scanError; this
      // panel just skips that log's curve.
    });
  }
});

interface LogStepResult {
  entry: LogEntry;
  result: StepResponseResult | null;
}

const allStep = computed<LogStepResult[]>(() => {
  const a = axisSpec.value;
  const out: LogStepResult[] = [];
  for (const entry of visibleEntries.value) {
    const sp = entry.log.fields.get(a.setpoint);
    const gy = entry.log.fields.get(a.gyro);
    const sr = estimateSampleRate(entry.log.time);
    if (!sp || !gy || sr <= 0 || sp.length < SEGMENT_LEN || gy.length < SEGMENT_LEN) {
      out.push({ entry, result: null });
      continue;
    }
    const result = computeStepResponse(sp, gy, sr, {
      segmentLen: SEGMENT_LEN,
      windowSec: WINDOW_SEC,
    });
    out.push({ entry, result });
  }
  return out;
});

const isHydrating = computed(() => {
  const a = axisSpec.value;
  for (const { log } of visibleEntries.value) {
    if (log.hydrating.has(a.setpoint) || log.hydrating.has(a.gyro)) return true;
  }
  return false;
});

const ready = computed(() =>
  allStep.value.some((lr) => lr.result !== null && lr.result.numSegments > 0),
);

/** Reference response-time axis: longest response.time across visible
 *  logs (all should be ~WINDOW_SEC samples but sample rates may
 *  differ). Shorter ones pad with NaN. */
const refTime = computed<Float32Array>(() => {
  let best: Float32Array | null = null;
  for (const lr of allStep.value) {
    if (lr.result && (!best || lr.result.time.length > best.length)) {
      best = lr.result.time;
    }
  }
  return best ?? new Float32Array(0);
});

const data = computed<AlignedData>(() => {
  if (!ready.value || refTime.value.length === 0) {
    return [new Float32Array(0)] as unknown as AlignedData;
  }
  const xLen = refTime.value.length;
  const blank = (): Float32Array => {
    const b = new Float32Array(xLen);
    b.fill(NaN);
    return b;
  };
  const padToRef = (src: Float32Array | null): Float32Array => {
    if (!src) return blank();
    if (src.length === xLen) return src;
    const out = blank();
    for (let i = 0; i < Math.min(src.length, xLen); i++) out[i] = src[i];
    return out;
  };
  const series: Float32Array[] = [];
  for (const lr of allStep.value) {
    series.push(padToRef(lr.result?.response ?? null));
  }
  return [refTime.value, ...series] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const ax = axisSpec.value;
  const series: Series[] = [{}];
  for (const lr of allStep.value) {
    const tinted = tintTowardFamily(ax.color, lr.entry.family);
    series.push({
      label: `${lr.entry.log.name} ${ax.short}`,
      stroke: tinted,
      width: 1.5,
    });
  }
  return {
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
    series,
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
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

// Per-log visibility sync via uPlot setSeries. Series order matches
// allStep iteration (one series per log).
watch(
  [
    plot.updateCount,
    () => visibleEntries.value.map((e) => e.log.id).join(','),
    () => visibleEntries.value.map((e) => view.isSeriesHidden(e.log.id, 'step')),
  ],
  () => {
    const u = plot.instance();
    if (!u) return;
    allStep.value.forEach((lr, i) => {
      const show = !view.isSeriesHidden(lr.entry.log.id, 'step');
      if (u.series[i + 1] && u.series[i + 1].show !== show) {
        u.setSeries(i + 1, { show });
      }
    });
  },
  { immediate: true },
);

function resetZoom() { plot.resetZoom(); }
function selectAxis(id: 0 | 1 | 2) { selectedAxis.value = id; }

// Stats anchor on the FIRST visible log with a successful result.
// Per-log column would be the natural multi-log evolution but at
// N≥3 it crowds the header; visual overlay carries the comparison.
const firstResult = computed<StepResponseResult | null>(() => {
  for (const lr of allStep.value) {
    if (lr.result && lr.result.numSegments > 0) return lr.result;
  }
  return null;
});

const pendingMessage = computed(() => {
  if (visibleEntries.value.length === 0) return 'no logs loaded';
  if (isHydrating.value) return `hydrating ${axisSpec.value.label.toLowerCase()} setpoint + gyro…`;
  const anyHasFields = allStep.value.some(
    (lr) => lr.entry.log.fields.get(axisSpec.value.setpoint)?.length &&
            lr.entry.log.fields.get(axisSpec.value.gyro)?.length,
  );
  if (!anyHasFields) {
    return `${axisSpec.value.label.toLowerCase()} setpoint or gyro field missing from the loaded log(s)`;
  }
  const anyEnoughSamples = allStep.value.some(
    (lr) => (lr.entry.log.fields.get(axisSpec.value.setpoint)?.length ?? 0) >= SEGMENT_LEN,
  );
  if (!anyEnoughSamples) {
    return `log(s) too short for ${SEGMENT_LEN}-sample analysis window — need ≥ ${SEGMENT_LEN} samples`;
  }
  if (allStep.value.every((lr) => lr.result === null || lr.result.numSegments === 0)) {
    return `setpoint never exceeded the deconvolution gate — fly more aggressive manoeuvres on ${axisSpec.value.label.toLowerCase()} to characterize the step response`;
  }
  return 'computing step response…';
});

const latencyText = computed(() => {
  const r = firstResult.value;
  if (!r || !Number.isFinite(r.latencyMs)) return '—';
  return `${r.latencyMs.toFixed(0)} ms`;
});

/** Detect non-zero F/S contribution on the selected axis from scan-time
 *  sample_check magnitudes. Avoids hydrating the axisF/axisS arrays
 *  just to answer "are these terms active?" — the M1.7.2 value_min /
 *  value_max metadata answers it directly. Threshold of 1.0 (deg/s
 *  equivalent) dodges noise floor while catching any real contribution. */
const ffsActive = computed<{ f: boolean; s: boolean }>(() => {
  const first = visibleEntries.value[0];
  if (!first) return { f: false, s: false };
  const cap = first.log.scanReport?.capability;
  if (!cap?.sample_check) return { f: false, s: false };
  const axis = selectedAxis.value;
  const fCheck = cap.sample_check[`axisF[${axis}]`];
  const sCheck = cap.sample_check[`axisS[${axis}]`];
  const magnitude = (sc: { value_min: number | null; value_max: number | null } | undefined) => {
    if (!sc) return 0;
    return Math.max(Math.abs(sc.value_min ?? 0), Math.abs(sc.value_max ?? 0));
  };
  return { f: magnitude(fCheck) > 1.0, s: magnitude(sCheck) > 1.0 };
});

const ffsCaveatText = computed<string | null>(() => {
  const { f, s } = ffsActive.value;
  if (!f && !s) return null;
  const terms: string[] = [];
  if (f) terms.push('F');
  if (s) terms.push('S');
  return `non-zero ${terms.join('+')} — full closed-loop response, not PD-isolated`;
});

const peakPctText = computed(() => {
  const r = firstResult.value;
  if (!r) return '—';
  return `${(r.peakAmplitude * 100).toFixed(0)} %`;
});

const segmentInfo = computed(() => {
  const r = firstResult.value;
  if (!r) return '';
  const base = `${SEGMENT_LEN}-pt Wiener deconv · ${r.numSegments.toLocaleString()} segments · ${(WINDOW_SEC * 1000).toFixed(0)} ms window`;
  const n = visibleEntries.value.length;
  if (n > 1) return `${base} · ${n} logs overlaid (stats: log 1)`;
  return base;
});

const peakToneClass = computed(() => {
  const r = firstResult.value;
  if (!r) return 'text-bp-ink';
  if (r.peakAmplitude > 1.30) return 'text-bp-stamp';
  if (r.peakAmplitude > 1.10) return 'text-bp-warn';
  if (r.peakAmplitude < 0.85) return 'text-bp-warn';
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
        <div v-if="firstResult && ready" class="flex gap-3 items-baseline">
          <div
            class="text-right cursor-help"
            title="Peak of the step response within the first 400 ms (wing-scaled, not global max). 100% = ideal tracking; >110% = overshoot; >130% = hard overshoot / ringing."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">peak</div>
            <div class="font-mono text-[13px]" :class="peakToneClass">{{ peakPctText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Time for the response to first cross 0.5 (50% of the unit-step target), in ms. Lower = the controller starts responding sooner. NaN if it never reaches 0.5 in the window."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">latency 50%</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ latencyText }}</div>
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
      <div
        v-else-if="ffsCaveatText"
        class="absolute top-1 right-3 z-10 px-2 py-1 bg-bp-surface-2 border border-bp-warn/40 font-mono text-[10.5px] text-bp-warn leading-tight"
        title="For PIDtoolbox/PIDscope-style PD-isolation tuning, zero F and S gains in BF before the calibration flight."
      >
        {{ ffsCaveatText }}
      </div>
      <div ref="hostRef" class="w-full" />
    </div>

    <footer
      class="flex flex-wrap justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px] gap-y-1"
    >
      <div class="flex flex-wrap gap-x-4 gap-y-1 items-center font-sans text-bp-ink-2">
        <!-- per-log legend: family-tinted dot + filename. Active-log
             gets the axis-base swatch as a reference. -->
        <span
          v-for="lr in allStep"
          :key="lr.entry.log.id"
          class="flex items-center gap-1.5"
          :class="lr.result && lr.result.numSegments > 0 ? '' : 'opacity-50'"
        >
          <span
            class="inline-block w-3.5 h-0.5"
            :style="{ background: tintTowardFamily(axisSpec.color, lr.entry.family) }"
          />
          <span class="font-mono text-bp-ink-3 truncate max-w-[160px]">
            {{ lr.entry.log.name }}
          </span>
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
        peak &lt; 1.10 = clean &middot; 1.10–1.30 = mild &middot; &gt; 1.30 = hard overshoot
      </div>
    </footer>
  </section>
</template>
