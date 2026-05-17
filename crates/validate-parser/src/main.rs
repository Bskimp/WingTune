// M1.0 corpus validator. Loads tests/corpus/manifest.yaml (or a path
// passed via --manifest), then for each log:
//
//   1. Hygiene cross-check (gps_present + gps_location_class
//      consistency, bundled-sample paranoia rules) per the
//      wingtune-corpus-hygiene skill. Fails the build before touching
//      bytes — these rules have no escape hatch.
//   2. Decode check: scan() the .bbl, confirm it returns successfully
//      and matches `expected.decodes`.
//   3. Field-presence check: every name in `expected.fields_present`
//      must appear in capability.fields_present.
//
// Out of scope for this slice (left as TODO with a printed note):
//   · signals_resolved cross-check — requires porting the JS-side
//     signal registry to Rust, OR exposing a resolver from the parser
//     crate. Tracked in CLAUDE.md.
//   · modules_runnable cross-check — same dependency on the JS-side
//     capability predicates.
//
// Empty manifest (no logs) → exits 0 with an explicit note. CI runs
// this on every push so the harness stays warm even before the
// corpus has its first entry.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Manifest {
    logs: Vec<LogEntry>,
}

// `#[allow(dead_code)]` because the schema accepts forward-compat
// fields (e.g. debug_mode, signals_resolved, modules_runnable) that
// this slice doesn't yet validate against. They're parsed so adding
// new logs doesn't require a code change first, and so future
// validator passes (signal registry + module predicates ported to
// Rust) can light up without re-shipping the struct definition.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct LogEntry {
    file: String,
    class: String,
    firmware: String,
    #[serde(default)]
    debug_mode: String,
    gps_present: bool,
    #[serde(default)]
    gps_location_class: Option<String>,
    #[serde(default)]
    bundled: bool,
    #[serde(default)]
    expected: ExpectedBlock,
}

#[derive(Debug, Default, Deserialize)]
struct ExpectedBlock {
    #[serde(default)]
    decodes: Option<bool>,
    #[serde(default)]
    fields_present: Vec<String>,
    // signals_resolved + modules_runnable accepted but not yet
    // validated — schema accepts them so the manifest is forward-
    // compatible with the deeper validator pass.
    #[serde(default, rename = "signals_resolved")]
    _signals_resolved: serde_yml::Value,
    #[serde(default, rename = "modules_runnable")]
    _modules_runnable: Vec<String>,
}

/// Recognized corpus classes per docs/wingtune-roadmap.md "Golden-log
/// corpus" table. A class not in this list is a manifest error.
const KNOWN_CLASSES: &[&str] = &[
    "basic-wing",
    "pidfs-complete",
    "pidfs-partial",
    "airspeed-calibration",
    "tpa-curve-probe",
    "spa-test",
    "s-term-tpa-validation",
    "bad-incomplete",
];

const KNOWN_GPS_LOCATION_CLASSES: &[&str] = &[
    "public_field",
    "stripped",
    "cropped",
    "synthetic",
];

fn main() -> ExitCode {
    let mut manifest_path: Option<PathBuf> = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--manifest" => {
                let Some(p) = args.next() else {
                    eprintln!("validate-parser: --manifest requires a path");
                    return ExitCode::from(2);
                };
                manifest_path = Some(PathBuf::from(p));
            }
            "-h" | "--help" => {
                println!("Usage: validate-parser [--manifest <path>]");
                println!();
                println!("Validate a WingTune golden-log corpus manifest:");
                println!("  · hygiene checks (gps + bundled rules, class enum)");
                println!("  · per-log decode + fields_present cross-check");
                println!();
                println!("Exits 0 when all entries pass, 1 on any failure,");
                println!("2 on argument errors.");
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!("validate-parser: unknown argument: {other}");
                return ExitCode::from(2);
            }
        }
    }

    let Some(path) = manifest_path else {
        println!("validate-parser scaffold OK; {}", wingtune_parser::parser_info());
        println!("(pass --manifest <path> to validate a corpus manifest)");
        return ExitCode::SUCCESS;
    };

    let contents = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("validate-parser: failed to read {}: {e}", path.display());
            return ExitCode::from(1);
        }
    };
    let manifest: Manifest = match serde_yml::from_str(&contents) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("validate-parser: failed to parse YAML in {}: {e}", path.display());
            return ExitCode::from(1);
        }
    };

    let corpus_dir = path.parent().unwrap_or_else(|| Path::new("."));
    println!(
        "validate-parser: loaded {} ({} log entries) — corpus dir {}",
        path.display(),
        manifest.logs.len(),
        corpus_dir.display(),
    );

    if manifest.logs.is_empty() {
        println!("(no log entries — manifest is empty; nothing to validate)");
        return ExitCode::SUCCESS;
    }

    let mut passed = 0;
    let mut failed = 0;
    for entry in &manifest.logs {
        let log_path = corpus_dir.join(&entry.file);
        match validate_one(entry, &log_path) {
            Ok(()) => {
                println!("PASS  {}  ({})", entry.file, entry.class);
                passed += 1;
            }
            Err(reason) => {
                println!("FAIL  {}  ({})\n      {}", entry.file, entry.class, reason);
                failed += 1;
            }
        }
    }

    println!();
    println!("validate-parser: {} passed, {} failed", passed, failed);
    if failed == 0 { ExitCode::SUCCESS } else { ExitCode::from(1) }
}

