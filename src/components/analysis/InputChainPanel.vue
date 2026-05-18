<script setup lang="ts">
// Input-chain lag panel — M-Servo MVP.
//
// Per-axis breakdown of where the pilot-to-gyro lag actually lives:
//
//   rcCommand ─[A]─▶ setpoint ─[B]─▶ servoAgg ─[C]─▶ gyro    Σ total
//
// Each stage chip colored by health. The "missing link" (servo → control
// surface deflection) is not measurable from log data alone — flagged in
// the panel footer for transparency.
//
// Per-axis aggregation of servo PWMs uses the existing servo classifier
// (correlateServosToAxes) so opposite-sign true-differential servos AND
// paired-identical servos both produce a clean axis-equivalent command
// signal for stage B and stage C correlation.

import { computed, onMounted, ref, watch } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import {
  computeInputChain,
  buildPerAxisServoAggregate,
  AXIS_LABELS,
  AXIS_SHORTS,
  type Stage,
  type StageResult,
} from '@/lib/inputChain';
import { correlateServosToAxes } from '@/lib/servoClassifier';

// Actuator channel candidates. On a wing, control surfaces can live
// in either `servo[i]` or `motor[i]` (BF wing builds historically
// repurpose `motor[i]` for servo PWM, but newer wing setups keep
// real servos on `servo[i]` and use `motor[0]` for the pusher prop).
// Hydrating both is harmless — empty arrays are skipped, and the
// `MIN_DOMINANT_SIGNED` threshold below excludes throttle channels
// (which have low per-axis correlation) from the per-axis aggregate.
const ACTUATOR_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Channels whose strongest correlation with a setpoint axis is
 *  below this threshold are treated as unclassified — same cutoff
 *  the existing servo classifier uses to call a channel "unknown."
 *  Keeps throttle PWM (motor[0]) and weakly-coupled mixer artifacts
 *  out of the per-axis servo aggregate. */
const MIN_DOMINANT_SIGNED = 0.25;

const REQUIRED_FIELDS: string[] = [
  'rcCommand[0]', 'rcCommand[1]', 'rcCommand[2]',
  'setpoint[0]',  'setpoint[1]',  'setpoint[2]',
  'gyroADC[0]',   'gyroADC[1]',   'gyroADC[2]',
  ...ACTUATOR_CHANNELS.map((i) => `motor[${i}]`),
  ...ACTUATOR_CHANNELS.map((i) => `servo[${i}]`),
];

// Per-stage lag thresholds (ms). Stage A is rate curves only and
// should be near-zero on a sane setup, so it gets a tighter band.
// Stages B + C use wider wing-tuned bands (pitch axis can naturally
// run 30-60ms, so the yellow band has to accommodate that).
//
// TODO calibrate against multiple real wing flights — these are
// best-guesses pending corpus.
const STAGE_THRESHOLDS: Record<Stage, { green: number; yellow: number }> = {
  A: { green: 5,  yellow: 15 },  // rate curves should be ~0
  B: { green: 20, yellow: 50 },  // PID + mixer
  C: { green: 20, yellow: 50 },  // servo + mechanical + aero
};
// Total wing band (sum of three stages).
const TOTAL_THRESHOLDS = { green: 40, yellow: 100 };

type HealthTone = 'green' | 'yellow' | 'red' | 'dim';

const HEALTH_COLOR: Record<HealthTone, string> = {
  green:  'var(--color-bp-ok)',
  yellow: 'var(--color-bp-warn)',
  red:    'var(--color-bp-stamp)',
  dim:    'var(--color-bp-dim)',
};

function classifyLag(stage: Stage, ms: number): HealthTone {
  if (!Number.isFinite(ms)) return 'dim';
  const t = STAGE_THRESHOLDS[stage];
  if (ms < t.green) return 'green';
  if (ms < t.yellow) return 'yellow';
  return 'red';
}

