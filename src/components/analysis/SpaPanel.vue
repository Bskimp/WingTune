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
// M1.7.1 multi-log: chart x is SESSION time; each visible log
// contributes (SPA, I-term) traces tinted toward its family color.
// Gate-active bands + event markers render for the ACTIVE log only
// (overlapping per-log bands would be illegible at N≥2); flip the
// eye to inspect another log's gate behavior. Logs that can't
// resolve the SPA signal (no debug_mode = SPA) are silently dropped
// from the overlay.

import { computed, ref, watchEffect } from 'vue';
import type { AlignedData, Options, Series } from 'uplot';

import { useSessionStore, type LogState } from '@/stores/session';
import { useActiveLog } from '@/composables/useActiveLog';
import { useAlignedTime } from '@/composables/useAlignedTime';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { resolveSignal } from '@/lib/signalRegistry';
import {
  analyzeSpaAxis,
  debugSpaToMultiplier,
  type SpaAxisAnalysis,
} from '@/lib/spaAnalysis';
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

const visibleEntries = computed(() => logEntries.value.filter((e) => !e.hidden));

function resolveSpaSourceFor(log: LogState, axis: 0 | 1 | 2): string | null {
  const cap = log.scanReport?.capability;
  if (!cap) return null;
  const r = resolveSignal('spa', axis, cap);
  if (r.state !== 'resolved') return null;
  return r.source.kind === 'debug' ? `debug[${r.source.channel}]` : r.source.field;
}

// Hydrate SPA source + axisI[selected] across every loaded log.
watchEffect(() => {
  const axis = selectedAxis.value;
  const iField = `axisI[${axis}]`;
  for (const { log } of logEntries.value) {
    const wants: string[] = [iField];
    const sf = resolveSpaSourceFor(log, axis);
    if (sf) wants.push(sf);
    session.ensureFields(log.id, wants).catch(() => {});
  }
});

// Active log readouts for stats / pending message.
const activeSpaSource = computed(() => {
  const id = activeLog.activeId.value;
  if (!id) return null;
  const log = session.logs.get(id);
  if (!log) return null;
  return resolveSpaSourceFor(log, selectedAxis.value);
});
const iTermFieldName = computed(() => `axisI[${selectedAxis.value}]`);

const isHydrating = computed(() => {
  const sf = activeSpaSource.value;
  return (sf !== null && activeLog.hydrating.value.has(sf)) ||
         activeLog.hydrating.value.has(iTermFieldName.value);
});

const activeRawSpa = computed<Float32Array | undefined>(() => {
  const sf = activeSpaSource.value;
  return sf ? activeLog.fields.value.get(sf) : undefined;
});
const activeITermArr = computed<Float32Array | undefined>(() =>
  activeLog.fields.value.get(iTermFieldName.value),
);
const activeSpaMultiplier = computed<Float32Array | undefined>(() => {
  const raw = activeRawSpa.value;
  return raw ? debugSpaToMultiplier(raw) : undefined;
});

const activeAnalysis = computed<SpaAxisAnalysis | null>(() => {
  const s = activeSpaMultiplier.value;
  const i = activeITermArr.value;
  const t = activeLog.time.value;
  if (!s || !i || !t.length) return null;
  return analyzeSpaAxis(selectedAxis.value, s, i, t);
});

const modules = computed(() => {
  const r = activeLog.scanReport.value;
  if (!r) return null;
  return evaluateModules(r.capability);
});

const moduleState = computed(() => {
  const m = modules.value;
  if (!m) return null;
  return m.spaEffectiveness[axisSpec.value.label.toLowerCase() as 'roll' | 'pitch' | 'yaw'];
});

const ready = computed(() =>
  activeSpaMultiplier.value !== undefined &&
  activeITermArr.value !== undefined &&
  activeLog.time.value.length > 0 &&
  activeAnalysis.value !== null,
);

const refTime = useSessionRefTime();

// M1.7.1 — active log alignment handle, used to project draw-hook
// coordinates (band runs, event markers) from log-local time to
// session time so they overlay correctly when active log has offset.
const activeAlign = useAlignedTime(() => activeLog.activeId.value);

interface LogTraces {
  entry: LogEntry;
  spaMultiplier: Float32Array;
  iTermArr: Float32Array;
}

const allTraces = computed<LogTraces[]>(() => {
  const out: LogTraces[] = [];
  const axis = selectedAxis.value;
  for (const entry of visibleEntries.value) {
    const sf = resolveSpaSourceFor(entry.log, axis);
    if (!sf) continue;
    const raw  = entry.log.fields.get(sf);
    const iArr = entry.log.fields.get(`axisI[${axis}]`);
    if (!raw || !iArr || raw.length === 0 || iArr.length === 0) continue;
    out.push({
      entry,
      spaMultiplier: debugSpaToMultiplier(raw),
      iTermArr: iArr,
    });
  }
  return out;
});

