// Register a panel's per-cursor sample contributions with the view
// store so CursorReadout can render them in its strip.
//
// Each panel computes a reactive list of CursorSample rows from its
// own hydrated data + view.cursorTime, names itself with a stable
// sourceKey, and hands the ref to this composable. The composable
// pushes updates into view.cursorSamples and cleans up on unmount —
// so when the user navigates to another tab, that tab's samples
// disappear from the readout automatically.

import { onBeforeUnmount, watch, type Ref } from 'vue';

import { useViewStore, type CursorSample } from '@/stores/view';

export interface UseCursorSamplesArgs {
  /** Stable identifier for this panel's contribution (e.g. "tracking-
   *  roll", "pid-roll", "servos"). Re-using the same key for different
   *  axes is intentional — switching axis updates rather than appends. */
  sourceKey: string;
  /** Reactive list of rows. Return an empty array when there's nothing
   *  meaningful to show (e.g. no cursor active, fields not hydrated). */
  samples: Readonly<Ref<CursorSample[]>>;
}

export function useCursorSamples({ sourceKey, samples }: UseCursorSamplesArgs) {
  const view = useViewStore();
  watch(
    samples,
    (next) => {
      if (next.length === 0) {
        view.clearCursorSamples(sourceKey);
      } else {
        view.setCursorSamples(sourceKey, next);
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => view.clearCursorSamples(sourceKey));
}