fn validate_one(entry: &LogEntry, log_path: &Path) -> Result<(), String> {
    // --- hygiene checks (no escape hatch) -------------------------------
    if !KNOWN_CLASSES.contains(&entry.class.as_str()) {
        return Err(format!(
            "unknown class `{}` — must be one of: {}",
            entry.class,
            KNOWN_CLASSES.join(", "),
        ));
    }
    if entry.gps_present {
        match &entry.gps_location_class {
            None => return Err(
                "gps_present: true requires gps_location_class \
                 (public_field | stripped | cropped | synthetic)".to_string()
            ),
            Some(loc) if !KNOWN_GPS_LOCATION_CLASSES.contains(&loc.as_str()) => {
                return Err(format!(
                    "unknown gps_location_class `{}` — must be one of: {}",
                    loc,
                    KNOWN_GPS_LOCATION_CLASSES.join(", "),
                ));
            }
            _ => {}
        }
    }
    if entry.bundled {
        // Bundled sample paranoia: no real-flight GPS, even cropped/stripped.
        let safe = !entry.gps_present
            || entry.gps_location_class.as_deref() == Some("synthetic");
        if !safe {
            return Err(
                "bundled: true requires gps_present: false OR \
                 gps_location_class: synthetic (cropped/stripped not acceptable \
                 for the bundled sample log)".to_string()
            );
        }
    }

    // --- decode check ---------------------------------------------------
    let expected_decodes = entry.expected.decodes.unwrap_or(true);
    let bytes = fs::read(log_path).map_err(|e| {
        format!("failed to read {}: {e}", log_path.display())
    })?;
    let scan_result = wingtune_parser::scan(&bytes);
    match (&scan_result, expected_decodes) {
        (Ok(_), true) => {} // happy path
        (Ok(_), false) => return Err("scan succeeded but expected.decodes: false".to_string()),
        (Err(e), true) => return Err(format!("scan failed: {e:?}")),
        (Err(_), false) => return Ok(()), // expected failure — no further checks
    }
    let report = scan_result.unwrap();

    // --- fields_present cross-check ------------------------------------
    for expected_field in &entry.expected.fields_present {
        if !report.capability.fields_present.iter().any(|f| f == expected_field) {
            return Err(format!(
                "expected.fields_present: `{}` not in capability.fields_present \
                 (got {} fields total)",
                expected_field,
                report.capability.fields_present.len(),
            ));
        }
    }

    // --- firmware string sanity (loose) --------------------------------
    if !entry.firmware.is_empty() {
        if let Some(actual) = &report.firmware_revision {
            // Heuristic only — corpus firmware string may be a clean
            // tag like "betaflight/4.6.0-wing" while logged firmware is
            // a richer "Betaflight / STM32F405 (S405) 4.6.0 (...)". Just
            // ensure the version portion of the corpus tag appears
            // somewhere in the logged string.
            let needle = entry.firmware.split('/').next_back().unwrap_or("").split('-').next().unwrap_or("");
            if !needle.is_empty() && !actual.contains(needle) {
                return Err(format!(
                    "firmware mismatch: corpus says `{}`, log says `{}`",
                    entry.firmware, actual,
                ));
            }
        }
    }

    Ok(())
}
