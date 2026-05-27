---
name: wingtune-vue-conventions
description: WingTune's Vue 3 + Pinia + Tailwind frontend conventions. Use this skill whenever creating or modifying .vue files, Pinia stores, or composables; touching anything under src/components/, src/stores/, src/views/, or src/composables/; adding new UI features; implementing user interactions; consuming reactive state; or reviewing UI PRs. Use it even if the user doesn't mention Vue or Pinia explicitly — WingTune intentionally tracks the BF Configurator's Vue migration, so consistency now is what makes any future merge or pattern-sharing cheap, and ad-hoc deviations compound quickly across components.
---

# WingTune Vue conventions

WingTune is built on Vue 3 + Vite + TypeScript + Pinia + Tailwind. The
frontend deliberately tracks the BF Configurator's Vue migration so that
patterns learned here transfer cleanly. This skill captures the convention
choices that aren't already enforced by the type system or linter.

## The stack, locked in

- **Vue 3** with the Composition API and `<script setup>` SFCs
- **TypeScript** everywhere — no `.vue` files with JS-only scripts
- **Pinia** in setup-store style (not options-store style)
- **Vue Router** for top-level navigation
- **Tailwind** for styling, utility-first
- **vitest** for unit tests; Playwright (post-M1.6) for smoke tests

No Options API. No Vue 2 idioms. No `defineComponent` with an object config.
If a snippet found online uses `data()`, `methods`, or `mounted()`, it's the
wrong era and should not be copied.

## Pinia store conventions

### Setup-store style only

```ts
// ✓ good — setup style
import { defineStore } from 'pinia';
import { shallowRef, ref, computed } from 'vue';

export const useLogStore = defineStore('log', () => {
  const handle = shallowRef<LogHandle | null>(null);
  const isLoading = ref(false);

  const isLoaded = computed(() => handle.value !== null);

  function setHandle(next: LogHandle) {
    handle.value = next;
  }

  return { handle, isLoading, isLoaded, setHandle };
});
```

```ts
// ✗ bad — options style, deprecated for new Pinia code
export const useLogStore = defineStore('log', {
  state: () => ({ handle: null }),
  actions: { setHandle(next) { this.handle = next; } },
});
```

Setup style composes cleanly with `<script setup>` components, makes
`shallowRef` ergonomic (which we need — see `wingtune-memory-model`), and
matches what newer Pinia docs and Configurator code lean toward.

### One store per concern

Stores in `src/stores/` (current set):

- `session.ts` — the canonical state holder. Multi-tenant
  `Map<logId, LogState>` where each `LogState` is a `shallowReactive`
  container of typed-array fields + status flags + the per-log time
  offset (M1.7.1 alignment). Owns hydration, the LRU field-cache sweep,
  and per-log eager-pin lifecycle. Replaced the M1.3 `log.ts` shim
  during M1.7; `log.ts` is gone.
- `view.ts` — user-facing UI settings: tab routing, smoothing strength,
  tune-style profile (persisted to `localStorage`), per-(log × series)
  visibility (`hiddenSeries: Set<\`${logId}:${field}\`>`),
  per-log visibility (`hiddenLogs: Set<logId>` — the eye toggle),
  cursor pinning. Light, no typed arrays.

The original M1 design listed a `workspace.ts` + `hydration.ts` pair;
the workspace concept was rolled into per-panel `ensureFields(...)` in
`onMounted`, and the hydration cache lives in `session.ts`. Neither file
exists.

A store should answer "what is the state of one well-defined thing." If
a new store would only have one piece of state and one action, consider
whether it should be a composable instead (see below). A new store is
also the wrong answer when the state's lifecycle is bound to another
store's lifecycle (e.g. event annotations belong on the log they came
from, not in a parallel `events` store that would need synchronized
eviction).

### State typing patterns

- `shallowRef<T>` for typed arrays, large structured data, byte buffers,
  anything Vue's default deep proxy would hurt. See `wingtune-memory-model`
  for the load-bearing case.
- `ref<T>` for primitives and small objects.
- `reactive<T>` for plain objects whose nested fields need reactivity.
  Rare in this codebase; prefer `ref(object)` and reassign.
- `shallowReactive<T>` for `Map<K, V>` or `Set<T>` collections holding
  typed-array values, **and** for container objects that mix small
  primitives with typed-array maps (the `LogState` shape — see
  `wingtune-memory-model`). The collection / container structure is
  reactive; the values inside are not deeply proxied.

### Consuming stores in components

