---
name: wingtune-corpus-hygiene
description: WingTune's corpus safety, privacy, and scrubbing rules for blackbox logs. Use this skill whenever adding, modifying, removing, or reviewing any file under tests/corpus/, modifying tests/corpus/manifest.yaml, touching the bundled sample log, modifying .gitignore entries covering the corpus, adjusting the validate-parser CLI's manifest-handling, or any time a .bbl file enters or leaves the repo. Use it even if the user doesn't mention privacy or safety — committing a log with home GPS coordinates is a doxing event, not a minor mistake, and this skill is the gate that prevents it. There is no escape hatch on these rules.
---

# WingTune corpus hygiene

`.bbl` blackbox logs carry data that can identify a real person and their real
address. GPS frames pin the home field. Recognizable flight paths reveal where
the pilot flies regularly. Target names and firmware build strings can
identify specific hardware. The corpus is a public test asset; treating it
casually is how a regression-test fixture becomes a doxing event.

This skill is the gate. Every change touching `.bbl` files goes through it.

## The safety case

This is not a privacy preference. It is a safety constraint:

- **Home GPS coordinates = home address.** A log captured by arming in a
  driveway and landing in a backyard contains the pilot's literal home
  location, accurate to a few meters. Committing that log to a public repo
  publishes the pilot's home address indefinitely. Git history is forever.
- **Recognizable flight paths = pattern of life.** Even without absolute
  coordinates, a flight log over a clearly identifiable feature (a specific
  intersection, building, shoreline, runway) reveals where someone flies.
  Frequent flyers are easy to pin down.
- **Bundled sample log = maximum exposure.** The first-run sample log ships
  with every install (Tauri bundle, hosted demo, every release artifact). It
  is the single most-distributed log in the project. It gets paranoid review.

The default assumption is **a log is sensitive until proven otherwise**.

## Repo structure (load-bearing)

Two directories, with very different rules:

### `tests/corpus/` — public, committed

- Contents: scrubbed `.bbl` files, `manifest.yaml`, `README.md`
- Every file here is published to GitHub, the hosted demo, and any release
  artifact that bundles tests
- Every file here has been through the scrubbing checklist below
- Every file here has a manifest entry with `gps_present` documented

### `tests/corpus-private/` — personal, gitignored

- Contents: unscrubbed personal regression `.bbl` files
- Listed in `.gitignore`; never committed
- `validate-parser --manifest tests/corpus-private/manifest.yaml` works the
  same way as the public one — useful for local regression against real
  flights without the scrubbing overhead
- If a private log later proves useful as a public corpus entry, scrub it
  (see below) and move it; never shortcut by relaxing the public rules

Adding a new `.bbl` without putting it in one of these two locations is a bug.
Nothing at the repo root, nothing in `tests/` outside these subdirectories.

## What is sensitive in a `.bbl`

- **GPS frames**: `GPS_home`, `GPS_coord[0..1]` (lat/lon), `GPS_speed`,
  `GPS_altitude`, `GPS_numSat`. Lat/lon is the obvious one, but numSat + speed
  in combination can still distinguish "indoor bench test" from "real outdoor
  flight at a specific location."
- **Header fields**: any user-set `craft_name`, `pilot_name`, or display items
  containing identifying strings.
- **Firmware build string**: `Firmware revision`, `Firmware date` — these
  alone aren't sensitive, but combined with a custom target name (a one-off
  target built for a specific FC) they can identify the builder.
- **Receiver bind / UID**: some receivers leak a serial or bind ID into the
  log header. Check for any field starting with `rx_` or ending in `_uid`.

When in doubt, run the candidate log through the header inspector before
committing. Anything that looks personally distinctive → scrub or relocate.

## Scrubbing checklist for public corpus

A `.bbl` is eligible for `tests/corpus/` only if **all** of the following are
true:

- [ ] One of: (a) GPS was off during the flight (`gps_features = 0`),
      (b) flight was at a non-sensitive public location (public RC field,
      etc.), OR (c) GPS frames have been stripped from the file before commit
- [ ] Header fields (`craft_name`, `pilot_name`, custom display items) contain
      no personal identifiers — generic names only (`test-wing`,
      `pidfs-validation`)
- [ ] If GPS frames remain, the analysis window has been truncated to exclude
      takeoff and landing locations
- [ ] Manifest entry includes `gps_present` (accurately set to true or false)
- [ ] If `gps_present: true`, manifest also includes `gps_location_class` set
      to one of: `public_field`, `stripped`, `cropped`, `synthetic`
- [ ] File size is reasonable for the regression purpose — no need to commit
      a 200 MB flight when 20 MB exercises the same code path

