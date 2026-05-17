// Layer 2 — recommendation aggregation.
//
// A `Recommendation` is the consumer-facing shape rendered in the
// Recommend tab. Each individual recommender (one per domain /
// concern) is a pure function that takes the parser report + the
// derived ModuleReport and returns zero or more Recommendation
// entries. `gatherRecommendations` runs the full set and concatenates.
//
// Every rec that emits CLI carries a `ConfidenceResult`-shaped trio
// of (confidence / criteria_met / criteria_failed) per the cardinal
// rule. On `red` confidence the UI removes the copy-CLI affordance —
// see `wingtune-confidence-scoring`. Flat fields rather than a nested
// ConfidenceResult<T> because the UI consumes them per-row and the
// nesting added zero ergonomic value.

import type { CapabilityReport } from '@/lib/wasmBridge';
import type { ConfidenceLevel } from '@/lib/confidence';
import type { ModuleReport } from '@/lib/capabilityPredicates';
import {
  debugModeRecommender,
  debugModeRequiredFields,
} from '@/lib/recommenders/debugMode';
import {
  pidfsSharesRecommender,
  pidfsSharesRequiredFields,
} from '@/lib/recommenders/pidfsShares';
import {
  airspeedBasicRecommender,
  airspeedBasicRequiredFields,
} from '@/lib/recommenders/airspeedBasic';

/** UI severity — the "should I care" axis, distinct from confidence
 *  (the "is this rec trustworthy" axis). A high-severity low-
 *  confidence rec is still worth surfacing for the user to investigate. */
export type Severity = 'high' | 'medium' | 'low' | 'info';

/** Per-axis attribution for axis-scoped recs ('R' | 'P' | 'Y'); `null`
 *  or undefined for whole-craft recs. */
export type AxisShort = 'R' | 'P' | 'Y';

/** A cursor-pinnable evidence anchor — clicking the chip pins the
 *  shared cursor at this time so the user can scrub to the moment
 *  that triggered the rec. */
export interface EvidencePoint {
  time_sec: number;
  label: string;
}

export interface Recommendation {
  /** Stable identifier, used as the v-for key + future
   *  dismiss-persistence key. */
  id: string;
  /** Logical grouping ('Setup', 'PID', 'TPA', 'SPA', 'Filters',
   *  'Servo'). Drives both visual grouping and the filter chip set. */
  domain: string;
  /** Per-axis attribution (display-only). */
  axis?: AxisShort | null;
  severity: Severity;
  title: string;
  /** One-sentence summary shown collapsed. */
  summary: string;
  /** Multi-line explanation shown when expanded. */
  detail: string;
  /** Current vs suggested config rows, displayed side-by-side. */
  current?: ReadonlyArray<readonly [string, string]>;
  suggested?: ReadonlyArray<readonly [string, string]>;
  /** Paste-ready CLI lines. Empty = informational-only rec. */
  cli: readonly string[];
  /** Cursor-pin chips (deferred to slice 2 of the rec work). */
  evidence?: readonly EvidencePoint[];
  // Confidence-scored trio — required when cli.length > 0.
  confidence: ConfidenceLevel;
  criteria_met: readonly string[];
  criteria_failed: readonly string[];
}

export interface RecommenderArgs {
  capability: CapabilityReport;
  modules: ModuleReport;
  /** Hydrated field map (logStore.fields). Recommenders that need
   *  per-frame data look fields up by name (e.g. `axisP[0]`). Maps
   *  shallow-reactive — Vue's computed re-runs when entries are
   *  added, so PIDFS recs appear once the eager-hydration kick from
   *  AnalysisView completes. Fields a recommender NEEDS but that
   *  aren't hydrated yet → the recommender skips them, returns no
   *  recs from that axis. */
  fields: ReadonlyMap<string, Float32Array>;
  /** Log time axis (logStore.time), Float32 seconds-since-log-start.
   *  Used by recommenders to translate sample indices into evidence
   *  point time_sec values for the cursor-pin chips. Empty array
   *  before scan completes. */
  time: Float32Array;
  /** GPS-frame time axis (logStore.gpsTimeSec), Float32 seconds-since-
   *  first-main-frame. Empty when the log has no GPS frames. Used by
   *  the airspeed-basic recommender to trim its fit window to where
   *  GPS data exists. */
  gpsTimeSec: Float32Array;
}

export type Recommender = (args: RecommenderArgs) => Recommendation[];

/** Union of every field every registered recommender wants hydrated
 *  before it runs. AnalysisView eagerly hydrates this set on log
 *  load so PIDFS recs land without lazy-on-tab-mount delay. */
export const ALL_RECOMMENDER_REQUIRED_FIELDS: readonly string[] = [
  ...debugModeRequiredFields,
  ...pidfsSharesRequiredFields,
  ...airspeedBasicRequiredFields,
];

export function gatherRecommendations(args: RecommenderArgs): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const rec of debugModeRecommender(args)) recs.push(rec);
  for (const rec of pidfsSharesRecommender(args)) recs.push(rec);
  for (const rec of airspeedBasicRecommender(args)) recs.push(rec);
  // future: dynamicNotchCoverage, filterDelayBudget,
  // stepResponseOvershoot, servoSaturation, … each just appended here.
  return recs;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0, medium: 1, low: 2, info: 3,
};

/** Sort high → info; preserves stable order within a severity. */
export function sortBySeverity(recs: readonly Recommendation[]): Recommendation[] {
  return [...recs].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
