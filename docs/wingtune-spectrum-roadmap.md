# WingTune Spectrum-tab roadmap — filter simulation + airspeed-resolved spectra

Two tracks pulled to the front of the analytics plan (2026-05-20): take the
Spectrum tab from one static PSD to a spectral workbench.

**Context.** Today the Spectrum tab is M4 — one whole-log Welch PSD per axis,
a raw/filt/both selector, filter-config overlays (dyn-notch band, LPF lines,
RPM markers) and a filter delay budget. Solid, but it is *one number per
frequency for the whole flight*, and it cannot show what any individual
filter stage actually does.

This doc **supersedes** the `M-FilterSim` section and wing-regime spectral
batch items 2-4 in `wingtune-analytics-plan.md` — those sketches are folded
in here with the sequencing and the RPM-filter refinement worked out. It is a
**roadmap, not an execution doc**: per-milestone execution detail is written
when a milestone is picked up (analytics-plan convention).

---

## The two milestones

- ~~**S1 — M-FilterSim**~~ — per-stage filter simulation. ✅ **shipped
  2026-05-20** — validated on a real wing log at 89% sim fidelity.
- ~~**S2 — Airspeed-resolved spectra**~~ — airspeed×frequency spectrogram
  + low-frequency airframe-mode detection. ✅ **shipped 2026-05-21**.
  Slice 4 (wavelet view) deferred. Execution detail:
  `docs/wingtune-s2-execution.md`.

**Priority.** Both shipped ahead of M-Servo-2 in the analytics-plan order:
S1 → S2 → **M-Servo-2 ← next** → M-Pilot → …

**Order.** S1 first — more concrete, clearer payoff, and the RPM-filter piece
turns out exact rather than approximate (below). S1 and S2 are independent in
their analysis math but both rebuild the same tab, so doing them sequentially
avoids merge churn in `SpectrumPanel.vue`.

**Shared primitive.** Both need a short-time FFT (S1 for the dyn-notch
self-tracker, S2 for every spectral view). Build `lib/stft.ts` once, early —
it wraps the existing radix-2 FFT in `lib/spectrum.ts` with windowed
overlapping columns. Treat it as Phase 0, consumed by both milestones.

---

## The RPM-filter / dyn-notch refinement

The analytics-plan M-FilterSim "open question" — *an exact sim needs the
per-sample notch center, logged only under some debug modes* — splits cleanly
once the RPM filter is separated from the dynamic notch. Credit: Brian's
observation that the filter settings are in the header.

### RPM filter — exact. No approximation, no debug mode.

The RPM notches do not hunt a spectrum; they are locked to motor RPM. Notch
center (Hz) = motorFrequency × harmonic, and motorFrequency is derived from
**eRPM, which is logged per-motor per-main-frame** (bidir-DSHOT telemetry).
The RPM filter cannot run without bidir DSHOT, so whenever the filter is
active its eRPM is in the log — self-consistent. Harmonic count, min-Hz, fade
range, Q and motor pole count are all in the BBL header.

→ logged eRPM + header config = every RPM notch position at every sample,
deterministically. **This stage simulates exactly.**

### LPFs — exact.

Static cutoffs straight from the header. PT1/PT2/PT3 biquad coefficients are
a closed-form function of cutoff + sample rate. Exact.

### Dynamic notch — the header gives the cage, not the bird.

The dyn notch genuinely hunts: BF runs a sliding-DFT on the gyro and parks
notches on the live spectral peaks. The header carries `dyn_notch_count` /
`dyn_notch_min_hz` / `dyn_notch_max_hz` / `dyn_notch_q` — the *range* the
notches hunt within — but not where they sat at sample t.

Two recovery paths:

- **Self-track (S1 baseline).** Re-run our own STFT peak-picker on
  `gyroUnfilt`, constrained to the header's `[min_hz, max_hz]` and
  `dyn_notch_count` peaks. Approximates BF's SDFT; needs no debug mode.
- **Debug-mode (refinement).** When `debug_mode` logged the notch centers
  (DYN_NOTCH / FFT_FREQ family), use them directly — exact.

So the residual approximation is confined to **one stage**, and the S1
Phase 1 validation harness (below) catches it if the self-track is poor.

---

## S1 — M-FilterSim (per-stage filter simulation) ✅ SHIPPED

> ✅ Shipped 2026-05-20 — `lib/stft.ts`, `lib/bfFilters.ts`,
> `FilterSimPanel.vue` on the Spectrum tab (via `SpectrumTab.vue`).
> Validated on a real twin-motor wing log at 89% sim fidelity.
> Execution detail + the slice plan: `docs/wingtune-m-filtersim-execution.md`.
> The notes below are the original design intent.

The Spectrum tab can show raw (`gyroUnfilt`) and full-chain filtered
(`gyroADC`) — the *net* effect of the whole chain. It cannot show what one
stage does, because BF logs no intermediate signal. M-FilterSim simulates the
chain so each stage becomes a toggle.

### Phase 1 — Filter-math port + validation harness *(load-bearing)*

- `lib/bfFilters.ts` — port BF's biquad (PT1/PT2/PT3 lowpass), the dynamic
  notch and the RPM filter to JS. Ground against BF source.
- RPM notch placement from logged eRPM + header config (exact).
- Dyn-notch placement via the STFT self-tracker (`lib/stft.ts` + a
  peak-picker) constrained to the header range.
- **The honesty rule.** Apply the simulated *full* chain to `gyroUnfilt` and
  compare against the logged `gyroADC`. A `simFidelity` metric (normalized
  residual / spectral coherence). Match → the per-stage breakdown is
  trustworthy; mismatch → flagged loudly, per-stage view marked unreliable.
