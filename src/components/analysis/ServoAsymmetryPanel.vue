<script setup lang="ts">
// Servo asymmetric-linkage detection — drill-down for the M-Servo MVP.
//
// The Input Chain panel above this one aggregates paired servos into a
// per-axis signed sum so opposite-sign + paired-identical pairs both
// add cleanly — by design that hides per-servo drift. This panel is
// the drill-down: for axes with ≥ 2 contributing servos, cross-
// correlate each non-reference servo against the reference (highest
// |dominantSigned|) and report peak lag + amplitude ratio per pairing.
//
// Diagnostic-only — there's no CLI fix for mechanical drift; the
// fix workflow is "check linkage / sub-trim / endpoint mismatch." A
// yellow stamp surfaces when |lag| > 10ms OR amplitude ratio outside
// [0.7, 1.3]. The recommender (lib/recommenders/servoAsymmetry.ts)
// turns warn-severity pairs into yellow-confidence rec cards.

import { computed } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import { correlateServosToAxes } from '@/lib/servoClassifier';
import { estimateSampleRate } from '@/lib/spectrum';
import {
  analyzeServoAsymmetry,
  type AsymmetryPair,
  type AxisAsymmetry,
} from '@/lib/servoAsymmetry';

const ACTUATOR_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7];
const MIN_DOMINANT_SIGNED = 0.25;

const SEVERITY_COLOR: Record<AsymmetryPair['severity'], string> = {
  ok:           'var(--color-bp-ok)',
  warn:         'var(--color-bp-warn)',
  inconclusive: 'var(--color-bp-dim)',
};

const SEVERITY_LABEL: Record<AsymmetryPair['severity'], string> = {
  ok:           'ok',
  warn:         'asym',
  inconclusive: 'n/a',
};

const { time, fields } = useActiveLog();

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
  const raw = correlateServosToAxes(a, setR, setP, setY);
  return raw.filter((c) => Math.abs(c.dominantSigned) >= MIN_DOMINANT_SIGNED);
});

const sampleRateHz = computed(() => estimateSampleRate(time.value));

const asymmetry = computed<AxisAsymmetry[]>(() => {
  if (time.value.length === 0 || actuators.value.size === 0) return [];
  if (axisCorrelations.value.length === 0) return [];
  return analyzeServoAsymmetry({
    motors: actuators.value,
    axisCorrelations: axisCorrelations.value,
    sampleRateHz: sampleRateHz.value,
  });
});

const ready = computed(() => asymmetry.value.length > 0);

const pendingMessage = computed(() => {
  if (actuators.value.size === 0) return 'no servo / motor PWM channels — load a log first';
  if (axisCorrelations.value.length === 0) return 'no servos pass the per-axis correlation threshold (need setpoint + actuator PWM)';
  return 'no axis has ≥ 2 contributing servos to compare — single-surface setup or already-aggregated mixer output';
});

function formatLag(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '' : '';
  return `${sign}${ms.toFixed(1)} ms`;
}

function formatRatio(r: number): string {
  return `×${r.toFixed(2)}`;
}
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Servo asymmetry · per-axis pairwise drift
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          paired servo lag + amplitude ratio vs reference (highest correlation per axis)
        </div>
      </div>
    </header>

    <div
      v-if="!ready"
      class="px-4 py-6 font-mono text-[11px] text-bp-ink-3 text-center"
    >
      {{ pendingMessage }}
    </div>

    <div v-else class="px-3 py-3 flex flex-col gap-2">
      <div
        v-for="ax in asymmetry"
        :key="ax.axis"
        class="border border-bp-line bg-bp-surface-2 px-2.5 py-2 flex flex-col gap-1"
      >
        <div class="flex items-center gap-2">
          <span class="font-sans text-[9px] tracking-[0.2em] uppercase font-bold text-bp-ink-3 w-10">
            {{ ax.axisLabel.toUpperCase() }}
          </span>
          <span class="font-mono text-[11px] text-bp-ink">
            ref · {{ ax.referenceFieldName }}
          </span>
        </div>
        <div
          v-for="p in ax.pairs"
          :key="p.fieldName"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 font-mono text-[10.5px]"
        >
          <span class="text-bp-ink">{{ p.fieldName }}</span>
          <span class="text-bp-ink-3">
            lag <span :style="{ color: SEVERITY_COLOR[p.severity] }">{{ formatLag(p.peakLagMs) }}</span>
          </span>
          <span class="text-bp-ink-3">
            amp <span :style="{ color: SEVERITY_COLOR[p.severity] }">{{ formatRatio(p.amplitudeRatio) }}</span>
          </span>
          <span class="text-bp-ink-3">
            corr {{ p.peakCorr.toFixed(2) }}
          </span>
          <span
            class="ml-auto px-1.5 py-0.5 font-sans text-[9px] tracking-[0.18em] uppercase font-bold border"
            :style="{ color: SEVERITY_COLOR[p.severity], borderColor: SEVERITY_COLOR[p.severity] }"
          >
            {{ SEVERITY_LABEL[p.severity] }}
          </span>
        </div>
      </div>
    </div>

    <footer class="px-3 py-2 border-t border-bp-line font-mono text-[10px] text-bp-ink-3 leading-snug">
      lag positive → this servo responds LATER than reference · amp ratio = stddev(this) / stddev(ref) ·
      thresholds: |lag| ≤ 10 ms + ratio ∈ [0.7, 1.3] = ok · outside either = asym (check linkage, sub-trim, endpoints)
      <span class="block mt-1 text-bp-warn">
        note · BF wing-msp sends paired-identical PWM to both ailerons (physical reversal is mechanical, not
        mixer-side). A perfect ok here validates the firmware/mixer side only — mechanical drift (loose horn,
        worn clevis, asymmetric deflection) won't show in PWM and requires a bench deflection gauge to verify.
      </span>
    </footer>
  </section>
</template>
