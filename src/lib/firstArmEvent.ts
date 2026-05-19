// First-throttle-up event detection — alternative anchor for the
// multi-log auto-align when gyro cross-correlation is low confidence.
//
// `lib/autoAlign.ts` does gyro-magnitude cross-correlation to align two
// logs on the session axis. When that returns low NCC (no shared
// motion content) or low peak ratio (periodic/ambiguous signature),
// we want a fallback anchor. First-throttle-up is the simplest
// reliable one:
//
//   · `rcCommand[3]` (throttle channel) is always logged on the main
//     frame, eagerly hydrated for every log on load.
//   · BF uses 1000-2000 for stick range; 1100 is a clean "off-zero"
//     threshold that survives both manual hand-launch (pilot pushes
//     throttle) and USE_WING auto-launch (firmware ramps throttle).
//   · The exact arm event isn't what we want — pilots can sit armed
//     at zero throttle for arbitrary pre-flight time. First throttle
//     ≥ 1100 marks the moment the flight actually starts moving.
//
// Limitation: doesn't handle logs where the pilot was already at
// throttle when logging started (no rising edge from below 1100).
// In that case we return null and the orchestrator stays with the
// xcorr result even if low confidence.

import { type LogState } from '@/stores/session';

const THROTTLE_FIELD = 'rcCommand[3]';
const THROTTLE_THRESHOLD = 1100;

export interface FirstThrottleResult {
  /** Seconds-from-log-start when throttle first crosses THROTTLE_THRESHOLD
   *  from below. Null if no crossing exists (throttle never reaches
   *  the threshold, or was already above it at sample 0). */
  timeSec: number | null;
  /** Whether the crossing was detected; mirrors `timeSec !== null` but
   *  more explicit for orchestration code. */
  detected: boolean;
}

/** Walk `rcCommand[3]` for the first sample whose value is ≥ 1100
 *  AND whose predecessor was < 1100 (or sample 0 if it starts above).
 *  Wait — we explicitly require a rising edge from BELOW. Pilots
 *  sitting above 1100 from sample 0 don't have a meaningful first-
 *  throttle event in this log (they had it before logging started). */
export function findFirstThrottleUpSec(log: LogState): FirstThrottleResult {
  const arr = log.fields.get(THROTTLE_FIELD);
  if (!arr || arr.length === 0 || log.time.length === 0) {
    return { timeSec: null, detected: false };
  }
  const n = Math.min(arr.length, log.time.length);
  if (n === 0) return { timeSec: null, detected: false };

  // Must start BELOW threshold for "rising edge" semantics. Logs that
  // open already at throttle have no meaningful crossing here.
  if (arr[0] >= THROTTLE_THRESHOLD) return { timeSec: null, detected: false };

  for (let i = 1; i < n; i++) {
    if (arr[i - 1] < THROTTLE_THRESHOLD && arr[i] >= THROTTLE_THRESHOLD) {
      return { timeSec: log.time[i], detected: true };
    }
  }
  return { timeSec: null, detected: false };
}

export interface FirstThrottleAlignResult {
  /** Offset (seconds) to apply to `otherLog` so its first-throttle
   *  event lands at the same session time as `refLog`'s, assuming
   *  the reference's offset is 0. Caller adds the reference's
   *  existing offset to get the final value (same convention as
   *  `alignLogToReference` in `lib/autoAlign.ts`). */
  offsetSec: number;
  /** 'throttle' when both logs have a detected crossing; 'none'
   *  when at least one log doesn't. */
  signal: 'throttle' | 'none';
}

/** Difference the two logs' first-throttle-up times. Both logs must
 *  have a detected crossing; otherwise returns `signal: 'none'` and
 *  the caller should fall back to manual alignment or accept the
 *  prior (possibly low-confidence) xcorr result. */
export function alignByFirstThrottle(
  refLog: LogState,
  otherLog: LogState,
): FirstThrottleAlignResult {
  const refResult   = findFirstThrottleUpSec(refLog);
  const otherResult = findFirstThrottleUpSec(otherLog);
  if (!refResult.detected || !otherResult.detected) {
    return { offsetSec: 0, signal: 'none' };
  }
  // refTime and otherTime are seconds-from-each-log's-start. To make
  // them coincide on the session axis: sessionTime = logTime + offset.
  // For ref (offset 0): event lands at refTime. For other: want
  // sessionTime = refTime → otherTime + offset = refTime → offset = refTime - otherTime.
  return {
    offsetSec: (refResult.timeSec ?? 0) - (otherResult.timeSec ?? 0),
    signal: 'throttle',
  };
}
