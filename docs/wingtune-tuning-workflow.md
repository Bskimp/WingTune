# WingTune end-to-end tuning workflow

From a fresh BF-wing-msp flash to a dialed-in wing, using WingTune as
the analysis layer between flights.

**Read this in order.** The phases build on each other — phase N
assumes phase N-1 was completed and the previous CLI change took
effect. Don't skip phases hoping to tune everything in one go; this
is a "land, drop the log, change one thing, fly again" workflow
because that's the only way to know which change moved the needle.

**Companion docs:**
- `docs/wingtune-tab-guide.md` — what each WingTune panel shows + how
  to read it. Cross-referenced throughout this doc.
- `CLAUDE.md` — project context, scope box (planes-not-quads
  caveats), cardinal rules.

**Conventions used here:**
- `CLI` lines are typed (or pasted) into BF Configurator's CLI tab.
  Always end a session with `save` and let the FC reboot.
- "Drop the log" = drag the BBL onto WingTune's file zone (or use
  "Open file…" on the Tauri desktop build).
- "Multi-log compare" = use the `+` button on the LogRoster strip to
  add a second log; click `auto-align` to put them on a common
  session time axis; then any time-domain panel overlays both.

---

## Phase 0 — Bench setup before the first flight

Goal: get to a known-good static config so the first flight isn't a
crash. No WingTune involvement yet — this is pure BF Configurator work.

1. **Flash `betaflight-wing-msp` firmware** (the WingTune fork that
   logs main-frame `wing*` fields + `gyroUnfilt[]` for raw-gyro
   analysis). Verify the firmware version reads as
   `Betaflight 2026.6.0-alpha` (or whatever your fork build tags as)
   in the Configurator's Setup tab.
2. **Pick a wing preset** in the Mixer tab that matches your airframe
   (single-elevon delta, twin-aileron + elevator, V-tail, etc.). If
   no preset matches, build the mixer manually and double-check the
   servo directions by deflecting each surface in the Servos tab.
3. **Set servo endpoints + sub-trim** with the mechanical hardware:
   surfaces should be physically level at neutral, end-to-end travel
   should match what your radio sends.
4. **ESC / motor direction + calibration** if applicable — this is
   prop wing standard stuff.
5. **Blackbox config:** logging rate 1 kHz, `debug_mode = NONE`
   initially (USE_WING firmware logs the wing main-frame fields
   without needing a debug_mode set). Verify Blackbox is writing to
   your storage (microSD, OnboardFlash, etc.). For step-response
   analysis specifically, also enable "Gyro (Unfiltered)" in the
   Blackbox config — this gives WingTune the raw gyro for Spectrum
   raw/filt overlay.
6. **Enable arming**, verify the failsafe behavior makes sense for
   your hand-launch / runway-launch / catapult workflow.

**Final bench check:** with motor disarmed, watch the surfaces react
to stick inputs. Roll stick → ailerons + elevons deflect the right
way. Pitch stick → elevator / elevons pitch the right way. Yaw stick
→ rudder / split-rudder deflects the right way. **If any direction is
wrong here, fix it before flying** — backwards control = crash.

---

## Phase 1 — First flight: sanity sortie

Goal: confirm the plane flies AT ALL on stock PIDFS defaults +
collect a baseline log.

1. **PID + rates:** keep BF defaults for now. The defaults are
   conservative enough to fly almost any wing without diving.
2. **Hand-launch (or runway / catapult) gentle**. No aggressive
   inputs — you're verifying basic control authority + stability.
3. **Fly 30-60 seconds:** climb to altitude, do gentle banked turns
   both directions, gentle pitch up/down, throttle range from cruise
   to slow.
4. **Land safely.** No need to be brave.
5. **Pull the BBL off the FC + drop it into WingTune.**

**What to check in WingTune:**
- **Summary tab → Readiness** should show ~11/13 modules green. Yaw-
  specific items (PIDFS decomp · yaw, S-term yaw) are expected
  blocked on wings (yaw D isn't usually tuned; yaw axisS isn't
  written by USE_WING). That's wing-physics, not a bug.
- **Servos tab → ServoPanel:** verify every servo channel you wired
  shows a real PWM trace (not flat 1500). Saturation strip should be
  near 0% on a calm sortie.
