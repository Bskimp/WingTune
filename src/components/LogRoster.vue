<script setup lang="ts">
// Multi-log roster strip — sits between TabBar and TimeBar in the
// analysis view, visible only when 2+ logs are loaded. Each loaded
// log gets a chip showing its family color, filename, and a remove
// (✕) button. A trailing "+" button opens the native file picker to
// add another log via `session.addLog()` (no reset — the entry-page
// FileDropZone owns reset semantics).
//
// Eye-toggle button per chip (mass-hide all traces from this log
// across every multi-log-aware panel) lives at the view store via
// `toggleLogVisibility(logId)`. Chart panels iterating
// `session.logs.values()` skip hidden logs entirely. Chips dim when
// hidden so the state is visible at a glance.

import { computed, onUnmounted, ref } from 'vue';

import { useSessionStore } from '@/stores/session';
import { useViewStore } from '@/stores/view';
import {
  familyForIndex,
  isFamilyCycled,
  LOG_FAMILIES,
} from '@/lib/logColors';
import { alignLogToReference } from '@/lib/autoAlign';
import IconX from '@/components/icons/IconX.vue';

const session = useSessionStore();
const view = useViewStore();

interface RosterEntry {
  id: string;
  name: string;
  familyName: string;
  familyPrimary: string;
  cycled: boolean;
  hidden: boolean;
  offsetSec: number;
}

const entries = computed<RosterEntry[]>(() => {
  const out: RosterEntry[] = [];
  let idx = 0;
  for (const log of session.logs.values()) {
    const fam = familyForIndex(idx);
    out.push({
      id: log.id,
      name: log.name,
      familyName: fam.name,
      familyPrimary: fam.primary,
      cycled: isFamilyCycled(idx),
      hidden: view.isLogHidden(log.id),
      offsetSec: log.timeOffsetSec,
    });
    idx += 1;
  }
  return out;
});

// ---- M1.7.1 time-alignment drag handle ---------------------------------
// Mouse-down on a chip's ⟷ handle captures the current offset and the
// pointer's screen X; window mousemove translates pixel delta into
// seconds via `session.setTimeOffset(id, startOffset + dx * scale)`.
// Modifier keys swap the scale: shift = fine (0.002 s/px), alt = coarse
// (0.2 s/px), default = 0.02 s/px (~50 px/s — comfortable for typical
// wing-log alignment of arming/maneuver events).
//
// Only one chip drags at a time. `dragLogId` doubles as a "this chip is
// currently dragging" flag for the highlight style. `onUnmounted` is
// belt-and-suspenders for the case the user yanks the roster out of
// the DOM mid-drag (eye-toggle storms, etc.).

interface DragState {
  logId: string;
  startClientX: number;
  startOffsetSec: number;
}
const dragState = ref<DragState | null>(null);
const dragLogId = computed(() => dragState.value?.logId ?? null);

function scaleFor(ev: MouseEvent): number {
  if (ev.shiftKey) return 0.002;
  if (ev.altKey) return 0.2;
  return 0.02;
}

