<script setup lang="ts">
// Severity-sorted vertical list of recommendation cards. Empty state
// handled by the parent (RecommendTab) — if recs is empty the tab is
// hidden upstream and we never mount.

import { computed } from 'vue';

import { sortBySeverity, type Recommendation } from '@/lib/recommendations';
import RecommendCard from '@/components/analysis/RecommendCard.vue';

const props = defineProps<{ recs: readonly Recommendation[] }>();

const sorted = computed(() => sortBySeverity(props.recs));
</script>

<template>
  <div class="flex flex-col gap-2">
    <RecommendCard
      v-for="rec in sorted"
      :key="rec.id"
      :rec="rec"
    />
  </div>
</template>
