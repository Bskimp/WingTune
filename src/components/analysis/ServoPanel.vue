<script setup lang="ts">
// Actuator-output panel — multi-trace render of every PWM-output
// channel in the log. Wings log control surfaces under `servo[N]` and
// the pusher under `motor[N]`; both are surfaced here so the user
// sees the full set of physical actuators driving the airframe.
//
// M1.7 Push 3b — multi-log: chart overlays traces from every loaded
// log, each tinted toward its family color so per-log differences in
// the same channel are visible side-by-side. Footer chips, saturation
// strips, and stats remain anchored to the active (first) log because
// per-log expansion of those would explode vertical space at N≥3.
// Per-channel chips at the bottom toggle that single (active-log,
// channel) — the multi-log mass-toggle path would need a per-channel
// chip per log which gets unmanageable for 8 servos × 3 logs.
//
// Time axis: chart x is SESSION time (`log.time[i] + log.timeOffsetSec`).
// Each log's data array is resampled onto the reference x using
// nearest-sample lookup against its own aligned time, so a non-zero
// `timeOffsetSec` visibly shifts that log's traces left/right relative
// to the others (M1.7.1 — drag the ⟷ on a roster chip to set offsets).
// The active log's cursor readout projects `view.cursorTime` (session
// time) back to the active log's local axis via `useAlignedTime`.
// Assumes uniform sample rate per log (BF logs are uniform); if a
// non-uniform log ever shows up we'll need to swap the O(1) index
// math for a binary search.
//
// Labels:
//   · `servo[N]` → "Servo N · unknown" (or classified role + confidence
//     mark via the preset → correlation → user-override path)
//   · `motor[N]` → "Motor N" (a motor is a motor; no classifier)
//
// Servos render first so the actual control-surface channels are the
// visual lead; motors follow. Multi-log traces inherit this ordering
// per log.

import { computed, onMounted, ref, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options, Series } from 'uplot';

import { useSessionStore, type LogState } from '@/stores/session';
import { useActiveLog } from '@/composables/useActiveLog';
import { useAlignedTime } from '@/composables/useAlignedTime';
import type { ScanReport } from '@/lib/wasmBridge';
import { useViewStore, type CursorSample } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';
import { useChartPinnedCursor } from '@/composables/useChartPinnedCursor';
import { useCursorSamples } from '@/composables/useCursorSamples';
import { nearestTimeIndex } from '@/lib/dtype';
import {
  resampleOntoRef,
  sessionTimeRangeFn,
  useSessionRefTime,
} from '@/lib/sessionTime';
import {
  detectSaturation,
  type SaturationConfig,
  type SaturationResult,
} from '@/lib/servoAnalysis';
import { smoothTrace } from '@/lib/displaySmooth';
import {
  classifyServos,
  ROLE_LABELS,
  type ClassifiedChannel,
} from '@/lib/servoClassifier';
import { parseServoConfig } from '@/lib/servoMixer';
import {
  familyForIndex,
  tintTowardFamily,
  type FamilySpec,
} from '@/lib/logColors';

// Per-axis-hue cycle for channels. Each log's channels start from this
// cycle and then tinted toward the log's family color.
const CHANNEL_BASE_COLORS = [
  '#7ec8ff',
  '#ffc46a',
  '#6ed3a0',
  '#ff8a7a',
  '#b6c7e0',
  '#7a90b0',
] as const;

const MAX_CHANNELS = 16;
const RANGE_THRESHOLD_PWM = 10;

const session = useSessionStore();
const view = useViewStore();
const activeLog = useActiveLog();
const { time, fields, hydrating, scanReport } = activeLog;

type ChannelKind = 'servo' | 'motor';

type ChannelSpec = {
  fieldName: string;
  index: number;
  kind: ChannelKind;
  label: string;
  /** Base color (untinted). Per-log render tints this toward the
   *  log family. The active-log footer chips use this raw. */
  color: string;
};

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

/** Detect servo/motor channels from a scan report's fields_present.
 *  Servos first (by index), then motors. */
