<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 14 });
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
    <path d="M6 2h8l4 4v16H6z" />
    <path d="M14 2v4h4" />
  </svg>
</template>
