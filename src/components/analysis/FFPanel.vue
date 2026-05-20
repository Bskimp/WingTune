<script setup lang="ts">
// M-FF — feedforward effectiveness panel.
//
// FF responds to stick velocity (the setpoint derivative), so it only
// produces signal during fast inputs. The panel auto-detects maneuver
// windows (lib/maneuverDetect) and analyzes FF coverage + leading-edge
// overshoot on exactly those windows (lib/ffEffectiveness).
//
// Chart per axis: setpoint velocity (the FF input, left axis) + F and
// P contributions (right axis). Detected maneuver windows are shaded.
// The tuning read: during a shaded window, F should be large and P
// should stay small — "P does nothing during the move." When P is
// carrying the transient instead, FF is undergained.
//
// Single-log (useActiveLog) — FF tuning is a focus-one-log task. Flip
// the LogRoster eye to analyze a different log.

import { computed, onMounted, ref, watch } from 'vue';
import type { AlignedData, Options } from 'uplot';

import { useActiveLog } from '@/composables/useActiveLog';
import { useUPlot } from '@/composables/useUPlot';
import { detectManeuvers, setpointVelocity } from '@/lib/maneuverDetect';
import {
  analyzeFFAxis,
  type FFVerdict,
  type FFWindowMetric,
} from '@/lib/ffEffectiveness';

/** Signed boxcar smooth for the DISPLAY velocity trace only. The raw
 *  central-difference derivative amplifies setpoint quantization into
 *  a blocky mess; a light smooth makes the chart readable. Display-
 *  only — the analysis (lib/ffEffectiveness) consumes the raw signal. */
function boxcarSmooth(v: Float32Array, width: number): Float32Array {
  const n = v.length;
  const w = Math.max(1, width | 1); // force odd
  if (w === 1 || n === 0) return v;
  const half = (w - 1) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= n) continue;
      sum += v[j];
      count += 1;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

type ChipSeverity = 'ok' | 'warn' | 'over';

const CHIP_COLOR: Record<ChipSeverity, string> = {
  ok:   'var(--color-bp-ok)',
  warn: 'var(--color-bp-warn)',
  over: 'var(--color-bp-stamp)',
};

const COLORS = {
  ink3:   '#7a90b0',
  line:   '#1f3a5a',
  vel:    '#7ec8ff',  // setpoint velocity (FF input)
  fterm:  '#7ee0a8',  // F contribution
  pterm:  '#ffc46a',  // P contribution
  shade:  '#7ec8ff14',
} as const;

const VERDICT_COLOR: Record<FFVerdict, string> = {
  'healthy':     'var(--color-bp-ok)',
  'undergained': 'var(--color-bp-warn)',
  'overgained':  'var(--color-bp-stamp)',
  'no-data':     'var(--color-bp-ink-3)',
};

const VERDICT_LABEL: Record<FFVerdict, string> = {
  'healthy':     'healthy',
  'undergained': 'F undergained',
  'overgained':  'F overgained',
  'no-data':     'no maneuvers',
};

interface AxisSpec { id: 0 | 1 | 2; label: string; short: 'R' | 'P' | 'Y'; }
const AXES: AxisSpec[] = [
  { id: 0, label: 'Roll',  short: 'R' },
  { id: 1, label: 'Pitch', short: 'P' },
  { id: 2, label: 'Yaw',   short: 'Y' },
];

const selectedAxis = ref<0 | 1 | 2>(0);
const axisSpec = computed(() => AXES[selectedAxis.value]);

const logStore = useActiveLog();
const { time, fields, hydrating } = logStore;

// Maneuver detection needs all three setpoint axes (cross-axis
// classification); FF analysis of the selected axis needs that axis's
// F / P / gyro.
const wantedFields = computed(() => {
  const a = selectedAxis.value;
  return [
    'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
    `axisF[${a}]`, `axisP[${a}]`, `gyroADC[${a}]`,
  ];
});

async function hydrate() {
  await logStore.ensureFields(wantedFields.value);
}
onMounted(hydrate);
watch(wantedFields, hydrate);

const isHydrating = computed(() =>
  wantedFields.value.some((f) => hydrating.value.has(f)),
);

const maneuvers = computed(() => {
  if (time.value.length < 3) return [];
  const sp = [0, 1, 2].map((a) => fields.value.get(`setpoint[${a}]`));
  if (!sp.some(Boolean)) return [];
  return detectManeuvers(sp, time.value);
});

const ffResult = computed(() => {
  const a = selectedAxis.value;
  const setpoint = fields.value.get(`setpoint[${a}]`);
  const axisF = fields.value.get(`axisF[${a}]`);
  const axisP = fields.value.get(`axisP[${a}]`);
  const gyro  = fields.value.get(`gyroADC[${a}]`);
  if (!setpoint || !axisF || !axisP || !gyro || time.value.length < 3) return null;
  return analyzeFFAxis({
    axis: a, setpoint, axisF, axisP, gyro, time: time.value,
    maneuvers: maneuvers.value,
  });
});

