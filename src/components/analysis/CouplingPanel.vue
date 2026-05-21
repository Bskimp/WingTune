<script setup lang="ts">
// M-Coupling — cross-axis coupling matrix panel.
//
// "The wing rolls fine but pitches weirdly when I correct" — command
// one axis hard and watch the other two. A 3x3 grid: rows = commanded
// axis, columns = responding axis. Each off-diagonal cell is how hard
// the column axis moved when the row axis was snapped, as a fraction
// of the commanded response.
//
// Coupling is measured ONLY inside the single-axis snap windows from
// lib/maneuverDetect — in sustained flight a banked turn naturally
// trades pitch authority, and a whole-flight correlation would read
// that aerodynamically-expected coupling as a fault. The analysis math
// is in lib/coupling (Layer 2); this panel only displays it.
//
// Diagnostic-only — a hot cell points at mixer balance / CG / a
// mechanical bind, none of which has a firmware `set` fix. No CLI.
//
// Single-log (useActiveLog) — flip the LogRoster eye to analyze a
// different log.

import { computed, onMounted } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import { detectManeuvers } from '@/lib/maneuverDetect';
import {
  analyzeCoupling,
  MIN_WINDOWS_FOR_COUPLING,
  SIGNIFICANT_COUPLING,
  type CouplingResult,
} from '@/lib/coupling';

type Axis = 0 | 1 | 2;
type HealthTone = 'green' | 'yellow' | 'red' | 'dim';

interface AxisSpec { id: Axis; label: string; }
const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll' },
  { id: 1, label: 'Pitch' },
  { id: 2, label: 'Yaw' },
];

const HEALTH_COLOR: Record<HealthTone, string> = {
  green:  'var(--color-bp-ok)',
  yellow: 'var(--color-bp-warn)',
  red:    'var(--color-bp-stamp)',
  dim:    'var(--color-bp-dim)',
};

const WANTED_FIELDS = [
  'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
  'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]',
];

const logStore = useActiveLog();
const { time, fields, hydrating } = logStore;

onMounted(() => { logStore.ensureFields(WANTED_FIELDS); });

const isHydrating = computed(() =>
  WANTED_FIELDS.some((f) => hydrating.value.has(f)),
);

// Maneuver detection needs all three setpoint axes (cross-axis
// classification picks the single dominant commanded axis per window).
const maneuvers = computed(() => {
  if (time.value.length < 3) return [];
  const sp = [0, 1, 2].map((a) => fields.value.get(`setpoint[${a}]`));
  if (!sp.some(Boolean)) return [];
  return detectManeuvers(sp, time.value);
});

const couplingResult = computed<CouplingResult | null>(() => {
  if (time.value.length < 3) return null;
  const gyro = [0, 1, 2].map((a) => fields.value.get(`gyroADC[${a}]`));
  if (!gyro.some(Boolean)) return null;
  return analyzeCoupling({ gyro, time: time.value, maneuvers: maneuvers.value });
});

// Single-axis snap windows actually usable for coupling, across all
// commanded axes. Zero means every detected maneuver was compound.
const singleAxisCount = computed(() => {
  const r = couplingResult.value;
  return r ? r.sampleCount[0] + r.sampleCount[1] + r.sampleCount[2] : 0;
});

const ready = computed(() =>
  couplingResult.value !== null && singleAxisCount.value > 0,
);

/** Tone for an off-diagonal |coupling| magnitude. Green below the
 *  significance threshold, red at twice it. */
function cellTone(magnitude: number): HealthTone {
  if (magnitude >= 2 * SIGNIFICANT_COUPLING) return 'red';
  if (magnitude >= SIGNIFICANT_COUPLING) return 'yellow';
  return 'green';
}

interface CouplingCell {
  respondingAxis: Axis;
  isDiagonal: boolean;
  /** Off-diagonal cell with a finite measured value. */
  hasData: boolean;
  magnitudePct: number;
  tone: HealthTone;
  title: string;
}
interface CouplingRow {
  commandedAxis: Axis;
  label: string;
  /** Single-axis maneuver windows for this commanded axis. */
  windows: number;
  /** Below MIN_WINDOWS_FOR_COUPLING — the row is greyed, not trusted. */
  underSampled: boolean;
  cells: CouplingCell[];
}