function channelsFromReport(report: ScanReport): ChannelSpec[] {
  const pattern = /^(servo|motor)\[(\d+)\]$/;
  const raw = report.capability.fields_present
    .map((name) => ({ name, m: pattern.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null);
  raw.sort((a, b) => {
    if (a.m[1] !== b.m[1]) return a.m[1] === 'servo' ? -1 : 1;
    return Number(a.m[2]) - Number(b.m[2]);
  });
  return raw.slice(0, MAX_CHANNELS).map(({ name, m }, i) => {
    const kind = m[1] as ChannelKind;
    const idx = Number(m[2]);
    return {
      fieldName: name,
      index: idx,
      kind,
      label: kind === 'servo' ? `Servo ${idx} · unknown` : `Motor ${idx}`,
      color: CHANNEL_BASE_COLORS[i % CHANNEL_BASE_COLORS.length],
    };
  });
}

// Active log's channels — drives the footer chip row and saturation
// strips. Multi-log overlays read per-log channels independently.
const channels = computed<ChannelSpec[]>(() =>
  scanReport.value ? channelsFromReport(scanReport.value) : [],
);

// Eager-hydrate channel fields + setpoint refs for every loaded log.
// Each log gets its own ensureFields call routed by logId.
watchEffect(() => {
  const setpointFields = ['setpoint[0]', 'setpoint[1]', 'setpoint[2]'];
  for (const { log } of logEntries.value) {
    if (!log.scanReport) continue;
    const chans = channelsFromReport(log.scanReport);
    const names = chans.map((c) => c.fieldName);
    const all = [...names, ...setpointFields];
    if (all.length === 0) continue;
    session.ensureFields(log.id, all).catch(() => {
      // Hydration failures are recorded on the log's scanError;
      // the chart just renders without that log's data.
    });
  }
});

// Re-trigger hydration once on mount in case the watchEffect missed
// the initial frame (shouldn't, but safe and free).
onMounted(() => {
  for (const { log } of logEntries.value) {
    if (!log.scanReport) continue;
    const all = channelsFromReport(log.scanReport).map((c) => c.fieldName);
    if (all.length > 0) session.ensureFields(log.id, all).catch(() => {});
  }
});

const isHydrating = computed(() =>
  channels.value.some((c) => hydrating.value.has(c.fieldName)),
);

const allActiveHydrated = computed(() =>
  channels.value.length > 0 &&
  channels.value.every((c) => (fields.value.get(c.fieldName)?.length ?? 0) > 0),
);

/** Active-log channels that actually moved (post-range filter). */
const activeChannels = computed<ChannelSpec[]>(() => {
  if (!allActiveHydrated.value) return channels.value;
  return channels.value.filter((c) => {
    const arr = fields.value.get(c.fieldName)!;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return (max - min) > RANGE_THRESHOLD_PWM;
  });
});

const inactiveCount = computed(() =>
  allActiveHydrated.value ? channels.value.length - activeChannels.value.length : 0,
);

const servoCount = computed(() => activeChannels.value.filter((c) => c.kind === 'servo').length);
const motorCount = computed(() => activeChannels.value.filter((c) => c.kind === 'motor').length);

const activeChannelArrays = computed<Float32Array[]>(() =>
  activeChannels.value.map((c) => fields.value.get(c.fieldName) ?? new Float32Array(0)),
);

// Decoded servo mixer + per-servo params from the BBL header (empty
// on stock-BF logs that don't carry the smix/servoParam table).
const servoConfig = computed(() => parseServoConfig(scanReport.value?.header_params));

const saturationByChannel = computed<Map<string, SaturationResult>>(() => {
  const out = new Map<string, SaturationResult>();
  const params = servoConfig.value.servoParams;
  activeChannels.value.forEach((c, i) => {
    const arr = activeChannelArrays.value[i];
    if (!arr || arr.length === 0) return;
    // Use the channel's real PWM endpoints when the log carries the
    // servoParam table; otherwise detectSaturation falls back to its
    // 1000 / 2000 defaults.
    let cfg: SaturationConfig | undefined;
    if (c.kind === 'servo') {
      const sp = params.find((p) => p.servoIndex === c.index);
      if (sp) cfg = { minPwm: Math.min(sp.min, sp.max), maxPwm: Math.max(sp.min, sp.max) };
    }
    out.set(c.fieldName, detectSaturation(arr, cfg));
  });
  return out;
});

const classifications = computed<Map<string, ClassifiedChannel>>(() => {
  const r = scanReport.value;
  if (!r) return new Map();
  const servoMap = new Map<string, Float32Array>();
  activeChannels.value.forEach((c, i) => {
    if (c.kind !== 'servo') return;
    const arr = activeChannelArrays.value[i];
    if (arr && arr.length > 0) servoMap.set(c.fieldName, arr);
  });
  if (servoMap.size === 0) return new Map();
  const setpointRoll  = fields.value.get('setpoint[0]') ?? new Float32Array(0);
  const setpointPitch = fields.value.get('setpoint[1]') ?? new Float32Array(0);
  const setpointYaw   = fields.value.get('setpoint[2]') ?? new Float32Array(0);
  const results = classifyServos({
    smixRules: servoConfig.value.smixRules,
    mixerName: r.header_params?.['mixer'] ?? null,
    servos: servoMap,
    setpointRoll,
    setpointPitch,
    setpointYaw,
  });
  const out = new Map<string, ClassifiedChannel>();
  for (const res of results) out.set(res.fieldName, res);
  return out;
});

function labelFor(c: ChannelSpec): string {
  if (c.kind === 'motor') return `Motor ${c.index}`;
  const cls = classifications.value.get(c.fieldName);
  if (!cls || cls.role === 'unknown') return `Servo ${c.index} · unknown`;
  return `Servo ${c.index} · ${ROLE_LABELS[cls.role]}`;
}

function confidenceMark(c: ChannelSpec): string {
  if (c.kind === 'motor') return '';
  const cls = classifications.value.get(c.fieldName);
  if (!cls) return '';
  switch (cls.confidence) {
    case 'confident':    return '✓';
    case 'inferred':     return '~';
    case 'unclassified': return '?';
  }
}

function confidenceTitle(c: ChannelSpec): string {
  if (c.kind === 'motor') return '';
  const cls = classifications.value.get(c.fieldName);
  if (!cls) return '';
  switch (cls.confidence) {
    case 'confident':
      return cls.via === 'smix'
        ? "Confident: decoded from the log's smix servo-mixer table"
        : `Confident: matched preset "${cls.presetName ?? 'unknown'}"`;
    case 'inferred':
      return `Inferred from setpoint correlation (r = ${cls.correlationScore?.toFixed(2) ?? '?'})`;
    case 'unclassified':
      return 'Unclassified — channel did not correlate strongly with any axis';
  }
}

const worstSaturationPct = computed(() => {
  let worst = 0;
  for (const r of saturationByChannel.value.values()) {
    const pct = r.saturatedFraction * 100;
    if (pct > worst) worst = pct;
  }
  return worst;
});

const worstSaturationTone = computed(() => {
  const p = worstSaturationPct.value;
  if (p >= 10) return 'text-bp-stamp';
  if (p >= 2)  return 'text-bp-warn';
  return 'text-bp-ok';
});

const ready = computed(() =>
  time.value.length > 0 &&
  activeChannelArrays.value.length > 0 &&
  activeChannelArrays.value.every((a) => a.length > 0),
);

interface LogChannelTrace {
  entry: LogEntry;
  chans: ChannelSpec[];
  arrs: Float32Array[];
}

/** Per-log trace bundle for the chart. Each visible log contributes its
 *  own (post-range-filter) channel list. Channel arrays are aligned by
 *  index against the active log's time axis — see panel header for the
 *  same-rate caveat. */
const allTraces = computed<LogChannelTrace[]>(() => {
  const out: LogChannelTrace[] = [];
  for (const entry of visibleEntries.value) {
    if (!entry.log.scanReport) continue;
    const chans = channelsFromReport(entry.log.scanReport);
    // post-range filter, mirrors activeChannels logic
    const arrs: Float32Array[] = [];
    const kept: ChannelSpec[] = [];
    for (const c of chans) {
      const arr = entry.log.fields.get(c.fieldName);
      if (!arr || arr.length === 0) continue;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if ((max - min) <= RANGE_THRESHOLD_PWM) continue;
      kept.push(c);
      arrs.push(arr);
    }
    out.push({ entry, chans: kept, arrs });
  }
  return out;
});

// Session-time x-axis (longest aligned-time among visible logs) — see
// `src/lib/sessionTime.ts` for the load-bearing precision + NaN
// lessons baked into these helpers.
const refTime = useSessionRefTime();

const data = computed<AlignedData>(() => {
  if (!ready.value || refTime.value.length === 0) {
    return [new Float32Array(0)] as unknown as AlignedData;
  }
  const smooth = view.smoothingStrength;
  const series: Float32Array[] = [];
  for (const t of allTraces.value) {
    for (const a of t.arrs) {
      series.push(smoothTrace(resampleOntoRef(t.entry.log, refTime.value, a), smooth));
    }
  }
  return [refTime.value, ...series] as unknown as AlignedData;
});

// M1.7.1 — project session-time cursor back to the active log's local
// axis for the readout below. Reactive on activeId (eye-toggle moves
// focus) and on the active log's `timeOffsetSec` (drag-shift).
const activeAlign = useAlignedTime(() => activeLog.activeId.value);

const opts = computed<Options>(() => {
  const series: Series[] = [{}];
  for (const t of allTraces.value) {
    const fam = t.entry.family;
    for (const c of t.chans) {
      const tinted = tintTowardFamily(c.color, fam);
      series.push({
        label: `${t.entry.log.name} ${c.fieldName}`,
        stroke: tinted,
        width: 1.1,
      });
    }
  }
  return {
    width: 800,
    height: 320,
    legend: { show: false },
    scales: {
      x: {
        time: false,
        // Session-time x — force uPlot to refit on every setData.
        // See sessionTime.ts for why this is necessary.
        range: sessionTimeRangeFn,
      },
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
        stroke: '#7a90b0',
        grid:   { stroke: '#1f3a5a', width: 0.5 },
        ticks:  { stroke: '#1f3a5a', width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
      },
      {
        stroke: '#7a90b0',
        grid:   { stroke: '#1f3a5a', width: 0.5 },
        ticks:  { stroke: '#1f3a5a', width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        size:   50,
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

// Per-(log × channel) visibility sync. Series order matches
// allTraces.value iteration: log 0 ch 0..M, log 1 ch 0..N, etc.
const { hiddenSeries } = storeToRefs(view);

function syncSeriesVisibility() {
  const u = plot.instance();
  if (!u) return;
  let seriesIdx = 1;
  for (const t of allTraces.value) {
    const logId = t.entry.log.id;
    for (const c of t.chans) {
      const show = !view.isSeriesHidden(logId, c.fieldName);
      if (u.series[seriesIdx] && u.series[seriesIdx].show !== show) {
        u.setSeries(seriesIdx, { show });
      }
      seriesIdx += 1;
    }
  }
}

// watchEffect auto-tracks every reactive read inside
// syncSeriesVisibility (allTraces, hiddenSeries via isSeriesHidden,
// activeId via the loop, plot.updateCount via the explicit touch).
// Covers chip toggles, eye toggles, log add/remove, and uPlot rebuilds
// (which reset every series.show to default-true).
watchEffect(() => {
  if (!plot.ready.value) return;
  void (plot as { updateCount?: { value: number } }).updateCount?.value;
  syncSeriesVisibility();
});

/** Footer chip click — toggles only the active log's series for this
 *  channel. The multi-log mass-toggle path (every loaded log at once)
 *  would need a per-log chip row which gets crowded at N≥3; for now
 *  the chip controls the active log only. */
function toggleChannel(fieldName: string) {
  const activeId = activeLog.activeId.value;
  if (!activeId) return;
  view.toggleSeries(activeId, fieldName);
}

function isChannelHiddenActive(fieldName: string): boolean {
  const activeId = activeLog.activeId.value;
  if (!activeId) return false;
  return view.isSeriesHidden(activeId, fieldName);
}

const { cursorTime } = storeToRefs(view);
const liveSamples = computed<CursorSample[]>(() => {
  if (!ready.value || cursorTime.value === null) return [];
  // cursorTime lives in session time; project to active log's local
  // axis via its offset before indexing the active log's arrays.
  const localCursor = activeAlign.alignedCursor.value;
  if (localCursor === null) return [];
  const idx = nearestTimeIndex(time.value, localCursor);
  if (idx === null) return [];
  return activeChannels.value
    .filter((c) => !isChannelHiddenActive(c.fieldName))
    .map((c) => {
      const cls = classifications.value.get(c.fieldName);
      const roleLabel = cls && cls.role !== 'unknown' ? ROLE_LABELS[cls.role] : c.fieldName;
      return {
        label: roleLabel,
        value: (fields.value.get(c.fieldName)?.[idx] ?? 0).toFixed(0),
        tone: (c.kind === 'motor' ? 'ok' : 'ink') as CursorSample['tone'],
        hint: c.kind === 'motor'
          ? `Motor channel ${c.index} — raw PWM output (µs)`
          : `${c.fieldName} → ${roleLabel} (${cls?.confidence ?? 'unknown'}) — raw PWM output (µs)`,
      };
    });
});
useCursorSamples({ sourceKey: 'servos', samples: liveSamples });

function resetZoom() {
  plot.resetZoom();
}

const multiLogNote = computed(() => {
  const n = visibleEntries.value.length;
  if (n <= 1) return '';
  return `${n} logs · session time · drag ⟷ on a roster chip to align · chips + sat strips show active log only`;
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header
      class="flex justify-between items-center px-3 py-2 border-b border-bp-line"
    >
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink">
          Actuator outputs · raw PWM
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          {{
            multiLogNote ||
            'servo[i] control surfaces and motor[i] pusher channels · drag inside to zoom'
          }}
        </div>
      </div>

      <div class="flex gap-3.5 items-center">
        <div class="text-right">
          <div class="font-sans text-[9px] tracking-[0.2em] uppercase font-bold text-bp-ink-3">servos</div>
          <div class="font-mono text-[13px] text-bp-ink">{{ servoCount }}</div>
        </div>
        <div class="text-right">
          <div class="font-sans text-[9px] tracking-[0.2em] uppercase font-bold text-bp-ink-3">motors</div>
          <div class="font-mono text-[13px] text-bp-ink">{{ motorCount }}</div>
        </div>
        <div v-if="inactiveCount > 0" class="text-right" :title="`${inactiveCount} channel(s) declared by firmware but unwired (range < ${RANGE_THRESHOLD_PWM} µs)`">
          <div class="font-sans text-[9px] tracking-[0.2em] uppercase font-bold text-bp-ink-3">inactive</div>
          <div class="font-mono text-[13px] text-bp-dim">{{ inactiveCount }}</div>
        </div>
        <div class="text-right" title="Highest per-channel saturation: time the channel was pegged at the PWM endpoint (within 25 µs)">
          <div class="font-sans text-[9px] tracking-[0.2em] uppercase font-bold text-bp-ink-3">worst sat</div>
          <div class="font-mono text-[13px]" :class="worstSaturationTone">{{ worstSaturationPct.toFixed(1) }} %</div>
        </div>
        <button
          type="button"
          class="px-2.5 py-[3px] bg-bp-surface-2 border border-bp-line-2 text-bp-ink-3 font-mono text-[11px] font-semibold cursor-pointer hover:text-bp-ink"
          title="Reset zoom"
          @click="resetZoom"
        >⤺ reset</button>
      </div>
    </header>

    <div class="relative px-3 py-3 min-h-[336px]">
      <div
        v-if="channels.length === 0"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        <span class="text-bp-ink-2 mb-1">no servo[i] or motor[i] channels in this log</span>
        <span>check that motor/servo output logging is enabled in the BF blackbox config</span>
      </div>

      <div
        v-else-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3"
      >
        <span v-if="isHydrating">hydrating {{ channels.length }} channel(s)…</span>
        <span v-else>channel data not yet available</span>
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

      <!-- Saturation strips: active log only. Per-log strips at N≥2
           would explode vertical space; reading the active log's
           saturation is the actionable signal anyway (recommendations
           land on the active log). -->
      <div
        v-if="ready"
        class="mt-2 flex flex-col gap-px font-mono text-[10px] text-bp-ink-3"
      >
        <div
          v-for="c in activeChannels.filter((c) => !isChannelHiddenActive(c.fieldName))"
          :key="c.fieldName + '-sat'"
          class="flex items-center gap-2 h-3"
        >
          <span class="w-20 shrink-0 truncate text-right">{{ c.fieldName }}</span>
          <div class="flex-1 h-full bg-bp-bg border border-bp-line-2 relative overflow-hidden">
            <div
              v-for="(ep, i) in (saturationByChannel.get(c.fieldName)?.episodeList ?? [])"
              :key="i"
              class="absolute top-0 bottom-0"
              :style="{
                left: `${(ep.startIdx / (activeChannelArrays[0]?.length ?? 1)) * 100}%`,
                width: `${Math.max(0.2, ((ep.endIdx - ep.startIdx + 1) / (activeChannelArrays[0]?.length ?? 1)) * 100)}%`,
                background: ep.kind === 'low' ? 'var(--color-bp-warn)' : 'var(--color-bp-stamp)',
                opacity: 0.85,
              }"
              :title="`${ep.kind === 'low' ? 'Low' : 'High'} endpoint · ${ep.durationMs.toFixed(0)} ms`"
            />
          </div>
          <span
            class="w-12 shrink-0 text-right tabular-nums"
            :class="(saturationByChannel.get(c.fieldName)?.saturatedFraction ?? 0) >= 0.1
              ? 'text-bp-stamp'
              : (saturationByChannel.get(c.fieldName)?.saturatedFraction ?? 0) >= 0.02
                ? 'text-bp-warn'
                : 'text-bp-ink-3'"
            :title="(() => {
              const r = saturationByChannel.get(c.fieldName);
              if (!r) return '';
              return `${r.lowHits} low · ${r.highHits} high · longest ${r.longestRunMs.toFixed(0)} ms`;
            })()"
          >
            {{ ((saturationByChannel.get(c.fieldName)?.saturatedFraction ?? 0) * 100).toFixed(1) }}%
          </span>
        </div>
      </div>
    </div>

    <footer
      class="flex flex-wrap items-center px-3 py-2 gap-x-4 gap-y-1 border-t border-bp-line text-[10.5px]"
    >
      <button
        v-for="c in activeChannels"
        :key="c.fieldName"
        type="button"
        class="flex items-center gap-1.5 font-sans bg-transparent border-0 p-0 cursor-pointer transition-opacity"
        :class="isChannelHiddenActive(c.fieldName)
          ? 'opacity-40 text-bp-dim line-through'
          : 'opacity-100 text-bp-ink-2 hover:text-bp-ink'"
        :title="isChannelHiddenActive(c.fieldName)
          ? 'Click to show'
          : confidenceTitle(c) || 'Click to hide'"
        :aria-pressed="!isChannelHiddenActive(c.fieldName)"
        @click="toggleChannel(c.fieldName)"
      >
        <span
          class="inline-block w-3.5 h-0.5"
          :style="{ background: isChannelHiddenActive(c.fieldName) ? 'var(--color-bp-dim)' : c.color }"
        />
        <span class="font-mono">{{ c.fieldName }}</span>
        <span class="font-sans">· {{ labelFor(c).split('·').pop()?.trim() ?? '' }}</span>
        <span
          v-if="confidenceMark(c)"
          class="font-mono text-[10px]"
          :class="{
            'text-bp-ok':   confidenceMark(c) === '✓',
            'text-bp-warn': confidenceMark(c) === '~',
            'text-bp-dim':  confidenceMark(c) === '?',
          }"
        >{{ confidenceMark(c) }}</span>
      </button>
      <span
        v-if="inactiveCount > 0"
        class="font-mono text-[10.5px] text-bp-dim ml-auto"
        :title="`Channels declared by the firmware but with PWM range under ${RANGE_THRESHOLD_PWM} µs — typically unwired servo slots`"
      >
        {{ inactiveCount }} declared but unwired (hidden)
      </span>
    </footer>
  </section>
</template>
