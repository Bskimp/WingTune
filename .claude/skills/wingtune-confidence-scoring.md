---
name: wingtune-confidence-scoring
description: WingTune's two-layer trust model — capability predicates (can this module run on this log?) and confidence scoring (if it ran, how trustworthy is the output for paste-to-FC use?). Use this skill whenever adding a new analysis module, modifying src/lib/capabilityPredicates.ts or src/lib/confidence.ts, changing per-module confidence criteria, modifying the readiness report UI, writing validate-parser expected-capabilities checks, defining new corpus manifest expectations, or PR-reviewing any of the above. Use it even if the user doesn't mention confidence — modules that emit paste-ready CLI commands without confidence scoring are the project's most dangerous failure mode, because a low-quality fit pasted to a real flight controller can crash a real aircraft.
---

# WingTune confidence scoring

WingTune emits CLI recommendations that pilots paste directly into a real
flight controller. A bad recommendation pasted to a real plane crashes a real
plane. Every module that produces recommendations self-rates its
trustworthiness; the UI reflects that rating to the user; the rating gates
whether the "copy to clipboard" affordance even exists.

The framework is **two layers**, and they are independent:

- **Capability** — can this module run against this log at all?
- **Confidence** — given it ran, how much should we trust the output?

A module can be perfectly capable on a log and still produce a low-confidence
result. A module can be partially capable and refuse to run. Both signals are
always required for any module that emits CLI; visual-only modules need only
the capability layer.

## Layer 1: Capability predicates

**Question answered:** "Can this analysis module run against this log?"

A capability predicate is a pure function from log metadata (the parser's
capability report) to a `Capability` value. Predicates are **shared between
three callers** — this is the load-bearing property:

1. **Runtime UI** (`M1.6` readiness report) — shows the user which analyses
   are runnable on their loaded log
2. **Module runner** (Layer 2) — refuses to start a module whose predicate
   returns `blocked`
3. **Validate-parser regression** (CI) — checks every corpus log's
   `manifest.yaml` `expected.modules_runnable` against what the predicates
   actually return for that log

The same function is the source of truth for all three. If a predicate is
wrong, the runtime UI lies to the user, the runner attempts impossible work,
*and* the corpus regression fails. That triple-coverage is the invariant —
preserve it. Never duplicate predicate logic into the UI, the runner, or the
test harness.

### The signal registry — predicate plumbing

Wing-tuning signals (TPA speed estimate, TPA argument, pre-TPA sTerm per axis,
SPA per axis, adjusted setpoint per axis) can come from **two sources**: the
new main-frame `USE_WING` fields shipped in BF 2026.6+, or the corresponding
pre-PR debug-mode channels. A predicate must NEVER name a source directly —
instead it calls `resolveSignal(id, axis, capability)` from
`src/lib/signalRegistry.ts`, which walks an ordered list of sources
(main-frame preferred, debug-mode fallback) and returns one of:

- `{ state: 'resolved', via: 'main_frame' | 'debug', source }` — predicate can use the signal
- `{ state: 'inactive', via: 'main_frame', source }` — field present, `sample_check` says all-zero
- `{ state: 'missing' }` — not resolvable via any path

This is **the load-bearing invariant of the layer**:

> Predicates ask the registry; they never name a `debug_mode` string or
> main-frame field name themselves.

When the firmware companion PR lands (BF 2026.6), predicate code doesn't
change — only the corpus grows to include main-frame-sourced fixtures. A
partial PR landing (e.g. only the TPA family) automatically routes
TPA-dependent modules to main-frame resolution while SPA-dependent modules
stay on debug fallback, with zero predicate edits. **This is what "WingTune is
not gated on the firmware PR" means in code.**

For signals that are already main-frame-only with no fallback (e.g.
post-TPA `axisS[0..2]`, which has been under `USE_WING` for a while), the
predicate reads `capability.fieldsPresent` + `capability.sampleChecks`
directly — no registry indirection needed. The registry abstracts over
*sources*, and a single-source signal doesn't have any to abstract.

### Type contracts

