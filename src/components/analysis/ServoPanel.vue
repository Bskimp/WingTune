<script setup lang="ts">
// Actuator-output panel — multi-trace render of every PWM-output
// channel in the log. Wings log control surfaces under `servo[N]` and
// the pusher under `motor[N]`; both are surfaced here so the user
// sees the full set of physical actuators driving the airframe.
//
// Labels in M1.4:
//   · `servo[N]` → "Servo N · unknown" (classifier-pending — the
//     preset → correlation → user-override path lands in M2; see
//     `project-servo-identification`)
//   · `motor[N]` → "Motor N" (no classification needed — a motor is a
//     motor; for a wing this is the pusher)
//
// Servos render first so the actual control-surface channels are the
// visual lead; motors follow.
//
// Saturation overlays (the design's SAT_R / SAT_P / SAT_Y windows) are
// M2+ analytics — endpoint-saturation detection is a derived signal,
// not raw data. Not mocked here.

import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { AlignedData, Options, Series } from 'uplot';

import { useLogStore } from '@/stores/log';
import { useViewStore } from '@/stores/view';
import { useUPlot } from '@/composables/useUPlot';

// Cycle of Blueprint-compatible colors per channel. uPlot needs concrete
// CSS strings; keep in sync with tailwind.css @theme block. The first
// four match accent / warn / ok / stamp so primary channels read clearly;
// further channels fall back to ink-2 tones.
const CHANNEL_COLORS = [
  '#7ec8ff', // accent  — typically channel 0 (often throttle on conventional, elevon-L on delta)
  '#ffc46a', // warn    — typically channel 1
  '#6ed3a0', // ok      — typically channel 2
  '#ff8a7a', // stamp   — typically channel 3
  '#b6c7e0', // ink-2   — channel 4+
  '#7a90b0', // ink-3
] as const;

const MAX_CHANNELS = 16; // Wing builds rarely exceed this; defensive cap.

// BF declares fixed-size servo arrays in the log header (MAX_SUPPORTED_
// SERVOS), so a 2-servo elevon will still see `servo[0..7]` listed as
// present. Unwired channels sit at zero (caught by sample_check) or at
// PWM midpoint (not caught by sample_check). We post-hydration filter
// any channel whose total PWM range is below this threshold. 10 µs is
// well under any meaningful servo movement but well above sensor jitter.
const RANGE_THRESHOLD_PWM = 10;

const logStore = useLogStore();
const view = useViewStore();
const { time, fields, hydrating, scanReport } = storeToRefs(logStore);

type ChannelKind = 'servo' | 'motor';

type ChannelSpec = {
  fieldName: string;
  index: number;
  kind: ChannelKind;
  label: string;
  color: string;
};

// Pull every `servo[i]` and `motor[i]` field the scan report identified,
// servos first so they lead the visual stack.
const channels = computed<ChannelSpec[]>(() => {
  const r = scanReport.value;
  if (!r) return [];
  const pattern = /^(servo|motor)\[(\d+)\]$/;
  const raw = r.capability.fields_present
    .map((name) => ({ name, m: pattern.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null);

  raw.sort((a, b) => {
    // servos before motors, then by index
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
      // Servo labels surface the classifier-pending "unknown" state;
      // motors don't need a classifier (a motor is a motor) so they
      // just get the index.
      label: kind === 'servo' ? `Servo ${idx} · unknown` : `Motor ${idx}`,
      color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
    };
  });
});

async function hydrateAllChannels() {
  const names = channels.value.map((c) => c.fieldName);
  if (names.length === 0) return;
  await logStore.ensureFields(names);
}

onMounted(hydrateAllChannels);
watch(channels, hydrateAllChannels, { deep: false });

const isHydrating = computed(() =>
  channels.value.some((c) => hydrating.value.has(c.fieldName)),
);

// Pre-hydration we can't filter (no data yet); show every candidate so
// the panel doesn't flicker between "8 channels loading" and the
// filtered set. Once hydration lands, the range filter applies.
const allHydrated = computed(() =>
  channels.value.length > 0 &&
  channels.value.every((c) => (fields.value.get(c.fieldName)?.length ?? 0) > 0),
);

// Channels that actually moved during the flight. Indexed-keyed cache
// would be premature here — Vue's computed memoizes by dep tracking
// and only re-evaluates if fields changes, which happens once per
// hydration round.
const activeChannels = computed<ChannelSpec[]>(() => {
  if (!allHydrated.value) return channels.value;
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
  allHydrated.value ? channels.value.length - activeChannels.value.length : 0,
);

const servoCount = computed(() => activeChannels.value.filter((c) => c.kind === 'servo').length);
const motorCount = computed(() => activeChannels.value.filter((c) => c.kind === 'motor').length);

const channelArrays = computed<Float32Array[]>(() =>
  activeChannels.value.map((c) => fields.value.get(c.fieldName) ?? new Float32Array(0)),
);

const ready = computed(() =>
  time.value.length > 0 &&
  channelArrays.value.length > 0 &&
  channelArrays.value.every((a) => a.length > 0),
);

const data = computed<AlignedData>(() => {
  if (!ready.value) {
    const empties = activeChannels.value.map(() => new Float32Array(0));
    return [new Float32Array(0), ...empties] as unknown as AlignedData;
  }
  return [time.value, ...channelArrays.value] as unknown as AlignedData;
});

const opts = computed<Options>(() => {
  const series: Series[] = [
    {},
    ...activeChannels.value.map((c) => ({
      label:  c.fieldName,
      stroke: c.color,
      width:  1.1,
    })),
  ];

  return {
    width: 800,
    height: 320,
    legend: { show: false },
    scales: {
      x: { time: false },
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

function resetZoom() {
  plot.resetZoom();
}
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
          servo[i] control surfaces and motor[i] pusher channels · drag inside to zoom
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

      <div ref="hostRef" class="w-full" />
    </div>

    <footer
      class="flex flex-wrap items-center px-3 py-2 gap-x-4 gap-y-1 border-t border-bp-line text-[10.5px]"
    >
      <span
        v-for="c in activeChannels"
        :key="c.fieldName"
        class="flex items-center gap-1.5 font-sans text-bp-ink-2"
      >
        <span
          class="inline-block w-3.5 h-0.5"
          :style="{ background: c.color }"
        />
        <span class="font-mono text-bp-ink-3">{{ c.fieldName }}</span>
        <span class="font-sans text-bp-dim">
          · {{ c.kind === 'servo' ? 'unknown' : 'motor' }}
        </span>
      </span>
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