- Deliverable: `lib/bfFilters.ts` + `lib/stft.ts` + validation + unit tests.
  No UI. Nothing downstream is trustworthy without this phase.

### Phase 2 — Per-stage spectrum display

- `SpectrumPanel.vue`: the raw/filt/both selector becomes a per-stage toggle
  set (raw → +LPF → +dyn-notch → +RPM → full). The displayed "filtered" PSD
  is recomputed from the simulated chain with whichever stages are enabled.
- Toggle the dyn-notch and watch that peak reappear; toggle a LPF and watch
  the HF rolloff vanish — directly answers "what is this filter touching."
- The `simFidelity` badge is prominent. On a poor match the per-stage view is
  visibly flagged, not silently wrong.
- Deliverable: SpectrumPanel changes + the stage-toggle UI.

### Phase 3 — Interactive filter sandbox *(ambitious — may split out)*

- Edit a cutoff / notch parameter in the UI, re-simulate live, see the
  predicted PSD + filter delay budget update. Preview a config change before
  flashing and flying.
- The ambitious end of S1. Could be its own milestone; land Phases 1-2 first.

---

## S2 — Airspeed-resolved + low-frequency spectra ✅ SHIPPED

> ✅ Shipped 2026-05-21 — `lib/airspeedSpectrogram.ts` +
> `AirspeedSpectrogramPanel.vue` (airspeed×frequency heatmap, Phase 2),
> `lib/lowFreqModes.ts` + `LowFreqModePanel.vue` (sub-3 Hz airframe-mode
> detection, Phase 3), both stacked on the Spectrum tab. Phase 4 (wavelet
> scalogram) deferred. Execution detail + the lessons learned:
> `docs/wingtune-s2-execution.md`. The notes below are the original
> design intent.

M4's whole-log PSD assumes the spectrum is stationary across the flight.
On a wing the plant scales with airspeed and disturbances are non-stationary,
so a whole-log PSD smears the interesting structure away.

### Phase 1 — STFT engine

- `lib/stft.ts` (the shared Phase 0 above) — windowed overlapping FFT columns
  over the existing radix-2 FFT. Consumed by Phases 2-4 and by S1's
  dyn-notch tracker.

### Phase 2 — Airspeed × frequency spectrogram

- STFT columns, each → a PSD, binned / sorted by the M3 airspeed estimate
  instead of by time.
- Per-axis heatmap: x = airspeed, y = frequency, colour = power. Wing
  resonances, control-surface buzz and flutter precursors onset *at a speed* —
  this is the primary spectral view for wings, beside the whole-log PSD.
- Open question: sparse fast-end airspeed data → sparse columns; grey the
  under-sampled bins.

### Phase 3 — Low-frequency airframe-mode detection

- Nothing currently targets the 0.05-3 Hz band where wing airframe modes
  live: short-period (~0.5-2 Hz), dutch roll (~0.2-1 Hz), phugoid
  (~0.02-0.07 Hz). A peak there is an airframe dynamic mode — a CG / tail-
  volume / dihedral diagnostic — not noise.
- Low-frequency PSD + peak detection below ~3 Hz, labelled by likely mode.
  Phugoid needs a window down to ~0.02 Hz → 100 s+ of continuous flight to
  resolve; flag when the log is too short.
- A Spectrum sub-view or its own panel (see Tab IA below).

### Phase 4 — Wavelet / non-stationary view *(speculative)*

- An STFT scalogram (time×frequency) — keeps a one-off buffet or flutter
  transient localised instead of smearing it into the noise floor, the way
  Welch averaging does.
- CWT-vs-STFT decided later; start STFT (reuses Phase 1). The stretch end.

---

## Sequencing summary

```
Phase 0   lib/stft.ts                         ✅ shipped 2026-05-20
S1.1      lib/bfFilters.ts + validation       ✅ shipped 2026-05-20
S1.2      per-stage spectrum display          ✅ shipped (FilterSimPanel)
S1.3      interactive filter sandbox          deferred — see roadmap
S2.2      airspeed × frequency spectrogram    ✅ shipped 2026-05-21
S2.3      low-frequency airframe modes        ✅ shipped 2026-05-21
S2.4      wavelet / STFT scalogram            speculative — deferred
```

S1.1-S1.2 and S2.2-S2.3 — the high-confidence core — all shipped. The
speculative tails (S1.3 filter sandbox, S2.4 wavelet) stay deferred.

---

## Open decisions

1. **S1 before S2** — proposed (S1 is more concrete; RPM-exact lowers its
   risk). Reversible.
2. **Speculative tails** — S1.3 (filter sandbox) and S2.4 (wavelet) are
   marked land-core-first / decide-later, not committed.
3. **Dyn-notch source** — self-track is the S1 baseline; the debug-mode path
   is a later exactness refinement, not a blocker.
4. **Tab IA** — the Spectrum tab gets materially heavier (per-stage toggles +
   a spectrogram heatmap + a low-freq view). It likely needs internal
   sub-views / a sub-nav. This intersects the tab-IA consolidation already
   flagged in `wingtune-analytics-plan.md` — resolve in that design pass, do
   not solve it inline here.
5. **`simFidelity` threshold** — where the per-stage view flips from
   trustworthy to flagged-unreliable needs calibration against the corpus.
   Conservative default; mark `TODO calibrate`.

## Next step

Both Spectrum-roadmap milestones are shipped (S1 2026-05-20, S2 2026-05-21).
The Spectrum tab is now a four-panel spectral workbench. The next analytics
milestone is **M-Servo-2** (`docs/wingtune-analytics-plan.md`). The deferred
tails — S1.3 (interactive filter sandbox) and S2.4 (wavelet scalogram) —
remain land-core-first / decide-later.
