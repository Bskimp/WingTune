<script setup lang="ts">
// M-FilterSim — per-stage gyro filter simulation.
//
// Betaflight logs only raw gyro (gyroUnfilt) and full-chain filtered
// gyro (gyroADC) — the NET effect of the filter chain, with no
// per-stage signal. This panel SIMULATES the chain (lib/bfFilters) so
// each stage becomes a toggle: flip RPM / LPF1 / dyn-notch and watch
// that stage's effect appear or vanish in the simulated PSD.
//
// The honesty check: the simulated FULL chain is compared against the
// logged gyroADC (validateChain). High simFidelity → the per-stage
// breakdown is trustworthy; low → the sim diverges (most likely the
// approximated dyn-notch peak track) and the panel says so, instead
// of presenting plausible fiction as fact.
//
// Single-log (useActiveLog) + per-axis — filter work is a focus-one
// task. Stacked on the Spectrum tab below the multi-log SpectrumPanel.

import { computed, onMounted, ref, watch } from 'vue';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useUPlot } from '@/composables/useUPlot';
import { welchPsd, psdToDb, estimateSampleRate } from '@/lib/spectrum';
import { resolveSignal, type Axis } from '@/lib/signalRegistry';
import {
  parseFilterParams,
  simulateChain,
  validateChain,
  type ChainStages,
} from '@/lib/bfFilters';

const COLORS = {
  ink3:   '#7a90b0',
  line:   '#1f3a5a',
  raw:    '#7a90b0', // raw gyro — dim reference
  sim:    '#7ec8ff', // simulated chain
  logged: '#7ee0a8', // logged gyroADC
} as const;

const SEGMENT_LEN = 1024;
/** Time-domain comparison skips this many leading samples — the sim's
 *  filter state starts at zero, the logged signal's did not. */
const WARMUP_SAMPLES = 2000;

type Tone = 'ok' | 'warn' | 'stamp';
const TONE_COLOR: Record<Tone, string> = {
  ok:    'var(--color-bp-ok)',
  warn:  'var(--color-bp-warn)',
  stamp: 'var(--color-bp-stamp)',
};

interface AxisSpec { id: Axis; label: string; short: 'R' | 'P' | 'Y'; }
const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R' },
  { id: 1, label: 'Pitch', short: 'P' },
  { id: 2, label: 'Yaw',   short: 'Y' },
];
const selectedAxis = ref<Axis>(0);
const axisSpec = computed(() => AXES[selectedAxis.value]);

interface StageSpec { key: keyof ChainStages; label: string; title: string; }
const STAGES: StageSpec[] = [
  { key: 'rpm', label: 'RPM', title: 'RPM filter — motor-harmonic notches placed from logged eRPM' },
  { key: 'lpf1', label: 'LPF1', title: 'Gyro lowpass 1 — static or throttle-scheduled cutoff' },
  { key: 'dynNotch', label: 'dyn-notch', title: 'Dynamic notch — peak track re-derived from the gyro spectrum' },
];
const stagesOn = ref<Required<ChainStages>>({ rpm: true, lpf1: true, dynNotch: true });

const logStore = useActiveLog();
const { scanReport, time, fields, hydrating } = logStore;

const sampleRateHz = computed(() => estimateSampleRate(time.value));

/** Raw-gyro field name for an axis — gyroUnfilt main-frame, or the
 *  DEBUG_GYRO_RAW debug channel. `null` when the log has no raw gyro. */
function rawGyroName(axis: Axis): string | null {
  const sr = scanReport.value;
  if (!sr) return null;
  const r = resolveSignal('gyro_raw', axis, sr.capability);
  if (r.state !== 'resolved') return null;
  return r.source.kind === 'main_frame'
    ? r.source.field
    : `debug[${r.source.channel}]`;
}

/** eRPM field names present in the log (one per motor with telemetry). */
const erpmNames = computed<string[]>(() => {
  const sr = scanReport.value;
  if (!sr) return [];
  const present = new Set(sr.capability.fields_present);
  const out: string[] = [];
  for (let m = 0; m < 8; m++) {
    if (present.has(`eRPM[${m}]`)) out.push(`eRPM[${m}]`);
  }
  return out;
});

const wantedFields = computed(() => {
  const out = [`gyroADC[${selectedAxis.value}]`, 'setpoint[3]', ...erpmNames.value];
  const raw = rawGyroName(selectedAxis.value);
  if (raw) out.push(raw);
  return out;
});

