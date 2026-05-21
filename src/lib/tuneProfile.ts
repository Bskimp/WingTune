// Layer 2 — tune-style profiles ("the style dial").
//
// One user-facing setting — Cruise / Sport / 3D — that reweights the
// recommenders' thresholds and targets so the same log produces advice
// matched to what the wing is FOR. Not new analysis: an interpretation
// layer. A 3D plane tolerates less filter delay and lighter damping; a
// cruiser the reverse; Sport is the neutral middle.
//
// THE SAFETY RULE: the Sport profile's every threshold value EQUALS the
// recommender's current hardcoded constant, so selecting Sport (the
// default) is a behavioural no-op. Cruise and 3D are conservative first
// guesses — every non-Sport number is `TODO calibrate`, pending corpus
// logs flown in each style.
//
// Milestone M-Style — docs/wingtune-m-style-execution.md. This module is
// the data + resolution; the view store owns the active selection +
// localStorage persistence; recommenders read thresholds via
// RecommenderArgs.profile (wired through in Slice 2).

export type TuneProfile = 'cruise' | 'sport' | '3d';

/** The per-profile threshold set the recommenders read. Grows as Slice 2
 *  migrates each recommender — every field added here gets a value in
 *  all three PROFILES, and the `sport` value MUST equal the recommender's
 *  live constant at migration time (the Sport-===-today guarantee). */
export interface ProfileThresholds {
  /** M4 filter-delay budget — total group delay (ms) at which the badge
   *  turns orange, then red. 3D wants the chain short (delay is the
   *  enemy of crisp response); a cruiser trades latency for smoothness. */
  filterDelayWarnMs: number;
  filterDelayBadMs: number;
  /** M-Coupling significance threshold — |off-diagonal coupling| at or
   *  above this fraction is flagged. 3D tolerates more (aggressive
   *  flight couples axes naturally); a cruiser wants it tighter. */
  couplingSignificance: number;
  /** M-Step step-response peak amplitude bands. A peak above
   *  `stepPeakBadHigh` is hard overshoot; above `stepPeakWarnHigh`,
   *  mild; below `stepPeakWarnLow`, sluggish / over-damped. 3D
   *  tolerates more overshoot (snap is the point) yet flags a sluggish
   *  response sooner; a cruiser wants it tight + well-damped. */
  stepPeakWarnHigh: number;
  stepPeakBadHigh: number;
  stepPeakWarnLow: number;
}

export interface ProfileMeta {
  id: TuneProfile;
  label: string;
  /** One-liner for the UI selector. */
  blurb: string;
}

export const PROFILE_META: Record<TuneProfile, ProfileMeta> = {
  cruise: {
    id: 'cruise',
    label: 'Cruise',
    blurb: 'Smooth, efficient, disturbance-rejecting — latency traded for calm.',
  },
  sport: {
    id: 'sport',
    label: 'Sport',
    blurb: 'Balanced all-rounder — the neutral default.',
  },
  '3d': {
    id: '3d',
    label: '3D',
    blurb: 'Most responsive, least filtering — built for aggressive / 3D flying.',
  },
};

/** Profile → threshold set. `sport` mirrors today's hardcoded constants
 *  (verified per-recommender as Slice 2 migrates each). `cruise` / `3d`
 *  are conservative first guesses — `TODO calibrate` against corpus logs
 *  flown in each style. */
export const PROFILES: Record<TuneProfile, ProfileThresholds> = {
  cruise: {
    filterDelayWarnMs: 7, // TODO calibrate
    filterDelayBadMs: 11, // TODO calibrate
    couplingSignificance: 0.12, // TODO calibrate
    stepPeakWarnHigh: 1.08, // TODO calibrate
    stepPeakBadHigh: 1.22, // TODO calibrate
    stepPeakWarnLow: 0.80, // TODO calibrate
  },
  sport: {
    // Sport === today: every value matches the current hardcoded
    // constant — the filter-delay badge bands (green < 5 ms / orange
    // 5-8 / red > 8), the historical SIGNIFICANT_COUPLING (0.15), and
    // the StepResponsePanel peak bands (clean < 1.10 / mild < 1.30 /
    // sluggish < 0.85). Selecting Sport is a behavioural no-op.
    filterDelayWarnMs: 5,
    filterDelayBadMs: 8,
    couplingSignificance: 0.15,
    stepPeakWarnHigh: 1.10,
    stepPeakBadHigh: 1.30,
    stepPeakWarnLow: 0.85,
  },
  '3d': {
    filterDelayWarnMs: 3.5, // TODO calibrate
    filterDelayBadMs: 6, // TODO calibrate
    couplingSignificance: 0.22, // TODO calibrate
    stepPeakWarnHigh: 1.15, // TODO calibrate
    stepPeakBadHigh: 1.45, // TODO calibrate
    stepPeakWarnLow: 0.90, // TODO calibrate
  },
};

/** UI selector order — Cruise … Sport … 3D, soft to aggressive. */
export const TUNE_PROFILE_ORDER: readonly TuneProfile[] = ['cruise', 'sport', '3d'];

export const DEFAULT_TUNE_PROFILE: TuneProfile = 'sport';

/** Validate an untrusted value (e.g. from localStorage) to a legal
 *  TuneProfile. Anything unrecognised → the default (Sport). */
export function resolveTuneProfile(raw: unknown): TuneProfile {
  return raw === 'cruise' || raw === 'sport' || raw === '3d'
    ? raw
    : DEFAULT_TUNE_PROFILE;
}

/** The active profile's threshold set. */
export function thresholdsFor(profile: TuneProfile): ProfileThresholds {
  return PROFILES[profile];
}
