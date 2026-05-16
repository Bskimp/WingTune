# `docs/`

Long-form documents and reference snapshots for WingTune. Skills under
`.claude/skills/` are rules — these are reasoning.

## Planning

- [wingtune-roadmap.md](wingtune-roadmap.md) — long-arc design doc (v0.7).
  Vision, three-layer architecture, milestones M1–M7, risk register, firmware
  companion PR scope.
- [wingtune-m1-execution.md](wingtune-m1-execution.md) — current detailed M1
  execution plan (rev 8). M1.0 through M1.7, exit criteria, TypeScript stubs
  for load-bearing pieces.

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