const gridRows = computed<CouplingRow[]>(() => {
  const r = couplingResult.value;
  if (!r) return [];
  return AXES.map((cmd) => {
    const windows = r.sampleCount[cmd.id];
    const underSampled = windows < MIN_WINDOWS_FOR_COUPLING;
    const cells: CouplingCell[] = AXES.map((resp) => {
      const isDiagonal = cmd.id === resp.id;
      const value = r.matrix[cmd.id][resp.id];
      const finite = Number.isFinite(value);
      const magnitude = finite ? Math.abs(value) : 0;
      const magnitudePct = Math.round(magnitude * 100);

      let tone: HealthTone;
      let title: string;
      if (isDiagonal) {
        tone = 'dim';
        title = `${cmd.label} — the commanded axis itself`;
      } else if (windows === 0) {
        tone = 'dim';
        title = `No isolated ${cmd.label.toLowerCase()} snaps detected`;
      } else if (!finite) {
        tone = 'dim';
        title = `${resp.label} gyro not logged`;
      } else if (underSampled) {
        tone = 'dim';
        title =
          `${cmd.label} inputs perturb ${resp.label.toLowerCase()} by ~${magnitudePct}%`
          + ` · only ${windows}/${MIN_WINDOWS_FOR_COUPLING} windows — low confidence`;
      } else {
        tone = cellTone(magnitude);
        title =
          `${cmd.label} inputs perturb ${resp.label.toLowerCase()} by ${magnitudePct}%`
          + ` (signed ${value >= 0 ? '+' : ''}${value.toFixed(2)}) · ${windows} windows`
          + (tone === 'green'
            ? ' · within tolerance'
            : ' · check mixer balance / CG / a mechanical bind');
      }
      return {
        respondingAxis: resp.id,
        isDiagonal,
        hasData: finite && !isDiagonal,
        magnitudePct,
        tone,
        title,
      };
    });
    return { commandedAxis: cmd.id, label: cmd.label, windows, underSampled, cells };
  });
});

// Worst coupling among rows with enough windows to trust — the header
// readout. lib/coupling's worstCoupling() ignores the sample gate; the
// header wants the worst TRUSTWORTHY cell, so it is recomputed here.
const worstTrusted = computed(() => {
  const r = couplingResult.value;
  if (!r) return null;
  let best: { cmd: Axis; resp: Axis; value: number } | null = null;
  for (let c = 0 as Axis; c <= 2; c = (c + 1) as Axis) {
    if (r.sampleCount[c] < MIN_WINDOWS_FOR_COUPLING) continue;
    for (let rr = 0 as Axis; rr <= 2; rr = (rr + 1) as Axis) {
      if (c === rr) continue;
      const v = r.matrix[c][rr];
      if (!Number.isFinite(v)) continue;
      if (!best || Math.abs(v) > Math.abs(best.value)) {
        best = { cmd: c, resp: rr, value: v };
      }
    }
  }
  return best;
});

const worstText = computed(() => {
  const w = worstTrusted.value;
  if (!w) return '—';
  return `${AXES[w.cmd].label} → ${AXES[w.resp].label.toLowerCase()}  ${Math.round(Math.abs(w.value) * 100)}%`;
});
const worstTone = computed<HealthTone>(() => {
  const w = worstTrusted.value;
  return w ? cellTone(Math.abs(w.value)) : 'dim';
});

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating gyro / setpoint…';
  if (time.value.length < 3) return 'load a log to analyze cross-axis coupling';
  if (maneuvers.value.length === 0) {
    return 'no aggressive inputs detected — coupling is measured during fast snaps. '
      + 'Fly snap rolls / sharp pitch reversals so the cross-axis response has something to read.';
  }
  if (singleAxisCount.value === 0) {
    return `${maneuvers.value.length} maneuver(s) detected, but all were compound (multi-axis). `
      + 'Coupling needs isolated single-axis snaps to attribute the response to one commanded axis.';
  }
  return 'computing cross-axis coupling…';
});

