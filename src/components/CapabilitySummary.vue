<script setup lang="ts">
// Post-load capability summary — flight strip + the cards we can fill
// from the real ScanReport today, plus the field table. Cards for
// Controller / TPA / SPA / Servo recommendations are M2+ analytics work
// and are deliberately NOT mocked here (see
// `project-recommender-tab` memory: shipping placeholder content is a
// user-trust trap).

import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import FlightStrip from '@/components/FlightStrip.vue';
import FieldTable from '@/components/FieldTable.vue';
import DataDivider from '@/components/DataDivider.vue';
import ConfidenceStamp from '@/components/ConfidenceStamp.vue';

const logStore = useLogStore();
const { scanReport, firmwareRevision, boardInfo, events } = storeToRefs(logStore);

// Cards rendered from real ScanReport data only.
const capCards = computed(() => {
  const r = scanReport.value;
  if (!r) return [];
  const cards: Array<{
    label: string;
    value: string;
    sub: string;
    level: 'high' | 'medium' | 'low';
    extra?: Array<[string, string]>;
  }> = [];

  cards.push({
    label: 'Firmware',
    value: firmwareRevision.value ?? 'unknown',
    sub: boardInfo.value ?? '',
    level: 'high',
  });

  cards.push({
    label: 'Debug mode',
    value: r.capability.debug_mode ?? 'OFF',
    sub:
      r.capability.debug_mode == null
        ? 'no debug channels logged'
        : 'debug channels available for hydration',
    level: 'high',
  });

  if (r.capability.gps_present) {
    cards.push({
      label: 'GPS',
      value: 'present',
      sub: 'gpsCoord · GPS_speed available',
      level: 'high',
    });
  }

  if (r.capability.voltage_sag_summary) {
    const v = r.capability.voltage_sag_summary;
    cards.push({
      label: 'Battery',
      value: `${v.min_v.toFixed(2)} V min`,
      sub: `p99 ${v.p99_v.toFixed(2)} V · max ${v.max_v.toFixed(2)} V`,
      level: v.pct_below_threshold > 0.05 ? 'medium' : 'high',
      extra: [
        ['min',  `${v.min_v.toFixed(2)} V`],
        ['p99',  `${v.p99_v.toFixed(2)} V`],
        ['max',  `${v.max_v.toFixed(2)} V`],
        ['sag',  `${(v.pct_below_threshold * 100).toFixed(2)} %`],
      ],
    });
  }

  return cards;
});

const eventCount = computed(() => events.value.length);
</script>

<template>
  <section>
    <FlightStrip />

    <DataDivider :title="`SCAN CAPABILITY · ${capCards.length} ITEMS`" class="mt-5 mb-2.5">
      <template #right>
        <span class="font-mono text-[10.5px] text-bp-ink-3">
          analytics cards land with M2+ modules
        </span>
      </template>
    </DataDivider>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      <div
        v-for="card in capCards"
        :key="card.label"
        class="bg-bp-surface border border-bp-line-2 px-4 py-3.5"
      >
        <div class="flex justify-between items-start mb-2.5 gap-3">
          <div class="min-w-0 flex-1">
            <div class="font-sans text-[9.5px] tracking-[0.24em] uppercase font-bold text-bp-ink-3 mb-1.5">
              {{ card.label }}
            </div>
            <div class="font-slab text-[20px] font-semibold text-bp-ink leading-tight truncate">
              {{ card.value }}
            </div>
            <div v-if="card.sub" class="font-mono text-[11px] text-bp-ink-3 mt-1 truncate">
              {{ card.sub }}
            </div>
          </div>
          <ConfidenceStamp :level="card.level" />
        </div>

        <div
          v-if="card.extra"
          class="flex pt-2.5 mt-2.5 border-t border-bp-line-2 -mx-1.5"
        >
          <div
            v-for="(row, i) in card.extra"
            :key="row[0]"
            class="flex-1 px-3 min-w-0"
            :class="i > 0 ? 'border-l border-bp-line' : ''"
          >
            <div class="font-sans text-[9px] tracking-[0.2em] uppercase text-bp-ink-3 mb-0.5">
              {{ row[0] }}
            </div>
            <div class="font-mono text-[13px] text-bp-ink truncate">
              {{ row[1] }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="eventCount" class="mt-2.5">
      <div
        class="bg-bp-surface border border-bp-line-2 px-4 py-3.5 flex justify-between items-center"
      >
        <div>
          <div class="font-sans text-[9.5px] tracking-[0.24em] uppercase font-bold text-bp-ink-3 mb-1">
            EVENTS
          </div>
          <div class="font-slab text-[18px] font-semibold text-bp-ink leading-tight">
            {{ eventCount }} recorded
          </div>
        </div>
        <span class="font-mono text-[11px] text-bp-ink-3">
          arming · mode changes · failsafe · disarm
        </span>
      </div>
    </div>

    <div class="mt-5">
      <FieldTable />
    </div>
  </section>
</template>
