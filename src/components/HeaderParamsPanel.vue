<script setup lang="ts">
// Deep header inspector — exposes every key/value pair BF wrote into
// the BBL header. The free-form `header_params` map is the canonical
// dump (PID values, rates, mixer config, filter cutoffs, modes, etc.),
// alphabetically sorted on the Rust side via BTreeMap so the UI just
// renders. Click any row to copy the corresponding `set key = value`
// CLI line — useful for porting tuning between crafts or re-applying
// after a CLI reset.
//
// Includes keys that `filter_config` already typed. Showing the raw
// pair is the point — the user sees exactly what BF logged, not the
// WingTune-recognised subset.

import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import DataDivider from '@/components/DataDivider.vue';

const logStore = useLogStore();
const { scanReport } = storeToRefs(logStore);

const search = ref('');
const copiedKey = ref<string | null>(null);

interface Param {
  key: string;
  value: string;
}

const allParams = computed<Param[]>(() => {
  const r = scanReport.value;
  if (!r) return [];
  return Object.entries(r.header_params).map(([key, value]) => ({ key, value }));
});

const filteredParams = computed<Param[]>(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return allParams.value;
  return allParams.value.filter(
    (p) => p.key.toLowerCase().includes(q) || p.value.toLowerCase().includes(q),
  );
});

async function copyToClipboard(p: Param) {
  const cli = `set ${p.key} = ${p.value}`;
  try {
    await navigator.clipboard.writeText(cli);
    copiedKey.value = p.key;
    setTimeout(() => {
      if (copiedKey.value === p.key) copiedKey.value = null;
    }, 1200);
  } catch {
    // Clipboard API may be unavailable (insecure context, etc.).
    // Silent fail — the user can select the row text manually.
  }
}

function clearSearch() {
  search.value = '';
}
</script>

<template>
  <div>
    <DataDivider :title="`BBL HEADER PARAMETERS · ${allParams.length}`">
      <template #right>
        <span class="font-mono text-[10.5px] text-bp-ink-3">
          click any row to copy <span class="text-bp-ink-2">set key = value</span>
        </span>
      </template>
    </DataDivider>

    <div class="mt-2.5 relative">
      <input
        v-model="search"
        type="text"
        placeholder="filter by key or value (e.g. gyro, pid, dterm, 150)…"
        class="w-full bg-bp-surface border border-bp-line-2 pl-3 pr-8 py-1.5 font-mono text-[12px] text-bp-ink focus:outline-none focus:border-bp-accent placeholder-bp-dim"
        spellcheck="false"
      />
      <button
        v-if="search.length > 0"
        type="button"
        class="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-bp-ink-3 hover:text-bp-ink cursor-pointer"
        title="Clear filter"
        @click="clearSearch"
      >&#10005;</button>
    </div>

    <div class="mt-2.5 bg-bp-surface border border-bp-line-2 max-h-[480px] overflow-y-auto">
      <div
        v-for="(p, i) in filteredParams"
        :key="p.key"
        class="grid gap-3 px-3.5 py-[5px] cursor-pointer hover:bg-bp-surface-2 font-mono text-[11.5px] transition-colors duration-150"
        :class="[
          i < filteredParams.length - 1 ? 'border-b border-bp-line' : '',
          copiedKey === p.key ? 'bg-bp-accent !text-bp-bg' : 'text-bp-ink',
        ]"
        style="grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 60px;"
        :title="`Copy: set ${p.key} = ${p.value}`"
        @click="copyToClipboard(p)"
      >
        <span class="truncate">{{ p.key }}</span>
        <span
          class="truncate"
          :class="copiedKey === p.key ? '' : 'text-bp-ink-2'"
        >{{ p.value }}</span>
        <span
          class="text-right font-sans text-[9px] tracking-[0.16em] uppercase font-bold"
          :class="copiedKey === p.key ? 'text-bp-bg' : 'text-bp-ink-3 opacity-0'"
        >{{ copiedKey === p.key ? 'copied' : '' }}</span>
      </div>
      <div
        v-if="filteredParams.length === 0 && allParams.length > 0"
        class="px-3.5 py-3 font-mono text-[11px] text-bp-ink-3 text-center"
      >
        no parameters match "{{ search }}"
      </div>
      <div
        v-if="allParams.length === 0"
        class="px-3.5 py-3 font-mono text-[11px] text-bp-ink-3 text-center"
      >
        no header parameters in scan report
      </div>
    </div>

    <div
      v-if="allParams.length > 0"
      class="mt-1.5 font-mono text-[10.5px] text-bp-ink-3 text-right"
    >
      <template v-if="search">
        {{ filteredParams.length }} of {{ allParams.length }} match
      </template>
      <template v-else>
        {{ allParams.length }} total
      </template>
    </div>
  </div>
</template>
