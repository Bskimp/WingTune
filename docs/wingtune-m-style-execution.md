# M-Style execution plan — tune-style profiles (the "style dial")

Execution detail for the **M-Style** milestone — analytics-plan priority
#5. The analytics plan (`docs/wingtune-analytics-plan.md`, the "M-Style"
section) is the "why"; this doc is the slice-by-slice breakdown.

> **Read first:** `wingtune-vue-conventions` (view store + the UI
> control), `wingtune-confidence-scoring` (the profile moves the
> thresholds confidence is scored against), `wingtune-recommender`
> (every recommender is the "tool tells the user what to do" surface —
> M-Style changes what they say).

## What M-Style does

Every recommender emits thresholds and CLI targets against an implicit
"default wing." M-Style adds one user-facing setting — **Cruise /
Sport / 3D** — that reweights those thresholds and targets, so the same
log produces advice matched to what the wing is FOR. It is not new
analysis: an interpretation layer over the existing recommenders. A 3D
plane tolerates less filter delay and lighter damping and wants a higher
`tpa_curve_pid_thr0`; a cruiser the reverse; Sport is the neutral middle
(and the default — so nothing regresses).

## Status

🚧 **In progress** — started 2026-05-21.

## The load-bearing safety rule

**Sport === today.** Every per-profile threshold value for the Sport
profile MUST equal the recommender's current hardcoded constant. So
shipping the infra + the migration with the default (Sport) selected is
a behavioural no-op — verified by the existing recommender tests still
passing unchanged. Cruise and 3D are the only profiles that shift
anything; both start as conservative first guesses (`TODO calibrate`).

## Scope

**In:** `lib/tuneProfile.ts`, a `tuneProfile` view-store setting with
localStorage persistence, `RecommenderArgs` extended with the profile,
the style-sensitive recommenders migrated to profile-aware thresholds,
a UI selector.

**Out (deferred, with triggers):**
- **M-Pilot auto-suggest** — M-Pilot (analytics-plan #7) infers flight
  style from the log and can *suggest* a profile. Deferred until
  M-Pilot ships; M-Style works standalone with manual selection.
- **Per-axis profiles** — one global dial for v1.
- **Profile-specific analysis** (not just thresholds) — out of scope;
  M-Style is an interpretation layer, the analysis math is unchanged.

## Slice breakdown

### Slice 1 — `lib/tuneProfile.ts` + view-store setting (infra, no behaviour change)

Layer 2 + the view store. Pure infrastructure — at the end of this
slice nothing the user sees has changed.

- `lib/tuneProfile.ts` — `TuneProfile = 'cruise' | 'sport' | '3d'`; a
  `ProfileThresholds` interface; `PROFILES: Record<TuneProfile,
  ProfileThresholds>` with all three populated. Profile metadata
  (label, one-line description) for the UI. `resolveTuneProfile(raw):
  TuneProfile` — validates an untrusted string (localStorage) to a
  legal profile, default `'sport'`.
- View store: a `tuneProfile` ref + `setTuneProfile()`. First persisted
  view setting — read from `localStorage` on store init via
  `resolveTuneProfile`, write on change. Guard `typeof localStorage`
  for the test / non-browser environment.
- `RecommenderArgs` gains `profile: TuneProfile` (the same way M3 added
  `gpsTimeSec`); `gatherRecommendations` reads `view.tuneProfile` and
  passes it down. No recommender consumes it yet.
- **Tests:** `resolveTuneProfile` (valid / garbage / missing → default);
  `PROFILES` completeness (every profile has every threshold field);
  the view-store getter/setter.

### Slice 2 — migrate the style-sensitive recommenders

Layer 2 — `wingtune-recommender` + `wingtune-confidence-scoring`. The
meat. Each recommender: replace its file-scope threshold constant with a
read from the active profile's `ProfileThresholds`.

Candidates (audited per-recommender — not every threshold is
style-sensitive):
- **Filter-delay budget (M4)** — the green/orange/red millisecond bands.
- **Coupling (M-Coupling)** — `SIGNIFICANT_COUPLING`.
- **Step response (M-Step)** — the peak / latency "good" targets.
- **TPA curve fit (M5)** — biases the recommended `tpa_curve_pid_thr0`.
- PIDFS shares / input-chain / SPA / airspeed — audit, migrate the ones
  that prove style-sensitive.

Each migration keeps `PROFILES.sport.<x>` equal to the old constant.
Per-recommender tests gain a case: same log, different profile →
threshold shifts as expected. Existing tests run with the default
(Sport) and must pass unchanged.

### Slice 3 — the UI selector

Layer 3 — `wingtune-vue-conventions`. A three-way Cruise / Sport / 3D
control bound to `view.tuneProfile`, in the Recommend tab header (recs
are what it changes). Each option shows its one-line description.
Changing it re-runs `gatherRecommendations`.

### Slice 4 — M-Pilot auto-suggest — DEFERRED

When M-Pilot ships, it suggests a profile from the log's input style — a
suggestion, never an override (the fingerprint-as-suggestion principle).

## Open questions carried into execution

1. **`ProfileThresholds` shape** — define it incrementally as Slice 2
   audits each recommender, or all-at-once in Slice 1? Leaning
   incremental — Slice 1 ships the interface with the filter-delay +
   coupling thresholds (simple scalars), Slice 2 extends it.
2. **TPA bias mechanism** — M5 emits a *fitted* `tpa_curve_pid_thr0`.
   The profile should nudge the *recommended* value, not the fit itself.
   Exact mechanism (additive offset? a target the rec is pulled
   toward?) — resolve in Slice 2.
3. **Confidence interaction** — moving a threshold legitimately flips a
   rec's green/yellow/red (a CLI rec green under Sport can go red under
   3D, removing the copy button). That is correct and intended —
   M-Style changes the *inputs* to confidence scoring, never the scoring
   logic. No cardinal-rule conflict.
4. **Selector placement** — Recommend tab header for v1; revisit if it
   wants to be more global.

## Test plan

- Unit (`tests/unit/`): `tuneProfile.ts`; each migrated recommender
  gains a profile-shift case.
- Regression: the full existing recommender suite must pass unchanged
  with the default Sport profile — the Sport-===-today guarantee.
- Per-skill self-check before commit.
