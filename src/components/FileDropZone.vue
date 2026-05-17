<script setup lang="ts">
// Entry-page file-drop frame — four visual states wired to the log store:
//
//   EMPTY     — no file loaded, no drag in progress
//   STAGED    — drag is over the zone (about to drop)
//   DECODING  — store is scanning (post-drop, pre-result)
//   REJECTED  — scan failed; surface the error and offer retry
//
// Calls `useLogStore().loadFile(file)` on drop or file-picker selection.
// The store owns all parser state; this component only renders + collects
// the file and delegates. Per `wingtune-architecture`, no WASM call lands
// here.

import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useLogStore } from '@/stores/log';
import IconUpload from '@/components/icons/IconUpload.vue';
import IconFile from '@/components/icons/IconFile.vue';

const logStore = useLogStore();
const { scanning, scanError, fileName, fileSize } = storeToRefs(logStore);

const fileInput = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
// Counter avoids the dragenter/dragleave flicker bubbling produces when the
// pointer crosses a child element. Increment on enter, decrement on leave;
// stage is "dragging" while counter > 0.
const dragDepth = ref(0);
const stagedFile = ref<File | null>(null);

type DropState = 'empty' | 'staged' | 'decoding' | 'rejected';

const dropState = computed<DropState>(() => {
  if (scanning.value) return 'decoding';
  if (scanError.value) return 'rejected';
  if (isDragging.value || stagedFile.value) return 'staged';
  return 'empty';
});

const stateLabel = computed(() => dropState.value.toUpperCase());
const stateAccent = computed(() => {
  switch (dropState.value) {
    case 'staged':
    case 'decoding': return 'border-bp-accent';
    case 'rejected': return 'border-bp-stamp';
    default:         return 'border-bp-line-2';
  }
});
const stateIndicator = computed(() => {
  switch (dropState.value) {
    case 'decoding':
      return fileName.value ? `decoding · ${fileName.value}` : 'decoding';
    case 'rejected':
      return 'aborted';
    case 'staged':
      return stagedFile.value ? `${stagedFile.value.name}` : '1 file detected';
    default:
      return '0 files';
  }
});

const errorMessage = computed(() => {
  const e = scanError.value;
  if (!e) return '';
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return JSON.stringify(e);
});

const sizeLabel = computed(() => {
  const bytes = fileSize.value;
  if (bytes == null) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
});

function onDragEnter(ev: DragEvent) {
  ev.preventDefault();
  dragDepth.value += 1;
  isDragging.value = true;
}

function onDragLeave(ev: DragEvent) {
  ev.preventDefault();
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) isDragging.value = false;
}

function onDragOver(ev: DragEvent) {
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
}

async function onDrop(ev: DragEvent) {
  ev.preventDefault();
  dragDepth.value = 0;
  isDragging.value = false;
  const file = ev.dataTransfer?.files?.[0];
  if (file) await accept(file);
}

async function onFilePick(ev: Event) {
  const target = ev.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) await accept(file);
  // Reset so re-picking the same file fires `change` again.
  target.value = '';
}

async function accept(file: File) {
  stagedFile.value = file;
  try {
    await logStore.loadFile(file);
  } catch {
    // store keeps the error in `scanError`; UI surfaces from there.
  } finally {
    stagedFile.value = null;
  }
}

function openPicker() {
  fileInput.value?.click();
}

function dismissError() {
  logStore.reset();
}
</script>

