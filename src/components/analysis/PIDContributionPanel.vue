<script setup lang="ts">
// First real M2 analytics surface: per-term PIDFS decomposition.
//
// Reads the controller-output traces (axisP/I/D/F/S) for the selected
// axis, renders each as its own series, and computes mean-abs term
// shares via Layer 2's `lib/pidfs.ts`. Toggle chips in the header:
// click to show/hide a term, shift-click to solo (show only that term;
// shift-click again to restore all).
//
// M1.7.1 multi-log: chart x is SESSION time; each visible log
// contributes its present PIDFS terms + reference traces (setpoint,
// gyro), each tinted toward the log's family color. Chip toggles
// affect EVERY visible log uniformly via `toggleSeriesForAllLogs` —
// soloing "P" hides every other present term across all logs. Mean-
// abs share strip + cursor readout remain anchored to the active
// log (flip the eye to inspect another log's term balance). Missing
// terms per log (e.g. axisD/axisS on yaw — wings commonly log neither)
// are skipped per-log: that log just doesn't contribute that trace,
// but other logs may.

import { computed, ref, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options, Series } from 'uplot';

import { useSessionStore, type LogState } from '@/stores/session';
import { useActiveLog } from '@/composables/useActiveLog';
import { useAlignedTime } from '@/composables/useAlignedTime';
import { useViewStore, type CursorSample } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { useChartPinnedCursor } from '@/composables/useChartPinnedCursor';
import { useCursorSamples } from '@/composables/useCursorSamples';
import { nearestTimeIndex } from '@/lib/dtype';
import { pidfsShares, type PIDFSArrays, type PIDFSTerm } from '@/lib/pidfs';
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

type AxisId = 0 | 1 | 2;
type AxisSpec = {
  id: AxisId;
  short: 'R' | 'P' | 'Y';
  label: string;
};

const AXES: AxisSpec[] = [
  { id: 0, short: 'R', label: 'Roll' },
  { id: 1, short: 'P', label: 'Pitch' },
  { id: 2, short: 'Y', label: 'Yaw' },
];

type TermSpec = {
  term: PIDFSTerm;
  color: string;
  hint: string;
};

const TERM_SPECS: TermSpec[] = [
  { term: 'P', color: '#7ec8ff', hint: 'Proportional to error' },
  { term: 'I', color: '#b6c7e0', hint: 'Integral of error over time' },
  { term: 'D', color: '#ff8a7a', hint: 'Derivative of error' },
  { term: 'F', color: '#6ed3a0', hint: 'Feedforward from setpoint' },
  { term: 'S', color: '#ffc46a', hint: 'Static / saturation gain (PIDFS)' },
];

type ReferenceId = 'setpoint' | 'gyro';
type ReferenceSpec = {
  id: ReferenceId;
  short: string;
  field: (axis: AxisId) => string;
  color: string;
  hint: string;
  tone: CursorSample['tone'];
  dash?: number[];
};
const REFERENCE_SPECS: ReferenceSpec[] = [
  {
    id: 'setpoint',
    short: 'set',
    field: (a) => `setpoint[${a}]`,
    color: '#eef4ff',
    hint: 'Setpoint · what the PIDs are chasing (deg/s)',
    tone: 'ink',
    dash: [2, 4],
  },
  {
    id: 'gyro',
    short: 'gyr',
    field: (a) => `gyroADC[${a}]`,
    color: '#d97bc8',
    hint: 'Gyro · the actual rate the PIDs are reacting to (deg/s)',
    tone: 'stamp',
  },
];

const COLORS = {
  ink3:  '#7a90b0',
  line:  '#1f3a5a',
  dim:   '#4a5e7e',
} as const;

/** Symmetric-around-zero range — keeps PID (y) + deg/s (degs) zero
 *  lines on the same y-pixel so phase/shape comparison reads clean. */
function symmetric(min: number, max: number): [number, number] {
  const abs = Math.max(Math.abs(min), Math.abs(max)) || 1;
  return [-abs, abs];
}

const selectedAxis = ref<AxisId>(0);
const axisSpec = computed(() => AXES[selectedAxis.value]);

const session = useSessionStore();
const view = useViewStore();
const activeLog = useActiveLog();
const { hiddenSeries } = storeToRefs(view);

