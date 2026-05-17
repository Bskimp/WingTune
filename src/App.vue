<script setup lang="ts">
// Entry-page shell. Shows the file drop zone until a log has been scanned,
// then swaps to the capability summary. The "swap" button in the flight
// strip resets the store and returns the user here.
//
// `wasmReady` is wired by an initial `ParserClient.getInfo()` ping so the
// header's "WASM READY" pill turns on once the worker has actually
// instantiated the module. Failure is surfaced via the same chip going
// red and a small banner — most users will never see this state.

import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { ParserClient } from '@/lib/wasmBridge';
import { useLogStore } from '@/stores/log';
import AppHeader from '@/components/AppHeader.vue';
import FileDropZone from '@/components/FileDropZone.vue';
import AnalysisView from '@/views/AnalysisView.vue';

const wasmReady = ref(false);
const wasmError = ref<string | null>(null);

const logStore = useLogStore();
const { scanReport } = storeToRefs(logStore);

const hasLog = computed(() => scanReport.value !== null);

onMounted(async () => {
  try {
    const client = new ParserClient();
    await client.getInfo();
    wasmReady.value = true;
  } catch (err) {
    wasmError.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <main class="min-h-screen bg-bp-bg text-bp-ink font-sans">
    <div class="max-w-[1100px] mx-auto px-6 py-6">
      <AppHeader :wasm-ready="wasmReady" />

      <div v-if="wasmError" class="mt-4 px-4 py-3 border border-bp-stamp text-bp-stamp font-mono text-[12px]">
        WASM init failed — {{ wasmError }}
      </div>

      <div class="mt-5">
        <AnalysisView v-if="hasLog" />
        <FileDropZone v-else />
      </div>
    </div>
  </main>
</template>
