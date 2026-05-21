import { describe, test, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  resolveTuneProfile,
  thresholdsFor,
  PROFILES,
  PROFILE_META,
  TUNE_PROFILE_ORDER,
  DEFAULT_TUNE_PROFILE,
  type TuneProfile,
  type ProfileThresholds,
} from '@/lib/tuneProfile';
import { useViewStore } from '@/stores/view';

const ALL: TuneProfile[] = ['cruise', 'sport', '3d'];

describe('resolveTuneProfile', () => {
  test('passes through the three legal profiles', () => {
    expect(resolveTuneProfile('cruise')).toBe('cruise');
    expect(resolveTuneProfile('sport')).toBe('sport');
    expect(resolveTuneProfile('3d')).toBe('3d');
  });

  test('falls back to Sport on anything unrecognised', () => {
    for (const bad of ['', 'CRUISE', '3D', 'race', null, undefined, 0, 42, {}]) {
      expect(resolveTuneProfile(bad)).toBe('sport');
    }
    expect(DEFAULT_TUNE_PROFILE).toBe('sport');
  });
});

describe('PROFILES', () => {
  test('every profile carries every threshold field as a finite number', () => {
    const keys = Object.keys(PROFILES.sport) as (keyof ProfileThresholds)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const p of ALL) {
      for (const k of keys) {
        expect(Number.isFinite(PROFILES[p][k])).toBe(true);
      }
    }
  });

  test('Sport === today — the documented current filter-delay bands', () => {
    expect(PROFILES.sport.filterDelayWarnMs).toBe(5);
    expect(PROFILES.sport.filterDelayBadMs).toBe(8);
  });

  test('warn band sits below the bad band for every profile', () => {
    for (const p of ALL) {
      expect(PROFILES[p].filterDelayWarnMs).toBeLessThan(PROFILES[p].filterDelayBadMs);
    }
  });

  test('3D tolerates less filter delay than Cruise', () => {
    expect(PROFILES['3d'].filterDelayBadMs).toBeLessThan(PROFILES.cruise.filterDelayBadMs);
    expect(PROFILES['3d'].filterDelayWarnMs).toBeLessThan(PROFILES.cruise.filterDelayWarnMs);
  });

  test('coupling significance — Sport === today, 3D tolerates more than Cruise', () => {
    // Sport mirrors the historical SIGNIFICANT_COUPLING constant (0.15).
    expect(PROFILES.sport.couplingSignificance).toBe(0.15);
    // 3D flies aggressively — axes couple naturally — so it flags less
    // (a higher threshold); Cruise wants it tighter.
    expect(PROFILES.cruise.couplingSignificance)
      .toBeLessThan(PROFILES.sport.couplingSignificance);
    expect(PROFILES['3d'].couplingSignificance)
      .toBeGreaterThan(PROFILES.sport.couplingSignificance);
  });

  test('step-response peak bands — Sport === today, 3D tolerates more overshoot', () => {
    // Sport mirrors the current StepResponsePanel traffic-light bands.
    expect(PROFILES.sport.stepPeakWarnHigh).toBe(1.1);
    expect(PROFILES.sport.stepPeakBadHigh).toBe(1.3);
    expect(PROFILES.sport.stepPeakWarnLow).toBe(0.85);
    // 3D tolerates more overshoot (snap is the point) — higher bands —
    // but flags a sluggish response sooner (higher undershoot floor).
    expect(PROFILES['3d'].stepPeakBadHigh)
      .toBeGreaterThan(PROFILES.sport.stepPeakBadHigh);
    expect(PROFILES['3d'].stepPeakWarnLow)
      .toBeGreaterThan(PROFILES.sport.stepPeakWarnLow);
    // Cruise wants it tight + well-damped — lower overshoot bands.
    expect(PROFILES.cruise.stepPeakBadHigh)
      .toBeLessThan(PROFILES.sport.stepPeakBadHigh);
  });

  test('thresholdsFor returns the profile threshold set', () => {
    expect(thresholdsFor('cruise')).toBe(PROFILES.cruise);
    expect(thresholdsFor('3d')).toBe(PROFILES['3d']);
  });

  test('TUNE_PROFILE_ORDER lists each profile once, soft → aggressive', () => {
    expect(TUNE_PROFILE_ORDER).toEqual(['cruise', 'sport', '3d']);
    expect(new Set(TUNE_PROFILE_ORDER).size).toBe(3);
  });

  test('PROFILE_META has a label + blurb for every profile', () => {
    for (const p of ALL) {
      expect(PROFILE_META[p].id).toBe(p);
      expect(PROFILE_META[p].label.length).toBeGreaterThan(0);
      expect(PROFILE_META[p].blurb.length).toBeGreaterThan(0);
    }
  });
});

describe('view store — tuneProfile', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  test('defaults to Sport', () => {
    expect(useViewStore().tuneProfile).toBe('sport');
  });

  test('setTuneProfile updates the active profile', () => {
    const view = useViewStore();
    view.setTuneProfile('3d');
    expect(view.tuneProfile).toBe('3d');
    view.setTuneProfile('cruise');
    expect(view.tuneProfile).toBe('cruise');
  });
});