const fieldNameFor = (term: PIDFSTerm, axis: AxisId) => `axis${term}[${axis}]`;

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
const visibleLogIds = computed(() => visibleEntries.value.map((e) => e.log.id));

// Hydrate PIDFS quintet + setpoint/gyro across every loaded log for
// the selected axis. ensureFields tolerates missing-in-log entries.
watchEffect(() => {
  const axis = selectedAxis.value;
  const wants = [
    ...TERM_SPECS.map((t) => fieldNameFor(t.term, axis)),
    ...REFERENCE_SPECS.map((r) => r.field(axis)),
  ];
  for (const { log } of logEntries.value) {
    session.ensureFields(log.id, wants).catch(() => {});
  }
});

// Union of present terms across all visible logs. A term renders a
// chip if ANY visible log has it; per-log absence just skips that
// log's series for that term.
const allPresent = computed<Record<PIDFSTerm, boolean>>(() => {
  const out: Record<PIDFSTerm, boolean> = { P: false, I: false, D: false, F: false, S: false };
  const axis = selectedAxis.value;
  for (const { log } of visibleEntries.value) {
    for (const spec of TERM_SPECS) {
      const arr = log.fields.get(fieldNameFor(spec.term, axis));
      if (arr && arr.length > 0) out[spec.term] = true;
    }
  }
  return out;
});

const presentTerms = computed(() => TERM_SPECS.filter((t) => allPresent.value[t.term]));

const allPresentRefs = computed<Record<ReferenceId, boolean>>(() => {
  const out: Record<ReferenceId, boolean> = { setpoint: false, gyro: false };
  const axis = selectedAxis.value;
  for (const { log } of visibleEntries.value) {
    for (const spec of REFERENCE_SPECS) {
      const arr = log.fields.get(spec.field(axis));
      if (arr && arr.length > 0) out[spec.id] = true;
    }
  }
  return out;
});

const presentRefs = computed(() => REFERENCE_SPECS.filter((r) => allPresentRefs.value[r.id]));

// Active log's term arrays — used for the mean-abs share strip and
// the cursor readout. Other logs' shares aren't surfaced at N≥2
// (chip strip would explode); flip the eye to inspect another log.
const activeTermArrays = computed<PIDFSArrays>(() => {
  const out: PIDFSArrays = {};
  const axis = selectedAxis.value;
  for (const t of presentTerms.value) {
    const arr = activeLog.fields.value.get(fieldNameFor(t.term, axis));
    if (arr && arr.length > 0) out[t.term] = arr;
  }
  return out;
});

const activeRefArrays = computed<Record<ReferenceId, Float32Array | undefined>>(() => {
  const out: Record<ReferenceId, Float32Array | undefined> = { setpoint: undefined, gyro: undefined };
  const axis = selectedAxis.value;
  for (const r of presentRefs.value) {
    const arr = activeLog.fields.value.get(r.field(axis));
    if (arr && arr.length > 0) out[r.id] = arr;
  }
  return out;
});

const shares = computed(() => pidfsShares(activeTermArrays.value));

const isHydrating = computed(() => {
  const axis = selectedAxis.value;
  const wants = [
    ...TERM_SPECS.map((t) => fieldNameFor(t.term, axis)),
    ...REFERENCE_SPECS.map((r) => r.field(axis)),
  ];
  return wants.some((n) => activeLog.hydrating.value.has(n));
});

const ready = computed(
  () => activeLog.time.value.length > 0 && presentTerms.value.length > 0,
);

const refTime = useSessionRefTime();
const activeAlign = useAlignedTime(() => activeLog.activeId.value);

// --- per-log traces ---

interface LogTraceItem {
  kind: 'term' | 'ref';
  term?: PIDFSTerm;
  refId?: ReferenceId;
  field: string;
  baseColor: string;
  arr: Float32Array;
}

interface LogTraceBundle {
  entry: LogEntry;
  items: LogTraceItem[];
}

