<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 12 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="square"
    aria-hidden="true"
  >
    <path d="M5 5l14 14" />
    <path d="M19 5L5 19" />
  </svg>
</template>
