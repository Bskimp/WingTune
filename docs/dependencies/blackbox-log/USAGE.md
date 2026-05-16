# `blackbox-log` — our integration notes

> This file holds WingTune-specific notes that aren't in the upstream README.
> Primary canonical reference is **[docs.rs/blackbox-log](https://docs.rs/blackbox-log)** — keep that open when working in `crates/wingtune-parser/`.

## Pinned version

Upstream's latest release is **0.4.3** (April 2024, MSRV 1.87). It documents support up to **Betaflight 4.5.x** — BF 4.6+ wing logs almost certainly fail at the firmware-version check (explicit error, not silent-decode-with-wrong-fields).

**WingTune does not depend on the upstream crate directly.** It depends on the `wing-support` branch of `Bskimp/blackbox-log` via a Cargo patch override at the workspace root:

```toml
# Cargo.toml (workspace root)
[patch.crates-io]
blackbox-log = { git = "https://github.com/Bskimp/blackbox-log", branch = "wing-support" }
```

The fork's `wing-support` branch holds BF 4.6+ support (new firmware versions, new debug-mode enum values, new event-frame types). The same branch is the source of an upstream PR — if/when it merges, WingTune bumps to the new crates.io version (`blackbox-log = "0.5"` or similar) and deletes the patch override.

See **M1.0 → Parser support track** in [`docs/wingtune-m1-execution.md`](../../wingtune-m1-execution.md) for the operational plan, and **Risk #3** in [`docs/wingtune-roadmap.md`](../../wingtune-roadmap.md) for the long-term framing.

## Parallel PR status

When you open the upstream PR, link to it from this file so future contributors know:
- The PR branch matches the fork's `wing-support` branch verbatim.
- Bumping past the patch override depends on this PR merging.

If the PR stalls (>4–6 weeks with no review), nothing changes for WingTune — the fork is the long-term dep. Rebase `wing-support` on upstream `main` periodically so non-conflicting upstream improvements still flow through.

## Last-resort fallback

If the fork strategy ever falls apart (upstream goes hostile, fork maintenance becomes onerous, parser API breaks too often), the contained fallback is wrapping `betaflight/blackbox-tools` (C) via Emscripten — ~2 weeks of Layer 1 work. The `wasmBridge.ts` abstraction is what makes parser swaps a Layer 1 change rather than a project rewrite. Don't reach for this preemptively; the fork strategy is the default.

## Minimum viable usage (sketch)

This is the shape `crates/wingtune-parser/src/lib.rs` will wrap. From upstream's API (0.4.x):

```rust
use blackbox_log::File;

let bytes: &[u8] = /* the .bbl file contents */;
let file = File::new(bytes);

// One log file can contain multiple concatenated logs (e.g. when logging is
// resumed after a disconnect). Iterate to get them.
for headers_result in file.iter() {
    let headers = headers_result.expect("header parse failed");

    // headers gives access to: firmware, debug_mode, field names per frame
    // type, sample rates, debug-mode string, etc. — used to build the M1.2
    // capability report.

    let mut parser = headers.data_parser();
    while let Some(event) = parser.next() {
        // event is a ParserEvent: Main(MainFrame), Slow(SlowFrame),
        // Gps(GpsFrame), Event(...), etc.
        //
        // For M1's scan pass we discard the values and just tally frame
        // counts + sample fields for the sample_check + collect events
        // for the event track. M1.3's hydrate pass re-iterates and
        // materializes per-field typed arrays.
    }
}
```

## API gotchas (from the 0.4.0 BREAKING notes)

- **No more `Reader` tracking.** `File::parse()` returns `Headers` directly; `Headers::data_parser()` returns the iterator. If you find AI-generated code holding a `Reader`, it's pre-0.4.0 and wrong.
- **Filter API**: `FilterSet` (not `FieldFilterSet`), and per-frame-kind `Filter` enums (not `Option`).
- **`firmware_kind` is `firmware`**, and it includes the parsed version.

## Working examples / code references

The crate ships no `examples/` directory. For working code:

- **`tests/snapshots.rs`** in the upstream repo — full end-to-end parse against fixture logs.
- **`benches/parse.rs`** — minimal "parse from bytes" loop.
- **[docs.rs/blackbox-log](https://docs.rs/blackbox-log)** — every public item has at least a small example.

## When to refresh this directory

Refresh `README.md`, `CHANGELOG.md`, and this file whenever you bump the crate version in `Cargo.toml`. Note the new commit SHA / capture date in the header comments. If the upstream API broke, update the "Minimum viable usage" sketch in the same PR that updates `crates/wingtune-parser/src/lib.rs`.
