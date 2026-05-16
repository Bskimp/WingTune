# Firmware reference snapshots

Verbatim copies of selected Betaflight firmware headers, held here so we can
do offline reverse-lookups when building the WASM parser wrapper and the
analysis modules. **Not source code that ships with WingTune** — reference only.

## Why these are here, not just linked

Field names, predictor/encoder enums, debug-mode meanings, and event-frame
shapes are the contract between firmware and parser. When upstream renames a
field or adds a debug mode, the consequences ripple all the way to our
capability predicates and the corpus manifest. Having these files in-repo means
a single `git diff` reveals what changed when you refresh the snapshots.

## Files

| File | Source | Why |
|---|---|---|
| [blackbox_fielddefs.h](blackbox_fielddefs.h) | `src/main/blackbox/blackbox_fielddefs.h` | Field-condition enum, predictor/encoder enums, event-frame shapes — drives the M1.4 event/annotation track and the M1.2 capability report |

## Refresh procedure

1. Pull `master` for [Bskimp/betaflight](https://github.com/Bskimp/betaflight)
   (or upstream `betaflight/betaflight`).
2. Copy `src/main/blackbox/blackbox_fielddefs.h` over the local file.
3. Update the comment block at the top with the new commit SHA, file SHA, and
   capture date.
4. Run `npm run corpus:validate` — if anything mismatches between an existing
   corpus log and the new field set, that's a forced re-look at the predicate
   layer.
5. Commit the snapshot + any predicate/registry updates in the same PR.

## Current snapshot

- **Source**: `Bskimp/betaflight` branch `master`
- **Commit**: `e92c108873a876922ff8e07ef19b98a02d5a4ddb`
- **Captured**: 2026-05-15
