<script setup lang="ts">
// M-Servo-2 Slice 2 — airframe-bandwidth Bode panel.
//
// InputChainPanel reports servo→gyro lag as one bulk millisecond
// number. This panel keeps the frequency axis: it estimates the
// airframe transfer function H(f) — how a commanded surface motion
// (the per-axis servo aggregate) becomes rotation rate (gyro) — and
// reads off the -3 dB rolloff. That rolloff is the airframe
// BANDWIDTH: a hard physics ceiling on how fast the wing can EVER be
// tuned to respond. A tune chasing a faster response than this is
// chasing what the airframe cannot deliver.
//
// Window selection — the transfer function needs broadband
// excitation. Cruise gives it almost none. So the estimate runs over
// the M-FF maneuver windows when the flight has enough of them
// (expanded with ±1 s of lead-in / recovery context and merged), and
// falls back to whole-flight otherwise. Coherence γ² gates trust
// either way — low-coherence frequency spans are greyed, because |H|
// there is noise, not airframe response.
//
// Pure diagnostic — no recommender, no CLI. The airframe bandwidth is
// a physics fact, not a tuning fault; there is no firmware `set` for
// it. Single-log (useActiveLog) + per-axis.

import { computed, onMounted, ref } from 'vue';
import type uPlot from 'uplot';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useUPlot } from '@/composables/useUPlot';
import { estimateSampleRate } from '@/lib/spectrum';
import { buildPerAxisServoAggregate, type Axis } from '@/lib/inputChain';
import { correlateServosToAxes } from '@/lib/servoClassifier';
import { detectManeuvers } from '@/lib/maneuverDetect';
import {
  estimateTransferFunction,
  estimateBandwidth,
  type TransferFunctionResult,
} from '@/lib/transferFunction';

// --- tuning constants -------------------------------------------------

/** Welch segment length for the transfer-function estimate. 1024 at
 *  ~1 kHz logging → ~1 Hz resolution + short enough that a maneuver
 *  region yields several averaging segments. */
const SEGMENT_LEN = 1024;
/** Coherence floor below which |H| is not trusted — the trace is
 *  greyed there. Matches estimateBandwidth's default. TODO calibrate. */
const COHERENCE_TRUST = 0.5;
/** Context padding (s) added each side of a maneuver window before
 *  merging — captures the snap's lead-in + recovery, the broadband-
 *  rich span. TODO calibrate. */
const CONTEXT_SEC = 1.0;
/** Minimum maneuver-region coverage (in Welch segments) to prefer the
 *  maneuver-window estimate over whole-flight. */
const MIN_REGION_SEGMENTS = 4;
/** Low end of the plotted frequency axis (Hz). Below this is DC trim
 *  / drift, not airframe dynamics — and log10(0) is undefined. */
const X_MIN_HZ = 0.5;

const ACTUATOR_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7];
/** Channels whose strongest setpoint-axis correlation is below this
 *  are unclassified — keeps throttle PWM out of the per-axis servo
 *  aggregate. Same cutoff InputChainPanel uses. */
const MIN_DOMINANT_SIGNED = 0.25;

const REQUIRED_FIELDS: string[] = [
  'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
  'gyroADC[0]',  'gyroADC[1]',  'gyroADC[2]',
  ...ACTUATOR_CHANNELS.map((i) => `motor[${i}]`),
  ...ACTUATOR_CHANNELS.map((i) => `servo[${i}]`),
];

const COLORS = {
  ink3:     '#7a90b0',
  line:     '#1f3a5a',
  mag:      '#7ec8ff',
  coherence:'#6fd98a',
  rolloff:  '#ffc46a',
} as const;

/** x-axis tick positions, Hz — the axis plots log10(Hz) on a linear
 *  scale (uPlot's native log distr renders blank in this build, same
 *  gotcha LowFreqModePanel hit). */
const X_TICK_HZ = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

interface AxisSpec { id: Axis; label: string; short: 'R' | 'P' | 'Y'; }
const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R' },
  { id: 1, label: 'Pitch', short: 'P' },
  { id: 2, label: 'Yaw',   short: 'Y' },
];
const selectedAxis = ref<Axis>(0);
const axisSpec = computed(() => AXES[selectedAxis.value]);

// --- data sources -----------------------------------------------------

const logStore = useActiveLog();
const { scanReport, time, fields, hydrating } = logStore;

onMounted(() => { logStore.ensureFields(REQUIRED_FIELDS); });

const isHydrating = computed(() =>
  REQUIRED_FIELDS.some((f) => hydrating.value.has(f)),
);

const sampleRateHz = computed(() => estimateSampleRate(time.value));