const allTraces = computed<LogTraceBundle[]>(() => {
  const out: LogTraceBundle[] = [];
  const axis = selectedAxis.value;
  for (const entry of visibleEntries.value) {
    const items: LogTraceItem[] = [];
    for (const spec of presentTerms.value) {
      const field = fieldNameFor(spec.term, axis);
      const arr = entry.log.fields.get(field);
      if (!arr || arr.length === 0) continue;
      items.push({ kind: 'term', term: spec.term, field, baseColor: spec.color, arr });
    }
    for (const spec of presentRefs.value) {
      const field = spec.field(axis);
      const arr = entry.log.fields.get(field);
      if (!arr || arr.length === 0) continue;
      items.push({ kind: 'ref', refId: spec.id, field, baseColor: spec.color, arr });
    }
    if (items.length > 0) out.push({ entry, items });
  }
  return out;
});

const data = computed<AlignedData>(() => {
  if (!ready.value || refTime.value.length === 0 || allTraces.value.length === 0) {
    return [new Float32Array(0)] as unknown as AlignedData;
  }
  const series: Float32Array[] = [];
  for (const t of allTraces.value) {
    for (const item of t.items) {
      series.push(resampleOntoRef(t.entry.log, refTime.value, item.arr));
    }
  }
  return [refTime.value, ...series] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const series: Series[] = [{}];
  for (const t of allTraces.value) {
    const fam = t.entry.family;
    for (const item of t.items) {
      const tinted = tintTowardFamily(item.baseColor, fam);
      if (item.kind === 'term') {
        series.push({
          label: `${t.entry.log.name} ${item.term}`,
          stroke: tinted,
          width: 1.1,
        });
      } else {
        const refSpec = REFERENCE_SPECS.find((r) => r.id === item.refId)!;
        series.push({
          label: `${t.entry.log.name} ${refSpec.short}`,
          stroke: tinted,
          width: 1.1,
          scale: 'degs',
          ...(refSpec.dash ? { dash: refSpec.dash } : {}),
        });
      }
    }
  }
  const anyRefVisible = presentRefs.value.some((r) => !isChipHidden(r.id));
  return {
    width: 600,
    height: 240,
    legend: { show: false },
    scales: {
      x: { time: false, range: sessionTimeRangeFn },
      y:    { auto: true, range: (_u, min, max) => symmetric(min, max) },
      degs: { auto: true, range: (_u, min, max) => symmetric(min, max) },
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
      },
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        size:   50,
      },
      {
        scale:  'degs',
        side:   1,
        stroke: COLORS.dim,
        grid:   { show: false },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        size:   42,
        show:   anyRefVisible,
      },
    ],
    hooks: {
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          if (idx == null) {
            view.clearCursorIfNotPinned();
            return;
          }
          if (view.cursorPinned) return;
          const t = u.data[0][idx];
          if (typeof t === 'number') view.setCursor(t);
        },
      ],
    },
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });
const { pinnedPx } = useChartPinnedCursor({ plot, host: hostRef });

// --- chip toggles (now act across all visible logs uniformly) ---

function fieldKeyFor(id: PIDFSTerm | ReferenceId): string {
  if (id === 'setpoint' || id === 'gyro') {
    const r = REFERENCE_SPECS.find((s) => s.id === id)!;
    return r.field(selectedAxis.value);
  }
  return fieldNameFor(id, selectedAxis.value);
}

/** Chip is "hidden" if hidden across EVERY visible log — matches the
 *  ServoPanel chip pattern. Mixed state (some show, some hide) reads
 *  as visible so the toggle still does something sensible. */
function isChipHidden(id: PIDFSTerm | ReferenceId): boolean {
  const ids = visibleLogIds.value;
  if (ids.length === 0) return false;
  return view.isSeriesHiddenForAllLogs(fieldKeyFor(id), ids);
}

function onChipClick(term: PIDFSTerm, ev: MouseEvent) {
  const axis = selectedAxis.value;
  const myField = fieldNameFor(term, axis);
  const ids = visibleLogIds.value;
  if (ids.length === 0) return;
  if (ev.shiftKey) {
    // Solo across all visible logs: this term visible everywhere,
    // every OTHER present term hidden everywhere. Second shift-click
    // restores all term visibility (refs untouched).
    const others = TERM_SPECS
      .filter((t) => allPresent.value[t.term] && t.term !== term)
      .map((t) => fieldNameFor(t.term, axis));
    const key = (id: string, f: string) => `${id}:${f}`;
    const alreadySoloed = ids.every((id) =>
      !view.isSeriesHidden(id, myField) &&
      others.every((f) => view.isSeriesHidden(id, f)),
    );
    const next = new Set(hiddenSeries.value);
    for (const id of ids) {
      if (alreadySoloed) {
        next.delete(key(id, myField));
        for (const f of others) next.delete(key(id, f));
      } else {
        next.delete(key(id, myField));
        for (const f of others) next.add(key(id, f));
      }
    }
    view.hiddenSeries = next;
  } else {
    view.toggleSeriesForAllLogs(myField, ids);
  }
}