```ts
import { storeToRefs } from 'pinia';
import { useLogStore } from '@/stores/log';

const logStore = useLogStore();
const { handle, isLoaded } = storeToRefs(logStore); // reactive refs
const { setHandle } = logStore;                      // functions: direct destructure
```

`storeToRefs` for reactive state; direct destructure for functions. Never
destructure reactive state without `storeToRefs` — you'll lose reactivity
silently and the bug will manifest as "the UI just stops updating."

## Component conventions

### SFC structure

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useLogStore } from '@/stores/log';

const props = defineProps<{
  workspaceId: string;
  showLegend?: boolean;
}>();

const emit = defineEmits<{
  (e: 'workspace-change', id: string): void;
}>();

const logStore = useLogStore();
const { handle } = storeToRefs(logStore);

const title = computed(() => `Workspace: ${props.workspaceId}`);
</script>

<template>
  <section class="flex flex-col gap-2 p-4">
    <h2 class="text-lg font-semibold">{{ title }}</h2>
    <slot />
  </section>
</template>

<!-- No <style> block unless Tailwind genuinely cannot express the rule -->
```

Order: `<script setup>` first, `<template>` second, `<style scoped>` only if
necessary. Never `<style>` without `scoped` (or a CSS module). Script-first
is intentional — the script defines what the template can reference, so
reading top-to-bottom matches dependency order.

### Props and emits

Always typed via TS generic syntax:

```ts
// ✓ good
const props = defineProps<{ log: LogHandle; activeId?: string }>();
const emit = defineEmits<{ (e: 'change', id: string): void }>();

// ✗ bad — runtime-only types, loses TS inference
const props = defineProps({ log: Object, activeId: String });
const emit = defineEmits(['change']);
```

For optional props with defaults, use `withDefaults`:

```ts
const props = withDefaults(
  defineProps<{ showLegend?: boolean; height?: number }>(),
  { showLegend: true, height: 200 },
);
```

### Naming

- **Components**: PascalCase filename — `ReadinessReport.vue`,
  `WorkspaceSwitcher.vue`, `TimeSeriesChart.vue`
- **Views (route components)**: PascalCase filename under `src/views/` —
  `LogView.vue`, `SessionView.vue`
- **Composables**: camelCase `use*` filename under `src/composables/` —
  `useFileDrop.ts`, `useUPlot.ts`
- **Stores**: camelCase domain filename — `log.ts`, `workspace.ts`
- **Folders**: kebab-case — `src/components/readiness-report/`,
  `src/components/time-series/`

### What lives in a component

Components contain:
- Layout (template)
- Local UI state (open/closed, hover, focus, accordion state)
- Subscriptions to stores via `storeToRefs`
- Event handlers that call store actions or emit events

Components must NOT contain:
- Analysis math — that belongs in Layer 2 (`src/analytics/` or `src/lib/`)
- Direct WASM or worker calls — go through a store
- Typed-array field data in `ref()` — see `wingtune-memory-model`
- Long-running async work that should be a store action

See `wingtune-architecture` for the broader layer rules.

## Composables vs stores

Pick a **composable** when:
- The logic is reusable across components but has local state per call site
- State doesn't need to persist across navigation
- Examples: `useFileDrop`, `useUPlot`, `useKeyboardShortcut`,
  `useResizeObserver`

Pick a **store** when:
- State is app-level and shared
- Multiple unrelated components observe or mutate it
- State persists across navigation
- Examples: `log`, `workspace`, `session`

A `use*` function that immediately reaches for a single store and returns it
is not a composable — it's an awkward wrapper. Either the caller uses the
store directly, or the composable has its own local state to manage.

## Multi-log panel patterns

The session store holds N logs simultaneously. Every analysis panel falls
into one of two shapes:

### Single-log panels — `useActiveLog()` composable

For panels that only make sense one log at a time (CapabilitySummary,
ReadinessCard, InputChainPanel, CouplingPanel, AirframeBandwidthPanel,
ServoAsymmetryPanel, ServoHuntPanel, TrimDiagnosticsPanel,
PilotStylePanel, the spectrogram + low-freq panels, …):

```ts
import { useActiveLog } from '@/composables/useActiveLog';

const logStore = useActiveLog();
const { scanReport, time, fields, hydrating } = logStore;

onMounted(() => { logStore.ensureFields(REQUIRED_FIELDS); });
```

`useActiveLog()` projects "first VISIBLE log" — when the user eye-toggles
the active log off in the roster, the composable falls through to the
next visible one, and the panel re-anchors. This is the **eye-as-focus
pattern**: hiding logs is *also* how you choose which one to inspect.

### Compare panels — `session.logs.values()` iteration

For panels that show every loaded log side-by-side on one axis
(SpectrumPanel, ServoPanel, StepResponsePanel, SetpointTrackingPanel,
PIDContributionPanel, SpaPanel, STermPanel, AirspeedPanel,
AirspeedStepResponsePanel):

```ts
const session = useSessionStore();