- **Spectrum tab:** open this — note the filter delay badge color.
  If it's RED (>8 ms total), filter delay is your first tuning lever
  (Phase 2). If GREEN, skip to Phase 3.

**Save the log** somewhere durable (e.g.
`tests/corpus-private/yourwing_phase1.bbl` if you maintain a private
corpus). You'll come back to it for before/after multi-log compares.

---

## Phase 2 — Filter chain trim (if needed)

Goal: get total filter delay under ~10 ms so the closed loop has
headroom for tuning.

**Why this comes first:** filter delay shows up in every other tuning
metric (Step response peak / latency, Tracking RMS, InputChain stage
C lag). Fixing filters before tuning PID prevents you from chasing
your tail trying to compensate for a delay you can just remove.

1. **Open Spectrum tab.** Header badge shows total delay (e.g.
   "53.6 ms" RED).
2. **Open Recommend tab.** A `HIGH` severity, `FILTERS` domain card
   should be there: "Filter chain delay is X ms — consider trimming"
   with the heaviest stage named (typically `rpm filter ×2`).
3. **Apply the suggested CLI.** Most common fix: drop `rpm filter`
   from `×2` to `×1` (or remove if your ESC is well-behaved). Other
   levers: raise the dyn-notch min/max bounds, raise gyro / D-term
   LPF cutoffs if they're set lower than you need.
4. **`save`, reflash if needed, fly another short sortie** (same
   gentle pattern as Phase 1).
5. **Drop the new log → re-check Spectrum delay badge.** Target: <
   10 ms total. <5 ms is excellent.

**Multi-log compare:** drop phase 1 + phase 2 logs together, click
`auto-align`, open Spectrum tab → switch to `both` (raw + filt
overlay). You should see the filter chain now trims less of the
high-frequency content. If you went too far (raw + filt nearly
identical across the whole spectrum), you'll see noise leak through
into the gyro signal — back off the trim.

**Gotchas:**
- Don't trim filters so aggressively that motor / prop noise (sub-
  100 Hz on wings) feeds into D-term and shows up as gyro oscillation.
---

## Phase 3 — PD-isolation calibration sortie

Goal: produce a log where Step response measures TRUE PD-only
behavior — no feedforward, no S-term — so you can tune PD ratio
against a meaningful baseline.

**Why:** WingTune's Step panel measures the FULL closed-loop response
as flown. With F (feedforward) and S (wing maneuver-authority term)
active, the response curve shows the combined system, not just PD.
PIDtoolbox / PIDscope reference workflows assume PD-isolation. To get
comparable numbers + the cleanest PD tune, you have to zero F and S
first.

**CLI to zero feedforward paths (PER AXIS — repeat for all 3):**

```
set feedforward_transition = 100
set p_pitch = <leave as-is>
set i_pitch = <leave as-is>
set d_pitch = <leave as-is>
set f_pitch = 0
set s_pitch = 0
```

Repeat for `_roll` and `_yaw`. Then `save`.

(Note: exact param names depend on your wing-msp build. Check
`status` or the Configurator's PID Profile tab to confirm the wing
F and S gains zero correctly — some builds use `pid_thr0` style
naming for these terms.)

1. **Reflash + arm.**
2. **Fly an aggressive sortie:** snap rolls, sharp pitch reversals,
   sudden direction changes — you want clear step-like setpoint
   inputs that Wiener deconvolution can lock onto. ~30-60 seconds
   of varied inputs. Land before fatigue makes you sloppy.
3. **Drop the log.**

**What to verify in WingTune:**
- **Step tab → caveat ribbon should be GONE** (or only mention low
  F+S magnitudes, not both at non-trivial values). If the ribbon is
  still there with full F/S, the zero-out didn't take — re-check
  CLI + reflash.
- **Read PEAK + LATENCY per axis** from the header. These are your
  baseline PD response metrics.

**Save this log carefully.** It's your PD-isolation reference. Every
PD change you make in Phase 4 gets compared against this log via
multi-log compare.

---

## Phase 4 — PD ratio tuning (with the calibration log in hand)

Goal: iterate P / D values until Step response shows clean
tracking on all three axes. (I is not part of the PD ratio — it's
set separately; this phase is purely the P-to-D relationship.)