function onRefChipClick(id: ReferenceId) {
  const ids = visibleLogIds.value;
  if (ids.length === 0) return;
  view.toggleSeriesForAllLogs(fieldKeyFor(id), ids);
}

function syncSeriesVisibility() {
  const u = plot.instance();
  if (!u) return;
  let seriesIdx = 1;
  for (const t of allTraces.value) {
    for (const item of t.items) {
      const show = !view.isSeriesHidden(t.entry.log.id, item.field);
      if (u.series[seriesIdx] && u.series[seriesIdx].show !== show) {
        u.setSeries(seriesIdx, { show });
      }
      seriesIdx += 1;
    }
  }
}

watchEffect(() => {
  if (!plot.ready.value) return;
  void (plot as { updateCount?: { value: number } }).updateCount?.value;
  syncSeriesVisibility();
});

function selectAxis(id: AxisId) {
  selectedAxis.value = id;
}

function resetZoom() {
  plot.resetZoom();
}

const allHidden = computed(
  () => presentTerms.value.length > 0 && presentTerms.value.every((t) => isChipHidden(t.term)),
);

const dominantColor = computed(() => {
  const d = shares.value.dominant;
  if (!d) return COLORS.dim;
  return TERM_SPECS.find((t) => t.term === d)!.color;
});

// --- live cursor sample contributions (active log only) ---

const TERM_TONE: Record<PIDFSTerm, CursorSample['tone']> = {
  P: 'accent',
  I: 'ink',
  D: 'stamp',
  F: 'ok',
  S: 'warn',
};

const { cursorTime } = storeToRefs(view);
const liveSamples = computed<CursorSample[]>(() => {
  if (!ready.value || cursorTime.value === null) return [];
  // Project session cursor to active log's local axis.
  const localCursor = activeAlign.alignedCursor.value;
  if (localCursor === null) return [];
  const idx = nearestTimeIndex(activeLog.time.value, localCursor);
  if (idx === null) return [];
  const ax = axisSpec.value.label;
  const termRows = presentTerms.value
    .filter((t) => !isChipHidden(t.term))
    .map<CursorSample | null>((t) => {
      const arr = activeTermArrays.value[t.term];
      if (!arr) return null;
      return {
        label: `${t.term}${axisSpec.value.short}`,
        value: (arr[idx] as number).toFixed(0),
        tone: TERM_TONE[t.term],
        hint: `${t.term}-term · ${ax} — ${t.hint}`,
      };
    })
    .filter((r): r is CursorSample => r !== null);
  const refRows = presentRefs.value
    .filter((r) => !isChipHidden(r.id))
    .map<CursorSample | null>((r) => {
      const arr = activeRefArrays.value[r.id];
      if (!arr) return null;
      return {
        label: `${r.short}${axisSpec.value.short}`,
        value: (arr[idx] as number).toFixed(0),
        tone: r.tone,
        hint: `${ax} — ${r.hint}`,
      };
    })
    .filter((r): r is CursorSample => r !== null);
  return [...termRows, ...refRows];
});
useCursorSamples({ sourceKey: 'pid', samples: liveSamples });

