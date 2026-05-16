# Golden-log corpus

This directory holds public, scrubbed Betaflight blackbox logs used as the
regression-test corpus for WingTune. Every `.bbl` here is published to GitHub,
the hosted demo, and any release artifact that bundles tests. Treat that
visibility as load-bearing.

## Two-directory split

- `tests/corpus/` (this directory) — public, committed, scrubbed.
- `tests/corpus-private/` — personal regression logs, **gitignored**, never
  committed. Create it locally; it doesn't ship.

Adding a `.bbl` to any other location is a bug. Nothing at the repo root,
nothing in `tests/` outside these two subdirectories.

## Adding a log

**Read the `wingtune-corpus-hygiene` skill first**
([../../.claude/skills/wingtune-corpus-hygiene.md](../../.claude/skills/wingtune-corpus-hygiene.md))
— that file is the source of truth for what goes here and what doesn't. It
has no escape hatch.

Short version:

1. Decide location. If the log was captured with GPS on at a non-public
   location, it goes in `tests/corpus-private/` — period. Public corpus is
   for `gps_present: false` OR `gps_location_class: public_field | stripped |
   cropped | synthetic`.
2. Run the scrubbing checklist (see skill).
3. Add a manifest entry to [manifest.yaml](manifest.yaml) including the
   hygiene fields and `expected:` block.
4. Verify with `npm run corpus:validate` (once that script exists — landing
   with M1.0).

## The bundled sample log

One log in this directory is flagged `bundled: true` — it gets copied to
`public/samples/wing-sample.bbl` at build time and ships with the static
demo + Tauri bundle. The bundled log has the highest exposure of anything
in the project and is restricted to `gps_present: false` OR
`gps_location_class: synthetic` — no real-flight GPS, even cropped, is
acceptable.

## Manifest format

See the example in
[../../docs/wingtune-m1-execution.md](../../docs/wingtune-m1-execution.md)
under "M1.0 → manifest.yaml example." Briefly:

```yaml
logs:
  - file: example.bbl
    class: basic-wing               # one of the recognized corpus classes
    firmware: betaflight/4.6.0
    debug_mode: none
    gps_present: false
    bundled: false                  # true on the single bundled sample log
    # gps_location_class: required when gps_present: true
    expected:
      decodes: true
      signals_resolved: {}          # main-frame OR debug; resolver picks the path
      fields_present: [...]         # for direct-field assertions (e.g. axisS)
      modules_runnable: [M1, M2]
```

## Reviewer note

PRs that change `.bbl` files in this directory get a **separate
corpus-hygiene review pass**, independent of the code review. Don't approve a
corpus change implicitly because the rest of the diff looks fine.
