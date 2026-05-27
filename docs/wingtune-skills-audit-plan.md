# Skills audit — execution plan

Plan for auditing the 5 in-repo skills against the conventions that
landed between **2026-05-15** (the skills' last touch) and **2026-05-22**
(M-Pilot ship). Same shape as the milestone execution plans
(`docs/wingtune-m-*-execution.md`) — the "what" and "in what order."

> **Read first:** the current state of all 5 skills in
> `.claude/skills/`, plus `.claude/skills/wingtune-recommender.md`
> (refreshed 2026-05-21) as the quality-bar reference for what a
> post-audit skill should look like.

## Why now

Skills are the auto-trigger surface for every future session — they
describe themselves into context based on the work being done, and
their bodies are what Claude reads to decide how that work should
look. Out-of-date skills mean future-me writes against stale
conventions even when current ones are codified elsewhere.

Since 2026-05-15 the project landed M1.7 + M1.7.1 + M1.7.2 + the
entire post-M7 analytics batch (M-FF, M-Coupling, M-FilterSim, S2,
M-Style, M-Servo-2, M-Pilot). Each invented patterns now used in
multiple places but never codified. Examples of load-bearing
conventions currently missing from the skills:

- `shallowReactive(LogState)` for post-construction reactivity
  (M1.7 surfaced as a latent bug; now load-bearing for the session
  store)
- `watchEffect` over `watch([fixed deps], …)` for chart-visibility
  sync — load-bearing, fixed a real chart-state-drift bug
- The per-tab wrapper component pattern
  (`StepTab`/`SpectrumTab`/`SummaryTab`/…)
- Single-log panels use `useActiveLog()`, compare panels iterate
  `session.logs.values()` with `tintTowardFamily()`
- "Diagnostic-only" panel pattern (no recommender, no CLI, footer
  caveat) is the established norm for "describes; doesn't prescribe"
- The `regions: ReadonlyArray<readonly [number, number]>` param
  pattern in spectral estimators so segments never straddle
  non-contiguous window boundaries
- Display-smoothing hard rule (display-only, never feeds analysis;
  metrics computed from raw Float32)

The `wingtune-recommender` skill (refreshed 2026-05-21) is the only
one of the 6 that's been brought through the post-M7 era. It's the
quality bar for what the other 5 should look like after this audit.

## Scope guardrails

These keep the audit from drifting into a rewrite-everything pass:

1. **`n=1` is not a convention.** Only codify a pattern when it
   appears in at least two places in current code. Single-site
   patterns are observations, not rules.
2. **Don't pre-codify what's about to change.** The
   post-calibration threshold pass is coming
   (`docs/wingtune-calibration-flights.md`); the calibration-debt
   machinery is observed-not-rule-ified until those numbers land.
3. **Skill descriptions are the auto-trigger surface.** Editing a
   description changes when the skill fires. Default: leave
   descriptions alone, edit only the body. Re-evaluate per-skill in
   Phase 0; only touch a description if the trigger is demonstrably
   wrong against current code.
4. **Keep the named-exception hatch.** (`// LAYER-EXCEPTION:`,
   `// MEMORY-EXCEPTION:`, `// CONFIDENCE-EXCEPTION:`,
   `// VUE-EXCEPTION:`.) They're load-bearing for honest
   divergences. Corpus-hygiene has no exception hatch by design —
   that stays.
5. **Quality bar = `wingtune-recommender` (2026-05-21).** Each
   slice ends with a structural diff against that skill.

## Phase 0 — pre-audit read (no edits)

- Re-read all 5 skills in full so current state is in context.
- Re-read `wingtune-recommender` for structural reference.
- Confirm the per-skill pattern inventory below against actual code
  (cheap `Grep` passes to verify "this is in at least two places").
- Decision pass on each skill's description: keep as-is (default) or
  flag a specific reason it needs editing.

## Phase 1 — per-skill slices (one commit each)

### Slice A — `wingtune-architecture`

**Likely additions** (verify in Phase 0):

- Per-tab wrapper component pattern — `StepTab` / `SpectrumTab` /
  `TrackingTab` / `ServosTab` / `SummaryTab` all stack their panels
  vertically; `AnalysisView` routes by `activeTab`.
- Execution-doc-per-milestone rhythm — write
  `docs/wingtune-m-X-execution.md` → ship slices → freeze on COMPLETE.
- Main-frame `wing*` field preference over `DEBUG_*` multiplexed
  channels — 10 SignalDefs do this via the registry today.
- Direct-to-main workflow (currently only in user-feedback memory):
  one-liner cross-reference.

**Self-check additions:** panels in a `*Tab.vue` wrapper? Milestone
execution doc written/updated?

### Slice B — `wingtune-memory-model`

**Likely additions:**

- `shallowReactive(LogState)` pattern + the post-construction-write
  reactivity rationale.
- Multi-tenant worker shape — `Map<logId, Uint8Array>` byte cache,
  per-call routing, `closeLog(id)` on log removal.
- LRU field cache + `pinFields` ordering — pin BEFORE
  `ensureFields` so LRU sweep at end of hydrate can't evict.
- Float64Array escape for aligned-time arrays — documented exception
  to the Float32 cardinal rule with the
  `localT = ref[0] - offset` precision lesson as rationale.
- `serialize_maps_as_objects(true)` at the Rust→JS boundary
  (currently in feedback memory only).

**Self-check additions:** session-store changes use `shallowReactive`?
New hydration goes through `ensureFields`, not direct field writes?

### Slice C — `wingtune-vue-conventions` *(biggest delta)*

Most of M1.7 + every panel pattern lives here.

**Likely additions:**

- `useActiveLog()` vs `session.logs.values()` iteration — when each
  applies (single-log = composable, compare = direct).
- `watchEffect` over `watch([fixed deps], …)` for chart-visibility
  sync — the load-bearing fix.
- `${logId}:${field}` view-store keys + separate `hiddenLogs` Set
  (visibility ≠ series toggle; multi-log needs both).
- `useAlignedTime` convention — `sessionTime = logTime + offset`;
  `alignedTimeFor()` + `resampleOntoRef()` pattern.
- Panel structure template — `<section>` → header (title + subtitle
  + right-aligned status) → pending-message OR content → footer
  caveat with `text-bp-warn` note. Every diagnostic panel follows
  this.
- bp- token usage map — when to use `bp-ok` / `bp-warn` / `bp-stamp`
  / `bp-accent` / `bp-ink-N` / `bp-surface-N`.
- uPlot gotchas section — log-distr blank-chart workaround (plot
  `log10(Hz)` linear), all-NaN-series-kills-y-axis,
  `throw` in draw hook aborts cycle.
- `ensureFields` in `onMounted` as the standard panel data-load
  pattern.

**Self-check additions:** chart-visibility uses `watchEffect`?
Compare panels iterate `session.logs.values()` with
`tintTowardFamily`? Single-log panels use `useActiveLog`?

### Slice D — `wingtune-confidence-scoring`

**Likely additions:**

- Calibration-debt as honest-signal, not code smell — `TODO calibrate`
  first-guess constants paired with `calibration-flights.md` rows =
  honest hedge. Diagnostic-only panels make this safe.
- Which recommenders emit CLI vs which are diagnostic-only — only
  `debugMode`, `airspeedBasic`, `tpaCurve` emit CLI today. Rest are
  diagnostic by design. Real distinction the current skill doesn't
  draw.
- Profile-aware thresholds (M-Style migration pattern) — thresholds
  belong in `ProfileThresholds`, not analysis libs. `sport === today`
  safety rule when migrating an existing threshold.
- Signal-registry `out_of_range` state — `expected_range` guard as
  a confidence-scoring feature; predicates surface it as a distinct
  readiness state.

**Self-check additions:** `TODO calibrate` constants paired with a
row in `calibration-flights.md`? New recommender's `red` removes CLI?

### Slice E — `wingtune-corpus-hygiene`

Likely smallest delta. Phase 0 may collapse this into "minor wording
refresh" if no new rules emerged. Verify GPS-scrubbing rules still
match parser GPS-frame behaviour after M1.7.2.

## Phase 2 — quality-bar pass

Each slice ends with a structural diff against `wingtune-recommender`
(the 5-21 reference):

- Description still trigger-able for the same situations? (Default:
  yes.)
- Body sections in the same order (purpose / rules / patterns /
  self-check / exceptions)?
- Self-check is a real pre-commit checklist (specific, falsifiable)?
- Named exceptions documented (where applicable)?

## Phase 3 — commit cadence

**One commit per slice (5 total)** — keeps diffs reviewable and lets
you bail mid-audit if early slices reveal scope creep. Commit
messages follow the project pattern (`docs(skills): wingtune-X audit
pass`).

Audit happens in **a single session** (~2-3h focused work). The
cross-references between skills matter and stale-state-in-head loses
fidelity across breaks.

## Out of scope (won't touch this pass)

- The `wingtune-recommender` skill (already refreshed 2026-05-21;
  it's the reference, not the target).
- The CLAUDE.md skills index table — only edit if a skill's
  description changes (Guardrail #3 default: it shouldn't).
- Calibration-debt threshold patterns (Guardrail #2 — observe only
  until post-calibration pass).
- New skills. If a pattern doesn't fit one of the 5 existing skills,
  flag it for a follow-up session rather than spawn a 6th skill mid-
  audit.

## Open follow-ups deferred from this plan

- **Docs-index sweep** (`docs/README.md` + `wingtune-analytics-plan.md`
  M-Pilot pointers + `wingtune-tab-guide.md` PilotStylePanel mention
  + `wingtune-tuning-workflow.md` pilot-style step). Mechanical;
  separate small-commit pass.
- **`docs/firmware-pr/wing-fields-firmware-notes.md` triage** —
  frozen-by-design or stale? 60-second read decides.
- **Post-calibration threshold pass** — converts the suite's `TODO
  calibrate` constants into measured numbers once Brian's
  calibration sorties are flown. Blocked on flight data.
