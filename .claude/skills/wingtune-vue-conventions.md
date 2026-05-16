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

Stores in `src/stores/`:

- `log.ts` — current loaded log handle, scan progress, capability report,
  hydrated field map, and event-frame annotations (events live with the log
  they came from, not in a separate store — they get evicted with the log
  and have no independent lifecycle)
- `workspace.ts` — workspace definitions, active workspace, required fields
- `hydration.ts` — hydrated field cache eviction policy (lands M1.3)
- `session.ts` — multi-log container + named-session save/load (lands M1.7; replaces the earlier `campaign.ts` framing — same data, no implied UI mode)
- `view.ts` — user-facing UI settings (cache cap, theme, etc.)

A store should answer "what is the state of one well-defined thing." If a
new store would only have one piece of state and one action, consider
whether it should be a composable instead (see below). A new store is also
the wrong answer when the state's lifecycle is bound to another store's
lifecycle (e.g. event annotations belong on the log they came from, not in
a parallel `events` store that would need synchronized eviction).

### State typing patterns

- `shallowRef<T>` for typed arrays, large structured data, byte buffers,
  anything Vue's default deep proxy would hurt. See `wingtune-memory-model`
  for the load-bearing case.
- `ref<T>` for primitives and small objects.
- `reactive<T>` for plain objects whose nested fields need reactivity. Rare
  in this codebase; prefer `ref(object)` and reassign.
- `shallowReactive<T>` for `Map<K, V>` or `Set<T>` collections holding
  typed-array values. The collection structure is reactive; the values
  inside are not deeply proxied.

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

## Open decisions

Two convention questions are deferred until enough code is in place to make
them well:

- **Component library**: Nuxt UI standalone, or match the BF Configurator's
  custom SFC conventions? Decide while scaffolding M1.1, after eyeballing
  Configurator's current Vue tabs.
- **i18n**: the Configurator requires it; WingTune is more focused and may
  not need it for M1. Defer; revisit when the Configurator merge becomes a
  real option, or when the user base expands beyond English speakers.

When these resolve, update this skill with the chosen path. Until they
resolve, don't make ad-hoc choices in component code — keep components
library-agnostic and English-only, and flag any place where the resolution
would change the implementation.

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
- [ ] Every new store uses setup style with explicit exports, not options
      style?
- [ ] Props and emits typed via TS generic syntax (not the runtime object
      form)?
- [ ] Reactive store state accessed via `storeToRefs` when destructured?
- [ ] No `ref(typedArray)` in any store or component? (See
      `wingtune-memory-model`.)
- [ ] No analysis math, WASM calls, or worker calls in any component?
      (See `wingtune-architecture`.)
- [ ] Tailwind utilities preferred over per-component CSS, scoped styles
      reserved for things Tailwind genuinely can't express?
- [ ] Imports use `@/` for `src/`, not deep relative paths?
- [ ] No new dependency on a UI component library introduced before that
      decision is settled?

If any answer is "no" without a `// VUE-EXCEPTION:` comment explaining why,
the change is drifting from project conventions — fix it before merging.
