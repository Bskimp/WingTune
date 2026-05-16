# `blackbox-log` (upstream README snapshot)

> Snapshot of the parser dependency's README at the version we're tracking.
> See [USAGE.md](USAGE.md) for our integration-specific notes and [CHANGELOG.md](CHANGELOG.md) for the upstream version history.
>
> Captured 2026-05-15 from commit `8ad704f1936b6f738dbe93246d1d3da2a82eed11`.

---

# `blackbox-log`

This is a Rust port of Betaflight's & INAV's blackbox tools. Check the [GitHub
organization][org] for related projects. Or, read the [docs] to get started.

> **Note**: `blackbox-log` is not quite ready for production use yet --
consider it early-mid beta quality.

## Why?

There are two official parser implementations, each with a copy maintained by
Betaflight and one by INAV, so why another?

Neither is all that great for building other software with:
- `blackbox_decode` ([BF][bf-tools], [INAV][inav-tools]) has missed some of
  the changes in the format in the last few years, so its output is no longer
  entirely correct. Additionally, it decodes and writes *everything* to disk,
  so you pay for data your application may not need.
- The log viewer's parser ([BF][bf-viewer], [INAV][inav-viewer]) isn't meant to
  be used by anything else and is tightly coupled with its GUI. It's written in
  JavaScript, which limits the places it can reasonably be embedded.

This project aims to fill that niche. An ergonomic, up-to-date API usable
anywhere that supports Rust or WebAssembly.

## License

Licensed under either of Apache License, Version 2.0 or MIT license at your option.

[org]: https://github.com/blackbox-log/
[docs]: https://docs.rs/blackbox-log
[bf-tools]: https://github.com/betaflight/blackbox-tools
[bf-viewer]: https://github.com/betaflight/blackbox-log-viewer
[inav-tools]: https://github.com/iNavFlight/blackbox-tools
[inav-viewer]: https://github.com/iNavFlight/blackbox-log-viewer
