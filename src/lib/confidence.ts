// Layer 2 — confidence-scoring framework (cardinal rule #5).
//
// Every analysis module that emits a paste-ready CLI recommendation
// returns this shape. The UI reflects the level to the user; on `red`
// the copy-CLI affordance is removed entirely (not just disabled —
// disabled-but-visible buttons get tapped). See
// `wingtune-confidence-scoring` skill for the full spec.
//
// snake_case field names are intentional and match the roadmap +
// validate-parser manifest contracts. Don't camelCase them.
//
// No consumers in M1.6 — recommendation-emitting modules land with
// M2+. This file ships now so the type is available when those
// modules import it, and so the readiness-card work doesn't need to
// inline a placeholder.

/** Three discrete levels. No "mostly green" — if any criterion failed,
 *  the result is not green. Discreteness forces the author to pick.
 *  See the skill for the rationale against continuous 0..100 scores. */
export type ConfidenceLevel = 'green' | 'yellow' | 'red';

/** Per-module recommendation envelope. `recommendation` is the
 *  module-specific payload (CLI line set, fit parameters, etc.).
 *  Criteria lists are human-readable strings rendered in the
 *  per-module output panel. */
export interface ConfidenceResult<T> {
  recommendation: T;
  confidence: ConfidenceLevel;
  /** Criteria the module evaluated and passed. */
  criteria_met: string[];
  /** Criteria the module evaluated and failed. Drives the user's
   *  "what would I need to fly to get this to green" understanding. */
  criteria_failed: string[];
}

/** Aggregation helper. Each criterion is classified `critical` or
 *  `supporting` per-module; this helper applies the standard rule:
 *
 *    all pass         → green
 *    any critical failed
 *      OR more than half of supporting failed
 *                     → red
 *    otherwise        → yellow
 *
 *  Modules call this with their own per-criterion classifications.
 *  Criterion strings are returned in `criteria_met` / `criteria_failed`
 *  for the consumer to drop straight into the result. */
export interface CriterionEvaluation {
  /** Human-readable description; goes into criteria_met / criteria_failed. */
  description: string;
  /** Did this specific criterion pass on this log? */
  passed: boolean;
  /** Failure of a `critical` criterion forces `red`. Failure of a
   *  `supporting` criterion contributes to yellow / red via the
   *  more-than-half rule. */
  classification: 'critical' | 'supporting';
}

export interface AggregatedConfidence {
  confidence: ConfidenceLevel;
  criteria_met: string[];
  criteria_failed: string[];
}

export function aggregateConfidence(
  evals: readonly CriterionEvaluation[],
): AggregatedConfidence {
  const met: string[] = [];
  const failed: string[] = [];
  for (const e of evals) {
    if (e.passed) met.push(e.description);
    else failed.push(e.description);
  }
  if (failed.length === 0) {
    return { confidence: 'green', criteria_met: met, criteria_failed: failed };
  }
  const criticalFailed = evals.some((e) => !e.passed && e.classification === 'critical');
  const supporting = evals.filter((e) => e.classification === 'supporting');
  const supportingFailed = supporting.filter((e) => !e.passed).length;
  const majorityOfSupportingFailed = supporting.length > 0 && supportingFailed * 2 > supporting.length;
  if (criticalFailed || majorityOfSupportingFailed) {
    return { confidence: 'red', criteria_met: met, criteria_failed: failed };
  }
  return { confidence: 'yellow', criteria_met: met, criteria_failed: failed };
}
