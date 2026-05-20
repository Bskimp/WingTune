<script setup lang="ts">
// S-term TPA effectiveness — per-axis. Overlays pre-TPA S contribution
// (warn color) against post-TPA `axisS[i]` (accent) so the user can
// see exactly where airspeed-based TPA is attenuating S.
//
// A secondary y-axis renders the per-sample TPA factor (post/pre) as
// a faint trace — values near 1.0 mean TPA isn't doing anything; near
// 0 means S is heavily attenuated.
//
// M1.7.1 multi-log: chart x is SESSION time; each visible log
// contributes a (pre, post, factor) triplet, tinted toward its family
// color. Per-log signal resolution may differ (one log may have
// `debug_mode = S_TERM`, another may not) — logs that can't resolve
// both pre and post for the selected axis are silently dropped from
// the overlay. Stats + pending-message + module state remain anchored
// to the active log; flip the eye to inspect another log.
//
// Diagnostic-only per roadmap Module F / M7 — no CLI emission, no
// confidence scoring. TPA's tuning lives in M3's recommender (BASIC
// airspeed fit); this panel exists so the user can sanity-check
// whether their tuning is taking effect on the S-term in particular.

import { computed, ref, watchEffect } from 'vue';
import type { AlignedData, Options, Series } from 'uplot';

import { useSessionStore, type LogState } from '@/stores/session';
import { useActiveLog } from '@/composables/useActiveLog';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { evaluateModules } from '@/lib/capabilityPredicates';
import { resolveSignal } from '@/lib/signalRegistry';
import {
  analyzeSTermAxis,
  analyzeSTermAxisDirect,
  type STermAxisAnalysis,
} from '@/lib/sTermAnalysis';
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
  factor: '#7ee0a8',
} as const;

/** Replace NaN samples with the previous valid value. analyzeSTermAxis
 *  emits NaN where pre is below the activeThreshold (post/pre ratio
 *  uninformative), which made the right-axis TPA factor render as
 *  vertical bars when uPlot drew NaN→value→NaN→value transitions.
 *  Holding last keeps the line continuous and readable — TPA factor
 *  itself doesn't change discontinuously based on S activity (it's
 *  airspeed/throttle scheduled), so the hold-last value remains a fair
 *  representation between active windows. Leading NaN preserved until
 *  the first real sample so we don't fabricate a flat line at the start. */
function holdLastNaN(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  let last = NaN;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isFinite(v)) {
      last = v;
      out[i] = v;
    } else {
      out[i] = last; // NaN until first valid sample, then held
    }
  }
  return out;
}

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

/** BF emits `tpa_factor` (and the main-frame `wingTpaFactor` mirror)
 *  as integer × 1000 — see project-bf-wing-debug-modes memory + the
 *  TPA curve fit's BF_TPA_SCALE constant. */
const BF_TPA_SCALE = 1 / 1000;

/** Per-log signal resolution for pre/post TPA S on the selected axis
 *  plus the global TPA factor signal. Each log may have different
 *  debug_mode availability so the field names differ across logs.
 *  `factor` resolves to `wingTpaFactor` (main-frame, USE_WING) or
 *  DEBUG_TPA channel fallback; when unresolved, the panel falls back
 *  to deriving the factor from post/pre. */
function resolvePerLog(log: LogState, axis: 0 | 1 | 2): {
  pre: string | null;
  post: string | null;
  factor: string | null;
} {
  const cap = log.scanReport?.capability;
  if (!cap) return { pre: null, post: null, factor: null };
  const preR    = resolveSignal('pre_tpa_s',  axis, cap);
  const postR   = resolveSignal('post_tpa_s', axis, cap);
  const factorR = resolveSignal('tpa_factor', null, cap);
  const pre  = preR.state === 'resolved'
    ? (preR.source.kind === 'debug'
        ? `debug[${preR.source.channel}]`
        : preR.source.field)
    : null;
  const post = postR.state === 'resolved'
    ? (postR.source.kind === 'debug'
        ? `debug[${postR.source.channel}]`
        : postR.source.field)
    : null;
  const factor = factorR.state === 'resolved'
    ? (factorR.source.kind === 'debug'
        ? `debug[${factorR.source.channel}]`
        : factorR.source.field)
    : null;
  return { pre, post, factor };
}

/** Scale the raw int-encoded factor field into a multiplier. Direct
 *  firmware emission, no derivation noise. Returns a new Float32Array;
 *  the source field cache is not mutated. */
function scaleDirectFactor(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] * BF_TPA_SCALE;
  return out;
}