async function hydrate() {
  await logStore.ensureFields(wantedFields.value);
}
onMounted(hydrate);
watch(wantedFields, hydrate);

const isHydrating = computed(() =>
  wantedFields.value.some((f) => hydrating.value.has(f)),
);

const params = computed(() => {
  const sr = scanReport.value;
  return sr ? parseFilterParams(sr.header_params) : null;
});

const rawGyro = computed<Float32Array | null>(() => {
  const name = rawGyroName(selectedAxis.value);
  return name ? fields.value.get(name) ?? null : null;
});
const loggedGyro = computed<Float32Array | null>(
  () => fields.value.get(`gyroADC[${selectedAxis.value}]`) ?? null,
);
const erpm = computed<Float32Array[]>(() => {
  const out: Float32Array[] = [];
  for (const n of erpmNames.value) {
    const f = fields.value.get(n);
    if (f) out.push(f);
  }
  return out;
});
const throttle = computed<Float32Array | null>(() => {
  const sp = fields.value.get('setpoint[3]');
  if (!sp) return null;
  // setpoint[3] is throttle x 1000.
  const t = new Float32Array(sp.length);
  for (let i = 0; i < sp.length; i++) t[i] = sp[i] / 1000;
  return t;
});

const hasRawGyro = computed(() => rawGyroName(selectedAxis.value) !== null);
const ready = computed(() =>
  rawGyro.value != null
  && loggedGyro.value != null
  && params.value != null
  && sampleRateHz.value > 0
  && rawGyro.value.length >= SEGMENT_LEN,
);

function runChain(stages: ChainStages): Float32Array | null {
  if (!ready.value || !rawGyro.value || !params.value) return null;
  return simulateChain({
    rawGyro: rawGyro.value,
    sampleRateHz: sampleRateHz.value,
    params: params.value,
    eRPM: erpm.value,
    throttle: throttle.value,
    stages,
  });
}

const simulated = computed(() => runChain(stagesOn.value));
const simulatedFull = computed(() => runChain({ rpm: true, lpf1: true, dynNotch: true }));

const validation = computed(() => {
  const full = simulatedFull.value;
  const logged = loggedGyro.value;
  if (!full || !logged) return null;
  return validateChain(full, logged, WARMUP_SAMPLES);
});

const fidelityPct = computed(() =>
  validation.value ? Math.round(validation.value.simFidelity * 100) : null,
);
// Provisional bands — TODO calibrate against the corpus (the dyn-notch
// peak track and the sin/cos approximation keep a perfect match out of
// reach even on a correct config).
const fidelityTone = computed<Tone>(() => {
  const v = validation.value?.simFidelity ?? 0;
  return v >= 0.85 ? 'ok' : v >= 0.6 ? 'warn' : 'stamp';
});

interface Psd { f: Float32Array; db: Float32Array; }
function psdDb(sig: Float32Array | null): Psd | null {
  if (!sig || sampleRateHz.value <= 0 || sig.length < SEGMENT_LEN) return null;
  const r = welchPsd(sig, sampleRateHz.value, SEGMENT_LEN, 0.5);
  if (r.numSegments === 0) return null;
  return { f: r.frequencies, db: psdToDb(r.psd) };
}
const rawPsd = computed(() => psdDb(rawGyro.value));
const simPsd = computed(() => psdDb(simulated.value));
const loggedPsd = computed(() => psdDb(loggedGyro.value));

const data = computed<AlignedData>(() => {
  const base = rawPsd.value ?? loggedPsd.value ?? simPsd.value;
  if (!base) return [new Float32Array(0)] as unknown as AlignedData;
  const blank = (): Float32Array => {
    const b = new Float32Array(base.f.length);
    b.fill(NaN);
    return b;
  };
  return [
    base.f,
    rawPsd.value?.db ?? blank(),
    simPsd.value?.db ?? blank(),
    loggedPsd.value?.db ?? blank(),
  ] as unknown as AlignedData;
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 300,
  legend: { show: false },
  scales: {
    x: { time: false, auto: false },
    y: { auto: true },
  },
  cursor: { drag: { x: true, y: false, uni: 50 }, points: { show: true, size: 4 } },
  series: [
    {},
    { label: 'raw', stroke: COLORS.raw, width: 1, dash: [3, 3] },
    { label: 'simulated', stroke: COLORS.sim, width: 1.5 },
    { label: 'logged gyroADC', stroke: COLORS.logged, width: 1.5 },
  ],
  axes: [
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} Hz`),
    },
    {
      stroke: COLORS.ink3,
      grid:   { stroke: COLORS.line, width: 0.5 },
      ticks:  { stroke: COLORS.line, width: 0.5 },
      size:   50,
      font:   '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} dB`),
    },
  ],
}));

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

