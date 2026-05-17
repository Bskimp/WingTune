<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 16 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
  >
    <path d="M12 16V4" />
    <path d="M6 10l6-6 6 6" />
    <path d="M4 20h16" />
  </svg>
</template>