function classifyTotal(ms: number): HealthTone {
  if (!Number.isFinite(ms)) return 'dim';
  if (ms < TOTAL_THRESHOLDS.green) return 'green';
  if (ms < TOTAL_THRESHOLDS.yellow) return 'yellow';
  return 'red';
}

function lagText(ms: number): string {
  return Number.isFinite(ms) ? `${ms.toFixed(0)} ms` : '—';
}

const logStore = useActiveLog();
const { scanReport, time, fields, hydrating } = logStore;

onMounted(() => { logStore.ensureFields(REQUIRED_FIELDS); });

const isHydrating = computed(() =>
  REQUIRED_FIELDS.some((f) => hydrating.value.has(f)),
);

// Build the actuator map (every servo[i] and motor[i] that's present).
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

// Run the classifier's correlation pass to get per-channel dominant
// axis + sign, then filter to channels whose dominant correlation
// clears the noise threshold. This is what keeps throttle PWM
// (motor[0] on a pusher wing) out of the per-axis servo aggregate
// even though the classifier nominally assigns it a "dominant axis."
const axisCorrelations = computed(() => {
  const setR = fields.value.get('setpoint[0]');
  const setP = fields.value.get('setpoint[1]');
  const setY = fields.value.get('setpoint[2]');
  if (!setR || !setP || !setY) return [];
  if (actuators.value.size === 0) return [];
  const raw = correlateServosToAxes(actuators.value, setR, setP, setY);
  return raw.filter((c) => Math.abs(c.dominantSigned) >= MIN_DOMINANT_SIGNED);
});

const result = computed(() => {
  if (time.value.length === 0) return null;
  const length = time.value.length;
  const rcCommand = [0, 1, 2].map((a) => fields.value.get(`rcCommand[${a}]`));
  const setpoint  = [0, 1, 2].map((a) => fields.value.get(`setpoint[${a}]`));
  const gyro      = [0, 1, 2].map((a) => fields.value.get(`gyroADC[${a}]`));
  const servoAgg  = buildPerAxisServoAggregate({
    motors: actuators.value,
    axisCorrelations: axisCorrelations.value,
    length,
  });
  return computeInputChain({
    time: time.value,
    rcCommand,
    setpoint,
    servoAgg,
    gyro,
  });
});

const ready = computed(() =>
  !isHydrating.value && result.value !== null && actuators.value.size > 0,
);

// Watch for the result and re-run when underlying fields land
// (post-hydration). Vue's computed reactivity covers this; the watch
// is just to surface a hint message during the transition.
const transitioning = ref(false);
watch([isHydrating, axisCorrelations], () => {
  transitioning.value = true;
  setTimeout(() => { transitioning.value = false; }, 250);
});

// Per-stage chip data per axis — what the template iterates.
interface StageChip {
  stage: Stage;
  label: string;
  lagMs: number;
  tone: HealthTone;
  windowCount: number;
}
interface AxisRow {
  axis: 0 | 1 | 2;
  short: string;
  label: string;
  chips: StageChip[];
  totalMs: number;
  totalTone: HealthTone;
  hasData: boolean;
}

const STAGE_DEFS: Array<{ stage: Stage; label: string }> = [
  { stage: 'A', label: 'rcCmd → setpt' },
  { stage: 'B', label: 'setpt → servo' },
  { stage: 'C', label: 'servo → gyro' },
];

const rows = computed<AxisRow[]>(() => {
  const r = result.value;
  if (!r) return [];
  return r.axes.map((ax) => {
    const chips: StageChip[] = STAGE_DEFS.map((d) => {
      const s: StageResult = ax.stages[d.stage];
      return {
        stage: d.stage,
        label: d.label,
        lagMs: s.lagMs,
        tone: classifyLag(d.stage, s.lagMs),
        windowCount: s.windowCount,
      };
    });
    return {
      axis: ax.axis,
      short: AXIS_SHORTS[ax.axis],
      label: AXIS_LABELS[ax.axis],
      chips,
      totalMs: ax.totalLagMs,
      totalTone: classifyTotal(ax.totalLagMs),
      hasData: ax.hasData,
    };
  });
});

