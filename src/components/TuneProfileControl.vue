<script setup lang="ts">
// M-Style — the tune-style dial.
//
// A three-way Cruise / Sport / 3D selector. The chosen profile
// reweights every recommender's thresholds + targets (filter-delay
// budget, cross-axis coupling significance, step-response peak bands,
// …) without changing any analysis math — see
// docs/wingtune-m-style-execution.md. Bound to the persisted view-store
// `tuneProfile`; flipping it re-runs the recommenders and re-tones the
// affected panels live.
//
// M-Style Slice 4 (auto-suggest from M-Pilot): when the active log's
// pilot-input style suggests a different profile than the one currently
// selected, a non-binding hint appears with [switch] / [dismiss]. The
// honesty rule: the profile is the user's DECLARED INTENT. M-Pilot may
// suggest, never auto-apply. Dismissals are per (active log × current
// profile × suggestion) and live in component state — they reset on
// log change or on the user manually flipping the profile.

import { computed, ref, watch } from 'vue';

import { useActiveLog } from '@/composables/useActiveLog';
import { useViewStore } from '@/stores/view';
import { computePilotStyle } from '@/lib/pilotStyle';
import {
  TUNE_PROFILE_ORDER,
  PROFILE_META,
  type TuneProfile,
} from '@/lib/tuneProfile';

const view = useViewStore();
const log = useActiveLog();

function select(p: TuneProfile) {
  view.setTuneProfile(p);
}

/** Pilot-style verdict for the active log. Reads rcCommand[0..2]
 *  straight off the active log's fields map — those fields are already
 *  pinned by AnalysisView's eager hydrate (they back inputChain etc.),
 *  so we never need to ensure them ourselves. Re-computes when the
 *  active log changes or when its fields finish hydrating. */
const verdict = computed(() => {
  const t = log.time.value;
  if (t.length === 0) return null;
  const f = log.fields.value;
  const rc: (Float32Array | undefined)[] = [
    f.get('rcCommand[0]'),
    f.get('rcCommand[1]'),
    f.get('rcCommand[2]'),
  ];
  if (!rc.some((arr) => arr && arr.length > 0)) return null;
  return computePilotStyle(rc, t);
});

const suggestion = computed(() => verdict.value?.suggestedProfile ?? null);

/** A dismissal is keyed by (logId × current profile × suggestion). If
 *  the user dismisses the "switch to 3D" hint on log A while in Cruise,
 *  and then loads log B that suggests Sport, the new hint shows. */
const dismissed = ref<Set<string>>(new Set());
function hintKey(): string | null {
  const id = log.activeId.value;
  if (!id) return null;
  if (!suggestion.value) return null;
  return `${id}::${view.tuneProfile}::${suggestion.value}`;
}
function dismiss() {
  const k = hintKey();
  if (k) dismissed.value = new Set(dismissed.value).add(k);
}

/** Visible when (1) a suggestion exists, (2) it differs from the
 *  currently-selected profile, (3) the user hasn't dismissed this
 *  exact (log × profile × suggestion) combination. */
const showHint = computed(() => {
  const k = hintKey();
  if (!k) return false;
  if (suggestion.value === view.tuneProfile) return false;
  return !dismissed.value.has(k);
});

/** Clearing dismissals on a manual profile flip lets the user see a
 *  fresh hint if they pick a profile the log doesn't match. The watch
 *  on view.tuneProfile fires only when it CHANGES, so dismissing a
 *  hint doesn't immediately re-show it. */
watch(() => view.tuneProfile, () => { dismissed.value = new Set(); });
watch(() => log.activeId.value, () => { dismissed.value = new Set(); });

function applySuggestion() {
  if (suggestion.value) view.setTuneProfile(suggestion.value);
}
</script>

<template>
  <div class="flex flex-col gap-1 mt-1.5">
    <div class="flex items-center gap-2">
      <span
        class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-ink-3 whitespace-nowrap cursor-help"
        title="Tune-style profile — reweights the recommendations and panel thresholds for a cruise / all-round / 3D-aggressive wing. Persists across sessions."
      >tune style</span>
      <div class="flex gap-px">
        <button
          v-for="p in TUNE_PROFILE_ORDER"
          :key="p"
          type="button"
          class="px-2.5 py-[3px] font-mono text-[11px] font-semibold border cursor-pointer"
          :class="view.tuneProfile === p
            ? 'bg-bp-accent text-bp-bg border-bp-accent'
            : 'bg-bp-surface-2 text-bp-ink-3 border-bp-line-2 hover:text-bp-ink'"
          :aria-pressed="view.tuneProfile === p"
          :title="PROFILE_META[p].blurb"
          @click="select(p)"
        >{{ PROFILE_META[p].label }}</button>
      </div>
    </div>

    <div
      v-if="showHint && suggestion"
      class="flex items-center gap-2 font-mono text-[10.5px] text-bp-ink-3 border border-bp-line bg-bp-surface-2 px-2 py-1"
      role="status"
    >
      <span
        class="font-sans text-[9px] tracking-[0.18em] uppercase font-bold text-bp-accent whitespace-nowrap"
      >M-Pilot</span>
      <span class="leading-snug">
        this log looks flown
        <span class="text-bp-ink font-semibold">{{ PROFILE_META[suggestion].label }}</span>-style
        — switch profile?
      </span>
      <button
        type="button"
        class="ml-auto px-2 py-px font-mono text-[10.5px] font-semibold bg-bp-accent text-bp-bg border border-bp-accent cursor-pointer"
        @click="applySuggestion"
      >switch</button>
      <button
        type="button"
        class="px-2 py-px font-mono text-[10.5px] font-semibold bg-bp-surface text-bp-ink-3 border border-bp-line-2 cursor-pointer hover:text-bp-ink"
        @click="dismiss"
      >dismiss</button>
    </div>
  </div>
</template>
