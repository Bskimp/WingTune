<script setup lang="ts">
// Trim diagnostics — the steady-state I-term as a structural
// "fix the airplane before the PIDs" reading.
//
// Surfaces lib/trimDiagnostics: per axis, the mean I-term over the
// steady-cruise samples of the flight, as a fraction of that axis's
// whole-flight I-term RMS. A large persistent steady I-term means the
// controller is holding a constant control-surface offset to fight a
// structural asymmetry the pilot never trimmed out — heavy wing, CG
// off, asymmetric thrust. Every gain tuned afterwards is tuned around
// that crooked baseline.
//
// Diagnostic only — no recommender, no CLI. The fix is mechanical
// (trim / CG / linkage). Single-log (useActiveLog).

import { computed, onMounted } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import { AXIS_LABELS } from '@/lib/inputChain';
import {
  computeTrimDiagnostics,
  MIN_COVERAGE_SEC,
  type AxisTrim,
  type TrimSeverity,
} from '@/lib/trimDiagnostics';

const REQUIRED_FIELDS = [
  'axisI[0]', 'axisI[1]', 'axisI[2]',
  'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
  'attitude[0]',
];

const SEVERITY_COLOR: Record<TrimSeverity, string> = {
  balanced:    'var(--color-bp-ok)',
  slight:      'var(--color-bp-warn)',
  'trim-error':'var(--color-bp-stamp)',
  unknown:     'var(--color-bp-dim)',
};
const SEVERITY_LABEL: Record<TrimSeverity, string> = {
  balanced:    'balanced',
  slight:      'slight',
  'trim-error':'trim error',
  unknown:     'n/a',
};

/** Per-axis structural causes a held trim offset points at — fixed
 *  strings, independent of the I-term's sign convention. */
const AXIS_CAUSE: Record<number, string> = {
  0: 'wing-weight balance · aileron sub-trim · wing warp',
  1: 'CG position · wing / tail incidence · elevator trim',
  2: 'thrust line · motor alignment · vertical-fin offset',
};

const logStore = useActiveLog();
const { scanReport, time, fields, hydrating } = logStore;

onMounted(() => { logStore.ensureFields(REQUIRED_FIELDS); });

const isHydrating = computed(() =>
  REQUIRED_FIELDS.some((f) => hydrating.value.has(f)),
);

const iTermPresent = computed(() =>
  [0, 1, 2].some((a) => (fields.value.get(`axisI[${a}]`)?.length ?? 0) > 0),
);

const result = computed(() => {
  if (time.value.length === 0) return null;
  return computeTrimDiagnostics({
    time: time.value,
    iTerm: [0, 1, 2].map((a) => fields.value.get(`axisI[${a}]`)),
    setpoint: [0, 1, 2].map((a) => fields.value.get(`setpoint[${a}]`)),
    attitudeRoll: fields.value.get('attitude[0]'),
  });
});

const enoughCoverage = computed(
  () => (result.value?.steadyCoverageSec ?? 0) >= MIN_COVERAGE_SEC,
);

const ready = computed(() =>
  !isHydrating.value && result.value !== null && iTermPresent.value && enoughCoverage.value,
);

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating I-term / setpoint / attitude fields…';
  if (!scanReport.value) return 'load a log to read steady-state trim';
  if (!iTermPresent.value) {
    return 'no axisI[] data — enable PID-component logging in the BF blackbox config';
  }
  if (!enoughCoverage.value) {
    const have = result.value?.steadyCoverageSec ?? 0;
    return `only ${have.toFixed(1)} s of steady cruise found — trim needs ≥ ${MIN_COVERAGE_SEC} s `
      + 'of trimmed, hands-off straight-and-level flight to read';
  }
  return 'reading steady-state trim…';
});

const coverageNote = computed(() => {
  const r = result.value;
  if (!r) return '';
  const gate = r.usedAttitudeGate ? 'wings-level + centred-stick' : 'centred-stick';
  return `${r.steadyCoverageSec.toFixed(1)} s steady cruise · ${gate}`;
});

interface Row {
  axis: 0 | 1 | 2;
  label: string;
  cause: string;
  iTermText: string;
  fractionText: string;
  severity: TrimSeverity;
}

const rows = computed<Row[]>(() => {
  const r = result.value;
  if (!r) return [];
  return r.axes.map((ax: AxisTrim) => ({
    axis: ax.axis,
    label: AXIS_LABELS[ax.axis],
    cause: AXIS_CAUSE[ax.axis],
    iTermText: Number.isFinite(ax.meanITerm)
      ? `${ax.meanITerm >= 0 ? '+' : ''}${ax.meanITerm.toFixed(1)}`
      : '—',
    fractionText: ax.severity === 'unknown' ? '—' : `${(ax.trimFraction * 100).toFixed(0)}%`,
    severity: ax.severity,
  }));
});
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Trim diagnostics &middot; steady-state I-term
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          the airframe asymmetry the integrator is masking — fix this before the PIDs
        </div>
      </div>
      <div v-if="ready" class="font-mono text-[10.5px] text-bp-ink-3">
        {{ coverageNote }}
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
        v-for="row in rows"
        :key="row.axis"
        class="border border-bp-line bg-bp-surface-2 px-3 py-2 flex flex-col gap-1"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-sans text-[10px] tracking-[0.24em] uppercase font-bold text-bp-ink-2 min-w-[44px]">
            {{ row.label }}
          </span>
          <span class="font-mono text-[10.5px] text-bp-ink-3" title="Mean I-term over steady-cruise samples (raw axis units)">
            I-term <span class="text-bp-ink-2">{{ row.iTermText }}</span>
          </span>
          <span
            class="font-mono text-[10.5px] text-bp-ink-3"
            title="Share of the axis's whole-flight I-term activity that is a static trim offset"
          >
            <span class="font-semibold" :style="{ color: SEVERITY_COLOR[row.severity] }">
              {{ row.fractionText }}
            </span>
            static
          </span>
          <span
            class="ml-auto px-1.5 py-0.5 font-sans text-[9px] tracking-[0.18em] uppercase font-bold border"
            :style="{ color: SEVERITY_COLOR[row.severity], borderColor: SEVERITY_COLOR[row.severity] }"
          >
            {{ SEVERITY_LABEL[row.severity] }}
          </span>
        </div>
        <div
          v-if="row.severity === 'slight' || row.severity === 'trim-error'"
          class="font-mono text-[10px] text-bp-ink-3 pl-[44px]"
        >
          check &middot; {{ row.cause }}
        </div>
      </div>
    </div>

    <footer class="px-3 py-2 border-t border-bp-line font-mono text-[10px] text-bp-ink-3 leading-snug">
      A healthy axis needs almost no integral in trimmed level flight — its I-term
      rests near zero. A large <span class="text-bp-stamp">static</span> share means
      the controller is holding a constant surface offset to fight a structural
      asymmetry. Fix it mechanically (trim / CG / incidence / linkage) so the I-term
      rests near zero, THEN tune the PIDs against a straight baseline.
      <span class="block mt-1 text-bp-warn">
        note · diagnostic only, no firmware fix. Measured over steady cruise only
        (centred stick<template v-if="result?.usedAttitudeGate">, wings level</template>,
        integrator settled); fly a calm hands-off pass if coverage is thin.
      </span>
    </footer>
  </section>
</template>
