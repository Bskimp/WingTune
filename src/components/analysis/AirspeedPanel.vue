<script setup lang="ts">
// Airspeed panel — fits BF's BASIC airspeed model against GPS 3D speed,
// renders the two traces overlaid, and exposes the recovered tuning
// params in the header.
//
// Required hydrated fields:
//   · rcCommand[3]  — throttle (BF 1000..2000 raw; normalised to 0..1)
//   · vbatLatest    — battery voltage (volts; unit-tagged by parser)
//   · gps:GPS_speed — GPS 3D speed in m/s (Velocity-tagged on parser side)
//
// Optional:
//   · attitude[1]   — pitch (Signed deci-degrees; converted to radians).
//                     When missing the panel falls back to assuming level
//                     flight (pitch=0); the fit still runs but the
//                     gravity term is physically unconstrained.
//
// M1.7.1 multi-log: chart x is SESSION time; each visible log fits its
// OWN BASIC model from its own GPS data (fits are independent per log)
// and contributes a (gps, predicted) pair tinted toward its family
// color. Outside each log's fit window (the GPS-locked sub-range of
// the log) traces clamp-extend to the edge value — visually this
// reads as a flat segment at log boundaries, which is benign for the
// compare workflow. Fit window text, fitted params (delay, gravity),
// max voltage (read from the log header, not fitted), R²/RMS, and
// cursor readout all remain anchored to the active log; flip the eye
// to inspect another log's fit.

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
import {
  buildAirspeedFitInputs,
  fitBasicAirspeedModel,
  resolveAirspeedPitchField,
  type AirspeedFitResult,
  type BuiltInputs,
} from '@/lib/airspeedFit';
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
  ink2:   '#b6c7e0',
  line:   '#1f3a5a',
  accent: '#7ec8ff',
  warn:   '#ffc46a',
} as const;

const REQUIRED_FIELDS = [
  'rcCommand[3]',
  'vbatLatest',
  'gps:GPS_speed',
] as const;

const session = useSessionStore();
const view = useViewStore();
const activeLog = useActiveLog();

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

// Hydrate required fields + the registry-resolved pitch field across
// every loaded log. Pitch resolves per-log (USE_WING wingTpaPitch /
// DEBUG_TPA ch2 / raw attitude[1]).
watchEffect(() => {
  for (const { log } of logEntries.value) {
    const pitchField = resolveAirspeedPitchField(log.scanReport?.capability);
    session
      .ensureFields(log.id, [...REQUIRED_FIELDS, pitchField])
      .catch(() => {});
  }
});

const isHydrating = computed(() =>
  REQUIRED_FIELDS.some((f) => activeLog.hydrating.value.has(f)),
);

// Active log readouts.
const activeBuilt = computed<BuiltInputs | null>(() =>
  buildAirspeedFitInputs({
    time:        activeLog.time.value,
    gpsTimeSec:  activeLog.gpsTimeSec.value,
    fields:      activeLog.fields.value,
    headerParams: activeLog.scanReport.value?.header_params,
    capability:  activeLog.scanReport.value?.capability,
  }),
);

const activeFit = computed<AirspeedFitResult | null>(() => {
  const b = activeBuilt.value;
  if (!b) return null;
  return fitBasicAirspeedModel(b.inputs);
});

const ready = computed(() => activeFit.value !== null);

const refTime = useSessionRefTime();
const activeAlign = useAlignedTime(() => activeLog.activeId.value);

// --- per-log fits ---

interface LogFitBundle {
  entry: LogEntry;
  built: BuiltInputs;
  result: AirspeedFitResult;
}

const allFits = computed<LogFitBundle[]>(() => {
  const out: LogFitBundle[] = [];
  for (const entry of visibleEntries.value) {
    const built = buildAirspeedFitInputs({
      time:        entry.log.time,
      gpsTimeSec:  entry.log.gpsTimeSec,
      fields:      entry.log.fields,
      headerParams: entry.log.scanReport?.header_params,
      capability:  entry.log.scanReport?.capability,
    });
    if (!built) continue;
    const result = fitBasicAirspeedModel(built.inputs);
    out.push({ entry, built, result });
  }
  return out;
});