function onDragStart(ev: MouseEvent, id: string) {
  ev.preventDefault();
  const log = session.logs.get(id);
  if (!log) return;
  dragState.value = {
    logId: id,
    startClientX: ev.clientX,
    startOffsetSec: log.timeOffsetSec,
  };
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function onDragMove(ev: MouseEvent) {
  const ds = dragState.value;
  if (!ds) return;
  const dx = ev.clientX - ds.startClientX;
  const scale = scaleFor(ev);
  session.setTimeOffset(ds.logId, ds.startOffsetSec + dx * scale);
}

function onDragEnd() {
  if (!dragState.value) return;
  dragState.value = null;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
}

onUnmounted(onDragEnd);

function onResetOffset(id: string) {
  session.setTimeOffset(id, 0);
}

function formatOffset(sec: number): string {
  if (sec === 0) return '';
  const sign = sec > 0 ? '+' : '';
  return `${sign}${sec.toFixed(2)}s`;
}

/** Hidden file input, click()'d by the "+" button. The picker dialog
 *  is the only multi-log entry point in the analysis view today —
 *  drag-and-drop onto the analysis area lands in Push 3b polish. */
const fileInput = ref<HTMLInputElement | null>(null);

function openPicker() {
  fileInput.value?.click();
}

async function onFilePick(ev: Event) {
  const target = ev.target as HTMLInputElement;
  const file = target.files?.[0];
  // Reset so re-picking the same file fires `change` again.
  target.value = '';
  if (!file) return;
  try {
    await session.addLog(file);
  } catch {
    // session.lastScanError populated inside addLog. No surface
    // for this in the roster yet — a Push 3b enhancement could
    // flash the chip on failure or show an inline error banner.
  }
}

async function onRemove(id: string) {
  await session.removeLog(id);
}

function onToggleVisibility(id: string) {
  view.toggleLogVisibility(id);
}

const familyLegend = computed(() => LOG_FAMILIES.map((f) => f.name).join(' · '));

// ---- M1.7.1 auto-align (cross-correlation) -----------------------------
// One-click alignment of every visible log to the first visible log via
// gyro-magnitude cross-correlation. Reference log's offset is preserved
// (so a manually-anchored reference still works); each other log's
// offset is overwritten with `refOffset + alignment.offsetSec`.
//
// Why gyro magnitude + cross-correlation (and not arm event / throttle
// threshold): auto-launch fires the arm well before actual flight by
// an inconsistent amount, so event-based anchors aren't reliable.
// Cross-correlation finds the time shift that maximizes overlap of
// the two logs' gyro signatures — directly captures actual flight
// motion regardless of pre-flight choreography. See
// `src/lib/autoAlign.ts` for the algorithm + sign convention.
//
// Confidence surface: low NCC (< 0.4) or low peak ratio (< 1.5) flags
// an alignment as "low confidence" in the status line — typically
// means the two flights don't share enough common content to align
// reliably (different maneuvers / different airframes / etc.). User
// can still drag the chip handle to manually adjust.

const visibleEntries = computed(() => entries.value.filter((e) => !e.hidden));
const canAutoAlign = computed(() => visibleEntries.value.length >= 2);

const isAligning = ref(false);
const lastAlignStatus = ref<string | null>(null);
let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(msg: string | null, ms = 4500) {
  if (statusClearTimer !== null) {
    clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
  lastAlignStatus.value = msg;
  if (msg !== null && ms > 0) {
    statusClearTimer = setTimeout(() => {
      lastAlignStatus.value = null;
      statusClearTimer = null;
    }, ms);
  }
}

async function onAutoAlign() {
  if (isAligning.value || !canAutoAlign.value) return;
  isAligning.value = true;
  setStatus(null);
  // Yield once so the "aligning…" label paints before the correlation
  // runs synchronously (~50-150 ms per pair on typical 150k-sample logs).
  await new Promise<void>((r) => setTimeout(r, 0));
  try {
    const vis = visibleEntries.value;
    const refLog = session.logs.get(vis[0].id);
    if (!refLog) return;
    const refOffset = refLog.timeOffsetSec;
    let aligned = 0;
    let skipped = 0;
    let lowConfidence = 0;
    for (let i = 1; i < vis.length; i++) {
      const otherLog = session.logs.get(vis[i].id);
      if (!otherLog) continue;
      const result = alignLogToReference(refLog, otherLog);
      if (result.signal === 'none') {
        skipped += 1;
        continue;
      }
      session.setTimeOffset(otherLog.id, refOffset + result.offsetSec);
      aligned += 1;
      if (result.ncc < 0.4 || result.peakRatio < 1.5) lowConfidence += 1;
    }
    const parts: string[] = [];
    parts.push(`aligned ${aligned}`);
    if (skipped > 0) parts.push(`${skipped} skipped (no gyro)`);
    if (lowConfidence > 0) parts.push(`${lowConfidence} low conf`);
    setStatus(parts.join(' · '));
  } finally {
    isAligning.value = false;
  }
}

const autoAlignTooltip = computed(() => {
  if (!canAutoAlign.value) return 'auto-align needs ≥ 2 visible logs';
  const refName = visibleEntries.value[0]?.name ?? 'first visible';
  return `Auto-align every visible log to ${refName} via gyro cross-correlation`;
});

onUnmounted(() => {
  if (statusClearTimer !== null) clearTimeout(statusClearTimer);
});
</script>

<template>
  <div
    class="flex items-stretch gap-px bg-bp-surface border border-bp-line-2 border-t-0 px-1.5 py-1.5 select-none"
  >
    <input
      ref="fileInput"
      type="file"
      accept=".bbl,.bfl,.txt"
      class="hidden"
      @change="onFilePick"
    />

    <div
      v-for="entry in entries"
      :key="entry.id"
      class="flex items-center gap-2 px-2 py-1 border border-bp-line-2 bg-bp-surface-2 font-mono text-[10.5px] text-bp-ink transition-opacity"
      :class="entry.hidden ? 'opacity-50' : ''"
      :title="entry.cycled
        ? `${entry.name} · family ${entry.familyName} (re-used past ${LOG_FAMILIES.length} logs)`
        : `${entry.name} · family ${entry.familyName}`"
    >
      <!-- family color dot -->
      <span
        class="w-2 h-2 rounded-full inline-block flex-none"
        :style="{ background: entry.familyPrimary }"
      />
      <!-- filename, mono -->
      <span class="truncate max-w-[160px]">{{ entry.name }}</span>
      <!-- cycle warning when families re-used -->
      <span
        v-if="entry.cycled"
        class="font-sans text-[9px] tracking-[0.2em] uppercase text-bp-stamp"
        title="Color family re-used — more than 3 logs loaded"
      >
        cycled
      </span>
      <!-- M1.7.1 alignment drag handle (⟷). Mousedown captures start
           offset + clientX, window mousemove writes session.setTimeOffset.
           Shift = fine, alt = coarse. -->
      <button
        type="button"
        class="ml-1 flex items-center cursor-ew-resize"
        :class="dragLogId === entry.id
          ? 'text-bp-accent'
          : 'text-bp-ink-3 hover:text-bp-accent'"
        :title="`Drag to shift ${entry.name}'s time offset on the session axis · shift = fine · alt = coarse`"
        @mousedown="onDragStart($event, entry.id)"
      >
        <svg
          width="14"
          height="11"
          viewBox="0 0 16 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="13" y2="6" />
          <polyline points="5 3 2 6 5 9" />
          <polyline points="11 3 14 6 11 9" />
        </svg>
      </button>
      <!-- offset badge — visible only when shifted from 0. Accent
           color so it reads as "this log is intentionally moved." -->
      <span
        v-if="entry.offsetSec !== 0"
        class="font-mono text-[9.5px] text-bp-accent tabular-nums"
        :title="`Time offset: ${formatOffset(entry.offsetSec)} · projected onto the session time axis as t + offset`"
      >
        {{ formatOffset(entry.offsetSec) }}
      </span>
      <!-- reset offset button — only when offset != 0 -->
      <button
        v-if="entry.offsetSec !== 0"
        type="button"
        class="flex items-center text-bp-ink-3 cursor-pointer hover:text-bp-accent"
        :title="`Reset ${entry.name}'s offset to 0`"
        @click="onResetOffset(entry.id)"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8a5 5 0 1 0 1.5-3.5" />
          <polyline points="3 2 3 5 6 5" />
        </svg>
      </button>
      <!-- eye toggle (hides every trace from this log across panels
           that iterate session.logs — see view.toggleLogVisibility) -->
      <button
        type="button"
        class="ml-1 flex items-center cursor-pointer"
        :class="entry.hidden ? 'text-bp-ink-3 hover:text-bp-ink' : 'text-bp-ink-2 hover:text-bp-accent'"
        :title="entry.hidden
          ? `Show traces from ${entry.name}`
          : `Hide all traces from ${entry.name}`"
        :aria-pressed="!entry.hidden"
        @click="onToggleVisibility(entry.id)"
      >
        <!-- Inline SVG eye icon (open/closed via :class). Kept inline
             so we don't grow IconEye.vue + IconEyeOff.vue for one
             usage. The slash group only renders in the hidden state. -->
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
          <circle cx="8" cy="8" r="2" />
          <line v-if="entry.hidden" x1="2" y1="14" x2="14" y2="2" />
        </svg>
      </button>
      <!-- remove (X) -->
      <button
        type="button"
        class="flex items-center text-bp-ink-3 cursor-pointer hover:text-bp-stamp"
        :title="`Remove ${entry.name}`"
        @click="onRemove(entry.id)"
      >
        <IconX :size="10" />
      </button>
    </div>

    <!-- "+" add another log -->
    <button
      type="button"
      class="flex items-center justify-center px-2.5 py-1 border border-dashed border-bp-line-2 text-bp-ink-3 font-sans text-[12px] font-semibold cursor-pointer hover:text-bp-accent hover:border-bp-accent"
      :title="`Add another log (families: ${familyLegend})`"
      @click="openPicker"
    >
      +
    </button>

    <!-- M1.7.1 auto-align — gyro cross-correlation against first
         visible log. Visible at N≥2 visible logs. Disabled mid-run. -->
    <button
      v-if="canAutoAlign"
      type="button"
      class="ml-1 flex items-center gap-1.5 px-2 py-1 border border-bp-line-2 bg-bp-surface-2 font-mono text-[10.5px] cursor-pointer transition-colors"
      :class="isAligning
        ? 'text-bp-ink-3 cursor-wait'
        : 'text-bp-ink-2 hover:text-bp-accent hover:border-bp-accent'"
      :title="autoAlignTooltip"
      :disabled="isAligning"
      :aria-busy="isAligning"
      @click="onAutoAlign"
    >
      <!-- Crosshair / target icon: two perpendicular lines + center
           dot. Reads as "snap to / align" without needing a label. -->
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="5.5" />
        <line x1="8" y1="0.5" x2="8" y2="3.5" />
        <line x1="8" y1="12.5" x2="8" y2="15.5" />
        <line x1="0.5" y1="8" x2="3.5" y2="8" />
        <line x1="12.5" y1="8" x2="15.5" y2="8" />
        <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      </svg>
      {{ isAligning ? 'aligning…' : 'auto-align' }}
    </button>

    <!-- Brief status surface after an auto-align run (clears after
         ~4.5 s). Surfaces low-confidence + skipped counts so the user
         knows when manual adjustment may be needed. -->
    <span
      v-if="lastAlignStatus !== null"
      class="ml-2 self-center font-mono text-[10px] text-bp-ink-3"
    >
      {{ lastAlignStatus }}
    </span>
  </div>
</template>
