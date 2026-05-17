<script setup lang="ts">
// M1.6 readiness report — surfaces the capability layer of the trust
// model. For each analysis module (M2 PIDFS decomp, M3 airspeed, M4
// filters, M5 TPA, M6 SPA, M7 S-term TPA viz), shows whether the
// module can run against the loaded log, with the four-state
// icon set per `wingtune-confidence-scoring`:
//
//   available  ✓ green   — module can run, all required inputs present + active
//   partial    ⚠ amber   — module can run with reduced functionality
//   inactive   ⚠ gray    — feature disabled in firmware (logged but all zero)
//   blocked    ✗ red     — module cannot run; reason explains why
//
// Per-axis modules render as three rows (R / P / Y). The overall
// summary pill aggregates: "N of M modules runnable" with the count
// derived from `available` + `partial` (anything that produces useful
// output for the user).
//
// `via` suffix renders inline when set (informational; tells the
// user whether they're on the firmware-PR fast path or still using
// debug-mode fallback).

import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import {
  evaluateModules,
  type Capability,
  type CapabilityState,
  type ModuleReport,
} from '@/lib/capabilityPredicates';

const logStore = useLogStore();
const { scanReport } = storeToRefs(logStore);

const report = computed<ModuleReport | null>(() => {
  const r = scanReport.value;
  if (!r) return null;
  return evaluateModules(r.capability);
});

// Flat list of (module label, capability) rows for rendering. Per-axis
// modules expand into 3 rows each.
interface Row {
  label: string;
  capability: Capability;
}

const rows = computed<Row[]>(() => {
  const m = report.value;
  if (!m) return [];
  const out: Row[] = [];
  out.push({ label: 'Basic viewing',         capability: m.basicViewing });
  out.push({ label: 'PIDFS decomp · roll',   capability: m.pidfsDecomp.roll });
  out.push({ label: 'PIDFS decomp · pitch',  capability: m.pidfsDecomp.pitch });
  out.push({ label: 'PIDFS decomp · yaw',    capability: m.pidfsDecomp.yaw });
  out.push({ label: 'Airspeed auto-tune',    capability: m.airspeedAutoTune });
  out.push({ label: 'TPA curve fit',         capability: m.tpaCurveFit });
  out.push({ label: 'SPA effectiveness · roll',  capability: m.spaEffectiveness.roll });
  out.push({ label: 'SPA effectiveness · pitch', capability: m.spaEffectiveness.pitch });
  out.push({ label: 'SPA effectiveness · yaw',   capability: m.spaEffectiveness.yaw });
  out.push({ label: 'S-term TPA viz · roll',  capability: m.sTermTpaViz.roll });
  out.push({ label: 'S-term TPA viz · pitch', capability: m.sTermTpaViz.pitch });
  out.push({ label: 'S-term TPA viz · yaw',   capability: m.sTermTpaViz.yaw });
  return out;
});

const counts = computed(() => {
  const c = { available: 0, partial: 0, inactive: 0, blocked: 0 };
  for (const r of rows.value) c[r.capability.state] += 1;
  return c;
});

const totalRunnable = computed(() => counts.value.available + counts.value.partial);

// Overall status pill chooses the "worst" meaningful state, or "ready"
// if everything's available. Blocked rows from registry-pending stubs
// don't drag the overall to red; we surface them honestly but don't
// scream that the log is bad just because predicate code is incomplete.
const overall = computed<{ label: string; tone: 'ok' | 'warn' | 'stamp' | 'dim' }>(() => {
  const c = counts.value;
  if (c.available === rows.value.length) return { label: 'ALL MODULES AVAILABLE', tone: 'ok' };
  if (c.available + c.partial > 0)      return { label: `${totalRunnable.value} of ${rows.value.length} runnable`, tone: 'warn' };
  return { label: 'no modules runnable', tone: 'stamp' };
});

function iconFor(state: CapabilityState): string {
  switch (state) {
    case 'available': return '✓';
    case 'partial':   return '⚠';
    case 'inactive':  return '⚠';
    case 'blocked':   return '✗';
  }
}

function colorFor(state: CapabilityState): string {
  switch (state) {
    case 'available': return 'text-bp-ok';
    case 'partial':   return 'text-bp-warn';
    case 'inactive':  return 'text-bp-ink-3';
    case 'blocked':   return 'text-bp-stamp';
  }
}

function toneClass(tone: 'ok' | 'warn' | 'stamp' | 'dim'): string {
  switch (tone) {
    case 'ok':    return 'text-bp-ok border-bp-ok';
    case 'warn':  return 'text-bp-warn border-bp-warn';
    case 'stamp': return 'text-bp-stamp border-bp-stamp';
    case 'dim':   return 'text-bp-dim border-bp-dim';
  }
}
</script>

<template>
  <section
    v-if="report"
    class="bg-bp-surface border border-bp-line-2 border-t-2 border-t-bp-accent"
  >
    <header class="flex items-center justify-between px-4 py-2.5 border-b border-bp-line">
      <div>
        <div class="font-sans text-[9.5px] tracking-[0.24em] uppercase font-bold text-bp-ink-3">
          READINESS · MODULE CAPABILITY
        </div>
        <div class="font-slab text-[14px] font-semibold text-bp-ink mt-0.5">
          {{ counts.available }} ready · {{ counts.partial }} partial · {{ counts.inactive }} inactive · {{ counts.blocked }} blocked
        </div>
      </div>
      <span
        class="px-2.5 py-1 border font-sans text-[10px] font-bold tracking-[0.18em] uppercase whitespace-nowrap"
        :class="toneClass(overall.tone)"
      >
        {{ overall.label }}
      </span>
    </header>

    <ul class="divide-y divide-bp-line">
      <li
        v-for="row in rows"
        :key="row.label"
        class="flex items-start px-4 py-2 gap-3"
      >
        <span
          class="w-4 shrink-0 font-mono text-[14px] leading-none mt-0.5"
          :class="colorFor(row.capability.state)"
          :title="row.capability.state"
        >
          {{ iconFor(row.capability.state) }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2 flex-wrap">
            <span
              class="font-mono text-[12px]"
              :class="row.capability.state === 'blocked' ? 'text-bp-ink-3' : 'text-bp-ink'"
            >{{ row.label }}</span>
            <span
              v-if="row.capability.via"
              class="font-mono text-[10px] text-bp-ink-3"
            >via {{ row.capability.via }}</span>
            <span
              class="font-sans text-[9px] tracking-[0.2em] uppercase font-bold ml-auto"
              :class="colorFor(row.capability.state)"
            >{{ row.capability.state }}</span>
          </div>
          <div
            v-if="row.capability.reason"
            class="font-sans text-[11.5px] text-bp-ink-3 mt-0.5 leading-snug"
          >
            {{ row.capability.reason }}
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
