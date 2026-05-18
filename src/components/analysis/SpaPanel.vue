<script setup lang="ts">
// SPA (Setpoint PID Attenuation) effectiveness — per-axis. BF gates
// the I-term per axis based on commanded setpoint rate; SPA = 1.0
// means full I-term, SPA → 0 means I-term fully attenuated.
//
// Visualization: SPA multiplier (left axis 0..1) overlaid on I-term
// (right axis, raw deg). Gate-active regions render as warn-tinted
// background bands. Wind-up events get warn-color vertical markers;
// bounce-back events get stamp-color markers. Reference line at
// y=1.0 on the SPA axis is "no attenuation."
//
// Per-axis selector matches PIDtoolbox / Plasmatree convention since
// the R/P/Y SPA dynamics often diverge enough that an overlay would
// be confusing.

import { computed, onMounted, ref, watch } from 'vue';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { resolveSignal } from '@/lib/signalRegistry';
import {
  analyzeSpaAxis,
  debugSpaToMultiplier,
  type SpaAxisAnalysis,
} from '@/lib/spaAnalysis';

const COLORS = {
  ink3:   '#7a90b0',
  line:   '#1f3a5a',
  accent: '#7ec8ff',
  warn:   '#ffc46a',
  stamp:  '#ff6a6a',
  ok:     '#7ee0a8',
  iTerm:  '#b6c7e0',
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

const logStore = useActiveLog();
const { time, fields, hydrating, scanReport } = logStore;

useViewStore();  // touch the view store so cursor wiring (if added) works

const axisSpec = computed(() => AXES[selectedAxis.value]);

// Resolve the SPA signal source to get the actual field name.
const spaSource = computed(() => {
  const cap = scanReport.value?.capability;
  if (!cap) return null;
  const r = resolveSignal('spa', selectedAxis.value, cap);
  if (r.state !== 'resolved') return null;
  if (r.source.kind === 'debug') return `debug[${r.source.channel}]`;
  return r.source.field;
});

const iTermFieldName = computed(() => `axisI[${selectedAxis.value}]`);

async function hydrateForAxis(id: 0 | 1 | 2) {
  const wants: string[] = [`axisI[${id}]`];
  const sf = spaSource.value;
  if (sf) wants.push(sf);
  await logStore.ensureFields(wants);
}
onMounted(() => hydrateForAxis(selectedAxis.value));
watch([selectedAxis, spaSource], () => hydrateForAxis(selectedAxis.value));

const isHydrating = computed(() => {
  const sf = spaSource.value;
  return (sf !== null && hydrating.value.has(sf)) || hydrating.value.has(iTermFieldName.value);
});

const rawSpa = computed<Float32Array | undefined>(() => {
  const sf = spaSource.value;
  return sf ? fields.value.get(sf) : undefined;
});
const iTermArr = computed<Float32Array | undefined>(() => fields.value.get(iTermFieldName.value));

// Convert raw debug-mode SPA (×1000) to multiplier space.
const spaMultiplier = computed<Float32Array | undefined>(() => {
  const raw = rawSpa.value;
  return raw ? debugSpaToMultiplier(raw) : undefined;
});

const analysis = computed<SpaAxisAnalysis | null>(() => {
  const s = spaMultiplier.value;
  const i = iTermArr.value;
  const t = time.value;
  if (!s || !i || !t.length) return null;
  return analyzeSpaAxis(selectedAxis.value, s, i, t);
});

const modules = computed(() => {
  const r = scanReport.value;
  if (!r) return null;
  return evaluateModules(r.capability);
});

const moduleState = computed(() => {
  const m = modules.value;
  if (!m) return null;
  return m.spaEffectiveness[axisSpec.value.label.toLowerCase() as 'roll' | 'pitch' | 'yaw'];
});

const ready = computed(() => {
  return spaMultiplier.value !== undefined &&
         iTermArr.value !== undefined &&
         time.value.length > 0 &&
         analysis.value !== null;
});

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    return [new Float32Array(0), new Float32Array(0), new Float32Array(0)] as unknown as AlignedData;
  }
  return [time.value, spaMultiplier.value!, iTermArr.value!] as unknown as AlignedData;
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 300,
  legend: { show: false },
  scales: {
    x: { time: false },
    y:  { auto: false, range: [-0.05, 1.10] },
    y2: { auto: true },
  },
  cursor: {
    drag: { x: true, y: false, uni: 50 },
    focus: { prox: 30 },
    points: { show: true, size: 5 },
  },
  series: [
    {},
    { label: 'SPA',    stroke: COLORS.accent, width: 1.5, scale: 'y'  },
    { label: 'I-term', stroke: COLORS.iTerm,  width: 1,   scale: 'y2' },
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
      values: (_u, splits) => splits.map((v) => v.toFixed(2)),
    },
    {
      scale:  'y2',
      side:   1,
      stroke: COLORS.iTerm,
      grid:   { show: false },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      size:   60,
      values: (_u, splits) => splits.map((v) => v.toFixed(0)),
    },
  ],
  hooks: {
    draw: [
      (u) => {
        const ctx = u.ctx;
        const left = u.bbox.left;
        const top = u.bbox.top;
        const width = u.bbox.width;
        const height = u.bbox.height;
        ctx.save();

        // Gate-active background bands (warn tint, low alpha).
        const spa = spaMultiplier.value;
        const t = time.value;
        const ana = analysis.value;
        if (spa && t.length && ana && ana.gateActiveSamples > 0) {
          ctx.fillStyle = '#ffc46a1a';  // warn @ ~10% alpha
          const xMin = u.scales.x.min!;
          const xMax = u.scales.x.max!;
          // Walk runs of spa < 0.95 and fill bands. Skip outside view.
          let runStart = -1;
          for (let i = 0; i <= spa.length; i++) {
            const active = i < spa.length && spa[i] < 0.95;
            if (active && runStart < 0) runStart = i;
            else if (!active && runStart >= 0) {
              const t0 = t[runStart];
              const t1 = t[i - 1];
              if (t1 >= xMin && t0 <= xMax) {
                const x0 = u.valToPos(Math.max(t0, xMin), 'x', true);
                const x1 = u.valToPos(Math.min(t1, xMax), 'x', true);
                ctx.fillRect(x0, top, x1 - x0, height);
              }
              runStart = -1;
            }
          }
        }

        // Reference line at y=1.0 (no attenuation).
        ctx.strokeStyle = '#7ec8ff66';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        const y1 = u.valToPos(1.0, 'y', true);
        ctx.beginPath();
        ctx.moveTo(left, y1); ctx.lineTo(left + width, y1);
        ctx.stroke();
        ctx.setLineDash([]);

        // Event markers: wind-up (warn) and bounce-back (stamp).
        if (ana) {
          ctx.lineWidth = 1.5;
          for (const ev of ana.events) {
            const xMin = u.scales.x.min!;
            const xMax = u.scales.x.max!;
            if (ev.timeSec < xMin || ev.timeSec > xMax) continue;
            const x = u.valToPos(ev.timeSec, 'x', true);
            ctx.strokeStyle = ev.kind === 'wind_up' ? COLORS.warn : COLORS.stamp;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + height);
            ctx.stroke();
          }
        }

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
  if (isHydrating.value) return `hydrating SPA + I-term on ${axisSpec.value.label.toLowerCase()}…`;
  const ms = moduleState.value;
  if (ms && ms.state === 'blocked') return ms.reason ?? 'SPA module blocked on this log';
  if (ms && ms.state === 'inactive') return ms.reason ?? 'SPA inactive on this axis';
  if (!spaSource.value) return 'SPA signal not resolvable on this log — set `debug_mode = SPA` in BF';
  if (!iTermArr.value?.length) return `${iTermFieldName.value} missing from this log`;
  if (!time.value.length) return 'time axis empty — load a log first';
  return 'computing SPA analysis…';
});

