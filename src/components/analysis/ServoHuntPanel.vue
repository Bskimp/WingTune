<script setup lang="ts">
// M-Servo-2 Slice 4 — per-servo hunt indicator.
//
// Surfaces lib/servoHunt: each classified servo channel scored for
// "hunt" — high-frequency PWM activity above the hunt-band cutoff that
// does NOT track the pilot's rate setpoint. A clean servo follows the
// command and is otherwise smooth; a hunting one carries fast PWM
// wiggle the pilot never asked for (linkage slop, a loop limit cycle,
// gyro-noise chasing) — wasted effort, heat, wear.
//
// Its own panel rather than a strip on ServoAsymmetryPanel: hunt is
// per-CHANNEL and applies to every classified servo, whereas the
// asymmetry panel only renders axes with ≥ 2 contributing servos —
// embedding hunt there would hide it on single-surface-per-axis wings.
//
// Diagnostic only — no recommender, no CLI. A hunting servo is a
// mechanical / filtering investigation, not a firmware `set`. The
// hunt-band cutoff + score thresholds are wing-regime first guesses
// (TODO calibrate — see lib/servoHunt).

import { computed, onMounted } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import { correlateServosToAxes } from '@/lib/servoClassifier';
import { estimateSampleRate } from '@/lib/spectrum';
import { AXIS_LABELS } from '@/lib/inputChain';
import {
  computeServoHunt,
  type HuntSeverity,
  type ServoHuntChannel,
  type ServoHuntResult,
} from '@/lib/servoHunt';

const ACTUATOR_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7];
const MIN_DOMINANT_SIGNED = 0.25;

const REQUIRED_FIELDS: string[] = [
  'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
  ...ACTUATOR_CHANNELS.map((i) => `motor[${i}]`),
  ...ACTUATOR_CHANNELS.map((i) => `servo[${i}]`),
];

const SEVERITY_COLOR: Record<HuntSeverity, string> = {
  ok:      'var(--color-bp-ok)',
  watch:   'var(--color-bp-warn)',
  hunt:    'var(--color-bp-stamp)',
  unknown: 'var(--color-bp-dim)',
};
const SEVERITY_LABEL: Record<HuntSeverity, string> = {
  ok:      'ok',
  watch:   'watch',
  hunt:    'hunt',
  unknown: 'n/a',
};
/** Worst-first sort — hunt above watch above ok above unknown. */
const SEVERITY_RANK: Record<HuntSeverity, number> = {
  hunt: 0, watch: 1, ok: 2, unknown: 3,
};

const logStore = useActiveLog();
const { time, fields, hydrating } = logStore;

onMounted(() => { logStore.ensureFields(REQUIRED_FIELDS); });

const isHydrating = computed(() =>
  REQUIRED_FIELDS.some((f) => hydrating.value.has(f)),
);

const actuators = computed(() => {
  const out = new Map<string, Float32Array>();
  for (const i of ACTUATOR_CHANNELS) {
    for (const family of ['motor', 'servo'] as const) {
      const name = `${family}[${i}]`;
      const arr = fields.value.get(name);
      if (arr && arr.length > 0) out.set(name, arr);
    }
  }
  return out;
});

const axisCorrelations = computed(() => {
  const a = actuators.value;
  if (a.size === 0) return [];
  const setR = fields.value.get('setpoint[0]');
  const setP = fields.value.get('setpoint[1]');
  const setY = fields.value.get('setpoint[2]');
  if (!setR || !setP || !setY) return [];
  return correlateServosToAxes(a, setR, setP, setY).filter(
    (c) => Math.abs(c.dominantSigned) >= MIN_DOMINANT_SIGNED,
  );
});

const setpoint = computed(() =>
  [0, 1, 2].map((a) => fields.value.get(`setpoint[${a}]`)),
);

const result = computed<ServoHuntResult | null>(() => {
  if (time.value.length === 0 || actuators.value.size === 0) return null;
  if (axisCorrelations.value.length === 0) return null;
  return computeServoHunt({
    time: time.value,
    servos: actuators.value,
    axisCorrelations: axisCorrelations.value,
    setpoint: setpoint.value,
  });
});

// Channels sorted worst-first, then by descending hunt score.
const rows = computed<ServoHuntChannel[]>(() => {
  const r = result.value;
  if (!r) return [];
  return [...r.channels].sort((a, b) => {
    const d = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (d !== 0) return d;
    const as = Number.isFinite(a.huntScore) ? a.huntScore : -1;
    const bs = Number.isFinite(b.huntScore) ? b.huntScore : -1;
    return bs - as;
  });
});

