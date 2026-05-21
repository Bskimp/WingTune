# `docs/`

Long-form documents and reference snapshots for WingTune. Skills under
`.claude/skills/` are rules — these are reasoning.

## Planning

- [wingtune-roadmap.md](wingtune-roadmap.md) — long-arc design doc.
  Vision, three-layer architecture, milestones M1–M7, risk register, firmware
  companion PR scope.
- [wingtune-m1-execution.md](wingtune-m1-execution.md) — the M1 execution
  plan. M1 is complete; kept as a frozen historical record.
- [wingtune-analytics-plan.md](wingtune-analytics-plan.md) — the post-M7
  analytics milestones (M-FF, M-Coupling, M-Servo-2, M-Pilot, M-Style, …) —
  the live "what's the next milestone" doc.
- [wingtune-spectrum-roadmap.md](wingtune-spectrum-roadmap.md) — the
  Spectrum-tab track (S1 per-stage filter sim, S2 airspeed-resolved spectra).
- `wingtune-m-*-execution.md` / `wingtune-s2-execution.md` — per-milestone
  slice-by-slice execution plans, written when each milestone is picked up.
- [wingtune-tab-guide.md](wingtune-tab-guide.md) — per-tab walkthrough: what
  each panel shows and how to read it.
- [wingtune-tuning-workflow.md](wingtune-tuning-workflow.md) — the end-to-end
  fresh-flash-to-validated-wing tuning workflow.
- [wingtune-calibration-flights.md](wingtune-calibration-flights.md) — the
  purpose-built sorties that turn the tool's first-guess thresholds into
  calibrated values.

`CLAUDE.md` at the repo root is the authoritative live state-of-the-project
doc — these are the reasoning behind it.

## Firmware companion PR

- [firmware-pr/wing-fields-firmware.patch](firmware-pr/wing-fields-firmware.patch) — unified diff
  promoting wing-tuning signals to main-frame `USE_WING` fields in Bskimp/betaflight.
- [firmware-pr/wing-fields-firmware-notes.md](firmware-pr/wing-fields-firmware-notes.md) — VERIFY
  answers, per-file walkthrough, before-applying checklist, PR description draft.

## Firmware reference

- [firmware-reference/](firmware-reference/) — verbatim snapshots of selected Betaflight headers
  (currently `blackbox_fielddefs.h`). Refresh on each major BF release.

## Dependencies

- [dependencies/blackbox-log/](dependencies/blackbox-log/) — upstream README + CHANGELOG snapshot
  plus our integration notes ([USAGE.md](dependencies/blackbox-log/USAGE.md)) for the Rust parser
  we wrap as WASM.

## Refresh procedure

When you bump a dependency or notice firmware drift, update the snapshot files
and bump the capture date at the top of each. CI's `corpus:validate` step is
the safety net — if a snapshot drifts from reality, corpus regression breaks.