// Initial 0-300 Hz view (the sub-50 Hz wing band plus headroom), once
// per loaded log set.
let lastAppliedSampleRate = 0;
watch([plot.updateCount, sampleRateHz], () => {
  const sr = sampleRateHz.value;
  if (sr <= 0 || !ready.value || sr === lastAppliedSampleRate) return;
  plot.instance()?.setScale('x', { min: 0, max: Math.min(300, sr / 2) });
  lastAppliedSampleRate = sr;
});

function resetZoom() {
  const sr = sampleRateHz.value;
  if (sr <= 0) { plot.resetZoom(); return; }
  plot.instance()?.setScale('x', { min: 0, max: Math.min(300, sr / 2) });
}

function selectAxis(id: Axis) { selectedAxis.value = id; }
function toggleStage(key: keyof ChainStages) {
  stagesOn.value = { ...stagesOn.value, [key]: !stagesOn.value[key] };
}

const pendingMessage = computed(() => {
  if (isHydrating.value) return `hydrating ${axisSpec.value.label.toLowerCase()} raw / filtered gyro + eRPM…`;
  if (!scanReport.value) return 'load a log to simulate the filter chain';
  if (!hasRawGyro.value) {
    return 'raw gyro (gyroUnfilt) is not in this log — M-FilterSim simulates the chain ON the raw gyro. '
      + 'Enable Blackbox "Gyro (Unfiltered)" (preferred) or set debug_mode = GYRO_RAW.';
  }
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  if (rawGyro.value && rawGyro.value.length < SEGMENT_LEN) {
    return `log too short for a ${SEGMENT_LEN}-sample spectrum window`;
  }
  return 'simulating filter chain…';
});

const erpmNote = computed(() => {
  if (erpmNames.value.length > 0) return `${erpmNames.value.length} motor(s)`;
  return 'no eRPM — RPM stage inert';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Filter simulation &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          per-stage chain replay &middot; toggle a stage to see what it removes
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div
          v-if="ready && fidelityPct !== null"
          class="text-right cursor-help"
          title="How closely the simulated FULL chain reproduces the logged gyroADC: 1 − normalised RMS residual. High = the per-stage breakdown is trustworthy; low = the sim diverges (most likely the approximated dyn-notch peak track)."
        >
          <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">sim fidelity</div>
          <div class="font-mono text-[13px]" :style="{ color: TONE_COLOR[fidelityTone] }">
            {{ fidelityPct }}%
          </div>
        </div>

        <!-- stage toggles -->
        <div class="flex gap-px">
          <button
            v-for="stage in STAGES"
            :key="stage.key"
            type="button"
            class="px-2 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer whitespace-nowrap"
            :class="stagesOn[stage.key]
              ? 'bg-bp-accent text-bp-bg border-bp-accent'
              : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
            :aria-pressed="stagesOn[stage.key]"
            :title="stage.title"
            @click="toggleStage(stage.key)"
          >{{ stage.label }}</button>
        </div>

        <!-- axis selector -->
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
          >{{ ax.short }}</button>
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
      <div
        v-else-if="fidelityTone === 'stamp'"
        class="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 bg-bp-surface-2 border border-bp-stamp font-mono text-[10.5px] text-bp-stamp text-center"
      >
        simulated chain diverges from the logged gyroADC — per-stage view unreliable on this log
      </div>
      <div ref="hostRef" class="w-full relative" />
    </div>

    <footer class="flex flex-wrap justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px] gap-y-1">
      <div class="flex flex-wrap gap-4 items-center font-sans text-bp-ink-2">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.raw }" />
          raw gyro
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.sim }" />
          simulated (enabled stages)
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.logged }" />
          logged gyroADC
        </span>
        <span class="text-bp-ink-3">{{ erpmNote }}</span>
      </div>
      <div class="font-mono text-bp-ink-3">
        sim matches logged when all stages on &middot; drag to zoom
      </div>
    </footer>
  </section>
</template>