const ready = computed(() =>
  ffResult.value !== null && ffResult.value.windowCount > 0,
);

// Velocity trace for the chart (deg/s²). Same derivative the analysis
// uses, then a light display-only smooth — the raw central-difference
// is blocky from setpoint quantization.
const velocityTrace = computed<Float32Array>(() => {
  const a = selectedAxis.value;
  const sp = fields.value.get(`setpoint[${a}]`);
  const t = time.value;
  if (!sp || t.length < 3) return new Float32Array(0);
  const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
  if (!(dt > 0)) return new Float32Array(0);
  return boxcarSmooth(setpointVelocity(sp, dt), 9);
});

// Per-maneuver chips — the actionable readout. Each detected window
// for this axis gets a chip: time, type, FF coverage, overshoot flag.
interface ManeuverChip {
  key: string;
  startSec: number;
  endSec: number;
  type: string;
  coveragePct: number;
  hasOvershoot: boolean;
  noisy: boolean;
  severity: ChipSeverity;
}

const maneuverChips = computed<ManeuverChip[]>(() => {
  const r = ffResult.value;
  if (!r) return [];
  return r.windows.map((m: FFWindowMetric, i: number) => {
    const severity: ChipSeverity = m.hasOvershoot
      ? 'over'
      : m.ffCoverage < 0.5 ? 'warn' : 'ok';
    return {
      key: `${m.window.startIdx}-${i}`,
      startSec: m.window.startSec,
      endSec: m.window.endSec,
      type: m.window.type,
      coveragePct: Math.round(m.ffCoverage * 100),
      hasOvershoot: m.hasOvershoot,
      noisy: m.noisy,
      severity,
    };
  });
});

// Click a chip → zoom the chart x-scale to that maneuver window with
// a bit of lead-in / settle context. The header ↺ button resets.
const ZOOM_PAD_SEC = 0.4;
function zoomToChip(chip: ManeuverChip) {
  plot.zoomToRange(chip.startSec - ZOOM_PAD_SEC, chip.endSec + ZOOM_PAD_SEC);
}

const data = computed<AlignedData>(() => {
  const a = selectedAxis.value;
  const t = time.value;
  const vel = velocityTrace.value;
  const fterm = fields.value.get(`axisF[${a}]`);
  const pterm = fields.value.get(`axisP[${a}]`);
  if (t.length === 0 || vel.length === 0 || !fterm || !pterm) {
    return [new Float32Array(0), new Float32Array(0), new Float32Array(0), new Float32Array(0)] as unknown as AlignedData;
  }
  return [t, vel, fterm, pterm] as unknown as AlignedData;
});

