<script setup lang="ts">
// S-term TPA effectiveness — per-axis. Overlays pre-TPA S contribution
// (warn color) against post-TPA `axisS[i]` (accent) so the user can
// see exactly where airspeed-based TPA is attenuating S.
//
// A secondary y-axis renders the per-sample TPA factor (post/pre) as
// a faint trace — values near 1.0 mean TPA isn't doing anything; near
// 0 means S is heavily attenuated. Gaps in this trace are intentional
// (pre below activeThreshold).
//
// Per-axis selector (R/P/Y chips) matches the convention used by the
// SPA, Step, and PIDFS panels — the three axes' dynamics often differ
// enough that overlay would obscure detail.
//
// Diagnostic-only per roadmap Module F / M7 — no CLI emission, no
// confidence scoring. TPA's tuning lives in M3's recommender (BASIC
// airspeed fit); this panel exists so the user can sanity-check
// whether their tuning is taking effect on the S-term in particular.

import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options } from 'uplot';

import { useLogStore } from '@/stores/log';
import { useUPlot } from '@/composables/useUPlot';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { resolveSignal } from '@/lib/signalRegistry';
import {
  analyzeSTermAxis,
  type STermAxisAnalysis,
} from '@/lib/sTermAnalysis';

const COLORS = {
  ink3:   '#7a90b0',
  line:   '#1f3a5a',
  accent: '#7ec8ff',
  warn:   '#ffc46a',
  factor: '#7ee0a8',
} as const;

interface AxisSpec {
  id: 0 | 1 | 2;
  label: string;
  short: 'R' | 'P' | 'Y';
}

const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R' },
  { id: 1, label: 'Pitch', short: 'P' },
  { id: 2, label: 'Yaw',   short: 'Y' },
];

const selectedAxis = ref<0 | 1 | 2>(0);

const logStore = useLogStore();
const { time, fields, hydrating, scanReport } = storeToRefs(logStore);

const axisSpec = computed(() => AXES[selectedAxis.value]);

const preSourceField = computed(() => {
  const cap = scanReport.value?.capability;
  if (!cap) return null;
  const r = resolveSignal('pre_tpa_s', selectedAxis.value, cap);
  if (r.state !== 'resolved') return null;
  if (r.source.kind === 'debug') return `debug[${r.source.channel}]`;
  return r.source.field;
});
const postSourceField = computed(() => {
  const cap = scanReport.value?.capability;
  if (!cap) return null;
  const r = resolveSignal('post_tpa_s', selectedAxis.value, cap);
  if (r.state !== 'resolved') return null;
  if (r.source.kind === 'main_frame') return r.source.field;
  return `debug[${r.source.channel}]`;
});

async function hydrateForAxis() {
  const wants: string[] = [];
  if (preSourceField.value) wants.push(preSourceField.value);
  if (postSourceField.value) wants.push(postSourceField.value);
  if (wants.length > 0) await logStore.ensureFields(wants);
}
onMounted(hydrateForAxis);
watch([selectedAxis, preSourceField, postSourceField], hydrateForAxis);

const isHydrating = computed(() => {
  const pre = preSourceField.value;
  const post = postSourceField.value;
  return (pre !== null && hydrating.value.has(pre)) ||
         (post !== null && hydrating.value.has(post));
});

const preArr  = computed<Float32Array | undefined>(() =>
  preSourceField.value ? fields.value.get(preSourceField.value) : undefined,
);
const postArr = computed<Float32Array | undefined>(() =>
  postSourceField.value ? fields.value.get(postSourceField.value) : undefined,
);

const analysis = computed<STermAxisAnalysis | null>(() => {
  const pre = preArr.value;
  const post = postArr.value;
  if (!pre || !post) return null;
  return analyzeSTermAxis(selectedAxis.value, pre, post);
});

const modules = computed(() => {
  const r = scanReport.value;
  if (!r) return null;
  return evaluateModules(r.capability);
});
const moduleState = computed(() => {
  const m = modules.value;
  if (!m) return null;
  return m.sTermTpaViz[axisSpec.value.label.toLowerCase() as 'roll' | 'pitch' | 'yaw'];
});

