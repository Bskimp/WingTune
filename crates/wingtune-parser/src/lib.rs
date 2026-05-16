//! Layer 1 (Ingest): WASM-bound wrapper around `blackbox-log`.
//!
//! This crate is the only place outside the worker host that is allowed to
//! import `blackbox-log`. See the `wingtune-architecture` skill for the
//! three-layer rule.

/// One-line description of the underlying parser, surfaced by the M1.1
/// smoke wiring to confirm the WASM → worker → main-thread round-trip
/// resolves end-to-end.
pub fn parser_info() -> String {
    // Construct a `File` from empty bytes purely so the `blackbox-log`
    // dependency actually has to link — proves the `[patch.crates-io]`
    // override resolved to the wing-support fork in M1.1.1. Replace with
    // a real parse path in M1.2.
    let _file = blackbox_log::File::new(&[]);
    format!("wingtune-parser {}", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_info_returns_crate_id() {
        let info = parser_info();
        assert!(info.contains("wingtune-parser"), "got: {info}");
    }
}