const opts = computed<Options>(() => ({
  width: 800,
  height: 300,
  legend: { show: false },
  scales: {
    x:  { time: false },
    y:  { auto: true },
    y2: { auto: true },
  },
  cursor: { drag: { x: true, y: false, uni: 50 }, points: { show: true, size: 5 } },
  series: [
    {},
    { label: 'setpoint velocity', stroke: COLORS.vel,   width: 1,    scale: 'y'  },
    { label: 'F contribution',    stroke: COLORS.fterm, width: 1.5,  scale: 'y2' },
    { label: 'P contribution',    stroke: COLORS.pterm, width: 1.5,  scale: 'y2' },
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
      scale: 'y', stroke: COLORS.vel, size: 56,
      grid:  { stroke: COLORS.line, width: 0.5 },
      ticks: { stroke: COLORS.line, width: 0.5 },
      font:  '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => v.toFixed(0)),
    },
    {
      scale: 'y2', side: 1, stroke: COLORS.fterm, size: 52,
      grid:  { show: false },
      ticks: { stroke: COLORS.line, width: 0.5 },
      font:  '10px ui-monospace, Menlo, Consolas, monospace',
      values: (_u, splits) => splits.map((v) => v.toFixed(0)),
    },
  ],
  hooks: {
    draw: [
      (u) => {
        // Shade detected maneuver windows.
        const ctx = u.ctx;
        ctx.save();
        ctx.fillStyle = COLORS.shade;
        for (const m of maneuvers.value) {
          const x0 = u.valToPos(m.startSec, 'x', true);
          const x1 = u.valToPos(m.endSec, 'x', true);
          ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
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
  if (isHydrating.value) return `hydrating ${axisSpec.value.label.toLowerCase()} setpoint / F / P / gyro…`;
  if (time.value.length < 3) return 'load a log to analyze feedforward';
  if (maneuvers.value.length === 0) {
    return 'no aggressive inputs detected — FF only produces signal during fast stick movement. Fly snap rolls / sharp pitch reversals for feedforward analysis.';
  }
  const r = ffResult.value;
  if (r && r.windowCount === 0) {
    return `${maneuvers.value.length} maneuver(s) detected, but none on the ${axisSpec.value.label.toLowerCase()} axis — switch axes or fly ${axisSpec.value.label.toLowerCase()} inputs`;
  }
  return 'computing feedforward effectiveness…';
});

const verdict = computed<FFVerdict>(() => ffResult.value?.verdict ?? 'no-data');
const coverageText = computed(() => {
  const r = ffResult.value;
  return r && r.windowCount > 0 ? `${(r.meanFFCoverage * 100).toFixed(0)} %` : '—';
});
const overshootText = computed(() => {
  const r = ffResult.value;
  return r && r.windowCount > 0 ? `${r.overshootCount} / ${r.windowCount}` : '—';
});
const windowText = computed(() => {
  const r = ffResult.value;
  return r ? `${r.windowCount}` : '—';
});
const noiseText = computed(() => {
  const r = ffResult.value;
  return r && r.windowCount > 0 ? `${(r.meanFFNoise * 100).toFixed(0)} %` : '—';
});
const isNoisy = computed(() => ffResult.value?.noisy ?? false);
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Feedforward effectiveness &middot; {{ axisSpec.label.toLowerCase() }} axis
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          F coverage during detected fast inputs &middot; "P should do nothing during the move"
        </div>
      </div>

      <div class="flex flex-wrap gap-y-1.5 gap-x-3 items-center">
        <div v-if="ready" class="flex gap-3 items-baseline">
          <div
            class="text-right cursor-help"
            title="Share of controller output feedforward carried while the stick was moving: |F| / (|F|+|P|). High = FF doing the transient work; low = P carrying it, i.e. FF undergained."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">F coverage</div>
            <div class="font-mono text-[13px]" :style="{ color: VERDICT_COLOR[verdict] }">{{ coverageText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="How many detected maneuvers showed the gyro punching past the setpoint right after the input — the signature of overgained feedforward."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">overshoot</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ overshootText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="Number of fast-input windows auto-detected from the setpoint derivative. FF only produces signal during fast moves, so analysis is scoped to these."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">maneuvers</div>
            <div class="font-mono text-[13px] text-bp-ink">{{ windowText }}</div>
          </div>
          <div
            class="text-right cursor-help"
            title="High-frequency jitter in the F-term: RMS(F − smoothed F) / RMS(smoothed F). High = FF amplifying RC/stick noise. Fix is feedforward_smoothing / feedforward_jitter_factor, NOT the FF gain."
          >
            <div class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap">F noise</div>
            <div class="font-mono text-[13px]" :class="isNoisy ? 'text-bp-warn' : 'text-bp-ink'">{{ noiseText }}</div>
          </div>
          <div
            class="px-1.5 py-0.5 font-sans text-[9px] tracking-[0.16em] uppercase font-bold border self-center"
            :style="{ color: VERDICT_COLOR[verdict], borderColor: VERDICT_COLOR[verdict] }"
          >
            {{ VERDICT_LABEL[verdict] }}
          </div>
          <div
            v-if="isNoisy"
            class="px-1.5 py-0.5 font-sans text-[9px] tracking-[0.16em] uppercase font-bold border self-center text-bp-warn border-bp-warn"
            title="F-term carries heavy high-frequency jitter — raise feedforward_smoothing / feedforward_jitter_factor, not the FF gain"
          >
            noisy
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

    <div
      v-if="ready && maneuverChips.length > 0"
      class="px-3 py-2 border-t border-bp-line flex flex-wrap gap-1.5 items-center"
    >
      <span class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 mr-1">
        maneuvers
      </span>
      <button
        v-for="chip in maneuverChips"
        :key="chip.key"
        type="button"
        class="font-mono text-[10px] px-1.5 py-0.5 border flex items-center gap-1 whitespace-nowrap cursor-pointer hover:bg-bp-surface-2"
        :style="{ color: CHIP_COLOR[chip.severity], borderColor: CHIP_COLOR[chip.severity] }"
        :title="`${chip.type} maneuver at ${chip.startSec.toFixed(1)}s · FF coverage ${chip.coveragePct}%`
          + (chip.hasOvershoot ? ' · leading-edge overshoot' : '')
          + (chip.noisy ? ' · noisy F-term' : '')
          + ' · click to zoom'"
        @click="zoomToChip(chip)"
      >
        <span class="text-bp-ink-3">{{ chip.startSec.toFixed(1) }}s</span>
        <span>{{ chip.type }}</span>
        <span>{{ chip.coveragePct }}%</span>
        <span v-if="chip.hasOvershoot">⤴</span>
        <span v-if="chip.noisy">∿</span>
      </button>
    </div>

    <footer class="flex flex-wrap justify-between items-center px-3 py-2 border-t border-bp-line text-[10.5px] gap-y-1">
      <div class="flex flex-wrap gap-4 items-center font-sans text-bp-ink-2">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.vel }" />
          setpoint velocity (FF input)
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.fterm }" />
          F contribution
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-3.5 h-0.5" :style="{ backgroundColor: COLORS.pterm }" />
          P contribution
        </span>
        <span class="text-bp-ink-3">shaded = detected maneuver window</span>
      </div>
      <div class="font-mono text-bp-ink-3">
        coverage = Σ|F| / (Σ|F|+Σ|P|) while stick moving &middot; high = FF carries the transient
      </div>
    </footer>
  </section>
</template>
