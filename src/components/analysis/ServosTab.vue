<script setup lang="ts">
// Servos tab — ServoPanel (multi-trace + saturation strips +
// classified role labels), InputChainPanel (M-Servo input-chain
// lag breakdown), AirframeBandwidthPanel (M-Servo-2 frequency-
// resolved servo→gyro transfer function), ServoAsymmetryPanel, plus
// an honest "what's coming" note for the remaining classifier work.

import ServoPanel from '@/components/analysis/ServoPanel.vue';
import InputChainPanel from '@/components/analysis/InputChainPanel.vue';
import AirframeBandwidthPanel from '@/components/analysis/AirframeBandwidthPanel.vue';
import ServoAsymmetryPanel from '@/components/analysis/ServoAsymmetryPanel.vue';
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <ServoPanel />
    <InputChainPanel />
    <AirframeBandwidthPanel />
    <ServoAsymmetryPanel />

    <div
      class="bg-bp-surface border border-bp-line-2 px-4 py-3 font-mono text-[10.5px] text-bp-ink-3 leading-relaxed"
    >
      <span class="font-sans text-[9.5px] tracking-[0.24em] uppercase font-bold text-bp-accent mr-2">
        CLASSIFIER STATUS
      </span>
      Role labels per servo channel come from one of three sources:
      <span class="text-bp-ok">✓ preset</span> (matched a known mixer name in BF header),
      <span class="text-bp-warn">~ inferred</span> (correlated against per-axis setpoint),
      <span class="text-bp-dim">? unclassified</span> (no signal). Preset table starts empty —
      gets populated as bench-FC CLI dumps validate each mixer family. Manual override
      keyed by <span class="text-bp-ink-2">craft_name</span> is a future slice; for now,
      hover the chip to see the correlation score that drove an inference.
      Motor channels don't need a classifier — a motor is a motor.
    </div>
  </div>
</template>