// Hydrate pre/post + direct factor for selected axis across every loaded log.
watchEffect(() => {
  const axis = selectedAxis.value;
  for (const { log } of logEntries.value) {
    const { pre, post, factor } = resolvePerLog(log, axis);
    const wants: string[] = [];
    if (pre)    wants.push(pre);
    if (post)   wants.push(post);
    if (factor) wants.push(factor);
    if (wants.length > 0) {
      session.ensureFields(log.id, wants).catch(() => {});
    }
  }
});

// Active log readouts for stats / pending message.
const activeResolved = computed(() => {
  const id = activeLog.activeId.value;
  if (!id) return { pre: null, post: null, factor: null };
  const log = session.logs.get(id);
  if (!log) return { pre: null, post: null, factor: null };
  return resolvePerLog(log, selectedAxis.value);
});

const activePreArr = computed<Float32Array | undefined>(() =>
  activeResolved.value.pre ? activeLog.fields.value.get(activeResolved.value.pre) : undefined,
);
const activePostArr = computed<Float32Array | undefined>(() =>
  activeResolved.value.post ? activeLog.fields.value.get(activeResolved.value.post) : undefined,
);
const activeFactorArr = computed<Float32Array | undefined>(() =>
  activeResolved.value.factor ? activeLog.fields.value.get(activeResolved.value.factor) : undefined,
);

const isHydrating = computed(() => {
  const pre    = activeResolved.value.pre;
  const post   = activeResolved.value.post;
  const factor = activeResolved.value.factor;
  return (pre    !== null && activeLog.hydrating.value.has(pre))  ||
         (post   !== null && activeLog.hydrating.value.has(post)) ||
         (factor !== null && activeLog.hydrating.value.has(factor));
});

const activeAnalysis = computed<STermAxisAnalysis | null>(() => {
  const pre  = activePreArr.value;
  const post = activePostArr.value;
  if (!pre || !post) return null;
  // Prefer firmware-direct TPA factor when resolvable (continuous,
  // no derivation noise from post/pre at threshold borderlines).
  const factor = activeFactorArr.value;
  if (factor) {
    return analyzeSTermAxisDirect(selectedAxis.value, pre, scaleDirectFactor(factor));
  }
  return analyzeSTermAxis(selectedAxis.value, pre, post);
});

const modules = computed(() => {
  const r = activeLog.scanReport.value;
  if (!r) return null;
  return evaluateModules(r.capability);
});
const moduleState = computed(() => {
  const m = modules.value;
  if (!m) return null;
  return m.sTermTpaViz[axisSpec.value.label.toLowerCase() as 'roll' | 'pitch' | 'yaw'];
});

const ready = computed(() =>
  activePreArr.value !== undefined &&
  activePostArr.value !== undefined &&
  activeLog.time.value.length > 0 &&
  activeAnalysis.value !== null,
);

const refTime = useSessionRefTime();

interface LogTraces {
  entry: LogEntry;
  preArr: Float32Array;
  postArr: Float32Array;
  factorArr: Float32Array;
}

const allTraces = computed<LogTraces[]>(() => {
  const out: LogTraces[] = [];
  const axis = selectedAxis.value;
  for (const entry of visibleEntries.value) {
    const { pre, post, factor } = resolvePerLog(entry.log, axis);
    if (!pre || !post) continue;
    const preArr  = entry.log.fields.get(pre);
    const postArr = entry.log.fields.get(post);
    if (!preArr || !postArr || preArr.length === 0 || postArr.length === 0) continue;
    // Direct factor preferred when available + hydrated; otherwise
    // fall back to derive-from-post-pre with hold-last on NaN gaps.
    const directRaw = factor ? entry.log.fields.get(factor) : undefined;
    let factorArr: Float32Array;
    if (directRaw && directRaw.length > 0) {
      factorArr = scaleDirectFactor(directRaw);
    } else {
      const a = analyzeSTermAxis(axis, preArr, postArr);
      factorArr = holdLastNaN(a.tpaFactorSeries);
    }
    out.push({ entry, preArr, postArr, factorArr });
  }
  return out;
});

