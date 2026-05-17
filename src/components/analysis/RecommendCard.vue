<script setup lang="ts">
// One recommendation row. Severity stripe on the left, expandable
// detail body, paste-ready CLI block with copy button.
//
// Cardinal-rule gate: when confidence === 'red', the copy button is
// REMOVED entirely (not just disabled). "Disabled but visible" gets
// tapped by a pilot in a hurry; on red, the affordance must not
// exist.

import { computed, ref } from 'vue';

import type { Recommendation, Severity, EvidencePoint } from '@/lib/recommendations';
import type { ConfidenceLevel } from '@/lib/confidence';
import { useViewStore } from '@/stores/view';

const props = defineProps<{ rec: Recommendation }>();

const view = useViewStore();

function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const ms = Math.round((seconds - total) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0').slice(0, 2)}`;
}

/** Pin the shared cursor at the evidence point's time and switch
 *  to the Tracking tab so the user sees it land. Pin persists
 *  across tab switches per the M1.4 cursor design. */
function pinEvidence(ev: EvidencePoint) {
  view.pinCursorAt(ev.time_sec);
  view.setTab('tracking');
}

const open = ref(false);
const copied = ref(false);

function toggle() {
  open.value = !open.value;
}

async function copyCli() {
  if (props.rec.cli.length === 0) return;
  try {
    await navigator.clipboard.writeText(props.rec.cli.join('\n'));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Clipboard API may be blocked in some embeds; silently no-op.
  }
}

const severityStyle: Record<Severity, { color: string; label: string }> = {
  high:   { color: 'var(--color-bp-stamp)', label: 'high' },
  medium: { color: 'var(--color-bp-warn)',  label: 'med' },
  low:    { color: 'var(--color-bp-ok)',    label: 'low' },
  info:   { color: 'var(--color-bp-ink-3)', label: 'ok' },
};

const confidenceStyle: Record<ConfidenceLevel, { color: string; label: string }> = {
  green:  { color: 'var(--color-bp-ok)',    label: 'high conf' },
  yellow: { color: 'var(--color-bp-warn)',  label: 'med conf' },
  red:    { color: 'var(--color-bp-stamp)', label: 'low conf' },
};

const sev  = computed(() => severityStyle[props.rec.severity]);
const conf = computed(() => confidenceStyle[props.rec.confidence]);

// Cardinal rule #5 — copy button removed entirely on red confidence.
const allowCopy = computed(() =>
  props.rec.confidence !== 'red' && props.rec.cli.length > 0,
);
</script>

