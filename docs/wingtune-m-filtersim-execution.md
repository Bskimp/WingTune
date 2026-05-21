# M-FilterSim execution plan — per-stage filter simulation (Spectrum roadmap S1)

Execution detail for **S1** of `docs/wingtune-spectrum-roadmap.md` — the
first milestone of the Spectrum-tab track. The roadmap is the "why +
sequencing" reference; this doc is the slice-by-slice breakdown.

> **Read first:** `wingtune-architecture`, `wingtune-memory-model`,
> `wingtune-vue-conventions`. And the `CLAUDE.md` SCOPE box — wing filter
> regime is sub-50 Hz interesting noise, not the quad 50-500 Hz band.

## What M-FilterSim does

The Spectrum tab can show raw gyro (`gyroUnfilt`) and full-chain filtered
gyro (`gyroADC`) — the *net* effect of the whole filter chain. It cannot show
what one stage does, because BF logs no intermediate signal. M-FilterSim
**simulates** the chain so each stage becomes a toggle: flip the dyn-notch and
watch that peak reappear, flip a LPF and watch the HF rolloff vanish.

## Status

Not started. Plan locked 2026-05-20 from the Spectrum roadmap:

1. **RPM filter simulates exactly.** Its notches are locked to motor RPM:
   notch centre = motorFreq × harmonic, and motorFreq comes from `eRPM`,
   logged per-motor per-main-frame (bidir-DSHOT telemetry — the RPM filter
   can't run without it). Header gives harmonics / min-Hz / fade / Q /
   motor poles. No approximation, no debug mode.
2. **Dyn notch is self-tracked.** The header gives the hunt range
   (`dyn_notch_min_hz/max_hz/count/q`), not the per-sample centre. Baseline:
   re-run our own STFT peak-picker on `gyroUnfilt`, constrained to the header
   range. A debug-mode path (DYN_NOTCH / FFT family logs the centres) is a
   later exactness refinement, not a blocker.
3. **The validation harness is the safety net.** Apply the simulated *full*
   chain to `gyroUnfilt`, compare against logged `gyroADC`. A `simFidelity`
   metric gates trust — a poor dyn-notch self-track shows up here.
4. **Slice 4 (interactive sandbox) is deferred** — land Slices 1-3 first.

## Scope

**In:** `lib/stft.ts`, `lib/bfFilters.ts` + validation harness, the
per-stage `SpectrumPanel` UI.

**Out (deferred, with triggers):**
- **Interactive filter sandbox** (roadmap S1.3) — edit a cutoff, live
  re-sim. Deferred until Slices 1-3 land and the sim validates on the
  corpus; may become its own milestone.
- **No recommender.** M-FilterSim is a visualization tool — which stage to
  trim is a judgment call (the existing M4 filter-delay rec already says as
  much). No CLI, no `lib/recommenders/` entry.
- **Debug-mode dyn-notch centres** — exactness refinement, after the
  self-track baseline proves out against the validation harness.

## Slice breakdown

### Slice 1 — `lib/stft.ts` (shared windowed-FFT primitive)

Roadmap Phase 0. Layer 2, no Vue. Shared with S2 (every spectral view) — so
it is built here, once.

- Short-time FFT: split a signal into overlapping Hann-windowed segments,
  FFT each. Reuse the radix-2 FFT already in `lib/spectrum.ts` — do not add
  a second FFT implementation.
- API sketch: `computeStft(signal, { windowSize, hopSize })` →
  `{ columns: Float32Array[] (per-window magnitude/PSD), centreTimes,
  binHz }`.
- Float32 throughout (memory-model cardinal rule); no `Float64Array` on the
  hot path, no `new Array()` for column data.
- **Tests:** a steady sinusoid → energy in the expected bin in every column;
  a linear chirp → the peak bin migrates column-to-column as expected;
  window/hop edge math (last partial window, hop > window guard).

### Slice 2 — `lib/bfFilters.ts` + validation harness (load-bearing)

Roadmap S1.1. Layer 2, no Vue. Nothing downstream is trustworthy without it.

- Port BF's filter math to JS, grounded against Betaflight source for the
  release the fork targets (BF 4.6 / the 2026.6 line) — `filter.c`,
  `dyn_notch.c` / SDFT, `rpm_filter.c`. Do a research pass against BF source
  first, the way M5 was grounded against PR #13805. Document the source
  commit in the file header.
  - **Biquad LPF** — PT1 / PT2 / PT3. Coefficients are closed-form from
    cutoff + sample rate. Exact.
  - **Dynamic notch** — biquad notch(es). Centre per the self-tracker below.
  - **RPM filter** — cascade of biquad notches at motor harmonics.
- **RPM notch placement** — per sample, from logged `eRPM[i]` + header
  (`rpm_filter_harmonics`, `rpm_filter_min_hz`, `rpm_filter_fade_range_hz`,
  Q/weights, `motor_poles`). Deterministic — exact.
- **Dyn-notch placement** — STFT peak-pick (Slice 1) on `gyroUnfilt`,
  constrained to the header `[min_hz, max_hz]`, top `dyn_notch_count` peaks.
  An approximation of BF's SDFT.
- `simulateChain({ rawGyro, filterConfig, eRPM, sampleRateHz, stages })` →
  the filtered signal with the selected stages applied, stage by stage.
- **Validation:** `validateChain(simulatedFull, loggedGyroADC)` →
  `simFidelity` ∈ [0,1] (band-limited spectral coherence, or
  1 − normalised-RMS-residual). The honesty check from the roadmap.
- **`FilterConfig` check:** the M4 `scan.rs` already parses a typed
  `FilterConfig` (dyn-notch + 4 LPFs + rpm_filter). Verify it carries
  everything `bfFilters` needs — RPM harmonics, min-Hz, fade range, Q,
  `motor_poles` — and extend `scan.rs` if not (Rust side, `wingtune-parser`).
- **Tests:** each filter against its analytic response (PT1 −3 dB at the
  cutoff; notch null at centre); a synthetic full chain round-trips; the
  validation metric reads ~1 on a matching pair and low on a deliberate
  mismatch.

### Slice 3 — `SpectrumPanel` per-stage display

Roadmap S1.2. Layer 3 — `wingtune-vue-conventions`, `useActiveLog`.

- The raw/filt/both selector becomes a per-stage toggle set (raw → +LPF →
  +dyn-notch → +RPM → full). The displayed "filtered" PSD is recomputed via
  `simulateChain` from whichever stages are enabled.
- `simFidelity` badge, prominent — green when the sim matches logged
  `gyroADC`, red when it diverges, with the per-stage view visibly flagged
  unreliable (same honesty pattern as the Step panel's F/S caveat ribbon).
- Hydrates `gyroUnfilt[axis]`, `gyroADC[axis]`, `eRPM[*]`; reads
  `FilterConfig` from the scan report. Honest empty state when `gyroUnfilt`
  is absent (stock-BF logs without raw gyro logging — M-FilterSim needs it).

### Slice 4 — interactive filter sandbox — DEFERRED

Roadmap S1.3. Edit cutoffs / notch params, live re-sim, watch the predicted
PSD + delay budget update. Deferred per decision 4 above.

## Open questions carried into execution

1. **BF filter source version** — pin the port to the BF release the fork
   targets; record the source commit. Resolve in the Slice 2 research pass.
2. **Dyn-notch tracker fidelity** — how close the STFT self-track lands to
   BF's SDFT. The validation harness is the arbiter; if self-track is too
   rough, the debug-mode path is the upgrade.
3. **`simFidelity` threshold** — where the per-stage view flips from
   trustworthy to flagged-unreliable. `TODO calibrate` against the corpus.
4. **STFT params** — the dyn-notch tracker may want a different window/hop
   than S2's display use; `stft.ts` stays parameterised so both can.

## Test plan

- Unit (`tests/unit/`): `stft.ts`, `bfFilters.ts` (per-filter analytic
  checks + chain + validation metric).
- Corpus: Brian's USE_WING logs (btfl_002/003/005) carry `gyroUnfilt`,
  `gyroADC` and `eRPM` — they exercise the validation harness end-to-end
  (the simulated full chain vs the logged post-chain *is* the integration
  test). `npm run corpus:validate:private`.
- Per-skill self-check before commit.
