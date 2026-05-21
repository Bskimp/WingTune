# TPA HYPERBOLIC curve — firmware reference for WingTune M5

Source of truth: BF PR [#13805](https://github.com/betaflight/betaflight/pull/13805)
(merged), design discussion [#13786](https://github.com/betaflight/betaflight/discussions/13786).
Formula extracted from `src/main/flight/pid_init.c` (function
`tpaCurveHyperbolicFunction`, patch 01/15) — same function survived the
later `USE_WING` → `USE_ADVANCED_TPA` rename.

## 1. The formula

Given input `x` (the TPA argument — for wings this is the BASIC airspeed
estimate normalised to `[0,1]`, not raw throttle), the firmware returns
a PID multiplier `tpaFactor`:

```
thrStall   = tpa_curve_stall_throttle / 100        // in [0, 1]
pidThr0    = tpa_curve_pid_thr0  / 100             // multiplier at x = thrStall
pidThr100  = tpa_curve_pid_thr100 / 100            // multiplier at x = 1.0
expo       = -1 / (-tpa_curve_expo/100 + 0.999)    // curvature linearization

if x <= thrStall:
    return pidThr0                                 // flat plateau below stall
else:
    xShifted = (x - thrStall) / (1 - thrStall)     // remap (thrStall,1] -> (0,1]
    base     = 1 + (pow(pidThr0/pidThr100, 1/expo) - 1) * xShifted
    divisor  = pow(base, expo)
    return pidThr0 / divisor
```

`tpaFactor` multiplies **D always, P in `tpa_mode = PD`/`PDS`, and the
wing S-term in `PDS`** — it never scales I, and never scales feedforward
(F). Output > 1 boosts gains, < 1 cuts them. (Verified 2026-05-21 against
`pid.c::getTpaFactor` / `isTpaActive` — an earlier revision of this doc
wrongly listed I and F.) End-points are exact by construction:
`f(thrStall) = pidThr0`, `f(1) = pidThr100`.

Firmware uses `pow_approx` in the hot path and precomputes a 16-segment
PWL lookup (`TPA_CURVE_PWL_SIZE = 16`) on `[0,1]` at init time
(`tpaCurveHyperbolicInit`). For an offline fit just use `Math.pow`.

`expo` mapping: user param `tpa_curve_expo ∈ [-100, 100]`;
`expo = 0` → `≈ -1.001`, `expo = 99` → `≈ -100`, `expo = -100` → `≈ -0.498`.
The linearization makes the slider behave roughly linearly; positive bends
the curve down (more aggressive PID drop with speed), negative bends it
up. Author recommends most users leave it at default.

## 2. CLI parameters

All live on the PID profile. Black-box header keys are identical to CLI
names (`blackbox.c` patch).

| CLI name (PARAM_NAME)         | Type   | Min  | Max  | Units / meaning                                  |
|-------------------------------|--------|------|------|--------------------------------------------------|
| `tpa_curve_type`              | enum   | 0    | 1    | 0 = `CLASSIC`, 1 = `HYPERBOLIC` (wing-only)      |
| `tpa_curve_stall_throttle`    | u8     | 0    | 100  | `thrStall × 100` (percent of TPA-arg range)      |
| `tpa_curve_pid_thr0`          | u16    | 0    | 1000 | `pidThr0 × 100` (PID multiplier at stall, %)     |
| `tpa_curve_pid_thr100`        | u16    | 0    | 1000 | `pidThr100 × 100` (multiplier at full speed, %)  |
| `tpa_curve_expo`              | i8     | -100 | 100  | curvature (see `expo` mapping above)             |

Constants: `TPA_CURVE_STALL_THROTTLE_MAX = 100`, `TPA_CURVE_PID_MAX = 1000`,
`TPA_CURVE_EXPO_MIN/MAX = ±100` (`pid.h`, patch 01).

Note the header-name vs internal-name churn across patches — the patch
01 header line uses field `tpa_rate_stall_throttle` but later patches
rename the C field to `tpa_curve_stall_throttle` while keeping the CLI
key `tpa_curve_stall_throttle`. The CLI name is stable and is what
WingTune should emit.

Reference test vectors (from `pidControllerTest::testTpaHyperbolic`,
patch 14/15): for some param set, `f(0.5) ≈ 2.565` and `f(0.9) ≈ 0.693`
(check tracks the formula above to within ±0.01).

## 3. Fit inputs

- **Curve input** = `tpa_arg` from DEBUG_TPA. Per WingTune's existing
  BF 2026.6 YAML, `debug_mode = TPA` is integer ID **90**; the BASIC
  estimator's normalised airspeed feeds the curve as `x`. WingTune
  already exposes `tpa_arg` via the signal registry — re-use that path,
  do not re-derive from raw throttle.
- **Curve output** = `tpaFactor` (also a DEBUG_TPA channel, per the
  existing wing-support YAML). Together `(tpa_arg, tpaFactor)` samples
  ARE the curve — the fit is a direct nonlinear regression of the
  formula in §1 against this scatter.
- **Oscillation-onset detector inputs** = `gyroADC[axis]` (or filtered
  gyro if raw absent) vs `setpoint[axis]` on R/P axes, gated by
  airspeed bin. Look for high-frequency error growth in the top
  airspeed quartile.

Cross-check signal: if `gpsTimeSec` + GPS-3D speed are present, sanity-
check `tpa_arg` tracks GPS-derived airspeed (already done by M3).

## 4. tpa_arg ↔ tpaFactor relationship

`tpa_arg ∈ [0,1]` is the curve INPUT (firmware's normalised wing-speed
proxy, computed by `getWingTpaArgument(throttle)` from the BASIC
estimator). `tpaFactor` is the curve OUTPUT applied multiplicatively
to PID gains. The fit minimises Σ(predict(arg_i) − factor_i)² over
samples where the BASIC estimator is converged.

## 5. Tuning heuristics (from discussion #13786)

- **Mushy / sluggish at low speed** (small `x`, near `thrStall`):
  raise `tpa_curve_pid_thr0`. Default-ish starting point ≈ 2.0–2.5
  (i.e. `set tpa_curve_pid_thr0 = 200`–`250`).
- **Oscillates / HF buzz at high speed** (large `x`, near 1.0):
  lower `tpa_curve_pid_thr100`. Author's suggested defaults centre
  around `pidThr100 ≈ 0.5` (`= 50`).
- **Stall threshold**: `tpa_curve_stall_throttle` should sit just
  below the slowest sustained-cruise `tpa_arg` observed in the log.
  Author's spitballed default `stall_speed = 20%`.
- **Curvature**: leave `tpa_curve_expo = 0` unless the residual after a
  two-endpoint fit shows systematic bow. Discussion thread notes this
  is a fine-tuning knob; positive bends down, negative bends up.
- **Hard cap**: below `thrStall` the firmware clamps to a constant
  (the formula's flat plateau) — don't try to fit data points below
  stall, they are not curve-shaped.

## 6. Confidence / coverage

The discussion does not specify hard windows, but for a defensible fit:

- Need `tpa_arg` coverage spanning ≥60 % of `[thrStall, 1.0]`. Logs
  that hover at one throttle band cannot pin both endpoints.
- Need ≥ ~5 s aggregate dwell in each of: a low-speed band
  (`x` just above `thrStall`), mid, and high (`x` near 1.0). This
  matches M3's coverage gate philosophy.
- Need the BASIC estimator converged (use M3's `R²` ≥ 0.7 as a
  precondition — if BASIC airspeed isn't trustworthy, neither is
  `tpa_arg`).
- Two-endpoint fit (`pidThr0`, `pidThr100`) is green when ≥ both bands
  covered AND residual RMS < 0.15. `tpa_curve_expo` recommendation
  promotes from informational to CLI only when residuals show
  systematic bow (≥0.05 RMS improvement vs `expo = 0`).
- `tpa_curve_stall_throttle` recommendation is green only when the
  log contains a clear minimum `tpa_arg` plateau (≥2 s dwell at
  constant low value).

## 7. PR vs discussion: any contradictions?

None of substance. The discussion explores several candidate curve
families (`x^(-c)`, `1/log(x+1)`, etc.); the PR ships the
`1/log`-derived "intimidating but precomputable" form quoted in §1.
Discussion's `stall_speed = 20% / pids_max = 3 / pids_min = 0.5 /
curvature = 5%` mock-up maps directly to the four shipped CLI params
(`stall_throttle=20`, `pid_thr0=300`, `pid_thr100=50`, `expo=5`).