<template>
  <section>
    <div class="flex justify-between items-center pb-1.5">
      <div class="flex items-center gap-2">
        <span
          class="w-[5px] h-[5px] rounded-full"
          :class="{
            'bg-bp-line-2': dropState === 'empty',
            'bg-bp-accent': dropState === 'staged' || dropState === 'decoding',
            'bg-bp-stamp':  dropState === 'rejected',
          }"
        />
        <span class="font-sans text-[9.5px] tracking-[0.24em] font-semibold uppercase text-bp-ink-2">
          ENTRY · {{ stateLabel }}
        </span>
      </div>
      <span class="font-mono text-[10.5px] text-bp-ink-3">
        {{ stateIndicator }}
      </span>
    </div>

    <div
      class="relative bg-bp-surface p-7 min-h-[150px] border"
      :class="[
        stateAccent,
        dropState === 'empty' ? 'border-dashed' : 'border-solid',
      ]"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".bbl,.bfl,.txt"
        class="hidden"
        @change="onFilePick"
      />

      <!-- EMPTY -->
      <div v-if="dropState === 'empty'" class="text-center">
        <div
          class="relative w-14 h-14 mx-auto mb-3.5 border border-bp-line-2 flex items-center justify-center text-bp-accent"
        >
          <IconUpload :size="20" />
          <span class="absolute -left-px -top-px w-[5px] h-[5px] bg-bp-accent" />
          <span class="absolute -right-px -top-px w-[5px] h-[5px] bg-bp-accent" />
          <span class="absolute -left-px -bottom-px w-[5px] h-[5px] bg-bp-accent" />
          <span class="absolute -right-px -bottom-px w-[5px] h-[5px] bg-bp-accent" />
        </div>
        <div class="font-slab text-[18px] font-semibold text-bp-ink mb-1">
          Log a flight
        </div>
        <div class="font-sans text-[12px] text-bp-ink-3 mb-4">
          Drop
          <span class="font-mono text-bp-ink-2">.bfl</span>
          ·
          <span class="font-mono text-bp-ink-2">.bbl</span>
          ·
          <span class="font-mono text-bp-ink-2">.txt</span>
          &nbsp;·&nbsp; BF&nbsp;≥&nbsp;4.5
        </div>
        <div class="inline-flex gap-2">
          <button
            type="button"
            class="px-3.5 py-[7px] bg-bp-accent text-bp-bg border border-bp-accent font-sans font-semibold text-[12px] tracking-[0.04em] cursor-pointer hover:bg-bp-accent-dim hover:border-bp-accent-dim"
            @click="openPicker"
          >
            Select file
          </button>
          <button
            type="button"
            class="px-3.5 py-[7px] bg-transparent text-bp-ink-2 border border-bp-line-2 font-sans font-semibold text-[12px] tracking-[0.04em] cursor-not-allowed opacity-60"
            disabled
            title="Bundled sample log lands in M1.6"
          >
            Sample log
          </button>
        </div>
      </div>

      <!-- STAGED (hover or just-picked, pre-decode) -->
      <div v-else-if="dropState === 'staged'" class="text-center relative">
        <div
          class="absolute -inset-7 pointer-events-none"
          style="background: radial-gradient(ellipse at center, rgba(126,200,255,0.10), transparent 70%);"
        />
        <div class="relative">
          <div class="font-slab text-[20px] font-semibold text-bp-accent mb-1.5">
            Release to log
          </div>
          <div
            class="inline-flex items-center gap-3 px-3.5 py-1.5 border border-bp-accent-dim bg-bp-surface-2"
          >
            <IconFile :size="13" class="text-bp-ink-2" />
            <span class="font-mono text-[12px] text-bp-ink">
              {{ stagedFile?.name ?? 'staged file' }}
            </span>
          </div>
        </div>
      </div>

      <!-- DECODING -->
      <div v-else-if="dropState === 'decoding'">
        <div class="flex justify-between items-baseline mb-3">
          <div>
            <div class="font-slab text-[15px] font-semibold text-bp-ink">
              {{ fileName ?? 'log' }}
            </div>
            <div class="font-sans text-[11px] text-bp-ink-3 mt-0.5">
              Decoding — streaming progress lands later, holding pattern for now
            </div>
          </div>
          <div class="font-mono text-[14px] text-bp-accent">
            …{{ sizeLabel }}
          </div>
        </div>
        <!-- indeterminate striped bar -->
        <div
          class="relative h-2 bg-bp-surface-2 border border-bp-line-2 overflow-hidden"
        >
          <div
            class="absolute inset-y-0 left-0 w-full wt-stripe-anim"
            style="background: repeating-linear-gradient(135deg, var(--color-bp-accent) 0 4px, var(--color-bp-accent-dim) 4px 8px);"
          />
        </div>
      </div>

      <!-- REJECTED -->
      <div v-else>
        <div class="flex justify-between items-start gap-4 mb-3">
          <div class="flex-1">
            <div class="font-slab text-[16px] font-semibold text-bp-stamp mb-1">
              Scan failed
            </div>
            <div class="font-sans text-[12px] leading-snug text-bp-ink-2 break-words">
              {{ fileName ?? 'log' }} rejected during parse.
            </div>
            <div class="font-mono text-[10.5px] text-bp-ink-3 mt-2 break-all">
              {{ errorMessage }}
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="px-3 py-1 bg-transparent text-bp-ink-2 border border-bp-line-2 font-sans text-[11px] cursor-pointer hover:text-bp-ink"
            @click="dismissError"
          >
            Dismiss
          </button>
          <button
            type="button"
            class="px-3 py-1 bg-transparent text-bp-ink-2 border border-bp-line-2 font-sans text-[11px] cursor-pointer hover:text-bp-ink"
            @click="openPicker"
          >
            Try another file
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Tailwind can't express a keyframed background-position drift cleanly
 * via utilities; the striped progress bar uses CSS for the indeterminate
 * animation. Scoped so it doesn't leak. */
.wt-stripe-anim {
  background-size: 11.31px 11.31px;
  animation: wt-stripe-scroll 0.9s linear infinite;
}

@keyframes wt-stripe-scroll {
  from { background-position: 0 0; }
  to   { background-position: 22.62px 0; }
}
</style>
