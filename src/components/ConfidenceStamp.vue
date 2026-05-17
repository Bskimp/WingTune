<script setup lang="ts">
// Rubber-stamp confidence indicator. Visual language locked in M1.3.4
// (Direction C · Hangar Logbook). Only `high` is rendered organically
// for now — `medium` / `low` arrive when M2+ analytics start emitting
// confidence-scored results. Keeping the three levels here so the M2
// surfaces just slot in without a component rewrite.

const props = defineProps<{
  level: 'high' | 'medium' | 'low';
}>();

type StampSpec = { label: string; classes: string; rotate: string };

const SPECS: Record<typeof props.level, StampSpec> = {
  high:   { label: 'VERIFIED', classes: 'text-bp-ok border-bp-ok',       rotate: '-2deg' },
  medium: { label: 'REVIEW',   classes: 'text-bp-warn border-bp-warn',   rotate: '1.5deg' },
  low:    { label: 'FLAGGED',  classes: 'text-bp-stamp border-bp-stamp', rotate: '-1deg' },
};
</script>

<template>
  <span
    class="inline-flex items-center px-2 py-[2px] border-[1.5px] font-sans font-bold text-[10px] tracking-[0.22em] bg-black/15"
    :class="SPECS[level].classes"
    :style="{ transform: `rotate(${SPECS[level].rotate})` }"
  >
    {{ SPECS[level].label }}
  </span>
</template>