const multiLogNote = computed(() => {
  const n = visibleEntries.value.length;
  if (n <= 1) return 'click to toggle · shift-click to solo';
  return `${n} logs · session time · chips toggle across all logs · shares + readout show active log`;
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          PID contribution · {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          {{ multiLogNote }}
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-2 items-center">
        <div class="flex gap-1 items-center">
          <button
            v-for="t in presentTerms"
            :key="t.term"
            type="button"
            class="flex items-center gap-1.5 px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer transition-colors"
            :style="{
              background: isChipHidden(t.term) ? 'transparent' : `${t.color}1f`,
              borderColor: isChipHidden(t.term) ? 'var(--color-bp-line-2)' : t.color,
              color: isChipHidden(t.term) ? 'var(--color-bp-ink-3)' : t.color,
            }"
            :title="t.hint + (isChipHidden(t.term) ? ' · hidden' : '')"
            :aria-pressed="!isChipHidden(t.term)"
            @click="(ev) => onChipClick(t.term, ev)"
          >
            <span
              class="inline-block w-2.5 h-0.5"
              :style="{ background: isChipHidden(t.term) ? 'var(--color-bp-line-2)' : t.color }"
            />
            {{ t.term }}
          </button>
        </div>

        <div
          v-if="presentRefs.length > 0"
          class="w-px h-4 bg-bp-line-2"
          aria-hidden="true"
        />

        <div v-if="presentRefs.length > 0" class="flex gap-1 items-center">
          <button
            v-for="r in presentRefs"
            :key="r.id"
            type="button"
            class="flex items-center gap-1.5 px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer transition-colors"
            :style="{
              background: isChipHidden(r.id) ? 'transparent' : `${r.color}1f`,
              borderColor: isChipHidden(r.id) ? 'var(--color-bp-line-2)' : r.color,
              color: isChipHidden(r.id) ? 'var(--color-bp-ink-3)' : r.color,
            }"
            :title="r.hint + (isChipHidden(r.id) ? ' · hidden' : '')"
            :aria-pressed="!isChipHidden(r.id)"
            @click="onRefChipClick(r.id)"
          >
            <span
              class="inline-block w-2.5 h-0.5"
              :style="{ background: isChipHidden(r.id) ? 'var(--color-bp-line-2)' : r.color }"
            />
            {{ r.short }}
          </button>
        </div>

        <div class="flex gap-px">
          <button
            v-for="ax in AXES"
            :key="ax.id"
            type="button"
            class="px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer"
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
          class="px-2 py-[3px] bg-bp-surface-2 border border-bp-line-2 text-bp-ink-3 font-mono text-[11px] font-semibold cursor-pointer hover:text-bp-ink"
          title="Reset zoom"
          @click="resetZoom"
        >⤺</button>
      </div>
    </header>

    <div class="relative px-3 py-3 min-h-[260px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        <span v-if="isHydrating">hydrating {{ axisSpec.label.toLowerCase() }} PIDFS terms…</span>
        <span v-else>no PIDFS terms present on {{ axisSpec.label.toLowerCase() }} — try another axis</span>
      </div>

      <div ref="hostRef" class="w-full relative">
        <div
          v-if="pinnedPx !== null"
          class="absolute top-0 bottom-0 w-px bg-bp-accent pointer-events-none z-10"
          :style="{
            left: `${pinnedPx}px`,
            boxShadow: '0 0 6px var(--color-bp-accent)',
          }"
        />
      </div>

      <div
        v-if="allHidden"
        class="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-bp-ink-3 pointer-events-none"
      >
        all terms hidden — click a chip above
      </div>
    </div>

    <!-- per-term share strip (active log only) -->
    <footer
      v-if="ready && shares.totalAbs > 0"
      class="border-t border-bp-line px-3 py-2"
    >
      <div class="flex justify-between items-baseline mb-1.5">
        <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3">
          mean-abs share · active log
        </span>
        <span class="font-mono text-[10.5px] text-bp-ink-3">
          dominant ·
          <span class="font-bold" :style="{ color: dominantColor }">
            {{ shares.dominant ?? '—' }}
          </span>
        </span>
      </div>
      <div class="flex h-2 overflow-hidden bg-bp-surface-2 border border-bp-line-2 rounded-sm">
        <div
          v-for="t in presentTerms"
          :key="t.term"
          class="h-full"
          :style="{
            width: `${(shares[t.term] * 100).toFixed(2)}%`,
            background: isChipHidden(t.term) ? 'var(--color-bp-line-2)' : t.color,
            opacity: isChipHidden(t.term) ? 0.4 : 1,
          }"
          :title="`${t.term} · ${(shares[t.term] * 100).toFixed(1)}%`"
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 font-mono text-[10.5px]">
        <span
          v-for="t in presentTerms"
          :key="t.term"
          :style="{ color: isChipHidden(t.term) ? 'var(--color-bp-dim)' : t.color }"
        >
          {{ t.term }} {{ (shares[t.term] * 100).toFixed(1) }}%
        </span>
      </div>
    </footer>
  </section>
</template>