for (const log of session.logs.values()) {
  // build per-(log × series) traces, apply tintTowardFamily(axisHue, log.family)
}
```

Compare panels iterate the map directly, pad shorter logs' arrays with
NaN to a shared reference x-axis, and HSL-tint each log's traces toward
its family color (`tintTowardFamily()` from `src/lib/logColors.ts`).
**Both shapes coexist** — pick the one that matches the panel's purpose.
Compare panels that operate in frequency / impulse-relative time
(SpectrumPanel, StepResponsePanel) intentionally don't align via session
time; everything else does (see the `useAlignedTime` section below).

### `${logId}:${field}` view-store keys + separate `hiddenLogs` Set

The view store carries two visibility surfaces:

```ts
hiddenSeries: Set<string>   // keys are `${logId}:${field}` — per-(log × series)
hiddenLogs:   Set<string>   // keys are logId — the eye toggle in LogRoster
```

Helpers in `src/stores/view.ts`:
- `toggleSeries(logId, field)` / `isSeriesHidden(logId, field)`
- `toggleSeriesForAllLogs(field, logIds)` /
  `isSeriesHiddenForAllLogs(field, logIds)` — a single R/P/Y chip click
  in a compare panel affects every loaded log
- `toggleLogVisibility(logId)` / `isLogHidden(logId)` — the eye toggle

Series visibility is **per-(log × series)** because two logs may want
different series visible. Log visibility is per-log. Never collapse the
two — they answer different questions.

### `watchEffect` over `watch([fixed deps], ...)` for chart-visibility sync

uPlot panels imperatively apply series visibility via `setSeries(...)`
on every chart rebuild. Use `watchEffect`, NOT `watch([explicitDeps], ...)`:

```ts
// ✓ good — auto-tracks every reactive read inside, including
//          activeId, hiddenSeries, and plot.updateCount (uPlot rebuild marker)
watchEffect(() => {
  for (const [logId, fieldName] of seriesIndex.value) {
    plot.uplot?.setSeries(idx, { show: !view.isSeriesHidden(logId, fieldName) });
  }
  void plot.updateCount.value; // tracks setData() rebuilds
});