const flagPct = Math.round(SIGNIFICANT_COUPLING * 100);
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Cross-axis coupling
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          does a command on one axis disturb the others &middot; rows = commanded, columns = responding
        </div>
      </div>

      <div v-if="ready" class="flex gap-3 items-baseline">
        <div
          class="text-right cursor-help"
          title="Largest cross-axis coupling among commanded axes with enough single-axis maneuvers to trust."
        >
          <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">worst coupling</div>
          <div class="font-mono text-[13px]" :style="{ color: HEALTH_COLOR[worstTone] }">{{ worstText }}</div>
        </div>
        <div
          class="text-right cursor-help"
          title="Isolated single-axis snap windows — coupling is measured only inside these."
        >
          <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">single-axis snaps</div>
          <div class="font-mono text-[13px] text-bp-ink">{{ singleAxisCount }}</div>
        </div>
        <div
          class="text-right cursor-help"
          title="All aggressive-input windows auto-detected from the setpoint derivative — includes compound multi-axis inputs, which coupling cannot attribute."
        >
          <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">maneuvers</div>
          <div class="font-mono text-[13px] text-bp-ink">{{ maneuvers.length }}</div>
        </div>
      </div>
    </header>

    <div class="px-3 py-3 min-h-[244px] flex flex-col justify-center">
      <div
        v-if="!ready"
        class="flex items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6 py-8"
      >
        {{ pendingMessage }}
      </div>

      <div v-else class="grid grid-cols-[5.25rem_repeat(3,minmax(0,1fr))] gap-1">
        <!-- corner -->
        <div class="flex items-end px-1 pb-1">
          <span class="font-mono text-[9px] text-bp-ink-3 whitespace-nowrap">cmd&nbsp;&darr;</span>
        </div>
        <!-- responding-axis column headers -->
        <div
          v-for="resp in AXES"
          :key="`head-${resp.id}`"
          class="flex items-end justify-center pb-1"
        >
          <span class="font-sans text-[10px] tracking-[0.16em] uppercase font-bold text-bp-ink-2">
            {{ resp.label }}
          </span>
        </div>

        <!-- rows: commanded-axis label + 3 cells -->
        <template v-for="row in gridRows" :key="`row-${row.commandedAxis}`">
          <div class="flex flex-col justify-center px-2 py-1.5 bg-bp-surface-2 border border-bp-line">
            <span class="font-sans text-[10px] tracking-[0.16em] uppercase font-bold text-bp-ink-2">
              {{ row.label }}
            </span>
            <span
              class="font-mono text-[9.5px] mt-0.5"
              :class="row.underSampled ? 'text-bp-warn' : 'text-bp-ink-3'"
              :title="row.underSampled
                ? `Only ${row.windows} of ${MIN_WINDOWS_FOR_COUPLING} single-axis ${row.label.toLowerCase()} snaps — this row is low-confidence`
                : `${row.windows} single-axis ${row.label.toLowerCase()} snap windows`"
            >
              {{ row.windows }}<template v-if="row.underSampled">/{{ MIN_WINDOWS_FOR_COUPLING }}</template> win
            </span>
          </div>

          <div
            v-for="cell in row.cells"
            :key="`cell-${row.commandedAxis}-${cell.respondingAxis}`"
            class="flex items-center justify-center min-h-[58px] border"
            :class="cell.isDiagonal
              ? 'bg-bp-surface border-bp-line'
              : 'bg-bp-surface-2 border-bp-line'"
            :title="cell.title"
          >
            <span v-if="cell.isDiagonal" class="font-mono text-[13px] text-bp-dim">&mdash;</span>
            <span v-else-if="!cell.hasData" class="font-mono text-[12px] text-bp-dim">&mdash;</span>
            <span
              v-else
              class="font-mono text-[15px] font-semibold"
              :style="{ color: HEALTH_COLOR[cell.tone] }"
            >{{ cell.magnitudePct }}%</span>
          </div>
        </template>
      </div>
    </div>

    <footer class="px-3 py-2 border-t border-bp-line">
      <div class="font-mono text-[10px] text-bp-ink-3 leading-relaxed">
        <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-accent mr-1.5">
          reading
        </span>
        each cell = how hard the column axis moved when the row axis was snapped, as a
        fraction of the commanded response. The diagonal is the commanded axis itself.
        &ge; {{ flagPct }}% is flagged &middot; measured only inside detected single-axis
        snaps, so a banked turn's natural pitch trade is not mistaken for a fault.
      </div>
      <div class="font-mono text-[10px] text-bp-ink-3 leading-relaxed mt-1">
        a hot cell points at mixer balance, CG, or a mechanical bind &mdash; diagnostic
        only, there is no firmware setting that fixes cross-axis coupling.
      </div>
    </footer>
  </section>
</template>