const data = computed<AlignedData>(() => {
  if (!ready.value || refTime.value.length === 0 || allTraces.value.length === 0) {
    return [
      new Float32Array(0),
      new Float32Array(0),
      new Float32Array(0),
      new Float32Array(0),
    ] as unknown as AlignedData;
  }
  const series: Float32Array[] = [];
  for (const t of allTraces.value) {
    series.push(resampleOntoRef(t.entry.log, refTime.value, t.preArr));
    series.push(resampleOntoRef(t.entry.log, refTime.value, t.postArr));
    series.push(resampleOntoRef(t.entry.log, refTime.value, t.factorArr));
  }
  return [refTime.value, ...series] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const traces = allTraces.value;
  // Single-log mode: skip family tinting so the footer-legend swatches
  // (raw COLORS.*) match the on-chart line colors. Multi-log keeps the
  // tinting so each log's traces are distinguishable by family hue.
  const multiLog = traces.length > 1;
  const series: Series[] = [{}];
  for (const t of traces) {
    const fam = t.entry.family;
    series.push({
      label: `${t.entry.log.name} pre-TPA S`,
      stroke: multiLog ? tintTowardFamily(COLORS.warn, fam) : COLORS.warn,
      width: 1,
      scale: 'y',
    });
    series.push({
      label: `${t.entry.log.name} post-TPA S`,
      stroke: multiLog ? tintTowardFamily(COLORS.accent, fam) : COLORS.accent,
      width: 1.5,
      scale: 'y',
    });
    series.push({
      label: `${t.entry.log.name} TPA factor`,
      stroke: multiLog ? tintTowardFamily(COLORS.factor, fam) : COLORS.factor,
      width: 0.75,
      scale: 'y2',
    });
  }
  // Dynamic y2 ceiling — BF TPA factor can boost above 1.0 at low
  // airspeed (HYPERBOLIC curve THR0 often > 1.0 means amplification,
  // not attenuation). Keep a floor of 1.5 so the y=1.0 reference line
  // stays comfortably mid-axis on logs without significant boost.
  let factorMax = 1.5;
  for (const t of traces) {
    for (let i = 0; i < t.factorArr.length; i++) {
      const v = t.factorArr[i];
      if (Number.isFinite(v) && v > factorMax) factorMax = v;
    }
  }
  const y2Top = Math.min(3.0, factorMax * 1.05);
  return {
    width: 800,
    height: 300,
    legend: { show: false },
    scales: {
      x:  { time: false, range: sessionTimeRangeFn },
      y:  { auto: true },
      y2: { auto: false, range: [-0.05, y2Top] },
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
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

function resetZoom() { plot.resetZoom(); }
function selectAxis(id: 0 | 1 | 2) { selectedAxis.value = id; }

const pendingMessage = computed(() => {
  if (isHydrating.value) return `hydrating S-term pre/post on ${axisSpec.value.label.toLowerCase()}…`;
  const ms = moduleState.value;
  if (ms && ms.state === 'blocked') return ms.reason ?? 'S-term TPA viz blocked on this log';
  if (ms && ms.state === 'inactive') return ms.reason ?? 'S-term inactive on this axis';
  if (!activeResolved.value.pre)  return 'pre-TPA S signal not resolvable — set `debug_mode = S_TERM` in BF';
  if (!activeResolved.value.post) return 'post-TPA S (axisS) not present — USE_WING firmware build required';
  if (!activeLog.time.value.length) return 'time axis empty — load a log first';
  return 'computing S-term TPA analysis…';
});

const meanAttenText = computed(() => {
  const a = activeAnalysis.value;
  return a ? `${(a.meanAttenuation * 100).toFixed(0)} %` : '—';
});
const minFactorText = computed(() => {
  const a = activeAnalysis.value;
  return a ? a.minTpaFactor.toFixed(2) : '—';
});
const activePctText = computed(() => {
  const a = activeAnalysis.value;
  return a ? `${a.activePct.toFixed(0)} %` : '—';
});
const attenToneClass = computed(() => {
  const a = activeAnalysis.value;
  if (!a) return 'text-bp-ink';
  if (a.meanAttenuation >= 0.4) return 'text-bp-stamp';
  if (a.meanAttenuation >= 0.15) return 'text-bp-warn';
  return 'text-bp-ink';
});

const multiLogNote = computed(() => {
  const n = visibleEntries.value.length;
  if (n <= 1) return '';
  const drawing = allTraces.value.length;
  if (drawing < n) {
    return `${drawing} of ${n} logs · session time · ${n - drawing} dropped (no S-term signals)`;
  }
  return `${n} logs · session time · stats + pending shown for active log only`;
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
          {{ multiLogNote || 'pre-TPA vs post-TPA S contribution · factor = post / pre' }}
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="ready" class="flex gap-3 items-baseline">
          <div
            class="text-right cursor-help"
            title="Average attenuation TPA applied to the S-term across the flight, where S was active. 0% = TPA never scaled S down; higher = TPA actively reducing S authority at speed."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">mean atten</div>
            <div class="font-mono text-[13px]" :class="attenToneClass">{{ meanAttenText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="The lowest TPA factor reached — the single most-attenuated moment. 1.00 = TPA never engaged on S; below 1 = S was scaled down that much at peak."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">min factor</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ minFactorText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Percentage of the flight where the S-term was meaningfully active (above the noise threshold) — the fraction of the log this comparison is computed over."
          >
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
