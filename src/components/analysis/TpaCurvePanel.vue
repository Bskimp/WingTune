<script setup lang="ts">
// M5 — HYPERBOLIC TPA curve viz. Scatters (tpa_arg, tpa_factor)
// samples from whichever source signalRegistry resolves to
// (main-frame `wingTpaArg`/`wingTpaFactor` on USE_WING firmware, or
// the DEBUG_TPA channel pair as fallback) and overlays the fitted
// curve. Header surfaces residual RMS + sample count + coverage
// (low/mid/high band dwell seconds — required by the recommender's
// confidence gate).
//
// Single-axis view (not per-R/P/Y) since the TPA curve is whole-craft,
// not per-axis. Pending state routes through checkTpaCurveFit so
// non-resolvable logs show a clear "set debug_mode = TPA" message.

import { computed, onMounted, ref, watch } from 'vue';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useUPlot } from '@/composables/useUPlot';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { resolveSignal } from '@/lib/signalRegistry';
import {
  buildTpaFitInputs,
  evaluateHyperbolic,
  fitHyperbolicCurve,
  type HyperbolicFitResult,
} from '@/lib/tpaCurveFit';

const COLORS = {
  ink3:   '#7a90b0',
  line:   '#1f3a5a',
  accent: '#7ec8ff',
  warn:   '#ffc46a',
  curve:  '#7ee0a8',
} as const;

const logStore = useActiveLog();
const { time, fields, hydrating, scanReport } = logStore;

// Both signals can resolve via main-frame `wingTpaArg`/`wingTpaFactor`
// (USE_WING builds, preferred) or DEBUG_TPA channel fallback. Return
// whichever the registry walked to.
const argField = computed(() => {
  const cap = scanReport.value?.capability;
  if (!cap) return null;
  const r = resolveSignal('tpa_arg', null, cap);
  if (r.state !== 'resolved') return null;
  return r.source.kind === 'main_frame' ? r.source.field : `debug[${r.source.channel}]`;
});
const factorField = computed(() => {
  const cap = scanReport.value?.capability;
  if (!cap) return null;
  const r = resolveSignal('tpa_factor', null, cap);
  if (r.state !== 'resolved') return null;
  return r.source.kind === 'main_frame' ? r.source.field : `debug[${r.source.channel}]`;
});

async function hydrate() {
  const wants: string[] = [];
  if (argField.value)    wants.push(argField.value);
  if (factorField.value) wants.push(factorField.value);
  if (wants.length > 0) await logStore.ensureFields(wants);
}
onMounted(hydrate);
watch([argField, factorField], hydrate);

const isHydrating = computed(() =>
  (argField.value !== null    && hydrating.value.has(argField.value)) ||
  (factorField.value !== null && hydrating.value.has(factorField.value)),
);

const fitInputs = computed(() => {
  const arg = argField.value;
  const fac = factorField.value;
  if (!arg || !fac) return null;
  return buildTpaFitInputs({
    time: time.value,
    fields: fields.value,
    tpaArgField: arg,
    tpaFactorField: fac,
  });
});

const fitResult = computed<HyperbolicFitResult | null>(() => {
  const built = fitInputs.value;
  if (!built || built.samples.length < 50) return null;
  return fitHyperbolicCurve(built.samples, built.coverage);
});

const modules = computed(() => {
  const r = scanReport.value;
  if (!r) return null;
  return evaluateModules(r.capability);
});

const ready = computed(() => fitResult.value !== null);

// Nelder-Mead can wander out of physically-meaningful TPA-param ranges
// when the data only covers a narrow slice of [0, 1] (e.g. you never
// flew above ~50% throttle, so the upper half of the curve is
// unconstrained and the optimiser drifts to absurd values).
// Trustworthy = within CLI valid ranges AND not pinned at the expo rails.
// Untrustworthy fits skip the curve overlay so we don't blow the
// y autoscale with a curve that goes to ±1e10 at x → 1.
const fitTrustworthy = computed<boolean>(() => {
  const r = fitResult.value;
  if (!r) return false;
  const p = r.params;
  if (p.pidThr0   < 0.05 || p.pidThr0   > 10) return false;
  if (p.pidThr100 < 0.05 || p.pidThr100 > 10) return false;
  if (Math.abs(p.expoCli) >= 99) return false;
  if (p.stallThrottle < 0 || p.stallThrottle > 0.999) return false;
  return true;
});