const gatePctText = computed(() => {
  const a = analysis.value;
  return a ? `${a.gateActivePct.toFixed(1)} %` : '—';
});
const minSpaText = computed(() => {
  const a = analysis.value;
  return a ? a.minSpa.toFixed(2) : '—';
});
const eventCountText = computed(() => {
  const a = analysis.value;
  return a ? a.events.length.toString() : '—';
});
const gateToneClass = computed(() => {
  const a = analysis.value;
  if (!a) return 'text-bp-ink';
  if (a.gateActivePct >= 30) return 'text-bp-warn';
  if (a.gateActivePct >= 10) return 'text-bp-accent';
  return 'text-bp-ink';
});
const eventToneClass = computed(() => {
  const a = analysis.value;
  if (!a) return 'text-bp-ink';
  if (a.events.length >= 5) return 'text-bp-stamp';
  if (a.events.length >= 1) return 'text-bp-warn';
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
          SPA effectiveness &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          setpoint-rate I-term attenuation &middot; gate-active bands shaded
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="ready" class="flex gap-3 items-baseline">
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">gate</div>
            <div class="font-mono text-[13px]" :class="gateToneClass">{{ gatePctText }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">min SPA</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ minSpaText }}</div>
          </div>
          <div class="text-right">
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">events</div>
            <div class="font-mono text-[13px]" :class="eventToneClass">{{ eventCountText }}</div>
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
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.accent }" />
          SPA
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.iTerm }" />
          I-term
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-2.5 h-2.5 bg-bp-warn/20 border border-bp-warn/40" />
          gate active
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-0.5 h-3 bg-bp-warn" />
          wind-up
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-0.5 h-3 bg-bp-stamp" />
          bounce-back
        </span>
      </div>
      <div class="font-mono text-bp-ink-3">
        SPA = 1.0 → no attenuation &middot; lower = more I-term gated
      </div>
    </footer>
  </section>
</template>
