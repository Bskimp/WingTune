<script setup lang="ts">
// Pilot style — characterises HOW the log was flown from the raw
// rcCommand stick traces, not from the airframe's response. Three cases
// look alike in the gyro traces but call for different advice:
//
//   - calm wing, calm pilot       — small, infrequent inputs
//   - stable wing, aggressive     — large, deliberate strokes
//   - unstable wing, pilot fight  — constant small, rapid corrections
//
// Surfaces lib/pilotStyle: per-axis activity / reversal rate / stroke
// p50+p90, plus an aggregate roll+pitch verdict (Cruise/Sport/3D
// suggestion + calm/active/busy correction character). Yaw is reported
// per-axis but excluded from the verdict (rudder use is wing-specific,
// not a style signal).
//
// Diagnostic only — no recommender, no CLI. The verdict feeds the
// M-Style auto-suggest hook in TuneProfileControl (closes M-Style
// Slice 4); a hint, never an auto-apply.

import { computed, onMounted } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import { AXIS_LABELS } from '@/lib/inputChain';
import {
  computePilotStyle,
  type CorrectionCharacter,
  type PilotAxisStyle,
} from '@/lib/pilotStyle';
import { PROFILE_META, type TuneProfile } from '@/lib/tuneProfile';

const REQUIRED_FIELDS = ['rcCommand[0]', 'rcCommand[1]', 'rcCommand[2]'];

const CHARACTER_COLOR: Record<CorrectionCharacter, string> = {
  calm:   'var(--color-bp-ok)',
  active: 'var(--color-bp-accent)',
  busy:   'var(--color-bp-warn)',
};
const CHARACTER_LABEL: Record<CorrectionCharacter, string> = {
  calm:   'calm',
  active: 'active',
  busy:   'busy',
};

const PROFILE_COLOR: Record<TuneProfile, string> = {
  cruise: 'var(--color-bp-ok)',
  sport:  'var(--color-bp-accent)',
  '3d':   'var(--color-bp-warn)',
};

/** The single headline sentence — what the panel *says* about the
 *  flight at a glance. Composed from character + profile + amplitude. */
function headline(
  character: CorrectionCharacter | null,
  profile: TuneProfile | null,
): string {
  if (!character || !profile) return 'not enough stick motion to read a style';
  if (character === 'busy') {
    return 'frequent small corrections — the wing reads busy, a calmer tune or softer rates may help';
  }
  if (character === 'calm' && profile === 'cruise') {
    return 'small, infrequent inputs — flown calmly';
  }
  if (profile === '3d') {
    return 'large deliberate inputs — flown aggressively';
  }
  if (profile === 'sport' && character === 'active') {
    return 'moderate deliberate inputs — flown all-round';
  }
  return `${character} pilot input — ${PROFILE_META[profile].label.toLowerCase()}-style flight`;
}

const logStore = useActiveLog();
const { scanReport, time, fields, hydrating } = logStore;

onMounted(() => { logStore.ensureFields(REQUIRED_FIELDS); });

const isHydrating = computed(() =>
  REQUIRED_FIELDS.some((f) => hydrating.value.has(f)),
);

const rcPresent = computed(() =>
  [0, 1, 2].some((a) => (fields.value.get(`rcCommand[${a}]`)?.length ?? 0) > 0),
);

const result = computed(() => {
  if (time.value.length === 0) return null;
  return computePilotStyle(
    [0, 1, 2].map((a) => fields.value.get(`rcCommand[${a}]`)),
    time.value,
  );
});

const ready = computed(() =>
  !isHydrating.value && result.value !== null && rcPresent.value,
);

const pendingMessage = computed(() => {
  if (isHydrating.value) return 'hydrating rcCommand…';
  if (!scanReport.value) return 'load a log to read pilot style';
  if (!rcPresent.value) {
    return 'no rcCommand data — the BF log must include the stick traces';
  }
  return 'reading pilot style…';
});

interface Row {
  axis: 0 | 1 | 2;
  label: string;
  activityText: string;
  rateText: string;
  strokeText: string;
  empty: boolean;
}

const rows = computed<Row[]>(() => {
  const r = result.value;
  if (!r) return [];
  return r.axes.map((ax: PilotAxisStyle) => {
    const empty = ax.sampleCount === 0;
    return {
      axis: ax.axis,
      label: AXIS_LABELS[ax.axis],
      activityText: empty ? '—' : `${ax.activityRms.toFixed(0)}`,
      rateText: empty ? '—' : `${ax.reversalRatePerSec.toFixed(2)}/s`,
      strokeText:
        empty || ax.reversalCount === 0
          ? '— / —'
          : `${ax.strokeMedian.toFixed(0)} / ${ax.strokeP90.toFixed(0)}`,
      empty,
    };
  });
});