const data = computed<AlignedData>(() => {
  if (!ready.value || refTime.value.length === 0 || allFits.value.length === 0) {
    return [
      new Float32Array(0),
      new Float32Array(0),
      new Float32Array(0),
    ] as unknown as AlignedData;
  }
  const series: Float32Array[] = [];
  for (const f of allFits.value) {
    // Both gpsSpeed and predicted are indexed by built.inputs.time
    // (the GPS-trimmed fit window, a sub-range of log.time). Pass it
    // as the localTime override so resample maps correctly.
    series.push(resampleOntoRef(f.entry.log, refTime.value, f.built.inputs.gpsSpeed, f.built.inputs.time));
    series.push(resampleOntoRef(f.entry.log, refTime.value, f.result.predicted,    f.built.inputs.time));
  }
  return [refTime.value, ...series] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const series: Series[] = [{}];
  for (const f of allFits.value) {
    const fam = f.entry.family;
    series.push({
      label: `${f.entry.log.name} gps speed`,
      stroke: tintTowardFamily(COLORS.ink2, fam),
      width: 1,
      dash: [4, 2],
    });
    series.push({
      label: `${f.entry.log.name} predicted`,
      stroke: tintTowardFamily(COLORS.accent, fam),
      width: 1.25,
    });
  }
  return {
    width: 800,
    height: 280,
    legend: { show: false },
    scales: {
      x: { time: false, range: sessionTimeRangeFn },
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
      },
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
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

function resetZoom() { plot.resetZoom(); }

const fitWindowText = computed(() => {
  const b = activeBuilt.value;
  if (!b) return '';
  const t = b.inputs.time;
  const off = activeAlign.offsetSec.value;
  // Surface the window in session time so it matches the chart x-axis.
  return `${(t[0] + off).toFixed(1)}–${(t[t.length - 1] + off).toFixed(1)}s · ${t.length.toLocaleString()} samples`;
});

const maxVoltageTooltip = computed(() => {
  const b = activeBuilt.value;
  if (!b) return '';
  return b.maxVoltageSource === 'header'
    ? `Battery max voltage, V×100 — read from this log's saved BF config (tpa_speed_max_voltage). A known physical input, NOT fitted: it is degenerate with the gravity parameter, so fitting it yields unphysical values.`
    : `Battery max voltage, V×100 — ESTIMATED from peak logged battery voltage (this log's header had no tpa_speed_max_voltage). Not fitted. Set tpa_speed_max_voltage in BF for an exact value.`;
});

const { cursorTime } = storeToRefs(view);
const liveSamples = computed<CursorSample[]>(() => {
  const result = activeFit.value;
  const b = activeBuilt.value;
  if (!result || !b || cursorTime.value === null) return [];
  // Project session cursor to active log's local time before indexing
  // the fit-window arrays.
  const localCursor = activeAlign.alignedCursor.value;
  if (localCursor === null) return [];
  const idx = nearestTimeIndex(b.inputs.time, localCursor);
  if (idx === null) return [];
  const gps = b.inputs.gpsSpeed[idx];
  const pred = result.predicted[idx];
  const resid = pred - gps;
  return [
    {
      label: 'gps',
      value: `${gps.toFixed(1)} m/s`,
      tone: 'ink',
      hint: 'GPS 3D speed — ground truth from satellite',
    },
    {
      label: 'model',
      value: `${pred.toFixed(1)} m/s`,
      tone: 'accent',
      hint: 'Predicted airspeed from the fitted BASIC model',
    },
    {
      label: 'err',
      value: `${resid >= 0 ? '+' : ''}${resid.toFixed(1)} m/s`,
      tone: Math.abs(resid) > 5 ? 'warn' : 'ok',
      hint: 'Model − GPS (positive: model over-predicts speed)',
    },
  ];
});
useCursorSamples({ sourceKey: 'airspeed', samples: liveSamples });

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating airspeed-fit fields…';
  const throttle = activeLog.fields.value.get('rcCommand[3]');
  const vbat     = activeLog.fields.value.get('vbatLatest');
  const gps      = activeLog.fields.value.get('gps:GPS_speed');
  const missing: string[] = [];
  if (!throttle?.length) missing.push('rcCommand[3] (throttle)');
  if (!vbat?.length)     missing.push('vbatLatest');
  if (!gps?.length) {
    if (activeLog.gpsTimeSec.value.length === 0) {
      return 'no GPS frames in this log — log either has no GPS module or GPS never locked';
    }
    missing.push('gps:GPS_speed');
  }
  if (activeLog.gpsTimeSec.value.length < 2) return 'GPS axis has < 2 samples — cannot fit';
  if (missing.length > 0) return `missing required fields: ${missing.join(', ')}`;
  return 'preparing fit…';
});

const multiLogNote = computed(() => {
  const n = visibleEntries.value.length;
  if (n <= 1) return '';
  const drawing = allFits.value.length;
  if (drawing < n) {
    return `${drawing} of ${n} logs · session time · ${n - drawing} dropped (no GPS / missing fields) · params + readout show active log only`;
  }
  return `${n} logs · session time · params + readout show active log only · traces clamp-extend outside each log's fit window`;
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header
      class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3"
    >
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Airspeed estimator &middot; BASIC model fit
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          <template v-if="multiLogNote">{{ multiLogNote }}</template>
          <template v-else>
            predicted vs GPS 3D speed
            <template v-if="activeFit"> &middot; fit window {{ fitWindowText }}</template>
            <template v-if="activeBuilt?.pitchFromFallback">
              &middot;
              <span class="text-bp-warn">no pitch field — level flight assumed</span>
            </template>
          </template>
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="activeFit" class="flex gap-3 items-baseline">
          <div
            class="text-right cursor-help"
            title="BASIC-model throttle-to-airspeed lag: how long after a throttle change the modelled airspeed responds. A fitted tpa_speed_basic CLI parameter."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">delay ms</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ Math.round(activeFit.params.delayMs) }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="How much of the modelled speed change the fit attributes to climb/descent (gravity) versus thrust. A fitted tpa_speed_basic CLI parameter."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">gravity %</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ Math.round(activeFit.params.gravityPct) }}</div>
          </div>
          <div
            class="text-right cursor-help"
            :title="maxVoltageTooltip"
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">max V&times;100</div>
            <div class="font-mono text-[13px] text-bp-ink">
              {{ activeBuilt?.inputs.maxVoltageX100 ?? '—' }}<span
                v-if="activeBuilt?.maxVoltageSource === 'vbat-fallback'"
                class="text-bp-warn text-[9px] ml-0.5 align-top"
              >est</span>
            </div>
          </div>
          <div
            class="text-right cursor-help"
            title="Fit quality, 0-1: the fraction of GPS-speed variance the model explains. Above 0.7 = reliable fit (green rec with paste-ready CLI); below 0.7 = drifty (analysis-only, no CLI)."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">R&sup2;</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ activeFit.rSquared.toFixed(3) }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Root-mean-square residual in m/s — the model's average airspeed prediction error versus GPS 3D speed."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">RMS</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ activeFit.rmsResidual.toFixed(1) }}</div>
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

    <div class="relative px-3 py-3 min-h-[296px]">
      <div
        v-if="!ready"
        class="absolute inset-0 flex flex-col items-center justify-center font-mono text-[11px] text-bp-ink-3 text-center px-6"
      >
        {{ pendingMessage }}
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
    </div>

    <footer
      class="flex justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px]"
    >
      <div class="flex gap-4 items-center font-sans text-bp-ink-2">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5 bg-bp-accent" />
          predicted
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block w-3.5"
            style="border-top: 1.5px dashed var(--color-bp-ink-2);"
          />
          gps
        </span>
      </div>
      <div v-if="activeFit" class="font-mono text-bp-ink-3">
        {{ activeFit.iterations }} iter &middot; {{ activeFit.converged ? 'converged' : 'iter cap' }}
      </div>
    </footer>
  </section>
</template>
