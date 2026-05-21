# WingTune calibration flights

WingTune has a deep analysis suite, but most of its recommendation and
panel thresholds are still **first-guess constants** marked
`TODO calibrate` — M-Coupling significance, M-FilterSim simFidelity
bands, the M-Style Cruise/3D profile values, the Step recommender's
peak/latency bands, the low-frequency peak-detection knobs. They become
real numbers only by flying purpose-built sorties, dropping the logs
in, and comparing what the tool says against how the wing actually
flew.

This is the flight checklist for that. Bang these out, drop each log
into WingTune, and the calibration follows from there.

> **USE_WING firmware note.** On Brian's wing-branch firmware the
> main-frame `wing*` fields carry TPA / SPA / S-term / setpoint data
> directly — so a single log captures *every* wing analytic, no
> `debug_mode` juggling. These flights are differentiated by **content
> and config**, not by debug mode. The old "one debug mode per flight"
> constraint does not apply here.

---

## Flight 1 — Throttle-sweep cruise (GPS)

**Calibrates:** M3 BASIC airspeed fit, M5 hyperbolic TPA curve, S2
airspeed×frequency spectrogram, S2 low-frequency airframe modes.

**Config:** GPS module on, **wait for a 3D fix before launch** — the
airspeed fit is GPS-anchored and useless without lock. `tpa_speed_type
= BASIC`.

**Fly it:** open area, **3+ minutes continuous** (the phugoid airframe
mode needs ~100 s of unbroken flight to resolve). Deliberately sweep
airspeed end to end — slow flight near stall, then progressively
faster passes up to top cruise speed, and back, repeatedly. Throw in a
few climbs and dives (gives the airspeed model its gravity/dive
signal). The one thing to avoid is holding constant throttle.

**Coverage check (in WingTune):** Airspeed tab R² should clear ~0.7;
the TPA-curve panel should show dwell in the low / mid / high speed
bands, not one cluster.

---

## Flight 2 — Single-axis snap flight

**Calibrates:** M-Coupling cross-axis matrix + its three calibration
knobs (response tail, significance threshold, min-command floor).

**Fly it:** at a safe altitude, **isolated single-axis inputs**. Snap
a roll with the pitch + yaw sticks centred, return cleanly to neutral
— repeat ~5×. Then the same on pitch alone (sharp pitch reversals,
roll/yaw centred), ~5×. Then yaw alone, ~5×. Crisp inputs, clean
neutral between each. The cleaner the axis isolation, the better the
coupling measurement.

**Coverage check:** M-Coupling needs ≥ 3 single-axis snap windows per
axis — it greys any row below that.

---

## Flight 3 — PD-isolated step-response reference

**Calibrates:** the Step recommender's peak / latency thresholds —
currently the Step panel is diagnostic-only because there is no
PD-isolated reference to anchor against.

**Config (before flight, BF CLI):** zero the **feedforward and the
S-term** — set the F gain and S gain to 0 on every axis, then `save`.
With F = 0 and S = 0 the logged step response is PD-isolated and
directly comparable to PIDtoolbox / PIDscope. **Restore F + S
afterwards** — this is a one-off test config, not a flying tune.

**Fly it:** crisp, deliberate setpoint steps on each axis — snappy
stick inputs with clean returns, enough clean step content for the
deconvolution to average. The wing will feel softer with no
feedforward; fly conservatively.

---

## Flight 4 — Aggressive mixed maneuvers

**Calibrates:** M6 SPA effectiveness, M7 S-term viz, M-FF feedforward
effectiveness, and supplies the broadband excitation M-Servo-2's
airframe transfer function needs.

**Fly it:** your normal aggressive repertoire — snap rolls, hard pitch
punches, mixed maneuvers, anything that pushes the wing. The goal is
rich transient content spread across the frequency band. No special
config (the USE_WING main-frame fields cover SPA + S-term).

---

## Ongoing — M-Style profile verdict

Not a special sortie. As you fly normally — some flights cruise-style,
some 3D-style — note one honest line per log afterwards: *did this
tune feel right for how you were flying it?* That verdict is the
calibration input for the Cruise / 3D profile thresholds, which are
pure first guesses today. (This is exactly the "calibration feedback
loop" idea — for now it is a manual note; a tool-assisted version is a
candidate future milestone.)

---

## After the flights

Drop each log into WingTune, open the relevant tab, and look for where
the tool's read disagrees with how the wing actually flew — a panel
flagged red on a flight that felt fine, or green on one that didn't.
**That disagreement is the calibration signal**: it says which
`TODO calibrate` constant is mis-set and which way to nudge it. Flights
1-4 can be combined into fewer sorties if a single flight genuinely
captures the content (e.g. a long cruise that also includes an
aggressive segment) — the list is by *content needed*, not by
mandatory separate flights.
