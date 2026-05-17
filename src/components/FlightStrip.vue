<script setup lang="ts">
// Aviation-form top strip after a log is loaded — REG / HRS / FIRMWARE /
// SIZE / DATE data block. Real values from the log store; nothing mocked.
// The "Swap" button resets the store so the user lands back on the drop
// frame.

import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import IconX from '@/components/icons/IconX.vue';

const logStore = useLogStore();
const {
  fileName,
  fileSize,
  parseTimeMs,
  firmwareRevision,
  firmwareDate,
  boardInfo,
  craftName,
  time,
  scanReport,
} = storeToRefs(logStore);

function formatHms(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '–:––:––';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total - h * 3600) / 60);
  const s = total - h * 3600 - m * 60;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const entry = computed(() => craftName.value ?? fileName.value ?? '—');
const duration = computed(() => {
  const t = time.value;
  if (!t.length) return formatHms(0);
  // Time axis is seconds-since-first-frame; final sample is total duration.
  return formatHms(t[t.length - 1]);
});
const sampleRateHz = computed(() => {
  const t = time.value;
  if (t.length < 2) return null;
  const span = t[t.length - 1] - t[0];
  if (span <= 0) return null;
  return Math.round(t.length / span);
});
const totalFrames = computed(() => scanReport.value?.capability.total_frames ?? null);

const hrsSub = computed(() => {
  const hz = sampleRateHz.value;
  const f = totalFrames.value;
  if (hz == null || f == null) return '';
  const khz = hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz` : `${hz} Hz`;
  return `${khz} · ${f.toLocaleString()} frames`;
});

const firmware = computed(() => firmwareRevision.value ?? '—');
const firmwareSub = computed(() => {
  const parts = [boardInfo.value, firmwareDate.value].filter(Boolean);
  return parts.join(' · ');
});
const size = computed(() => formatBytes(fileSize.value));
const sizeSub = computed(() => {
  if (parseTimeMs.value == null) return '';
  return `parse ${Math.round(parseTimeMs.value)} ms`;
});

function swap() {
  logStore.reset();
}
</script>

<template>
  <div
    class="flex bg-bp-surface border border-bp-line-2 border-t-2 border-t-bp-accent"
  >
    <div class="px-3 py-2 border-l border-bp-line-2 flex-1 min-w-0 first:border-l-0">
      <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1">
        ENTRY
      </div>
      <div class="font-slab text-[15px] font-medium text-bp-ink leading-tight truncate">
        {{ entry }}
      </div>
      <div v-if="fileName && entry !== fileName" class="font-mono text-[10.5px] text-bp-ink-3 mt-0.5 truncate">
        {{ fileName }}
      </div>
    </div>

    <div class="px-3 py-2 border-l border-bp-line-2 flex-1 min-w-0">
      <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1">
        HRS
      </div>
      <div class="font-mono text-[15px] font-medium text-bp-ink leading-tight">
        {{ duration }}
      </div>
      <div v-if="hrsSub" class="font-mono text-[10.5px] text-bp-ink-3 mt-0.5">
        {{ hrsSub }}
      </div>
    </div>

    <div class="px-3 py-2 border-l border-bp-line-2 flex-1 min-w-0">
      <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1">
        FIRMWARE
      </div>
      <div class="font-mono text-[15px] font-medium text-bp-ink leading-tight truncate">
        {{ firmware }}
      </div>
      <div v-if="firmwareSub" class="font-mono text-[10.5px] text-bp-ink-3 mt-0.5 truncate">
        {{ firmwareSub }}
      </div>
    </div>

    <div class="px-3 py-2 border-l border-bp-line-2 flex-1 min-w-0">
      <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1">
        SIZE
      </div>
      <div class="font-mono text-[15px] font-medium text-bp-ink leading-tight">
        {{ size }}
      </div>
      <div v-if="sizeSub" class="font-mono text-[10.5px] text-bp-ink-3 mt-0.5">
        {{ sizeSub }}
      </div>
    </div>

    <button
      type="button"
      class="flex items-center px-3.5 border-l border-bp-line-2 text-bp-ink-3 font-sans text-[10.5px] cursor-pointer hover:text-bp-ink gap-2.5"
      @click="swap"
      title="Reset and load another log"
    >
      <span>Swap</span>
      <IconX :size="11" />
    </button>
  </div>
</template>
