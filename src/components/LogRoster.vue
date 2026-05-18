<script setup lang="ts">
// Multi-log roster strip — sits between TabBar and TimeBar in the
// analysis view, visible only when 2+ logs are loaded. Each loaded
// log gets a chip showing its family color, filename, and a remove
// (✕) button. A trailing "+" button opens the native file picker to
// add another log via `session.addLog()` (no reset — the entry-page
// FileDropZone owns reset semantics).
//
// Eye-toggle button per chip (mass-hide all traces from this log
// across every multi-log-aware panel) lives at the view store via
// `toggleLogVisibility(logId)`. Chart panels iterating
// `session.logs.values()` skip hidden logs entirely. Chips dim when
// hidden so the state is visible at a glance.

import { computed, ref } from 'vue';

import { useSessionStore } from '@/stores/session';
import { useViewStore } from '@/stores/view';
import {
  familyForIndex,
  isFamilyCycled,
  LOG_FAMILIES,
} from '@/lib/logColors';
import IconX from '@/components/icons/IconX.vue';

const session = useSessionStore();
const view = useViewStore();

interface RosterEntry {
  id: string;
  name: string;
  familyName: string;
  familyPrimary: string;
  cycled: boolean;
  hidden: boolean;
}

const entries = computed<RosterEntry[]>(() => {
  const out: RosterEntry[] = [];
  let idx = 0;
  for (const log of session.logs.values()) {
    const fam = familyForIndex(idx);
    out.push({
      id: log.id,
      name: log.name,
      familyName: fam.name,
      familyPrimary: fam.primary,
      cycled: isFamilyCycled(idx),
      hidden: view.isLogHidden(log.id),
    });
    idx += 1;
  }
  return out;
});

/** Hidden file input, click()'d by the "+" button. The picker dialog
 *  is the only multi-log entry point in the analysis view today —
 *  drag-and-drop onto the analysis area lands in Push 3b polish. */
const fileInput = ref<HTMLInputElement | null>(null);

function openPicker() {
  fileInput.value?.click();
}

async function onFilePick(ev: Event) {
  const target = ev.target as HTMLInputElement;
  const file = target.files?.[0];
  // Reset so re-picking the same file fires `change` again.
  target.value = '';
  if (!file) return;
  try {
    await session.addLog(file);
  } catch {
    // session.lastScanError populated inside addLog. No surface
    // for this in the roster yet — a Push 3b enhancement could
    // flash the chip on failure or show an inline error banner.
  }
}

async function onRemove(id: string) {
  await session.removeLog(id);
}

function onToggleVisibility(id: string) {
  view.toggleLogVisibility(id);
}

const familyLegend = computed(() => LOG_FAMILIES.map((f) => f.name).join(' · '));
</script>

<template>
  <div
    class="flex items-stretch gap-px bg-bp-surface border border-bp-line-2 border-t-0 px-1.5 py-1.5 select-none"
  >
    <input
      ref="fileInput"
      type="file"
      accept=".bbl,.bfl,.txt"
      class="hidden"
      @change="onFilePick"
    />

    <div
      v-for="entry in entries"
      :key="entry.id"
      class="flex items-center gap-2 px-2 py-1 border border-bp-line-2 bg-bp-surface-2 font-mono text-[10.5px] text-bp-ink transition-opacity"
      :class="entry.hidden ? 'opacity-50' : ''"
      :title="entry.cycled
        ? `${entry.name} · family ${entry.familyName} (re-used past ${LOG_FAMILIES.length} logs)`
        : `${entry.name} · family ${entry.familyName}`"
    >
      <!-- family color dot -->
      <span
        class="w-2 h-2 rounded-full inline-block flex-none"
        :style="{ background: entry.familyPrimary }"
      />
      <!-- filename, mono -->
      <span class="truncate max-w-[160px]">{{ entry.name }}</span>
      <!-- cycle warning when families re-used -->
      <span
        v-if="entry.cycled"
        class="font-sans text-[9px] tracking-[0.2em] uppercase text-bp-stamp"
        title="Color family re-used — more than 3 logs loaded"
      >
        cycled
      </span>
      <!-- eye toggle (hides every trace from this log across panels
           that iterate session.logs — see view.toggleLogVisibility) -->
      <button
        type="button"
        class="ml-1 flex items-center cursor-pointer"
        :class="entry.hidden ? 'text-bp-ink-3 hover:text-bp-ink' : 'text-bp-ink-2 hover:text-bp-accent'"
        :title="entry.hidden
          ? `Show traces from ${entry.name}`
          : `Hide all traces from ${entry.name}`"
        :aria-pressed="!entry.hidden"
        @click="onToggleVisibility(entry.id)"
      >
        <!-- Inline SVG eye icon (open/closed via :class). Kept inline
             so we don't grow IconEye.vue + IconEyeOff.vue for one
             usage. The slash group only renders in the hidden state. -->
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
          <circle cx="8" cy="8" r="2" />
          <line v-if="entry.hidden" x1="2" y1="14" x2="14" y2="2" />
        </svg>
      </button>
      <!-- remove (X) -->
      <button
        type="button"
        class="flex items-center text-bp-ink-3 cursor-pointer hover:text-bp-stamp"
        :title="`Remove ${entry.name}`"
        @click="onRemove(entry.id)"
      >
        <IconX :size="10" />
      </button>
    </div>

    <!-- "+" add another log -->
    <button
      type="button"
      class="flex items-center justify-center px-2.5 py-1 border border-dashed border-bp-line-2 text-bp-ink-3 font-sans text-[12px] font-semibold cursor-pointer hover:text-bp-accent hover:border-bp-accent"
      :title="`Add another log (families: ${familyLegend})`"
      @click="openPicker"
    >
      +
    </button>
  </div>
</template>