// 200-point fitted curve overlay across [0, 1]. NaN-filled when fit is
// untrustworthy so the curve doesn't render (scatter still does).
const CURVE_RES = 200;
const curveData = computed<{ x: Float32Array; y: Float32Array }>(() => {
  const r = fitResult.value;
  const x = new Float32Array(CURVE_RES);
  const y = new Float32Array(CURVE_RES);
  for (let i = 0; i < CURVE_RES; i++) x[i] = i / (CURVE_RES - 1);
  if (!r || !fitTrustworthy.value) {
    for (let i = 0; i < CURVE_RES; i++) y[i] = NaN;
    return { x, y };
  }
  for (let i = 0; i < CURVE_RES; i++) y[i] = evaluateHyperbolic(x[i], r.params);
  return { x, y };
});

const scatterArrays = computed<{ x: Float32Array; y: Float32Array }>(() => {
  const built = fitInputs.value;
  if (!built || built.samples.length === 0) {
    return { x: new Float32Array(0), y: new Float32Array(0) };
  }
  // Sub-sample if >5000 points (keeps the plot snappy without losing the
  // overall shape).
  const max = 5000;
  const n = built.samples.length;
  const stride = Math.max(1, Math.floor(n / max));
  const len = Math.ceil(n / stride);
  const x = new Float32Array(len);
  const y = new Float32Array(len);
  for (let i = 0, j = 0; i < n; i += stride, j++) {
    x[j] = built.samples[i].x;
    y[j] = built.samples[i].y;
  }
  return { x, y };
});

// uPlot AlignedData here is (x, y_scatter, y_curve) — but scatter and
// curve have DIFFERENT x sets. uPlot's aligned-data model needs a
// shared x axis, so we render two overlapping series by passing one
// flat x and NaN-padding the other axis. Workaround: render scatter
// + curve as a single plot with the union x merged + matched y, with
// NaN where the data doesn't have that x.
const data = computed<AlignedData>(() => {
  if (!ready.value) {
    return [new Float32Array(0), new Float32Array(0), new Float32Array(0)] as unknown as AlignedData;
  }
  const scat = scatterArrays.value;
  const curve = curveData.value;

  // Merge sort the x arrays (scatter unsorted, curve sorted).
  const allX = new Float32Array(scat.x.length + curve.x.length);
  allX.set(scat.x, 0);
  allX.set(curve.x, scat.x.length);

  // Indexed sort so we can re-emit y values in matching order.
  const idx = new Uint32Array(allX.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => allX[a] - allX[b]);

  const xSorted = new Float32Array(allX.length);
  const ySc = new Float32Array(allX.length);
  const yCu = new Float32Array(allX.length);
  for (let k = 0; k < idx.length; k++) {
    const src = idx[k];
    xSorted[k] = allX[src];
    if (src < scat.x.length) {
      ySc[k] = scat.y[src];
      yCu[k] = NaN;
    } else {
      ySc[k] = NaN;
      yCu[k] = curve.y[src - scat.x.length];
    }
  }
  return [xSorted, ySc, yCu] as unknown as AlignedData;
});

// Bounded y range — TPA factor is a multiplier in roughly [0, 3] for
// any sane setup; cap so an untrustworthy curve (or even a trustworthy
// one with a steep low-throttle plateau) can't squash the scatter into
// a pixel-thin band at y ≈ 0.
const yRange = computed<[number, number]>(() => {
  const scat = scatterArrays.value;
  let yMax = 1.5;
  for (let i = 0; i < scat.y.length; i++) {
    const v = scat.y[i];
    if (Number.isFinite(v) && v > yMax) yMax = v;
  }
  return [-0.1, Math.min(5, yMax * 1.2)];
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 320,
  legend: { show: false },
  scales: {
    x: { time: false, range: [0, 1.02] },
    y: { range: [yRange.value[0], yRange.value[1]] },
  },
  cursor: {
    drag: { x: true, y: true, uni: 50 },
    points: { show: true, size: 5 },
  },
  series: [
    {},
    { label: 'measured',  stroke: COLORS.accent, width: 0, points: { show: true, size: 2.5, fill: COLORS.accent }, spanGaps: false },
    { label: 'fit curve', stroke: COLORS.curve,  width: 1.75, spanGaps: false },
  ],
  axes: [
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => v.toFixed(2)),
    },
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      size:   55,
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
        ctx.strokeStyle = '#7ec8ff66';
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

const moduleState = computed(() => modules.value?.tpaCurveFit ?? null);

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating tpa_arg + tpa_factor…';
  const ms = moduleState.value;
  if (ms && ms.state === 'blocked') return ms.reason ?? 'TPA curve fit blocked on this log';
  if (ms && ms.state === 'inactive') return ms.reason ?? 'TPA curve channels logged but always zero';
  if (!argField.value || !factorField.value) return 'TPA signals not resolvable on this log — needs USE_WING firmware (`wingTpaArg`/`wingTpaFactor`) or `debug_mode = TPA`';
  if (fitInputs.value && fitInputs.value.samples.length < 50) {
    return `only ${fitInputs.value?.samples.length ?? 0} active samples — fly more throttle/airspeed variation to characterise the curve`;
  }
  return 'fitting HYPERBOLIC TPA curve…';
});