<template>
  <article
    class="bg-bp-surface border border-bp-line-2"
    :style="{ borderLeft: `3px solid ${sev.color}` }"
  >
    <!-- head -->
    <div class="px-4 pt-3">
      <div class="flex gap-2.5 items-center mb-1.5 flex-wrap">
        <span
          class="inline-flex items-center gap-1.5 px-1.5 py-px border font-sans text-[9px] font-bold tracking-[0.2em] uppercase"
          :style="{ color: sev.color, borderColor: sev.color }"
        >
          <span
            class="inline-block w-1.5 h-1.5 rounded-full"
            :style="{ background: sev.color }"
          />
          {{ sev.label }}
        </span>
        <span class="font-mono text-[10px] tracking-[0.18em] font-bold uppercase text-bp-ink-3">
          {{ rec.domain }}<template v-if="rec.axis"> · {{ rec.axis }}</template>
        </span>
        <span class="flex-1" />
        <span
          class="inline-flex items-center px-1.5 py-px border font-sans text-[9px] font-bold tracking-[0.18em] uppercase"
          :style="{ color: conf.color, borderColor: conf.color, transform: 'rotate(-1deg)', background: 'rgba(0,0,0,0.18)' }"
        >{{ conf.label }}</span>
      </div>
      <div class="font-slab text-[15px] font-semibold text-bp-ink mb-1">
        {{ rec.title }}
      </div>
      <div class="font-sans text-[12px] text-bp-ink-2 leading-snug">
        {{ rec.summary }}
      </div>
    </div>

    <!-- body (collapsed by default) -->
    <div v-if="open" class="px-4 pt-3">
      <div class="font-sans text-[12px] text-bp-ink-3 leading-relaxed mb-3 whitespace-pre-line">
        {{ rec.detail }}
      </div>

      <!-- current vs suggested -->
      <div
        v-if="rec.current && rec.suggested"
        class="flex gap-px mb-3"
      >
        <div class="flex-1 bg-bp-surface-2 border border-bp-line p-2.5 min-w-0">
          <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1.5">
            current
          </div>
          <div
            v-for="row in rec.current"
            :key="row[0]"
            class="flex justify-between font-mono text-[11.5px] py-0.5"
          >
            <span class="text-bp-ink-3">{{ row[0] }}</span>
            <span class="text-bp-ink">{{ row[1] }}</span>
          </div>
        </div>
        <div class="flex items-center px-1.5 bg-bp-bg text-bp-accent font-mono text-[14px] font-bold">
          →
        </div>
        <div class="flex-1 bg-bp-surface-2 border border-bp-line p-2.5 min-w-0">
          <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1.5">
            suggested
          </div>
          <div
            v-for="row in rec.suggested"
            :key="row[0]"
            class="flex justify-between font-mono text-[11.5px] py-0.5"
          >
            <span class="text-bp-ink-3">{{ row[0] }}</span>
            <span class="text-bp-accent">{{ row[1] }}</span>
          </div>
        </div>
      </div>

      <!-- evidence chips — click to pin cursor on Tracking -->
      <div
        v-if="rec.evidence && rec.evidence.length > 0"
        class="mb-3"
      >
        <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1.5">
          Evidence · click to pin cursor
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(ev, i) in rec.evidence"
            :key="`${ev.time_sec}-${i}`"
            type="button"
            class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-bp-surface-2 border border-bp-line-2 text-bp-ink-2 font-mono text-[11px] cursor-pointer hover:border-bp-accent hover:text-bp-ink"
            :title="`Pin cursor at ${ev.time_sec.toFixed(3)}s and switch to Tracking tab`"
            @click="pinEvidence(ev)"
          >
            <span class="text-bp-accent text-[10px]">↳</span>
            {{ formatClock(ev.time_sec) }}
            <span class="text-bp-ink-3">· {{ ev.label }}</span>
          </button>
        </div>
      </div>

      <!-- criteria_met / criteria_failed -->
      <div
        v-if="rec.criteria_met.length || rec.criteria_failed.length"
        class="mb-3"
      >
        <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3 mb-1">
          confidence criteria
        </div>
        <ul class="space-y-0.5">
          <li
            v-for="c in rec.criteria_met"
            :key="`met-${c}`"
            class="font-sans text-[11.5px] text-bp-ok flex gap-1.5"
          >
            <span>✓</span>
            <span>{{ c }}</span>
          </li>
          <li
            v-for="c in rec.criteria_failed"
            :key="`fail-${c}`"
            class="font-sans text-[11.5px] text-bp-stamp flex gap-1.5"
          >
            <span>✗</span>
            <span>{{ c }}</span>
          </li>
        </ul>
      </div>

      <!-- CLI -->
      <div v-if="rec.cli.length > 0">
        <div class="flex justify-between items-center mb-1.5">
          <div class="font-sans text-[9px] tracking-[0.22em] uppercase font-bold text-bp-ink-3">
            CLI commands
          </div>
          <button
            v-if="allowCopy"
            type="button"
            class="px-2.5 py-0.5 font-mono text-[10.5px] font-semibold cursor-pointer border"
            :class="copied
              ? 'bg-bp-ok text-bp-bg border-bp-ok'
              : 'bg-bp-surface-2 text-bp-ink-2 border-bp-line-2 hover:text-bp-ink'"
            @click="copyCli"
          >{{ copied ? '✓ copied' : 'Copy' }}</button>
        </div>
        <pre
          class="m-0 px-3 py-2 bg-bp-bg border border-bp-line font-mono text-[11.5px] text-bp-ink leading-relaxed whitespace-pre-wrap"
        >{{ rec.cli.join('\n') }}</pre>
        <div
          v-if="!allowCopy && rec.confidence === 'red'"
          class="mt-1 font-mono text-[10.5px] text-bp-stamp"
        >
          analysis only — copy disabled because confidence is red
        </div>
      </div>
    </div>

    <!-- footer toggle -->
    <div
      class="px-4 py-2 flex justify-between items-center"
      :class="open ? 'border-t border-bp-line mt-3' : ''"
    >
      <button
        type="button"
        class="bg-transparent border-0 text-bp-ink-3 font-mono text-[11px] cursor-pointer p-0 hover:text-bp-ink"
        @click="toggle"
      >
        {{ open ? '▾ collapse' : '▸ details' }}
      </button>
      <span class="font-mono text-[10.5px] text-bp-dim">
        rec id · {{ rec.id }}
      </span>
    </div>
  </article>
</template>
