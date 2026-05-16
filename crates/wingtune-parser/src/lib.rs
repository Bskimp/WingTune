//! Layer 1 (Ingest): WASM-bound wrapper around `blackbox-log`.
//!
//! This crate is the only place outside the worker host that is allowed to
//! import `blackbox-log`. See the `wingtune-architecture` skill for the
//! three-layer rule.

pub mod capability;
pub mod event;
pub mod scan;

pub use capability::{CapabilityReport, FrameIndex, SampleCheck, VoltageSagSummary};
pub use event::EventFrame;
pub use scan::{scan, ScanError, ScanReport};

use wasm_bindgen::prelude::*;

/// One-line description of the underlying parser. Retained from the M1.1
/// smoke as a diagnostic endpoint — the real scan/hydrate surface lands
/// in M1.2.2+.
#[wasm_bindgen]
pub fn parser_info() -> String {
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

    #[test]
    fn capability_report_round_trips_through_serde_json() {
        let mut sample_check = std::collections::BTreeMap::new();
        sample_check.insert(
            "axisS[0]".to_string(),
            SampleCheck { all_zero: false, has_content: true },
        );
        let report = CapabilityReport {
            fields_present: vec!["axisP[0]".into(), "axisS[0]".into()],
            debug_mode: Some("WING_LAUNCH".into()),
            gps_present: false,
            sample_check,
            frame_index: FrameIndex {
                offsets: vec![0, 4096, 8192],
                times_sec: vec![0.0, 1.0, 2.0],
            },
            total_frames: 12_345,
            voltage_sag_summary: Some(VoltageSagSummary {
                min_v: 14.2,
                max_v: 16.8,
                p99_v: 14.5,
                pct_below_threshold: 0.03,
            }),
        };
        let json = serde_json::to_string(&report).expect("serialize");
        let back: CapabilityReport = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.fields_present, report.fields_present);
        assert_eq!(back.debug_mode, report.debug_mode);
        assert_eq!(back.total_frames, report.total_frames);
        assert_eq!(back.frame_index.offsets, report.frame_index.offsets);
    }

    #[test]
    fn event_frame_enum_tags_each_variant() {
        let events = vec![
            EventFrame::Arming { time_sec: 1.5 },
            EventFrame::Disarming { time_sec: 30.0, reason: Some("switch".into()) },
            EventFrame::FlightModeChange { time_sec: 12.0, flags: 0b101 },
            EventFrame::RxLoss { time_sec: 25.3 },
            EventFrame::Failsafe { time_sec: 25.5, phase: "landing".into() },
            EventFrame::Other { time_sec: 99.9, name: "unknown_event".into() },
        ];
        let json = serde_json::to_string(&events).expect("serialize");
        // The `#[serde(tag = "kind")]` attribute should put a discriminator
        // string in each entry — the JS side dispatches on `kind`.
        assert!(json.contains("\"kind\":\"arming\""), "missing arming tag in: {json}");
        assert!(json.contains("\"kind\":\"flight_mode_change\""), "got: {json}");
        let back: Vec<EventFrame> = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.len(), events.len());
    }

    #[test]
    fn scan_on_empty_bytes_returns_no_logs_error() {
        let err = scan(&[]).expect_err("empty bytes should not scan");
        assert!(
            matches!(err, ScanError::NoLogs),
            "expected NoLogs, got {err:?}"
        );
    }

    /// Run `scan()` against a real BBL file specified via the
    /// `WINGTUNE_TEST_LOG` environment variable. Skipped silently when
    /// the var isn't set so CI (no real logs in the public corpus yet)
    /// stays green.
    #[test]
    fn scan_real_log_when_env_var_set() {
        let Ok(path) = std::env::var("WINGTUNE_TEST_LOG") else {
            eprintln!("skipped: set WINGTUNE_TEST_LOG=<path> to run");
            return;
        };
        let bytes = std::fs::read(&path).expect("read test log");
        let report = scan(&bytes).expect("scan");
        assert!(report.capability.total_frames > 0, "no frames decoded");
        assert!(
            !report.capability.fields_present.is_empty(),
            "no fields_present"
        );
        assert!(!report.time_sec.is_empty(), "empty time axis");
        assert_eq!(
            report.time_sec.len(),
            report.capability.total_frames as usize,
            "time axis length must equal frame count"
        );
        eprintln!(
            "scan(WINGTUNE_TEST_LOG): frames={} fields={} events={} duration={:.2}s \
             debug_mode={:?} firmware={:?}",
            report.capability.total_frames,
            report.capability.fields_present.len(),
            report.events.len(),
            report.time_sec.last().copied().unwrap_or(0.0),
            report.capability.debug_mode,
            report.firmware_revision,
        );
    }

    #[test]
    fn scan_report_round_trips_with_empty_payload() {
        let report = ScanReport {
            capability: CapabilityReport {
                fields_present: vec![],
                debug_mode: None,
                gps_present: false,
                sample_check: std::collections::BTreeMap::new(),
                frame_index: FrameIndex::default(),
                total_frames: 0,
                voltage_sag_summary: None,
            },
            time_sec: vec![],
            events: vec![],
            firmware_revision: None,
            firmware_date: None,
            board_info: None,
            craft_name: None,
        };
        let json = serde_json::to_string(&report).expect("serialize");
        let back: ScanReport = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.capability.total_frames, 0);
        assert!(back.events.is_empty());
    }
}