const sampleRateLabel = computed(() => {
  const r = result.value;
  return r ? `${r.sampleRateHz.toFixed(0)} Hz sample rate` : '';
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Input chain · per-axis lag breakdown
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          where the lag accumulates between stick and gyro
        </div>
      </div>
      <div v-if="sampleRateLabel" class="font-mono text-[10.5px] text-bp-ink-3">
        {{ sampleRateLabel }}
      </div>
    </header>

    <div v-if="isHydrating" class="px-4 py-6 font-mono text-[11px] text-bp-ink-3 text-center">
      hydrating rcCommand / setpoint / gyro / motor fields…
    </div>
    <div
      v-else-if="!ready"
      class="px-4 py-6 font-mono text-[11px] text-bp-ink-3 text-center"
    >
      <template v-if="actuators.size === 0">
        no servo / motor channels with PWM data — classifier needs at least one actuator
      </template>
      <template v-else>
        log too short for chain analysis (need ≥ 2s windows + lag headroom)
      </template>
    </div>

    <div v-else class="px-3 py-3 flex flex-col gap-2.5">
      <div
        v-for="row in rows"
        :key="row.axis"
        class="bg-bp-surface-2 border border-bp-line"
      >
        <div class="flex flex-wrap items-center px-3 py-2 gap-x-3 gap-y-1">
          <!-- axis label -->
          <span class="font-sans text-[10px] tracking-[0.24em] uppercase font-bold text-bp-ink-2 min-w-[44px]">
            {{ row.label }}
          </span>

          <!-- chain visualization -->
          <div v-if="row.hasData" class="flex items-center flex-wrap gap-x-1.5 gap-y-1 flex-1 min-w-0">
            <span class="font-mono text-[10.5px] text-bp-ink-3">rcCmd</span>
            <span
              v-for="(chip, idx) in row.chips"
              :key="chip.stage"
              class="flex items-center gap-1.5"
            >
              <span class="text-bp-dim font-mono text-[11px]">─[{{ chip.stage }}]─</span>
              <span
                class="inline-flex items-center px-1.5 py-px border font-mono text-[11px] font-semibold"
                :style="{ color: HEALTH_COLOR[chip.tone], borderColor: HEALTH_COLOR[chip.tone] }"
                :title="`${chip.label} · n=${chip.windowCount} windows`"
              >
                {{ lagText(chip.lagMs) }}
              </span>
              <span class="text-bp-dim font-mono text-[11px]">▶</span>
              <span class="font-mono text-[10.5px] text-bp-ink-3">
                {{ idx === 0 ? 'setpt' : idx === 1 ? 'servo' : 'gyro' }}
              </span>
            </span>
          </div>
          <div v-else class="flex-1 font-mono text-[10.5px] text-bp-ink-3 italic">
            insufficient data on this axis (skipped — input or output didn't move enough)
          </div>

          <!-- total -->
          <div class="flex items-baseline gap-1.5 ml-auto">
            <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3">
              Σ
            </span>
            <span
              class="font-mono text-[13px] font-semibold"
              :style="{ color: HEALTH_COLOR[row.totalTone] }"
            >
              {{ lagText(row.totalMs) }}
            </span>
          </div>
        </div>
      </div>

      <!-- explainer -->
      <div class="font-mono text-[10px] text-bp-ink-3 leading-relaxed px-1 mt-1">
        <span class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-accent mr-1.5">
          stages
        </span>
        <span class="text-bp-ok">A</span> = rate curves
        ·  <span class="text-bp-ok">B</span> = PID + mixer
        ·  <span class="text-bp-ok">C</span> = servo + mechanical + aero
        ·  missing link (motor → physical surface deflection) not measurable
        without position feedback.
      </div>
    </div>
  </section>
</template>