// Actuator map — every servo[i] / motor[i] present.
const actuators = computed(() => {
  const m = new Map<string, Float32Array>();
  for (const i of ACTUATOR_CHANNELS) {
    for (const family of ['servo', 'motor']) {
      const name = `${family}[${i}]`;
      const arr = fields.value.get(name);
      if (arr && arr.length > 0) m.set(name, arr);
    }
  }
  return m;
});

// Classifier correlation pass → per-axis sign-aligned servo aggregate.
const axisCorrelations = computed(() => {
  const setR = fields.value.get('setpoint[0]');
  const setP = fields.value.get('setpoint[1]');
  const setY = fields.value.get('setpoint[2]');
  if (!setR || !setP || !setY || actuators.value.size === 0) return [];
  return correlateServosToAxes(actuators.value, setR, setP, setY).filter(
    (c) => Math.abs(c.dominantSigned) >= MIN_DOMINANT_SIGNED,
  );
});

const servoAgg = computed(() => {
  if (time.value.length === 0) return [undefined, undefined, undefined];
  return buildPerAxisServoAggregate({
    motors: actuators.value,
    axisCorrelations: axisCorrelations.value,
    length: time.value.length,
  });
});

// All maneuver windows (axis-independent — detectManeuvers classifies).
const maneuvers = computed(() => {
  if (time.value.length < 3) return [];
  const setpoint = [0, 1, 2].map((a) => fields.value.get(`setpoint[${a}]`));
  return detectManeuvers(setpoint, time.value);
});

// --- window selection: maneuver regions, or whole-flight fallback -----

interface RegionPlan {
  /** Sample ranges to restrict the estimate to; null → whole flight. */
  regions: ReadonlyArray<readonly [number, number]> | null;
  mode: 'maneuver' | 'whole';
  regionCount: number;
  coveredSec: number;
}

const regionPlan = computed<RegionPlan>(() => {
  const total = time.value.length;
  const fs = sampleRateHz.value;
  const wholeFlight: RegionPlan = {
    regions: null,
    mode: 'whole',
    regionCount: 0,
    coveredSec: total > 0 && fs > 0 ? total / fs : 0,
  };
  if (total === 0 || fs <= 0) return wholeFlight;

  // Maneuver windows where this axis was the dominant input (or a
  // mixed/compound input) — those are the ones that excited it.
  const axis = selectedAxis.value;
  const relevant = maneuvers.value.filter(
    (m) => m.dominantAxis === axis || m.type === 'mixed',
  );
  if (relevant.length === 0) return wholeFlight;

  // Expand each window by ±CONTEXT_SEC, then merge overlaps.
  const ctx = Math.round(CONTEXT_SEC * fs);
  const spans = relevant
    .map((m): [number, number] => [
      Math.max(0, m.startIdx - ctx),
      Math.min(total, m.endIdx + ctx),
    ])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && s[0] <= prev[1]) prev[1] = Math.max(prev[1], s[1]);
    else merged.push([s[0], s[1]]);
  }

  // Only regions long enough to host at least one Welch segment.
  const regions = merged.filter(([lo, hi]) => hi - lo >= SEGMENT_LEN);
  const coveredSamples = regions.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);

  // Too little maneuver coverage → whole-flight has more to work with.
  if (coveredSamples < MIN_REGION_SEGMENTS * SEGMENT_LEN) return wholeFlight;

  return {
    regions,
    mode: 'maneuver',
    regionCount: regions.length,
    coveredSec: coveredSamples / fs,
  };
});

// --- transfer function + bandwidth ------------------------------------

const result = computed<TransferFunctionResult | null>(() => {
  const fs = sampleRateHz.value;
  const x = servoAgg.value[selectedAxis.value];
  const y = fields.value.get(`gyroADC[${selectedAxis.value}]`);
  if (!x || !y || fs <= 0) return null;
  const len = Math.min(x.length, y.length);
  if (len < SEGMENT_LEN) return null;
  return estimateTransferFunction(x.subarray(0, len), y.subarray(0, len), fs, {
    segmentLen: SEGMENT_LEN,
    regions: regionPlan.value.regions ?? undefined,
  });
});

const bandwidth = computed(() =>
  result.value ? estimateBandwidth(result.value) : null,
);

const ready = computed(
  () => !isHydrating.value && result.value !== null && result.value.numSegments >= 1,
);

/** Plotted bins — drop DC + sub-X_MIN_HZ (log10(0) is undefined). */
const display = computed(() => {
  const tf = result.value;
  if (!tf || tf.numSegments < 1) return null;
  let lo = 0;
  while (lo < tf.frequencies.length && tf.frequencies[lo] < X_MIN_HZ) lo++;
  const n = tf.frequencies.length - lo;
  if (n < 2) return null;
  const logF = new Float32Array(n);
  const magDb = new Float32Array(n);
  const coh = new Float32Array(n);
  const freqs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = tf.frequencies[lo + i];
    freqs[i] = f;
    logF[i] = Math.log10(f);
    magDb[i] = tf.magnitudeDb[lo + i];
    coh[i] = tf.coherence[lo + i];
  }
  return { logF, magDb, coh, freqs };
});

