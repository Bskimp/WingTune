# Wing fields blackbox promotion — patch notes

Target: **Bskimp/betaflight** `master` (just synced from upstream).
Release target: **Betaflight 2026.6**.
Patch file: `wing-fields-firmware.patch` (same directory).

## VERIFY answers resolved against master

| Question | Answer |
|---|---|
| Is `DEBUG_WING_SETPOINT` still the name in master? | **Yes.** `pid.c:399-400` uses `DEBUG_SET(DEBUG_WING_SETPOINT, 2*axis, ...)` / `2*axis+1, ...`. |
| What does `DEBUG_SET(DEBUG_TPA, 0, ...)` assign? | **`lrintf(tpaFactor * 1000)`** — assigned in `pidUpdateTpaFactor()` at `pid.c:449`, *after* the curve resolves. Channel 5 of `DEBUG_TPA` is `tpaArgument * 1000.0f` (`pid.c:360`). Channel 4 is `pidRuntime.tpaSpeed.speed * 10.0f` (`pid.c:359`). |
| Is `pidRuntime.tpaSpeed.speed` populated every PID loop unconditionally inside `USE_WING`? | **Only when `isFixedWing()` is true.** `calcWingTpaArgument()` is invoked from `pidUpdateTpaFactor()` via the ternary `isFixedWing() ? calcWingTpaArgument() : throttle` (`pid.c:431`). For non-fixed-wing builds with `USE_WING` defined, `tpaSpeed.speed` is *not* advanced. Patch logs whatever value sits there — `0.0f` if unused. Acceptable: this matches the existing `DEBUG_TPA` channel 4 behavior. |
| Is `pidRuntime.spa[]` populated every PID loop? | **Yes, unconditionally inside `USE_WING`.** `calculateSpaValues()` writes `pidRuntime.spa[axis]` for all 3 axes every call (`pid.c:978-983`), driven from the main `pidController` loop. No further ifdef. |
| Is `adjustedSetpoint` already a `pidRuntime` member? | **No.** It is a local in `wingAdjustSetpoint()` (`pid.c:391`). Patch adds `pidRuntime.adjustedSetpoint[XYZ_AXIS_COUNT]` shadow. |
| Is pre-TPA `sTerm` available via `pidRuntime`? | **No.** Local in `getSterm()` (`pid.c:959`). Patch adds `pidRuntime.sTermPreTpa[XYZ_AXIS_COUNT]` shadow, written right before the `getTpaFactor()` multiply. |
| Is `tpaArgument` exposed? | **No.** Local in `calcWingTpaArgument()` (`pid.c:357`). Patch adds `pidRuntime.tpaArgumentLogged` shadow. |
| `axisS` precedent — same pattern as proposed? | **Yes, exactly.** See "axisS template" below. |

## axisS template captured from master (verbatim, with line refs)

- `blackbox_fielddefs.h:56-60` — enum block inside `#ifdef USE_WING`:
  ```
  FLIGHT_LOG_FIELD_CONDITION_NONZERO_WING_S_0,
  FLIGHT_LOG_FIELD_CONDITION_NONZERO_WING_S_1,
  FLIGHT_LOG_FIELD_CONDITION_NONZERO_WING_S_2,
  ```
- `blackbox.c:366` — struct member in `blackboxMainState_t`:
  ```
  int32_t axisPID_S[XYZ_AXIS_COUNT];
  ```
  (no `#ifdef USE_WING` around it — left bare for offsetof compatibility.)
- `blackbox.c:213-217` — fields table:
  ```
  #ifdef USE_WING
      {"axisS", 0, SIGNED, .Ipredict = PREDICT(0), .Iencode = ENCODING(SIGNED_VB),
       .Ppredict = PREDICT(PREVIOUS), .Pencode = ENCODING(SIGNED_VB), CONDITION(NONZERO_WING_S_0)},
      ... (1 and 2 follow)
  #endif
  ```
- `blackbox.c:529-534` — testBlackboxCondition switch case:
  ```
  #ifdef USE_WING
  case CONDITION(NONZERO_WING_S_0):
  case CONDITION(NONZERO_WING_S_1):
  case CONDITION(NONZERO_WING_S_2):
      return (currentPidProfile->pid[condition - CONDITION(NONZERO_WING_S_0)].S != 0)
              && isFieldEnabled(FIELD_SELECT(PID));
  #endif
  ```
- `blackbox.c:680-686` — writeIntraframe emission (inside `if (testBlackboxCondition(CONDITION(PID)))`):
  ```
  #ifdef USE_WING
      for (int x = 0; x < XYZ_AXIS_COUNT; x++) {
          if (testBlackboxCondition(CONDITION(NONZERO_WING_S_0) + x)) {
              blackboxWriteSignedVB(blackboxCurrent->axisPID_S[x]);
          }
      }
  #endif
  ```