```ts
// src/lib/capabilityPredicates.ts
export type CapabilityState = 'available' | 'partial' | 'inactive' | 'blocked';

export type Capability = {
  state: CapabilityState;
  reason?: string;                          // human-readable, surfaced in readiness report
  via?: 'main_frame' | 'debug' | 'mixed';   // resolved source path; rendered as "(via …)" in UI
};

// Aggregate of per-module capability rollups. Note: this is NOT the parser's
// capability report (which lives in Layer 1 and feeds *into* predicates) —
// this is what comes OUT of running every predicate over the parser report.
export type ModuleReport = {
  basicViewing:      Capability;
  pidfsDecomp:       { roll: Capability; pitch: Capability; yaw: Capability };
  airspeedAutoTune:  Capability;
  tpaCurveFit:       Capability;
  spaEffectiveness:  { roll: Capability; pitch: Capability; yaw: Capability };
  sTermTpaViz:       { roll: Capability; pitch: Capability; yaw: Capability };
};
```

Per-axis modules (SPA effectiveness, S-term TPA viz) report per-axis state
rather than a single rollup. A user with SPA configured on roll/pitch but not
yaw sees three independent statuses, not one collapsed "partial."

### Predicate example — signal-routed

```ts
import { resolveSignal } from './signalRegistry';

export function checkAirspeedAutoTune(capability: CapabilityReport): Capability {
  const speed = resolveSignal('tpa_speed_est', null, capability);
  const arg   = resolveSignal('tpa_arg',       null, capability);

  if (speed.state === 'missing' || arg.state === 'missing') {
    return {
      state: 'blocked',
      reason: 'TPA signals not present. Need main-frame `tpaSpeedEst`/`tpaArg` (BF 2026.6+) or `debug_mode = TPA`.',
    };
  }
  if (!capability.gpsPresent) {
    return { state: 'blocked', reason: 'GPS data not present in log' };
  }
  return {
    state: 'available',
    via: speed.via === arg.via ? speed.via : 'mixed',
  };
}
```

Note the lack of any `debug_mode === 'TPA'` check, any `fieldsPresent.includes('tpaSpeedEst')`
call, or any branching on firmware version. The predicate is source-agnostic.

### The four states

- **`available`** — module can run, all required inputs present and active.
- **`partial`** — module can run but with reduced functionality (e.g. PIDFS
  decomp without `axisS[axis]` falls back to PIDF without S).
- **`inactive`** — required field is logged but always zero. The feature is
  disabled in the firmware, not missing from the log. Module can still run
  on the field but the output will be uninteresting.
- **`blocked`** — module cannot run. Show the user *why* via `reason`.

The distinction between `inactive` and `partial` is load-bearing for the user:
"S gain is disabled in your firmware" (inactive) is materially different
advice from "the S field isn't logged in this firmware version" (partial).
Don't collapse them.

### Fifth registry-level state: `out_of_range`

Signal sources in `signalRegistry.ts` may declare an `expected_range`.
At resolve time, the registry checks the parser's per-field
`value_min`/`value_max` from `SampleCheck` against that range; values
outside the range produce a fifth registry-level state:

- **`out_of_range`** — field is present and non-zero, but the sampled
  values fall outside the declared `expected_range` for this source.
  Catches firmware-version mismatches (a channel layout shifted upstream),
  unit-scale bugs (the BF wing TPA `×1000` regression caught at M1.7.2),
  or a mis-mapped signal-def entry.

Predicates that consume the registry collapse `out_of_range` to a
`blocked` capability with a firmware-version reason; the readiness card
surfaces the observed-vs-expected pair so the user can tell a true
firmware mismatch from a config bug.

The walker promotes the most-informative state when sources conflict:
`out_of_range > inactive > missing`. Don't collapse this either —
"resolved but suspiciously valued" is a different conversation with
the user than "not logged at all."

### Three-state field handling (single-source signals only)

For signals with a **single source** (e.g. main-frame `axisS[0..2]`, where
the registry has no debug-mode fallback to walk to), a predicate checks the
field directly via three presence states:

```ts
type FieldPresence = 'missing' | 'zero' | 'active';

function presenceOf(
  fieldName: string,
  capability: ParserCapabilityReport, // the Layer 1 output, not the ModuleReport
): FieldPresence {
  if (!capability.fieldsPresent.includes(fieldName)) return 'missing';
  if (capability.sampleChecks[fieldName]?.allZero) return 'zero';
  return 'active';
}
```

Mapping to capability state for a required field:

- `missing` → `partial` (or `blocked` if the field is hard-required)
- `zero`    → `inactive`
- `active`  → `available`

Never collapse these three into a boolean. The user-facing distinction is the
whole point.

For **multi-source signals** (anything with both a main-frame name and a debug
channel — i.e. all the wing-tuning signals), use `resolveSignal()` instead.
The registry's `state` field already encodes the three presence cases:
`resolved` → `available`, `inactive` → `inactive`, `missing` → `blocked`/`partial`.

### UI rendering — readiness report

