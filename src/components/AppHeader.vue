<script setup lang="ts">
// Top app header — slab title, version, station/ops chips, WASM-ready pill.
// `wasmReady` is wired by App.vue once `ParserClient.getInfo()` resolves.

withDefaults(defineProps<{ wasmReady?: boolean }>(), { wasmReady: false });
</script>

<template>
  <header
    class="flex justify-between items-end pb-3 border-b-2 border-bp-line-2"
  >
    <div>
      <div class="flex items-baseline gap-3">
        <span class="font-slab text-[22px] font-semibold text-bp-ink tracking-tight">
          WingTune
        </span>
        <span class="font-mono text-[11px] text-bp-accent">v0.1.0</span>
      </div>
      <div class="font-sans text-[10px] tracking-[0.16em] uppercase text-bp-ink-3 mt-1">
        Flight-log analysis · fixed wing · Blueprint
      </div>
    </div>

    <div class="flex gap-3.5 items-center">
      <div class="font-mono text-[10px] text-bp-ink-3 text-right leading-snug">
        <div>STN · BROWSER</div>
        <div>OPS · OFFLINE</div>
      </div>
      <div class="w-px h-7 bg-bp-line-2" />
      <div
        class="px-2 py-[3px] font-sans text-[9px] font-bold tracking-[0.2em] border"
        :class="wasmReady
          ? 'border-bp-ok text-bp-ok'
          : 'border-bp-dim text-bp-dim'"
      >
        {{ wasmReady ? 'WASM READY' : 'WASM …' }}
      </div>
    </div>
  </header>
</template>