- `blackbox.c:865-871` — writeInterframe (delta) emission, same shape but `[x] - blackboxLast->[x]`.
- `blackbox.c:1260-1262` — loadMainState populate, inside `for (i ... XYZ_AXIS_COUNT)`:
  ```
  #ifdef USE_WING
      blackboxCurrent->axisPID_S[i] = lrintf(pidData[i].S);
  #endif
  ```

Note: the proposed `axisS` precedent says "wing-only build, always meaningful" — but in source, **per-axis conditions are gated by `pid[axis].S != 0`**, not unconditional. The patch keeps that idiom for `axisSpreTpa` (reuses `NONZERO_WING_S_n`) and adds parallel `NONZERO_SPA_n` for the `spa[]` array (gated by `spa_mode[axis] != SPA_MODE_OFF`).

`tpaSpeedEst` and `tpaArg` are single scalars (axis = -1 in the field table) — gated `CONDITION(ALWAYS)` because they're meaningful for every fixed-wing log line. They occupy 0 bytes in non-`USE_WING` builds because the entire block is `#ifdef USE_WING` in `blackboxMainFields[]`.

## Per-file change summary

### `src/main/blackbox/blackbox_fielddefs.h` (1 hunk, +6)
Add `FLIGHT_LOG_FIELD_CONDITION_NONZERO_SPA_0/1/2` immediately after the existing `NONZERO_WING_S_*` block, inside the same `#ifdef USE_WING`.

### `src/main/blackbox/blackbox.c` (6 hunks)
1. **`blackboxMainFields[]`** — add 5 wing rows inside the existing `#ifdef USE_WING` block: 3× `axisSpreTpa`, 3× `spa`, plus `tpaSpeedEst` and `tpaArg` (axis = -1). Also adds 3× `setpointAdj` rows inside a new `#ifdef USE_WING` immediately after the existing `setpoint` rows, gated by `CONDITION(SETPOINT)` (so they vanish when the user has disabled setpoint logging).
2. **`blackboxMainState_t`** — add a `#ifdef USE_WING` block with `axisS_preTpa[3]`, `spa[3]`, `setpointAdj[3]`, `tpaSpeedEst`, `tpaArg` (all `int32_t`).
3. **`testBlackboxCondition`** — add `NONZERO_SPA_0/1/2` cases inside the existing `#ifdef USE_WING` switch block, gated by `spa_mode[axis] != SPA_MODE_OFF`.
4. **`writeIntraframe`** — append three new loops inside the existing `#ifdef USE_WING` block (already present after `axisPID_S`): emit `axisS_preTpa`, `spa`, plus two unconditional `blackboxWriteSignedVB` calls for `tpaSpeedEst` and `tpaArg`. Also emits 3× `setpointAdj` inside the existing `if (testBlackboxCondition(CONDITION(SETPOINT)))` block.
5. **`writeInterframe`** — same shape as intraframe but emits deltas (`current - last`).
6. **`loadMainState`** — populate the new struct members from `pidRuntime` shadows. `tpaSpeedEst`/`tpaArg` are populated *outside* the per-axis loop.

### `src/main/flight/pid.h` (1 hunk, +10)
Inside the existing `#ifdef USE_WING` block in `pidRuntime_t`, add:
- `float adjustedSetpoint[XYZ_AXIS_COUNT];`
- `float sTermPreTpa[XYZ_AXIS_COUNT];`
- `float tpaArgumentLogged;`

(Reuses existing `pidRuntime.spa[]` and `pidRuntime.tpaSpeed.speed` directly — no shadow needed for those.)

### `src/main/flight/pid.c` (3 small hunks)
- `calcWingTpaArgument()`: store `tpaArgument` into `pidRuntime.tpaArgumentLogged` right before `return`.
- `wingAdjustSetpoint()`: store local `adjustedSetpoint` into `pidRuntime.adjustedSetpoint[axis]` right before `return`. Inside the existing `#ifdef USE_WING` arm only.
- `getSterm()`: capture `sTerm` into `pidRuntime.sTermPreTpa[axis]` between `DEBUG_SET(...,2*axis,...)` and the `*= getTpaFactor(...)` multiply — i.e. exactly when the existing debug-channel-even captures it.

## Before-applying checklist

1. **Sync confirmed.** `git fetch upstream && git merge upstream/master` against Bskimp's master.
2. **Line numbers will drift.** The patch is hand-aligned to current `master` (SHA `e92c108873a876922ff8e07ef19b98a02d5a4ddb`, file SHAs `c6f977a` for fielddefs.h and `f18c28c` for pid.h captured at fetch time). Apply with:
   ```
   git apply --reject --whitespace=fix wing-fields-firmware.patch
   ```
   then resolve any `.rej` files manually.