**Targets (wing baseline):**
- PEAK 1.10-1.30 → mild controlled overshoot, fast response
- LATENCY 20-40 ms → controller actually doing work
- Tracking RMS error during your aggressive inputs ~50-150 deg/s

**Diagnose from the Step curve:**
- **PEAK > 1.30** (hard overshoot, rings) → P or D too high. Try
  lowering P by ~10% first; if ringing persists, lower D. Re-fly.
- **PEAK < 1.05** AND LATENCY > 40 ms (sluggish) → P too low.
  Raise P by ~10%, re-fly.
- **PEAK = NaN** (response never crosses 0.5 within 400 ms) → very
  under-gained. Bump P significantly (e.g. 30%), re-fly.
- **PEAK fine but Tracking RMS high** → D might be filtering out the
  control input. Lower D-term LPF cutoff or D gain slightly.

**Workflow per change:**
1. Make ONE CLI change at a time. `save`, reflash, fly an aggressive
   sortie (same pattern as Phase 3 for comparability).
2. Drop the new log → multi-log compare with the phase 3 reference.
3. Open Step tab → both curves overlaid. Look for: did PEAK come
   down? Did LATENCY change? Did the curve get cleaner?
4. Open Tracking tab → both gyro/setpoint pairs overlaid for the
   axis you changed. RMS should drop or hold.
5. If improved → keep the change as new baseline. If worse → revert.
6. Repeat. Each axis tuned independently.

**Cardinal rule:** **one variable per flight**. Changing P and D
simultaneously means you can't attribute which change improved or
worsened the response. Discipline pays off.

**Stop when:** all three axes have PEAK in 1.10-1.30, LATENCY
20-40 ms, and Tracking RMS stable across multiple flights with
similar inputs. You're done with PD. Move on.

---

## Phase 5 — Re-enable S, tune wing authority

Goal: bring S-term back, set its gain so wing maneuver-authority
during turns / pulls is responsive but not violent.

**CLI to re-enable S (start at the wing-msp default, NOT max):**

```
set s_roll = <wing-msp default — check fresh-flash value>
set s_pitch = <wing-msp default>
set s_yaw = 0  # yaw S is typically not useful on wings
```

`save`, reflash.

1. **Fly representative flying — NOT pure stress test inputs.**
   Banked turns, climb, descent, holding altitude in light wind.
   The pattern you'd actually fly.
2. **Drop the log.**

**Read S-Term tab per axis (Roll first, Pitch second):**
- **ACTIVE > 30%** → S is firing during typical flying. Good.
- **ACTIVE < 10%** → wing isn't generating enough setpoint authority
  to activate S — either your rates are too soft or you fly too
  smoothly. (Not necessarily a problem; just means S isn't doing
  much for you.)
- **MEAN ATTEN 0% + MIN FACTOR 1.00** → TPA isn't scaling S yet
  (Phase 8 will set that up). Expected at this stage.

**SPA tab:** check for **wind-up events** (yellow markers) or
**bounce-back events** (orange markers). A handful is fine. Dozens
means SPA gain / threshold needs adjustment in Phase 9.

**Diagnose S tuning:**
- **Plane feels mushy in turns** → raise S gain.
- **Plane snaps too aggressively on stick input** → lower S gain.
- **S contribution dominates PID output** (PID contribution panel
  shows S share > 50%) → S is doing too much work, lower it OR
  raise P to share the load.

**Workflow:** same one-variable-per-flight discipline as Phase 4.
Stop when wing flies responsively without snapping.

---

## Phase 6 — Re-enable F, tune snap-input response

Goal: bring feedforward back so fast stick inputs translate to fast
gyro response without waiting for PID error to build up.

**CLI:**

```
set f_roll = <wing-msp default>
set f_pitch = <wing-msp default>
set f_yaw = 0  # yaw FF rarely useful on wings
set feedforward_transition = 0  # default — FF active across whole stick range
```

`save`, reflash.

1. **Fly with deliberate sharp inputs**: snap rolls, snap pitch ups,
   quick direction changes. F's job is to make these snappy.
2. **Drop the log.**