If any box is unchecked, the log goes in `tests/corpus-private/` instead, or
gets a scrubbing pass before merging.

## Manifest contract

`tests/corpus/manifest.yaml` is the source of truth for what each public log
is for and what has been scrubbed. Every entry includes:

```yaml
- file: basic-wing-4.6.bbl
  class: basic-wing
  firmware: betaflight/4.6.0
  debug_mode: none
  gps_present: false
  # Required when gps_present: true:
  # gps_location_class: public_field | stripped | cropped | synthetic
  expected:
    decodes: true
    fields_required: [gyroADC, setpoint, servo, motor]
    modules_runnable: [M1]
```

The `expected` block is what `validate-parser` checks against. The hygiene
fields (`gps_present`, `gps_location_class`) are what corpus PR reviewers
check against. Both matter; one without the other is not enough.

## The bundled sample log

The first-run sample log ships with every install. It has the highest
exposure of any log in the project and gets a separate, paranoid review.

Rules for the bundled sample log specifically:

- Must be `gps_present: false` OR `gps_location_class: synthetic`. **No
  cropped or stripped real-flight GPS is acceptable here** — too many edge
  cases for paranoid comfort.
- Must be flagged in the manifest with `bundled: true`.
- Any change to the bundled sample log requires a separate scrubbing review
  before merge, even if the rest of the corpus change is routine.
- If the bundled sample log changes, the corpus PR description must
  explicitly call out the change and confirm a fresh scrubbing review.

## When adding or changing a log

1. **Decide location:** public-corpus material (scrubbed, demonstrative) or
   private-corpus material (real flights, local regression only)? If unsure,
   default to private.
2. **For public-corpus only:** run through the scrubbing checklist above.
3. **Add the manifest entry** with accurate `gps_present` and (if relevant)
   `gps_location_class`.
4. **Verify the log decodes** via `npm run corpus:validate`.
5. **Check the header inspector output** for any unexpected identifying
   fields; rerun the checklist if anything new shows up.

For PR reviewers: any `.bbl` change in a diff that adds to `tests/corpus/`
gets a separate corpus-hygiene review pass, independent of the code review.
Don't approve the corpus change implicitly because the code looks fine.

## What Claude Code might want to do but should not

- **"Move this private log to the public corpus, it's just a test flight."**
  No. "Just a test flight" is exactly the category that contains home GPS
  coordinates. Run the checklist. If GPS was on and the location was home or
  a regular flying spot, the log stays private.
- **"Replace the bundled sample log with this cooler one from yesterday's
  flight."** No. The bundled sample log is the highest-exposure log in the
  project. Even after scrubbing real GPS, prefer a synthetic or GPS-off log.
- **"This `.bbl` is covered by .gitignore extension globs, no need for a
  manifest entry."** No. Every file in `tests/corpus/` has a manifest entry,
  full stop. The manifest is what reviewers and CI both check against.
- **"Strip the GPS frames programmatically in a CI step instead of
  pre-commit."** No. CI is a check, not a cleanup mechanism. Sensitive data
  that arrives in the repo even briefly stays in git history. Scrub before
  commit, not after.
- **"Add a `.bbl` to `examples/` or `samples/` instead of `tests/corpus/` to
  skip the manifest."** No. Every `.bbl` in the repo lives in
  `tests/corpus/` (scrubbed, manifested) or `tests/corpus-private/`
  (gitignored). No third location.
- **"Let me commit and then scrub in a follow-up PR."** No. Git history is
  forever. Force-pushing or rewriting history is not a recovery path,
  because clones, forks, and the GitHub event API have already captured the
  bad commit.

## Quick self-check before committing a corpus change

- [ ] Is every new `.bbl` file located in either `tests/corpus/` (scrubbed)
      or `tests/corpus-private/` (gitignored)? Nothing in between, nothing at
      the repo root.
- [ ] For each public `.bbl`: has the scrubbing checklist been run? Header
      inspector reviewed?
- [ ] Has the manifest been updated with accurate `gps_present` and (if
      applicable) `gps_location_class`?
- [ ] If the bundled sample log changed: has the separate paranoid review
      happened?
- [ ] Does `npm run corpus:validate` pass?

## No exceptions

Unlike `wingtune-architecture` (which permits `// LAYER-EXCEPTION:`) and
`wingtune-memory-model` (which permits `// MEMORY-EXCEPTION:`), this skill
has **no escape hatch**. There is no `CORPUS-EXCEPTION:` annotation. The
downside of a leaked home GPS coordinate is not recoverable by reverting a
commit; assume git history is forever. If a hygiene rule seems to be in the
way of a legitimate change, the right answer is to change the rule via
explicit discussion and update this skill — not to bypass it in a comment.