// --- chart ------------------------------------------------------------

// Both overlays run in the `draw` hook (after the axes + traces) — the
// only draw-stage hook the codebase trusts; a throw in `drawClear`
// aborts the whole draw cycle.
function drawOverlays(u: uPlot): void {
  const d = display.value;
  if (!ready.value || !d) return;
  const ctx = u.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  ctx.clip();

  // Grey contiguous frequency spans where coherence is below trust —
  // |H| there is noise, not airframe response.
  ctx.fillStyle = COLORS.ink3;
  let spanStart = -1;
  for (let i = 0; i <= d.coh.length; i++) {
    const low = i < d.coh.length && d.coh[i] < COHERENCE_TRUST;
    if (low && spanStart < 0) {
      spanStart = i;
    } else if (!low && spanStart >= 0) {
      const xL = u.valToPos(d.logF[spanStart], 'x', true);
      const xR = u.valToPos(d.logF[i - 1], 'x', true);
      ctx.globalAlpha = 0.14;
      ctx.fillRect(xL, u.bbox.top, Math.max(1, xR - xL), u.bbox.height);
      spanStart = -1;
    }
  }
  ctx.globalAlpha = 1;

  // -3 dB rolloff marker — the airframe bandwidth.
  const bw = bandwidth.value;
  if (bw && Number.isFinite(bw.rolloffHz)) {
    const x = u.valToPos(Math.log10(bw.rolloffHz), 'x', true);
    const colour = bw.trustworthy ? COLORS.rolloff : COLORS.ink3;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(bw.trustworthy ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, u.bbox.top);
    ctx.lineTo(x, u.bbox.top + u.bbox.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    const label = `−3 dB ≈ ${bw.rolloffHz.toFixed(1)} Hz`;
    const w = ctx.measureText(label).width;
    const right = x + 5 + w < u.bbox.left + u.bbox.width;
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(label, right ? x + 5 : x - 5, u.bbox.top + 4);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

const data = computed<AlignedData>(() => {
  const d = display.value;
  if (!d) {
    return [
      new Float32Array([Math.log10(X_MIN_HZ), Math.log10(100)]),
      new Float32Array([0, 0]),
      new Float32Array([0, 0]),
    ] as unknown as AlignedData;
  }
  return [d.logF, d.magDb, d.coh] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const d = display.value;
  const xMinHz = d ? d.freqs[0] : X_MIN_HZ;
  const xMaxHz = d ? d.freqs[d.freqs.length - 1] : 100;
  return {
    width: 800,
    height: 300,
    legend: { show: false },
    scales: {
      // x is log10(Hz) on a LINEAR scale — see `display`.
      x: { time: false, range: [Math.log10(xMinHz), Math.log10(xMaxHz)] },
      y: { auto: true },
      coh: { range: [0, 1] },
    },
    cursor: { drag: { x: true, y: false, uni: 50 }, points: { show: true, size: 4 } },
    series: [
      {},
      { label: '|H| dB', stroke: COLORS.mag, width: 1.5, scale: 'y' },
      { label: 'coherence', stroke: COLORS.coherence, width: 1, dash: [3, 3], scale: 'coh' },
    ],
    axes: [
      {
        stroke: COLORS.ink3,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        splits: (_u, _ai, scaleMin, scaleMax) =>
          X_TICK_HZ
            .map((hz) => Math.log10(hz))
            .filter((v) => v >= scaleMin - 1e-6 && v <= scaleMax + 1e-6),
        values: (_u, splits) =>
          splits.map((v) => {
            const hz = 10 ** v;
            return hz >= 1 ? `${hz.toFixed(0)} Hz` : `${hz.toFixed(1)} Hz`;
          }),
      },
      {
        stroke: COLORS.mag,
        grid:   { stroke: COLORS.line, width: 0.5 },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        size:   52,
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        values: (_u, splits) => splits.map((v) => `${v.toFixed(0)} dB`),
      },
      {
        scale:  'coh',
        side:   1,
        stroke: COLORS.coherence,
        grid:   { show: false },
        ticks:  { stroke: COLORS.line, width: 0.5 },
        size:   42,
        font:   '10px ui-monospace, Menlo, Consolas, monospace',
        values: (_u, splits) => splits.map((v) => v.toFixed(1)),
      },
    ],
    hooks: { draw: [drawOverlays] },
  };
});

const hostRef = ref<HTMLDivElement | null>(null);
const plot = useUPlot({ target: hostRef, data, opts });

function resetZoom() { plot.resetZoom(); }
function selectAxis(id: Axis) { selectedAxis.value = id; }

// --- header / footer text --------------------------------------------

type Tone = 'ok' | 'warn' | 'dim';
const TONE_COLOR: Record<Tone, string> = {
  ok:   'var(--color-bp-ok)',
  warn: 'var(--color-bp-warn)',
  dim:  'var(--color-bp-dim)',
};

const bandwidthBadge = computed<{ text: string; tone: Tone }>(() => {
  const tf = result.value;
  const bw = bandwidth.value;
  if (!tf || !bw) return { text: '—', tone: 'dim' };
  if (tf.numSegments < 2) return { text: 'insufficient data', tone: 'dim' };
  if (!Number.isFinite(bw.rolloffHz)) {
    return { text: 'no rolloff in band', tone: 'dim' };
  }
  const hz = bw.rolloffHz.toFixed(1);
  return bw.trustworthy
    ? { text: `≈ ${hz} Hz`, tone: 'ok' }
    : { text: `≈ ${hz} Hz · low coherence`, tone: 'warn' };
});

const estimateNote = computed(() => {
  const p = regionPlan.value;
  const tf = result.value;
  const segs = tf ? tf.numSegments : 0;
  if (p.mode === 'maneuver') {
    return `maneuver windows · ${p.regionCount} region${p.regionCount === 1 ? '' : 's'} · `
      + `${p.coveredSec.toFixed(1)} s · ${segs} segments`;
  }
  return `whole flight · ${segs} segments`;
});

/** True when coherence is poor across most of the band — the airframe
 *  was not excited broadly enough for a trustworthy estimate. */
const poorCoherence = computed(() => {
  const bw = bandwidth.value;
  return bw != null && result.value != null
    && result.value.numSegments >= 2 && bw.bandCoherence < COHERENCE_TRUST;
});

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating servo / gyro / setpoint fields…';
  if (!scanReport.value) return 'load a log to estimate airframe bandwidth';
  if (sampleRateHz.value <= 0) return 'time axis empty — load a log first';
  if (actuators.value.size === 0) {
    return 'no servo / motor channels with PWM data — the classifier needs an actuator';
  }
  if (!servoAgg.value[selectedAxis.value]) {
    return `no servo classified to the ${axisSpec.value.label.toLowerCase()} axis — `
      + 'cannot build the per-axis command signal';
  }
  if (result.value && result.value.numSegments < 1) {
    return 'log too short for a transfer-function estimate (need ≥ 1 s of data)';
  }
  return 'estimating airframe transfer function…';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Airframe bandwidth &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          servo&nbsp;→&nbsp;gyro transfer function — the physics ceiling on response speed
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div
          v-if="ready"
          class="flex items-baseline gap-1.5"
          title="The -3 dB rolloff of |H(f)| relative to the low-frequency gain plateau."
        >
          <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3">
            bandwidth
          </span>
          <span
            class="font-mono text-[13px] font-semibold"
            :style="{ color: TONE_COLOR[bandwidthBadge.tone] }"
          >
            {{ bandwidthBadge.text }}
          </span>
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
      <div ref="hostRef" class="w-full relative" />
    </div>

    <footer class="px-3 py-2 border-t border-bp-line flex flex-col gap-1.5">
      <div class="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-[10.5px]">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
          <span class="flex items-center gap-1.5">
            <span class="w-3 h-px inline-block" :style="{ backgroundColor: COLORS.mag }" />
            <span class="text-bp-ink-3">|H| magnitude</span>
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-3 h-px inline-block border-t border-dashed" :style="{ borderColor: COLORS.coherence }" />
            <span class="text-bp-ink-3">coherence γ²</span>
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 inline-block opacity-40" :style="{ backgroundColor: COLORS.ink3 }" />
            <span class="text-bp-ink-3">γ² &lt; {{ COHERENCE_TRUST }} — untrusted</span>
          </span>
        </div>
        <div v-if="ready" class="font-mono text-bp-ink-3">{{ estimateNote }}</div>
      </div>

      <div
        v-if="ready && poorCoherence"
        class="font-mono text-[10px] text-bp-warn leading-relaxed"
      >
        Coherence is low across the band — the airframe was not excited
        broadly enough for a trustworthy estimate. Fly more aggressive,
        broadband inputs (snap rolls, pitch punches) and re-check.
      </div>

      <div class="font-mono text-[10px] text-bp-ink-3 leading-relaxed">
        <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-accent mr-1.5">
          reading it
        </span>
        |H| holds a low-frequency plateau, then rolls off — the
        <span :style="{ color: COLORS.rolloff }">−3 dB point</span> is the airframe
        bandwidth, the fastest the wing can physically respond. Greyed spans are
        coherence-untrusted (noise, or no excitation there). Diagnostic only —
        bandwidth is a physics ceiling, not a tuning fault.
      </div>
    </footer>
  </section>
</template>