const data = computed<AlignedData>(() => {
  if (!ready.value || refTime.value.length === 0 || allTraces.value.length === 0) {
    return [
      new Float32Array(0),
      new Float32Array(0),
      new Float32Array(0),
    ] as unknown as AlignedData;
  }
  const series: Float32Array[] = [];
  for (const t of allTraces.value) {
    series.push(resampleOntoRef(t.entry.log, refTime.value, t.spaMultiplier));
    series.push(resampleOntoRef(t.entry.log, refTime.value, t.iTermArr));
  }
  return [refTime.value, ...series] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const series: Series[] = [{}];
  for (const t of allTraces.value) {
    const fam = t.entry.family;
    series.push({
      label: `${t.entry.log.name} SPA`,
      stroke: tintTowardFamily(COLORS.accent, fam),
      width: 1.5,
      scale: 'y',
    });
    series.push({
      label: `${t.entry.log.name} I-term`,
      stroke: tintTowardFamily(COLORS.iTerm, fam),
      width: 1,
      scale: 'y2',
    });
  }
  return {
    width: 800,
    height: 300,
    legend: { show: false },
    scales: {
      x:  { time: false, range: sessionTimeRangeFn },
      y:  { auto: false, range: [-0.05, 1.10] },
      y2: { auto: true },
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

          // Gate-active bands + event markers for ACTIVE log only.
          // Per-log overlays would be illegible at N≥2; the active
          // log's gate behavior is the actionable signal anyway.
          // Project log-local times to session time via offset.
          const spa = activeSpaMultiplier.value;
          const t = activeLog.time.value;
          const ana = activeAnalysis.value;
          const off = activeAlign.offsetSec.value;
          if (spa && t.length && ana && ana.gateActiveSamples > 0) {
            ctx.fillStyle = '#ffc46a1a';  // warn @ ~10% alpha
            const xMin = u.scales.x.min!;
            const xMax = u.scales.x.max!;
            let runStart = -1;
            for (let i = 0; i <= spa.length; i++) {
              const active = i < spa.length && spa[i] < 0.95;
              if (active && runStart < 0) runStart = i;
              else if (!active && runStart >= 0) {
                const t0 = t[runStart] + off;
                const t1 = t[i - 1]    + off;
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
          // Project log-local event times to session time.
          if (ana) {
            ctx.lineWidth = 1.5;
            const xMin = u.scales.x.min!;
            const xMax = u.scales.x.max!;
            for (const ev of ana.events) {
              const sessionT = ev.timeSec + off;
              if (sessionT < xMin || sessionT > xMax) continue;
              const x = u.valToPos(sessionT, 'x', true);
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
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

function resetZoom() { plot.resetZoom(); }
function selectAxis(id: 0 | 1 | 2) { selectedAxis.value = id; }

const pendingMessage = computed(() => {
  if (isHydrating.value) return `hydrating SPA + I-term on ${axisSpec.value.label.toLowerCase()}…`;
  const ms = moduleState.value;
  if (ms && ms.state === 'blocked') return ms.reason ?? 'SPA module blocked on this log';
  if (ms && ms.state === 'inactive') return ms.reason ?? 'SPA inactive on this axis';
  if (!activeSpaSource.value) return 'SPA signal not resolvable on this log — set `debug_mode = SPA` in BF';
  if (!activeITermArr.value?.length) return `${iTermFieldName.value} missing from this log`;
  if (!activeLog.time.value.length) return 'time axis empty — load a log first';
  return 'computing SPA analysis…';
});

const gatePctText = computed(() => {
  const a = activeAnalysis.value;
  return a ? `${a.gateActivePct.toFixed(1)} %` : '—';
});
const minSpaText = computed(() => {
  const a = activeAnalysis.value;
  return a ? a.minSpa.toFixed(2) : '—';
});
const eventCountText = computed(() => {
  const a = activeAnalysis.value;
  return a ? a.events.length.toString() : '—';
});
const gateToneClass = computed(() => {
  const a = activeAnalysis.value;
  if (!a) return 'text-bp-ink';
  if (a.gateActivePct >= 30) return 'text-bp-warn';
  if (a.gateActivePct >= 10) return 'text-bp-accent';
  return 'text-bp-ink';
});
const eventToneClass = computed(() => {
  const a = activeAnalysis.value;
  if (!a) return 'text-bp-ink';
  if (a.events.length >= 5) return 'text-bp-stamp';
  if (a.events.length >= 1) return 'text-bp-warn';
  return 'text-bp-ok';
});

const multiLogNote = computed(() => {
  const n = visibleEntries.value.length;
  if (n <= 1) return '';
  const drawing = allTraces.value.length;
  if (drawing < n) {
    return `${drawing} of ${n} logs · session time · ${n - drawing} dropped (no SPA signal) · bands + events show active log only`;
  }
  return `${n} logs · session time · bands + events + stats show active log only`;
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
          {{ multiLogNote || 'setpoint-rate I-term attenuation · gate-active bands shaded' }}
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