The M1.6 readiness report maps capability states to icons, with the resolved
source (`via`) appearing as a parenthetical suffix:

| State        | Icon | Color   | Example row |
|--------------|------|---------|-------------|
| `available`  | ✓    | green   | `✓ Airspeed auto-tune (via main-frame fields)` |
| `partial`    | ⚠    | amber   | `⚠ SPA effectiveness: pitch (only spa[1] resolvable)` |
| `inactive`   | ⚠    | gray    | `⚠ PIDFS decomp: yaw (axisS[2] always 0 — S gain disabled)` |
| `blocked`    | ✗    | red     | `✗ TPA curve fit (need TPA signals — none resolved)` |

Same icon (`⚠`) for `partial` and `inactive` is intentional — both warn the
user but for different reasons, distinguished by color and by `reason` text.
The `via` suffix is purely informational; it lets a tuner see at a glance
whether they're on the post-PR fast path or still in debug-mode territory,
without changing what's runnable.

## Layer 2: Confidence scoring

**Question answered:** "Given the module ran, how trustworthy is *this
specific output* for paste-to-FC use?"

Confidence is the output's self-assessment of trustworthiness based on the
data adequacy of the specific flight. A capable module on a runnable log can
still produce a low-confidence result — M3 airspeed auto-tune is *capable*
when `debug_mode = TPA` and GPS is present, but produces low-*confidence*
output if the flight didn't cover enough airspeed range to constrain the fit.

### Return shape

Every module that emits a CLI recommendation MUST return this shape:

```ts
// src/lib/confidence.ts
export type ConfidenceLevel = 'green' | 'yellow' | 'red';

export type ConfidenceResult<T> = {
  recommendation: T;            // module-specific result (CLI lines, fit params, etc.)
  confidence: ConfidenceLevel;
  criteria_met: string[];       // human-readable; rendered in UI
  criteria_failed: string[];    // human-readable; rendered in UI
};
```

The snake_case field names match the roadmap contract — don't camelCase them
even though TS convention would normally suggest it. Consistency with the
manifest + roadmap matters more than convention here.

### The three levels

- **`green`** — paste-ready. Every confidence criterion passed.
- **`yellow`** — verify before pasting. Some criteria failed; the output is
  plausibly correct but the data didn't fully validate it.
- **`red`** — analysis-only. Output is shown for inspection but is not
  paste-ready. UI removes the copy-CLI affordance.

A module never returns `green` if *any* criterion failed. There is no
"mostly green." Use `yellow` for partial criteria coverage. The discreteness
is the point.

### UI rendering — module output

- `green`: green badge, "Paste-ready" label, copy-to-clipboard button enabled
- `yellow`: amber badge, "Verify before applying" label, copy enabled with an
  explicit confirmation step
- `red`: red badge, "Analysis only — do not paste" label, **copy button
  removed entirely** (not just disabled)

The removed-on-red copy button is a load-bearing UX gate. A pilot in a hurry
will not read the badge color; they will see and tap the copy button.
"Disabled but visible" gets tapped anyway. On `red`, the button is gone.

## Per-module criteria

Each module that emits recommendations declares its own criteria list. The
criteria are evaluated against the loaded log; pass/fail strings populate
`criteria_met` and `criteria_failed`. Aggregation rule below.

### M3 — airspeed estimation auto-tuner

Confidence criteria from the roadmap:

- **Speed range coverage** — span of airspeeds actually flown
- **Throttle transition density** — enough throttle changes to constrain the fit
- **Dive/climb presence** — vertical maneuvers exercise the model
- **GPS quality** — 3D fix, low HDOP, sufficient satellite count
- **Opposite-direction-pass detection** — catches wind contamination
- **Samples-per-region** — no bin too sparse
- **Voltage sag during calibration window** — large `vbatLatest` droop
  confounds throttle→thrust mapping and downgrades the fit

### M5 — TPA curve fitter

Same green/yellow/red framework as M3; specific criteria land with M5.
Expected candidates: oscillation-onset detection quality, per-bin
population, fit residual size, overlap with calibrated airspeed range from
M3 output.

### M6 — SPA effectiveness analyzer

If M6 emits CLI recommendations (vs visual-only output), criteria land with
M6. Likely candidates: SPA gate-region coverage, I-term wind-up event count,
setpoint-rate range exercised.

### Modules that don't emit recommendations

Most M-series analytics ship "panel only" — they render information,
don't tell the user what to do. They still need capability predicates so
the readiness report can place them; they don't need confidence scoring
in the sense of `green/yellow/red` because there's no CLI to gate.