const ready = computed(() => {
  return preArr.value !== undefined &&
         postArr.value !== undefined &&
         time.value.length > 0 &&
         analysis.value !== null;
});

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    return [new Float32Array(0), new Float32Array(0), new Float32Array(0), new Float32Array(0)] as unknown as AlignedData;
  }
  return [
    time.value,
    preArr.value!,
    postArr.value!,
    analysis.value!.tpaFactorSeries,
  ] as unknown as AlignedData;
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 300,
  legend: { show: false },
  scales: {
    x:  { time: false },
    y:  { auto: true },
    y2: { auto: false, range: [-0.05, 1.50] },
  },
  cursor: {
    drag: { x: true, y: false, uni: 50 },
    focus: { prox: 30 },
    points: { show: true, size: 5 },
  },
  series: [
    {},
    { label: 'pre-TPA S',  stroke: COLORS.warn,   width: 1,   scale: 'y'  },
    { label: 'post-TPA S', stroke: COLORS.accent, width: 1.5, scale: 'y'  },
    { label: 'TPA factor', stroke: COLORS.factor, width: 0.75, scale: 'y2', spanGaps: false },
  ],
  axes: [
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} s`),
    },
    {
      scale:  'y',
      stroke: COLORS.accent,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      size:   50,
      values: (_u, splits) => splits.map((v) => v.toFixed(0)),
    },
    {
      scale:  'y2',
      side:   1,
      stroke: COLORS.factor,
      grid:   { show: false },
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
        // Reference line at TPA factor = 1.0 (no attenuation) on y2.
        ctx.strokeStyle = '#7ee0a866';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        const y1 = u.valToPos(1.0, 'y2', true);
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
  if (isHydrating.value) return `hydrating S-term pre/post on ${axisSpec.value.label.toLowerCase()}…`;
  const ms = moduleState.value;
  if (ms && ms.state === 'blocked') return ms.reason ?? 'S-term TPA viz blocked on this log';
  if (ms && ms.state === 'inactive') return ms.reason ?? 'S-term inactive on this axis';
  if (!preSourceField.value) return 'pre-TPA S signal not resolvable — set `debug_mode = S_TERM` in BF';
  if (!postSourceField.value) return 'post-TPA S (axisS) not present — USE_WING firmware build required';
  if (!time.value.length) return 'time axis empty — load a log first';
  return 'computing S-term TPA analysis…';
});

const meanAttenText = computed(() => {
  const a = analysis.value;
  return a ? `${(a.meanAttenuation * 100).toFixed(0)} %` : '—';
});
const minFactorText = computed(() => {
  const a = analysis.value;
  return a ? a.minTpaFactor.toFixed(2) : '—';
});
const activePctText = computed(() => {
  const a = analysis.value;
  return a ? `${a.activePct.toFixed(0)} %` : '—';
});
const attenToneClass = computed(() => {
  const a = analysis.value;
  if (!a) return 'text-bp-ink';
  if (a.meanAttenuation >= 0.4) return 'text-bp-stamp';
  if (a.meanAttenuation >= 0.15) return 'text-bp-warn';
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
          S-term TPA effectiveness &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          pre-TPA vs post-TPA S contribution &middot; factor = post / pre
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="ready" class="flex gap-3 items-baseline">
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">mean atten</div>
            <div class="font-mono text-[13px]" :class="attenToneClass">{{ meanAttenText }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">min factor</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ minFactorText }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">active</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ activePctText }}</div>
          </div>
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
      <div ref="hostRef" class="w-full" />
    </div>

    <footer
      class="flex justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px]"
    >
      <div class="flex gap-4 items-center font-sans text-bp-ink-2">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.warn }" />
          pre-TPA S
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.accent }" />
          post-TPA S
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.factor }" />
          TPA factor (right)
        </span>
      </div>
      <div class="font-mono text-bp-ink-3">
        factor = 1.0 → no attenuation &middot; lower = more S gated by TPA
      </div>
    </footer>
  </section>
</template>