const ready = computed(() => rows.value.length > 0);

const flaggedCount = computed(
  () => rows.value.filter((c) => c.severity === 'hunt' || c.severity === 'watch').length,
);

const cutoffHz = computed(() => result.value?.hfCutoffHz ?? 20);

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating servo / setpoint fields…';
  if (actuators.value.size === 0) {
    return 'no servo / motor PWM channels — load a log first';
  }
  return 'no servos pass the per-axis correlation threshold '
    + '(needs setpoint + actuator PWM to classify channels)';
});

function rmsText(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} µs` : '—';
}
function corrText(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : '—';
}
function scoreText(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '—';
}
/** Why a channel could not be scored — only meaningful when unknown. */
function unknownReason(c: ServoHuntChannel): string {
  return c.hasReference
    ? 'log too short to score'
    : 'no setpoint reference for this axis';
}
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Servo hunt &middot; uncommanded high-frequency motion
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          fast servo PWM above {{ cutoffHz }} Hz that doesn't track the pilot's setpoint
        </div>
      </div>
      <div v-if="ready" class="font-mono text-[11px]">
        <span v-if="flaggedCount > 0" :style="{ color: SEVERITY_COLOR.watch }">
          {{ flaggedCount }} channel{{ flaggedCount === 1 ? '' : 's' }} flagged
        </span>
        <span v-else :style="{ color: SEVERITY_COLOR.ok }">all channels clear</span>
      </div>
    </header>

    <div
      v-if="!ready"
      class="px-4 py-6 font-mono text-[11px] text-bp-ink-3 text-center"
    >
      {{ pendingMessage }}
    </div>

    <div v-else class="px-3 py-3 flex flex-col gap-1">
      <div
        v-for="c in rows"
        :key="c.fieldName"
        class="border border-bp-line bg-bp-surface-2 px-2.5 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px]"
      >
        <span class="text-bp-ink w-16">{{ c.fieldName }}</span>
        <span class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 w-10">
          {{ AXIS_LABELS[c.axis] }}
        </span>

        <template v-if="c.severity !== 'unknown'">
          <span class="text-bp-ink-3" title="RMS of the high-frequency band of the servo PWM">
            HF <span class="text-bp-ink-2">{{ rmsText(c.hfRmsPwm) }}</span>
          </span>
          <span
            class="text-bp-ink-3"
            title="Peak correlation of the HF servo signal with the pilot's rate setpoint — how much of the HF motion was commanded"
          >
            cmd-corr <span class="text-bp-ink-2">{{ corrText(c.commandCorrelation) }}</span>
          </span>
          <span class="text-bp-ink-3" title="hfRms × (1 − cmd-corr) — uncommanded HF servo amplitude (µs)">
            hunt
            <span class="font-semibold" :style="{ color: SEVERITY_COLOR[c.severity] }">
              {{ scoreText(c.huntScore) }}
            </span>
          </span>
        </template>
        <span v-else class="text-bp-ink-3 italic">
          HF {{ rmsText(c.hfRmsPwm) }} · {{ unknownReason(c) }}
        </span>

        <span
          class="ml-auto px-1.5 py-0.5 font-sans text-[9px] tracking-[0.18em] uppercase font-bold border"
          :style="{ color: SEVERITY_COLOR[c.severity], borderColor: SEVERITY_COLOR[c.severity] }"
        >
          {{ SEVERITY_LABEL[c.severity] }}
        </span>
      </div>
    </div>

    <footer class="px-3 py-2 border-t border-bp-line font-mono text-[10px] text-bp-ink-3 leading-snug">
      hunt score = HF servo amplitude × (1 − correlation with the pilot's setpoint) —
      fast PWM motion the pilot didn't command. Setpoint, not gyro, is the reference:
      the servo PWM is a function of gyro, so a gyro reference would explain away the
      very content this flags. Score thresholds + the {{ cutoffHz }} Hz band edge are
      wing-regime first guesses (TODO calibrate).
      <span class="block mt-1 text-bp-warn">
        note · diagnostic only — there's no firmware fix. A flagged channel is a bench
        check: linkage slop, a worn horn or clevis, a chattering servo — and gyro
        filtering / D-term if the airframe itself is noisy.
      </span>
    </footer>
  </section>
</template>
