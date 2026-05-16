<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ParserClient } from './lib/wasmBridge';

const parserStatus = ref<string>('loading…');

onMounted(async () => {
  try {
    const client = new ParserClient();
    parserStatus.value = await client.getInfo();
  } catch (err) {
    parserStatus.value = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
});
</script>

<template>
  <main
    class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-8"
  >
    <h1 class="text-4xl font-semibold mb-2">WingTune</h1>
    <p class="text-zinc-400 mb-6">Betaflight fixed-wing log analysis &mdash; pre-alpha</p>
    <p class="text-sm text-zinc-500 mb-1">M1.2 scaffold</p>
    <p class="text-sm text-zinc-500 mb-4">scan/hydrate API exposed &mdash; file drop UI lands in M1.3</p>
    <p class="text-emerald-400 font-mono text-sm" data-test="parser-info">{{ parserStatus }}</p>
  </main>
</template>
