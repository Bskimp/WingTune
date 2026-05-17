<script setup lang="ts">
// Servos tab — single ServoPanel for M1.4 plus an honest "what's
// coming" note so users know the raw-index labels aren't the end
// state.
//
// Future panels: per-channel saturation strips (M2+), mechanical
// filter-chain visualizer (M3+), classifier-driven role assignment UI
// with the confident / inferred-low / unclassified states (per
// `project-servo-identification` memory).

import ServoPanel from '@/components/analysis/ServoPanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <ServoPanel />

    <div
      class="bg-bp-surface border border-bp-line-2 px-4 py-3 font-mono text-[10.5px] text-bp-ink-3 leading-relaxed"
    >
      <span class="font-sans text-[9.5px] tracking-[0.24em] uppercase font-bold text-bp-accent mr-2">
        CLASSIFIER PENDING
      </span>
      servo channel labels read as "unknown" because the preset → correlation → user-override
      classifier ships in M2. Once active, presets resolve directly (e.g. <span class="text-bp-ink-2">servo[1] → Elevon-L</span>);
      MIXER_CUSTOM_AIRPLANE channels are inferred from per-axis input correlation; manual
      assignment persists per <span class="text-bp-ink-2">craft_name</span>. Motor channels
      don't need a classifier — a motor is a motor.
    </div>
  </div>
</template>