// ✗ bad — chart drifts from chip state after eye-toggle / uPlot rebuild
watch([hiddenSeries, presentTerms], () => { /* setSeries... */ });
```

Load-bearing: a fixed-deps `watch` misses the activeId + `plot.updateCount`
changes that fire when the chart rebuilds. M1.7 verification caught this
as a real bug in PID + Servo panels (chart visibility lost sync after
eye-toggle); `watchEffect` is the fix.

### `useAlignedTime` for session-time alignment

`src/composables/useAlignedTime.ts` + `src/lib/sessionTime.ts` give
panels a session-time x-axis built from each log's `timeOffsetSec`:

```
sessionTime = logTime + offset
```

Compare panels with a time-axis x build per-log aligned arrays via
`alignedTimeFor(log)`, pick the longest as the reference, and resample
per-log values onto the reference via `resampleOntoRef()`. The cursor
projects to log-local time via `alignedCursor.value`. See
`wingtune-memory-model` for the `Float64Array` exception that lives here.

## Panel structure template

Every diagnostic / analysis panel follows the same outer shape (21
panels in `src/components/analysis/*Panel.vue` use it — this is THE
template):

```vue
<template>
  <section class="bg-bp-surface border border-bp-line-2">
    <header class="flex flex-wrap justify-between items-center px-3 py-2 border-b border-bp-line gap-y-1.5 gap-x-3">
      <div class="min-w-0">
        <div class="font-slab text-[13px] font-semibold text-bp-ink">
          Panel title &middot; subtitle
        </div>
        <div class="font-mono text-[10.5px] text-bp-ink-3 mt-px">
          one-line what-this-means-in-tuner-terms
        </div>
      </div>
      <div v-if="ready" class="font-mono text-[10.5px] text-bp-ink-3">
        <!-- right-aligned header metric / stamp / source toggle -->
      </div>
    </header>

    <div
      v-if="!ready"
      class="px-4 py-6 font-mono text-[11px] text-bp-ink-3 text-center"
    >
      {{ pendingMessage }}
    </div>
    <div v-else class="px-3 py-3 flex flex-col gap-2">
      <!-- main content -->
    </div>

    <footer class="px-3 py-2 border-t border-bp-line font-mono text-[10px] text-bp-ink-3 leading-snug">
      One sentence on how to read this, then optional
      <span class="block mt-1 text-bp-warn">note · caveat / TODO calibrate note</span>
    </footer>
  </section>
</template>
```

Honest empty state via `v-if="!ready"` with a specific `pendingMessage`
(not a generic spinner). Header metrics live to the right of the title,
hoverable for tooltips. Footer has the "how to read this" sentence and
the `text-bp-warn` caveat block when relevant.

### bp- design tokens

`tailwind.config.ts` defines a small token palette — use these, don't
inline arbitrary hex:

- `bp-bg`, `bp-surface`, `bp-surface-2` — backgrounds (page / panel /
  inner)
- `bp-line`, `bp-line-2` — borders (subtle / strong)
- `bp-ink`, `bp-ink-2`, `bp-ink-3`, `bp-dim` — text (primary → fade)
- `bp-ok`, `bp-warn`, `bp-stamp` — green / yellow / red severity
  (also: traffic-light cells, criteria badges)
- `bp-accent` — interactive / selected state (Pinia chip, button hover)

Severity maps: `bp-ok` = balanced / paste-ready / `available`,
`bp-warn` = slight / yellow / verify, `bp-stamp` = trim-error / red /
analysis-only.

## uPlot gotchas

uPlot is the chart library; it has sharp edges the project has stubbed
its toe on more than once. The codified workarounds:

### Native log-distr renders blank — plot `log10(Hz)` on a linear scale

`{ distr: 3 }` (log scale) renders an empty canvas in this build. The
project-wide workaround: compute `Math.log10(freq)` into the data array
and plot on a linear x-scale, formatting tick labels back to Hz via a
custom `values:` callback. Used in SpectrumPanel + FilterSimPanel +
AirframeBandwidthPanel + LowFreqModePanel + AirspeedSpectrogramPanel.

### All-NaN series breaks y-scale autorange

A series whose array is `[NaN, NaN, …]` (no finite values anywhere)
makes uPlot's autorange chip the *whole chart's* y-axis — labels
disappear, plot draws blank, no error. Pad short logs with NaN to a
shared length is fine; an *entirely* NaN series is not.
AirspeedStepResponsePanel hit this with empty airspeed bins; the fix is
to populate empty bins with a real zero-filled array instead of NaN.

### `throw` inside a `draw` hook aborts the whole draw cycle

Custom draw hooks (filter overlays, coupling-cell heatmaps, coherence
spans) must catch their own errors. An uncaught throw silently aborts
the rest of the chart's draw — gridlines, axes, other series all
disappear. Wrap risky hook code in try/catch and console.warn on the
failure path.

### Imperative visibility uses `watchEffect`, not `watch`

See above. Belongs here too because every uPlot panel touches it.

## Tune-style profile threshold reads

A small set of analytics + recommenders have style-sensitive thresholds
(filter-delay budget, coupling-significance cutoff, step-response peak
bands). They read from the active tune-style profile via
`thresholdsFor(resolveTuneProfile(view.tuneProfile))` instead of a
file-scope constant. The `sport` profile equals the historical constant
— picking Sport (the default) is a behavioural no-op. See
`wingtune-recommender` invariant I9 + `docs/wingtune-m-style-execution.md`
for the full rule.

Panels (not just recommenders) consume profile thresholds where the
panel coloring itself is style-sensitive — current consumers:
SpectrumPanel (filter-delay badge), CouplingPanel
(SIGNIFICANT_COUPLING cell threshold), StepResponsePanel (peak
traffic-light bands).

## Tailwind discipline

- Utility classes in `<template>`. No per-component CSS unless Tailwind
  genuinely cannot express the rule.
- Design tokens come from `tailwind.config.ts` — extend the theme rather
  than inlining arbitrary values everywhere.
- `@apply` directives sparingly, and only in a top-level
  `src/styles/global.css` for design-system primitives. Not in per-component
  scoped styles.
- Custom CSS reserved for things Tailwind can't do cleanly: complex grid
  layouts, CSS variables driven by JS (e.g. dynamic chart colors), or
  animations beyond Tailwind's transition utilities.

### When Tailwind can't express it

Use a scoped style block with CSS variables driven from `<script setup>`:

```vue
<script setup lang="ts">
const props = defineProps<{ accentColor: string }>();
</script>

<template>
  <div class="custom-band" :style="{ '--accent': props.accentColor }">…</div>
</template>

<style scoped>
.custom-band {
  background: linear-gradient(90deg, var(--accent), transparent);
}
</style>
```

Never inline `style="background: ..."` for anything other than a CSS-variable
assignment that bridges JS state into a scoped CSS rule.

## File path aliases

Use `@/` for absolute imports from `src/`:

```ts
// ✓ good
import { useLogStore } from '@/stores/log';
import ReadinessReport from '@/components/readiness-report/ReadinessReport.vue';

// ✗ bad — fragile relative paths
import { useLogStore } from '../../../stores/log';
```

Configure `@` in both `vite.config.ts` and `tsconfig.json` to point at
`src/`. Don't introduce additional aliases — a single `@` keeps the import
surface legible.

## Decided by accretion

- **Component library: none.** The project went through M1 → analytics
  batch → M1.7 without ever adopting a UI library; the bp- design tokens
  + plain `<button>` / `<input>` / `<section>` pattern is now the
  convention. The original "decide at M1.1" trigger is well past; the
  defensible call is "plain elements + bp tokens." If a library swap
  ever happens, treat it as a planned migration with its own execution
  doc — don't introduce a dep in a drive-by PR.

## Open decisions

- **i18n**: the BF Configurator requires it; WingTune is more focused
  and still English-only. Defer until the user base expands beyond
  English speakers or a Configurator-merge conversation re-opens it.
  Don't make ad-hoc choices in component code — keep strings
  hardcoded; if i18n lands later it's a sweep, not a per-component
  decision.

## What Claude Code might want to do but should not

- **"Use the Options API for this one component, it's simpler."** No.
  Mixed-API codebases get harder to navigate as they grow. `<script setup>`
  + Composition API is the single style.
- **"Use Pinia options-store style here, it reads more like the docs."** No.
  Setup style only. The Pinia docs show both because the library supports
  both; the project picks one.
- **"Put the analysis math in the component since it only runs there."** No.
  Components are Layer 3. Math is Layer 2. See `wingtune-architecture`.
- **"Wrap this typed array in `ref()` so the template updates."** No.
  `shallowRef` for typed-array data. See `wingtune-memory-model`.
- **"Destructure the store: `const { handle, setHandle } = useLogStore()`."**
  No for reactive state, yes for functions. Use `storeToRefs` for state,
  direct destructure for actions. Mixing them in one line is a footgun.
- **"Add a new alias like `~components/` to shorten this import."** No. One
  alias (`@/`) is enough; more aliases multiply the cognitive surface for
  marginal keystroke savings.
- **"This component uses Nuxt UI's `<UButton>` so let's add the dep."** No,
  not until the component-library decision lands. Use a plain `<button>`
  with Tailwind utilities for now; the library swap is mechanical once
  decided, but the inverse (Nuxt UI deps scattered through the codebase
  before the decision) is expensive to undo.

## Quick self-check before committing

- [ ] Every new `.vue` file uses `<script setup lang="ts">` and the
      Composition API?
- [ ] Every new store uses setup style with explicit exports, not
      options style?
- [ ] Props and emits typed via TS generic syntax (not the runtime
      object form)?
- [ ] Reactive store state accessed via `storeToRefs` when destructured?
- [ ] No `ref(typedArray)` in any store or component, and no
      `reactive(...)` on a `LogState`-shaped container? (See
      `wingtune-memory-model`.)
- [ ] Single-log panels use `useActiveLog()`; compare panels iterate
      `session.logs.values()` with `tintTowardFamily()`?
- [ ] Time-axis compare panels build per-log aligned arrays via
      `alignedTimeFor()` + `resampleOntoRef()`?
- [ ] Imperative uPlot series visibility uses `watchEffect` (not
      `watch([deps], ...)`) and tracks `plot.updateCount` for rebuild
      reactivity?
- [ ] Panel outer shape matches the section/header/body/footer
      template — honest pending state, header metric on the right,
      footer caveat where relevant?
- [ ] No analysis math, WASM calls, or worker calls in any component?
      (See `wingtune-architecture`.)
- [ ] Tailwind utilities preferred over per-component CSS; bp- tokens
      used instead of inlined hex; scoped styles reserved for things
      Tailwind genuinely can't express?
- [ ] Imports use `@/` for `src/`, not deep relative paths?
- [ ] Style-sensitive thresholds read from the tune-style profile via
      `thresholdsFor(...)`, not file-scope constants? (Cross-ref
      `wingtune-recommender` I9.)
- [ ] No new dependency on a UI component library introduced (decision
      closed: plain elements + bp tokens).

If any answer is "no" without a `// VUE-EXCEPTION:` comment explaining why,
the change is drifting from project conventions — fix it before merging.