const rmsText = computed(() => fitResult.value ? fitResult.value.rmsResidual.toFixed(3) : '—');
const sampleText = computed(() => {
  const r = fitResult.value;
  return r ? r.coverage.samples.toLocaleString() : '—';
});
const xRangeText = computed(() => {
  const r = fitResult.value;
  if (!r) return '—';
  return `${r.coverage.xMin.toFixed(2)}–${r.coverage.xMax.toFixed(2)}`;
});
const expoText = computed(() => fitResult.value ? Math.round(fitResult.value.params.expoCli).toString() : '—');
const pidThr0Text = computed(() => fitResult.value ? fitResult.value.params.pidThr0.toFixed(2) : '—');
const pidThr100Text = computed(() => fitResult.value ? fitResult.value.params.pidThr100.toFixed(2) : '—');

const rmsTone = computed(() => {
  const r = fitResult.value;
  if (!r) return 'text-bp-ink';
  if (r.rmsResidual > 0.15) return 'text-bp-stamp';
  if (r.rmsResidual > 0.08) return 'text-bp-warn';
  return 'text-bp-ok';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header
      class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3"
    >
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          TPA curve fit &middot; HYPERBOLIC
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          (tpa_arg → tpa_factor) scatter + Nelder-Mead fit per BF PR #13805
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="ready" class="flex gap-3 items-baseline">
          <div
            class="text-right cursor-help"
            title="Root-mean-square residual of the HYPERBOLIC curve fit. Lower = the fitted curve passes closer through the measured (tpa_arg, tpa_factor) scatter. <0.08 clean / 0.08-0.15 drifty / >0.15 poor fit."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">rms</div>
            <div class="font-mono text-[13px]" :class="rmsTone">{{ rmsText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Fitted curve endpoints: the PID multiplier at low airspeed (thr0) and at full airspeed (thr100). >1 = gain amplification, <1 = attenuation. These map to the tpa_curve_pid_thr0 / pid_thr100 CLI params."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">thr0/thr100</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ pidThr0Text }} / {{ pidThr100Text }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Fitted curvature of the HYPERBOLIC curve between the two endpoints. Maps to the tpa_curve_expo CLI param."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">expo</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ expoText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Number of (tpa_arg, tpa_factor) sample pairs that fed the fit. More samples across a wider airspeed range = a better-constrained curve."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">samples</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ sampleText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="The span of the airspeed argument the flight actually covered. A narrow range leaves the curve under-constrained — fly throttle excursions up to cruise/max to widen it."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">x range</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ xRangeText }}</div>
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

    <div class="relative px-3 py-3 min-h-[336px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        {{ pendingMessage }}
      </div>
      <div
        v-else-if="!fitTrustworthy"
        class="absolute top-1 right-3 z-10 max-w-[58%] px-2 py-1.5 bg-bp-surface-2 border border-bp-warn/40 font-mono text-[10.5px] text-bp-warn leading-snug"
      >
        fit unreliable — params out of range (thr0 {{ pidThr0Text }} / thr100 {{ pidThr100Text }} / expo {{ expoText }}).
        x range only {{ xRangeText }} — fly throttle excursions up to cruise/max to constrain the high-airspeed end.
        scatter still real; curve overlay suppressed.
      </div>
      <div ref="hostRef" class="w-full" />
    </div>

    <footer
      class="flex justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px]"
    >
      <div class="flex gap-4 items-center font-sans text-bp-ink-2">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: COLORS.accent }" />
          measured (tpa_arg, tpa_factor)
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.curve }" />
          fitted HYPERBOLIC
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5" style="border-top: 1px dashed var(--color-bp-ink-3);" />
          y=1.0 no-attenuation
        </span>
      </div>
      <div class="font-mono text-bp-ink-3">
        RMS &lt; 0.08 = clean &middot; 0.08–0.15 = drifty &middot; &gt; 0.15 = poor fit
      </div>
    </footer>
  </section>
</template>
