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
    stroke-width="2.5"
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
  >
    <path d="M5 12l5 5L20 6" />
  </svg>
</template>
