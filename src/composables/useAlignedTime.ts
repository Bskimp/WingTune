// Per-log time-alignment helpers — the bridge between session-level
// shared cursor time and per-log "time since this log's own start"
// indexing.
//
// Background: every loaded log has its own time axis with t=0 at its
// own first frame. The shared cursor (`view.cursorTime`) lives in a
// single "session time" coordinate system. With multi-log compare,
// each log's data needs to map onto/off of that session axis using
// its `timeOffsetSec` (M1.7.1 alignment hook — user-settable offset
// via the future drag-to-align UI). Today the offset is always 0
// (no alignment), so session time == log time. Once M1.7.1 wires
// the UI, offsets can be tuned per log to align maneuvers / arming
// events / mode transitions across flights.
//
// Convention: `timeOffsetSec` is added when projecting log → session:
//
//     sessionTime = logLocalTime + log.timeOffsetSec
//     logLocalTime = sessionTime - log.timeOffsetSec
//
// So setting a positive offset shifts the log's traces RIGHTWARD on
// the session axis. Setting a negative offset shifts LEFTWARD.
//
// This composable is the canonical source of truth for that math —
// panels that render multiple logs against a session cursor should
// pull conversions from here rather than open-coding the +/- offset
// (mistakes inevitable when N panels do it independently).
//
// Today's call sites: none (scaffold for M1.7.1). Once panels migrate
// to true session-time rendering, they use `toLogTime(sessionT)` to
// pick the right index into their per-log arrays, and
// `toSessionTime(logT)` to plot trace x-coords on the session axis.

import {
  computed,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue';

import { useSessionStore } from '@/stores/session';
import { useViewStore } from '@/stores/view';

export interface AlignedTimeHandle {
  /** Current per-log offset in seconds (live from the log state). */
  offsetSec: ComputedRef<number>;
  /** Project a log-local time (seconds since this log's first frame)
   *  onto the shared session axis. Returns null if the logId isn't
   *  loaded. */
  toSessionTime: (logLocalSec: number) => number | null;
  /** Project a session-axis time back to this log's local time.
   *  Returns null if the logId isn't loaded. The result may be
   *  negative (cursor is before this log's t=0 after alignment) or
   *  past the log's duration — callers should bounds-check before
   *  indexing into per-log arrays. */
  toLogTime: (sessionSec: number) => number | null;
  /** The shared cursor (view.cursorTime) projected onto this log's
   *  local axis. Null when the cursor is unset or the log isn't
   *  loaded. */
  alignedCursor: ComputedRef<number | null>;
}

/** Accepts a plain logId string OR a ref / getter that yields the
 *  current logId — the latter for panels whose active log can change
 *  (eye-toggle moves focus, log removed, etc.). Reading the id via
 *  `toValue` makes both paths reactive without forcing the caller to
 *  re-instantiate the composable on every change. */
export function useAlignedTime(
  logIdSource: MaybeRefOrGetter<string | null | undefined>,
): AlignedTimeHandle {
  const session = useSessionStore();
  const view = useViewStore();

  const offsetSec = computed(() => {
    const id = toValue(logIdSource);
    if (!id) return 0;
    return session.logs.get(id)?.timeOffsetSec ?? 0;
  });

  function toSessionTime(logLocalSec: number): number | null {
    const id = toValue(logIdSource);
    if (!id || !session.logs.has(id)) return null;
    return logLocalSec + offsetSec.value;
  }

  function toLogTime(sessionSec: number): number | null {
    const id = toValue(logIdSource);
    if (!id || !session.logs.has(id)) return null;
    return sessionSec - offsetSec.value;
  }

  const alignedCursor = computed<number | null>(() => {
    const t = view.cursorTime;
    if (t == null) return null;
    return toLogTime(t);
  });

  return { offsetSec, toSessionTime, toLogTime, alignedCursor };
}
