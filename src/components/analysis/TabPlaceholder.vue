<script setup lang="ts">
// Placeholder for tabs whose analytics modules haven't landed yet.
// Per the `project-recommender-tab` "no placeholder content" rule,
// these tabs render an honest "module pending" state instead of mock
// data. When the module ships, this component is replaced with the
// real tab content.

defineProps<{
  tab: string;
  milestone: string;
  blurb: string;
}>();
</script>

<template>
  <div
    class="bg-bp-surface border border-bp-line-2 px-6 py-10 text-center"
  >
    <div class="font-slab text-[16px] font-semibold text-bp-ink mb-2">
      {{ tab }} · pending {{ milestone }}
    </div>
    <div class="font-sans text-[12px] text-bp-ink-3 max-w-xl mx-auto leading-relaxed">
      {{ blurb }}
    </div>
    <div class="mt-4 font-mono text-[10.5px] text-bp-dim">
      no mock data shown here — surface appears when the module emits real results
    </div>
  </div>
</template>
