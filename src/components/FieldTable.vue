<script setup lang="ts">
// Main-frame field presence + sample-check status. Reads exclusively from
// `scanReport.capability` — no hydration is triggered here (per the lazy
// hydration invariant in `wingtune-memory-model`). A "missing" row is a
// field the parser didn't see at all; an "all-zero" row is a field the
// parser saw but every sample was zero (sensor uninitialized or wired but
// silent).

import { computed } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import DataDivider from '@/components/DataDivider.vue';
import IconCheck from '@/components/icons/IconCheck.vue';

type Row = {
  name: string;
  present: boolean;
  status: 'ok' | 'all-zero' | 'missing';
  note: string;
};

const logStore = useActiveLog();
const { scanReport } = logStore;

const rows = computed<Row[]>(() => {
  const r = scanReport.value;
  if (!r) return [];
  const presentSet = new Set(r.capability.fields_present);
  // Render in the order the parser saw them, then any sample-check-only
  // entries that weren't in `fields_present` (shouldn't happen, defensive).
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const name of r.capability.fields_present) {
    const sc = r.capability.sample_check[name];
    let status: Row['status'] = 'ok';
    let note = '';
    if (sc) {
      if (sc.all_zero) {
        status = 'all-zero';
        note = 'all samples zero';
      } else if (!sc.has_content) {
        status = 'all-zero';
        note = 'no content';
      }
    }
    out.push({ name, present: true, status, note });
    seen.add(name);
  }
  for (const name of Object.keys(r.capability.sample_check)) {
    if (seen.has(name)) continue;
    out.push({ name, present: presentSet.has(name), status: 'missing', note: '' });
  }
  return out;
});

const counts = computed(() => {
  const present = rows.value.filter((r) => r.status === 'ok').length;
  const allZero = rows.value.filter((r) => r.status === 'all-zero').length;
  const missing = rows.value.filter((r) => r.status === 'missing').length;
  return { present, allZero, missing, total: rows.value.length };
});
</script>

<template>
  <div>
    <DataDivider :title="`MAIN-FRAME FIELDS · ${counts.total}`">
      <template #right>
        <span class="font-mono text-[11px] text-bp-ink-3">
          <span class="text-bp-ok">{{ counts.present }}</span> present
          <template v-if="counts.allZero">
            · <span class="text-bp-warn">{{ counts.allZero }}</span> empty
          </template>
          <template v-if="counts.missing">
            · <span class="text-bp-dim">{{ counts.missing }}</span> missing
          </template>
        </span>
      </template>
    </DataDivider>

    <div class="mt-2.5 bg-bp-surface border border-bp-line-2">
      <div
        class="grid gap-3 px-3.5 py-2 font-sans text-[9.5px] tracking-[0.2em] uppercase font-bold text-bp-ink-3 border-b border-bp-line-2"
        style="grid-template-columns: 18px 1fr 64px 1fr;"
      >
        <span />
        <span>Field</span>
        <span class="text-right">Status</span>
        <span>Note</span>
      </div>

      <div
        v-for="(r, i) in rows"
        :key="r.name"
        class="grid gap-3 px-3.5 py-[7px] items-center text-[12px]"
        :class="[
          i < rows.length - 1 ? 'border-b border-bp-line' : '',
          r.status === 'missing' ? 'opacity-50' : '',
        ]"
        style="grid-template-columns: 18px 1fr 64px 1fr;"
      >
        <span class="flex items-center">
          <IconCheck v-if="r.status === 'ok'" :size="11" class="text-bp-ok" />
          <span
            v-else-if="r.status === 'all-zero'"
            class="inline-block w-1.5 h-1.5 rounded-full bg-bp-warn"
          />
          <span v-else class="inline-block w-1.5 h-px bg-bp-dim" />
        </span>
        <span class="font-mono text-[12px] text-bp-ink truncate">{{ r.name }}</span>
        <span
          class="text-right font-mono text-[11px]"
          :class="{
            'text-bp-ok':   r.status === 'ok',
            'text-bp-warn': r.status === 'all-zero',
            'text-bp-dim':  r.status === 'missing',
          }"
        >
          {{
            r.status === 'ok' ? 'present'
            : r.status === 'all-zero' ? 'empty'
            : 'missing'
          }}
        </span>
        <span class="font-sans text-[11.5px] text-bp-ink-3 truncate">{{ r.note }}</span>
      </div>

      <div
        v-if="!rows.length"
        class="px-3.5 py-3 font-mono text-[11px] text-bp-ink-3"
      >
        No field metadata in scan report.
      </div>
    </div>
  </div>
</template>