const headlineText = computed(() =>
  headline(result.value?.correctionCharacter ?? null, result.value?.suggestedProfile ?? null),
);

/** Activity bar width 0..100% relative to 500 (BF rcCommand full-scale). */
function activityWidthPct(activityRms: number): number {
  const pct = (activityRms / 500) * 100;
  return Math.max(0, Math.min(100, pct));
}
</script>

<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink whitespace-nowrap">
          Pilot style &middot; rcCommand
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          how the stick was flown — the gyro can't tell calm wing from busy pilot, the stick can
        </div>
      </div>
      <div
        v-if="ready && result?.suggestedProfile"
        class="font-mono text-[10.5px] text-bp-ink-3 flex items-center gap-2"
      >
        <span>suggests</span>
        <span
          class="px-1.5 py-0.5 font-sans text-[9px] tracking-[0.18em] uppercase font-bold border"
          :style="{
            color: PROFILE_COLOR[result.suggestedProfile],
            borderColor: PROFILE_COLOR[result.suggestedProfile],
          }"
          title="Non-binding suggestion — see the TuneProfileControl above for the active profile."
        >{{ PROFILE_META[result.suggestedProfile].label }}</span>
        <span
          v-if="result?.correctionCharacter"
          class="px-1.5 py-0.5 font-sans text-[9px] tracking-[0.18em] uppercase font-bold border"
          :style="{
            color: CHARACTER_COLOR[result.correctionCharacter],
            borderColor: CHARACTER_COLOR[result.correctionCharacter],
          }"
        >{{ CHARACTER_LABEL[result.correctionCharacter] }}</span>
      </div>
    </header>

    <div
      v-if="!ready"
      class="px-4 py-6 font-mono text-[11px] text-bp-ink-3 text-center"
    >
      {{ pendingMessage }}
    </div>

    <div v-else class="px-3 py-3 flex flex-col gap-2">
      <div class="font-mono text-[11px] text-bp-ink-2 leading-snug">
        {{ headlineText }}
      </div>

      <div
        v-for="row in rows"
        :key="row.axis"
        class="border border-bp-line bg-bp-surface-2 px-3 py-2 flex flex-col gap-1.5"
        :class="{ 'opacity-50': row.empty }"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-sans text-[10px] tracking-[0.24em] uppercase font-bold text-bp-ink-2 min-w-[44px]">
            {{ row.label }}
          </span>
          <span
            class="font-mono text-[10.5px] text-bp-ink-3"
            title="RMS deflection from centre in rcCommand units (±500 full-scale)."
          >
            activity <span class="text-bp-ink-2">{{ row.activityText }}</span>
          </span>
          <span
            class="font-mono text-[10.5px] text-bp-ink-3"
            title="Confirmed stick direction-changes per second. Sub-deadband jitter rejected."
          >
            reversals <span class="text-bp-ink-2">{{ row.rateText }}</span>
          </span>
          <span
            class="font-mono text-[10.5px] text-bp-ink-3"
            title="Median / 90th-percentile stroke amplitude (|deflection| at confirmed turning points)."
          >
            strokes <span class="text-bp-ink-2">{{ row.strokeText }}</span>
          </span>
        </div>
        <div class="h-[3px] bg-bp-bg" v-if="!row.empty">
          <div
            class="h-full bg-bp-accent"
            :style="{ width: `${activityWidthPct(result!.axes[row.axis].activityRms)}%` }"
          ></div>
        </div>
      </div>
    </div>

    <footer class="px-3 py-2 border-t border-bp-line font-mono text-[10px] text-bp-ink-3 leading-snug">
      Roll + pitch drive the aggregate verdict; yaw is reported per-axis but
      excluded (rudder use is wing-specific, not a style signal). The
      suggestion is a non-binding hint — the tune-style dial above is yours
      to set; M-Pilot may suggest, never auto-apply.
      <span class="block mt-1 text-bp-warn">
        note · thresholds are wing-regime first guesses (TODO calibrate
        against the corpus). The verdict is null on flights under 3 s or
        with the sticks near centre throughout.
      </span>
    </footer>
  </section>
</template>