**Read Step tab:**
- **LATENCY should drop** vs your phase 4 PD-only baseline (FF pushes
  servo command instantly when setpoint changes).
- **PEAK might come up slightly** — FF overshoots target slightly,
  PID brings it back. Acceptable.
- **Caveat ribbon will return** ("non-zero F+S — full closed-loop
  response, not PD-isolated"). Expected — you're now flying the
  full controller.

**Read Tracking tab during your sharp inputs:**
- **Gyro should follow setpoint with less lag** during the
  initial part of a fast input.
- **Peak error on the input transient should be lower** vs phase 5.

**Diagnose F tuning:**
- **Gyro overshoots setpoint badly on fast inputs** → F too high.
  Lower by ~25%.
- **Fast inputs still feel sluggish** → F too low. Raise by ~25%.

Stop when fast inputs feel snappy without overshoot.

---

## Phase 7 — Airspeed model fit

Goal: calibrate BF's BASIC airspeed model so TPA (Phase 8) has a
meaningful x-axis.

**Why:** TPA scales PID by an "airspeed argument" derived from
throttle / voltage / pitch via the BASIC model. If the model isn't
calibrated, TPA scales by garbage and the curve fit in Phase 8 will
be unreliable.

**Prerequisites:**
- GPS lock. The fit compares predicted airspeed against GPS 3D speed.
- Voltage telemetry working (the model uses voltage for thrust
  estimation).

1. **Fly a calibration sortie focused on throttle variation:**
   - Sustained slow cruise (~30 sec)
   - Steady climb at higher throttle
   - Steady descent at lower throttle
   - Brief full-throttle straight-line pass if your airframe + radio
     allow
   - Back to slow cruise
2. **Drop the log.**

**Read Airspeed tab:**
- **R² > 0.7** → good fit. Recommend tab will have a green-
  confidence card with paste-ready `set tpa_speed_basic_*` CLI.
  Copy it, paste in BF, `save`, reflash.
- **R² 0.4-0.7** → drifty fit; rec stays as analysis-only (no CLI).
  Usually means you need more throttle variation or longer cruise.
  Fly again with more deliberate throttle excursions.
- **R² < 0.4** → poor fit. Check GPS lock duration (Summary tab will
  flag if GPS frames are sparse). Re-fly with better GPS conditions.

**Multi-log compare** with phase 1 baseline to confirm the airspeed
prediction is improving as the model converges.

---

## Phase 8 — TPA curve fit

Goal: shape the TPA curve so PID gain scales correctly across your
airspeed range. Critical for fast wings that need gain attenuation
at high cruise speed.

**Prerequisites:**
- Phase 7 done — airspeed model is calibrated.
- Fly the full airspeed range. The X RANGE on the TPA panel needs to
  cover from low cruise (~0.1) to near max (~0.9). Anything less and
  Nelder-Mead can't constrain the curve.

1. **Fly a sortie covering the full throttle range** with sustained
   cruise at each level. Aim for ~30 sec each at 4-5 distinct
   throttle settings spanning idle to max.
2. **Drop the log.**

**Read TPA tab:**
- **No warn ribbon + curve visible** → fit succeeded. Recommend tab
  has green-confidence `set tpa_curve_*` CLI. Apply.
- **Warn ribbon: "fit unreliable — x range only [0.05, 0.51] …"**
  → flight didn't cover enough of the airspeed range. Fly more
  aggressive throttle excursions, especially at high end.

**Multi-log compare** the new flight with phase 1 baseline. The TPA
curve from your new tune should show PID gain dropping at high
airspeed (the wing feels less twitchy at cruise) and possibly
boosting at low airspeed (more authority on landing).

**Validation flight:** with the new TPA curve applied, fly the same
maneuvers you flew in Phase 4. Step response (Step tab) should now
look CLEANER at high airspeed than before — TPA is doing its job.

---

## Phase 9 — SPA tuning (optional)

Goal: prevent I-term wind-up during fast stick inputs.

**When this matters:** if your SPA panel (from Phase 5 onwards) shows
frequent wind-up or bounce-back events, OR if you feel the wing
"bounces back" after releasing a fast stick input. Many wings don't
need active SPA tuning — the defaults are usually fine.

1. **Lower SPA threshold** if you see wind-up events
   (`set spa_threshold = <lower than default>`). This makes SPA
   engage earlier during fast inputs.
2. **OR raise I-term decay** to make accumulated I bleed off faster.
3. Fly representative maneuvers, drop log, check SPA panel.

Iterate until wind-up / bounce-back events drop to near zero.

**SPA tuning is generally a fine-tuning step, not a main-event tune.**
Don't worry about it unless behavior says you need it.

---

## Phase 10 — Full validation + before/after

Goal: confirm the tune holds across realistic flying and document
the win.

1. **Fly a representative flight**: takeoff, cruise, climb, descent,
   turns, landing. ~5-10 minutes of typical flying.
2. **Drop the log.**

**Multi-log compare against your phase 1 baseline:**
- **Tracking tab** → RMS error should be markedly lower.
- **Step tab** → peak should be lower + cleaner; latency similar or
  faster.
- **Spectrum tab** → noise spectrum should be similar (filter chain
  unchanged since Phase 2).
- **SPA / S-Term / TPA panels** → all firing healthily during the
  flight.

**Recommend tab** should be mostly empty (OK count high) or only
have SHOULD / COULD items remaining. If MUST items still appear, go
back to the relevant phase and re-tune.

**Save this final log as your reference baseline** for future tuning
sessions. Any future change gets compared against this "known good"
log via multi-log compare.

---

## Beyond Phase 10 — ongoing refinement

**Things to revisit periodically:**
- Re-fit airspeed (Phase 7) seasonally — air density changes affect
  the model.
- Re-fit TPA (Phase 8) after any significant airframe modification
  (different prop, different battery, surface tape changes).
- Check filter delay (Phase 2) after any major BF firmware update —
  defaults sometimes change.
- Re-validate (Phase 10) after any significant CG change or
  payload addition.

**Tuning for new conditions:**
- New airframe = restart from Phase 0.
- New servos / linkage on existing airframe = back to Phase 1 to
  verify, then jump to Phase 2 (filters might have changed).
- New battery class (e.g. 4S → 6S) = back to Phase 7 (airspeed
  model uses voltage), then Phase 8.

---

## Cardinal advice

- **One variable per flight.** Discipline pays.
- **Save every log.** Disk space is cheap; lost data is expensive.
- **Don't trust a single flight's metrics.** Wind, turbulence, pilot
  fatigue all affect the data. Confirm tune changes across 2-3
  flights before locking them in.
- **Read the Recommend tab confidence stamps.** Green = act. Yellow =
  investigate. Red = don't paste the CLI — there's no CLI to paste
  because the tool isn't confident.
- **When something feels wrong, drop the log.** Even if you don't
  know what's wrong, WingTune will probably tell you.
- **Calibration flights are different from fun flights.** Phase 4 PD
  tuning needs aggressive inputs that you'd never use in normal
  flying. Phase 7 airspeed needs throttle excursions that aren't
  practical for transport. Schedule calibration flights deliberately.

---

## Workflow at a glance

```
[Phase 0] Bench setup (no flying)
   ↓
[Phase 1] First flight, baseline log
   ↓ (Spectrum delay high?)
   ↓
[Phase 2] Trim filters → reflash → fly
   ↓
[Phase 3] Zero F+S → calibration sortie → reference log
   ↓
[Phase 4] Tune PD per axis (iterate; 1 change/flight)
   ↓ (PEAK 1.10-1.30, LATENCY 20-40 ms, all axes)
[Phase 5] Re-enable S → tune S authority
   ↓ (ACTIVE > 30%, flight feels responsive)
[Phase 6] Re-enable F → tune snap response
   ↓ (LATENCY drops vs PD-only)
[Phase 7] Airspeed model fit → apply CLI
   ↓ (R² > 0.7)
[Phase 8] TPA curve fit → apply CLI
   ↓ (X RANGE covers 0.1-0.9)
[Phase 9] SPA tune if events present (often skip)
   ↓
[Phase 10] Validation flight + before/after compare
   ↓
Save final log. Done.
```

End-to-end on a willing-and-cooperative airframe: 5-8 flights total
(one per phase, with PD tuning in Phase 4 taking 2-3 flights of
iteration). On a stubborn airframe with mechanical issues or unusual
geometry: more.