3. **One hunk fence to watch.** The `loadMainState` hunk closes the `for (i...)` loop *before* adding `tpaSpeedEst`/`tpaArg` writes. The current code's loop closing brace is at `blackbox.c:1272`. If upstream churned this loop body, re-stitch carefully — the two scalar populates **must** sit between the loop's closing brace and the start of the `USE_ACC` quaternion block (`blackbox.c:1273`).
4. **No `blackbox_encoding.c` changes.** Patch reuses `SIGNED_VB`. Verify nothing else changes there.
5. **No CLI/MSP changes.** `master.c`, `cli/settings.c`, `msp/msp.c` untouched. The user does not opt these fields in or out — they're driven by `USE_WING` and the existing `FIELD_SELECT(PID)` / `FIELD_SELECT(SETPOINT)` masks.
6. **Build matrix to verify locally** (`make TARGET=STM32H743 USE_WING=yes` and one non-wing target):
   - `USE_WING=yes`: confirm the 11 new fields appear in `make unittest`-generated log header.
   - `USE_WING=no`: confirm `blackboxMainState_t` size unchanged (the new members are inside `#ifdef USE_WING`), no compile warnings.
7. **`pidRuntime` size growth (`USE_WING` build only):** +28 bytes (`adjustedSetpoint[3] + sTermPreTpa[3] + tpaArgumentLogged = 7 floats`).
8. **Downstream WingTune analyzer** must learn the new field names (`tpaSpeedEst`, `tpaArg`, `axisSpreTpa[0..2]`, `spa[0..2]`, `setpointAdj[0..2]`). Header parser only — no decoding changes.

## Known-flagged scope deviations

- **`tpaSpeedEst` / `tpaArg` are only meaningful for `isFixedWing()` builds.** Despite this they are gated `CONDITION(ALWAYS)` inside `#ifdef USE_WING`. For non-wing `USE_WING` builds (e.g. mixed-mode targets where `USE_WING` is compiled but `isFixedWing()` returns false at runtime), these will log zero. This matches the existing `DEBUG_TPA` channel behavior — flagged for reviewer attention. Alternative: add an `IS_FIXED_WING` runtime condition, but that complicates the field-header transmission state machine.
- **`spa[]` gated by `spa_mode != SPA_MODE_OFF`.** This means logs from pilots who haven't enabled SPA will not emit `spa` columns. Matches behavior of `axisS` (gated by `S != 0`). Reviewer may prefer `CONDITION(ALWAYS)` for consistency — switch the condition to ALWAYS and drop the new `NONZERO_SPA_*` enums if so.
- **`setpointAdj` reuses `CONDITION(SETPOINT)`.** If a pilot has setpoint logging disabled, they also lose `setpointAdj`. This is desirable: the two are useless apart.

## Commit message + PR description draft

```
blackbox: log wing-tuning signals as first-class main-frame fields

Promotes the wing-specific tuning signals (TPA airspeed estimate, TPA
argument, pre-TPA sTerm, SPA attenuation, post-SPA adjusted setpoint)
out of DEBUG_TPA / DEBUG_S_TERM / DEBUG_WING_SETPOINT debug modes into
gated main-frame blackbox fields, mirroring the existing axisS pattern.

New fields (all USE_WING-gated):
  tpaSpeedEst       pidRuntime.tpaSpeed.speed * 10  (m/s, ALWAYS)
  tpaArg            tpaArgument * 1000              (0..1000, ALWAYS)
  axisSpreTpa[0..2] pre-TPA sTerm                   (NONZERO_WING_S_n)
  spa[0..2]         pidRuntime.spa[] * 1000         (NONZERO_SPA_n)
  setpointAdj[0..2] post-SPA adjusted setpoint      (SETPOINT)

Numeric scalings exactly match the existing debug channels they replace,
so downstream log-analyzer code paths can be reused without re-tuning.

This eliminates the requirement to fly with a specific debug_mode set
in order to capture wing-tuning logs. Three pidRuntime shadow members
(adjustedSetpoint[3], sTermPreTpa[3], tpaArgumentLogged) expose
previously-local values to loadMainState() — +28 bytes RAM in USE_WING
builds, zero impact otherwise.

No CLI, MSP, or blackbox encoding changes. Reuses SIGNED_VB throughout.

Companion to the WingTune log analyzer.
```

**PR title:** `blackbox: log wing-tuning signals as first-class main-frame fields`

**PR labels:** `wing`, `blackbox`, `enhancement`