### Recommenders that exist but never emit CLI: `cli: []` is the signal

A subset of `src/lib/recommenders/*.ts` exist NOT to emit paste-ready
CLI, but to surface their analysis through the same Recommend tab as the
CLI emitters — with diagnostic text + `criteria_met`/`criteria_failed`
rows, but `cli: []`. Current diagnostic-only recommenders (7 today):

```
pidfsShares, coupling, ffEffectiveness, inputChain,
servoAsymmetry, spa, spectrumFilter
```

vs. real CLI emitters (3 today):

```
debugMode, airspeedBasic, tpaCurve
```

`cli: []` is the **canonical diagnostic-only signal**. `RecommendCard.vue`
gates the copy block on `rec.cli.length > 0` (combined with the red-removes
rule from `wingtune-recommender` I1); an empty array IS the "render the
analysis, no copy button" UI state. Don't introduce a separate flag or
shape for diagnostic-only — emit `cli: []` and trust the gate.

When to make a recommender diagnostic-only:

- The diagnosis has **no firmware fix** (coupling is mixer/CG/mechanical;
  asymmetric servos are bench-side; trim error is structural). No
  `set foo = X` would help, so emit none.
- The fix is a **judgment call** that the panel + criteria let the user
  reason through, but the tool shouldn't auto-prescribe (filter-delay
  reduction — *which stage* to trim is a judgment).
- The thresholds are **first-guess, calibration-pending** (see below) —
  a CLI emission would over-promise on what's actually a hedged read.
  Once calibrated, the recommender can graduate to CLI emission.

The `cli: []` convention means a recommender can be promoted to CLI
emission later (add the `set ...` strings, downgrade confidence rules
to `red` removes copy) without a new shape or a UI rewrite.

## Calibration debt as an honest confidence signal

A real chunk of the suite carries `TODO calibrate` first-guess constants
(9 lib files at last audit: coupling, pilotStyle, servoHunt,
transferFunction, lowFreqModes, maneuverDetect, trimDiagnostics,
airspeedSpectrogram, tuneProfile). These constants drive panel coloring
+ recommender severity but haven't been validated against corpus logs
flown with the relevant input.

This is **not a code smell** — it's an honest hedge backed by a real
mitigation plan (`docs/wingtune-calibration-flights.md` lists the
purpose-built sorties that turn each guess into a measured number).
The pairing is what makes it honest:

- The constant lives next to its `TODO calibrate` marker in code.
- The recommender / panel emits with the constant in effect.
- Diagnostic-only emission (`cli: []`) keeps the blast radius bounded
  to "panel coloring + trust erosion if wrong," not "bad CLI to a
  flight controller."
- The calibration-flights doc names the sortie that unblocks the
  constant; once flown, the threshold pass replaces the guess.

The rule: every `TODO calibrate` constant should have a corresponding
row in `wingtune-calibration-flights.md`. If a new threshold can't
point at a calibration plan, either find one or hold the threshold at
diagnostic-only severity. Don't ship calibration-pending thresholds in
a CLI-emitting recommender without the diagnostic-only gate.

### Aggregation rule

Within a module:

- **All** criteria pass → `green`
- **One or more "critical" criteria fail**, OR **more than half of
  "supporting" criteria fail** → `red`
- Otherwise → `yellow`

