<script setup lang="ts">
// Section divider — brass-accent uppercase label, double-rule line, optional
// right-side slot for a counter or aux action. Matches `CDivider` in
// docs/design-reference/source/src/direction-c.jsx.

defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="shrink-0 font-sans text-[10px] tracking-[0.32em] text-bp-accent font-semibold">
      {{ title }}
    </div>
    <div
      class="flex-1 border-t border-b border-bp-line-2 h-1"
    />
    <div class="shrink-0">
      <slot name="right" />
    </div>
  </div>
</template>