Each criterion is classified as **critical** (failure → red) or
**supporting** (failure contributes to yellow but doesn't force red).
Classification is per-module and per-criterion. Document the classification
inline alongside the criterion definition. Never ship a module without
classifying every criterion.

## The two layers together

Capability and confidence compose:

```
Log loaded
   ↓
Capability predicate runs
   ↓
   ├─ blocked     → module never runs; readiness report shows ✗
   ├─ inactive    → module runs but result is uninteresting; readiness ⚠ gray
   ├─ partial     → module runs in reduced mode; readiness ⚠ amber
   └─ available   → module runs in full mode
                      ↓
                      Confidence score on the output
                      ↓
                      ├─ green   → paste-ready (copy enabled)
                      ├─ yellow  → verify (copy enabled w/ confirm)
                      └─ red     → analysis only (copy removed)
```

Any module emitting CLI always provides both signals. The readiness report
shows capability; the per-module output panel shows confidence.

## What Claude Code might want to do but should not

- **"Check `debug_mode === 'TPA'` or `capability.fieldsPresent.includes('tpaSpeedEst')`
  directly inside a predicate."** No. The signal registry exists to hide source
  choices from predicates. Writing the source name in the predicate means the
  firmware companion PR landing silently breaks your module, and the corpus
  regression's "this log should resolve via main-frame" check has no way to
  catch the bug because the predicate isn't using the resolver.
- **"Add a new wing-tuning signal by patching the predicate to handle a new
  debug mode."** No. New wing-tuning signals get a `SignalDef` entry in
  `src/lib/signalRegistry.ts` listing their main-frame and debug-mode sources
  in preference order. Predicate code does not change.
- **"Use a single 0–100 score instead of green/yellow/red."** No. The
  three-level discretization is deliberate. Continuous scores invite
  threshold debates and "59% is basically green" reasoning. Discrete levels
  force the author to pick.
- **"Boolean `canRun` instead of a four-state capability."** No. Collapsing
  `partial`/`inactive`/`available` into a boolean loses the user-facing
  distinction between "field is missing" and "field is disabled," which is
  exactly the distinction a tuner needs.
- **"Drop the `via` field on `Capability` — it's just decoration."** No. The
  `via` suffix is what tells a user whether the firmware companion PR has
  reached them yet. It's also load-bearing for the corpus regression's
  cross-check that the resolver picked the expected source path.
- **"Skip the predicate and just let the module throw if it can't run."**
  No. The readiness report needs the predicate to tell the user *before*
  they try. Same predicate is used by the corpus regression — moving the
  check into the module body removes the test-time coverage.
- **"Show the CLI copy button on red but disabled, so users know it exists."**
  No. Disabled-but-visible buttons get tapped. On `red`, the button is
  removed, not disabled.
- **"Compute confidence inline in the analysis function."** Acceptable if
  the function returns the right shape, but prefer extracting criterion
  evaluation into a `criteria.ts` alongside the module. Easier to unit-test,
  easier to share between live runs and corpus regression.
- **"This new module just emits a single number; we don't need confidence
  scoring."** If the number is shown to the user and could be acted on,
  yes you do. If it's purely an intermediate value for another module, the
  consuming module is the one that emits the confidence-scored result.
- **"Compute confidence after rendering, in a separate panel."** No.
  Confidence is part of the result. A module's `ConfidenceResult<T>` is
  what's rendered; rendering must not happen with the recommendation but
  without the score.

## Quick self-check before committing

- [ ] Does every new analysis module export a capability predicate from
      `src/lib/capabilityPredicates.ts`?
- [ ] For wing-tuning signals (anything with a main-frame and debug-mode
      source), does the predicate route through `resolveSignal()` rather
      than naming a `debug_mode` string or main-frame field directly?
- [ ] For new signal sources with bounded values: is `expected_range`
      declared so the registry can promote `out_of_range` for misconfigured
      logs?
- [ ] For multi-source signals: does the returned `Capability` carry a `via`
      field reflecting which source resolved (`main_frame`, `debug`, or
      `mixed` when sub-signals resolved differently)?
- [ ] Does every recommender that emits CLI return `ConfidenceResult<T>`
      with the snake_case fields?
- [ ] For a new diagnostic-only recommender: does it emit `cli: []`
      (the canonical signal) rather than introducing a separate flag?
- [ ] Are all single-source field checks using the three-state presence
      helper, not a boolean?
- [ ] Are critical-vs-supporting criteria documented for every confidence
      criterion in the module?
- [ ] Does the readiness report render the four capability states with the
      correct icons (✓ ⚠ ⚠ ✗), with the informational `(via …)` suffix,
      and surface the registry's `out_of_range` observed-vs-expected pair?
- [ ] On `red` confidence, is the copy-CLI affordance removed (not just
      disabled)?
- [ ] Does every new `TODO calibrate` constant point at a row in
      `docs/wingtune-calibration-flights.md`? If not, is the recommender
      that consumes it gated to `cli: []` until calibration lands?
- [ ] For a style-sensitive threshold: does it read from `thresholdsFor(...)`
      with `sport === today` rather than a file-scope constant? (Cross-ref
      `wingtune-recommender` I9.)
- [ ] Is the predicate exercised in the validate-parser corpus regression,
      including the `via` cross-check (the manifest's `signals_resolved:
      { id: { via: ... } }` must match what the resolver picks at runtime)?

If any answer is "no" without a `// CONFIDENCE-EXCEPTION:` comment explaining
why, the module isn't ready to ship. The CLI-without-confidence-scoring rule
(line four of the self-check) admits no exceptions — implementation-detail
exceptions are fine, but a recommender that emits CLI without a confidence
score does not merge.
