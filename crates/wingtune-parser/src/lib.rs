//! Layer 1 (Ingest): WASM-bound wrapper around `blackbox-log`.
//!
//! This crate is the only place outside the worker host that is allowed to
//! import `blackbox-log`. See the `wingtune-architecture` skill for the
//! three-layer rule.

pub mod capability;
pub mod event;
pub mod hydrate;
pub mod scan;

pub use capability::{
    CapabilityReport, DynNotchConfig, FilterConfig, FrameIndex, LowPassConfig, RpmFilterConfig,
    SampleCheck, VoltageSagSummary,
};
pub use event::EventFrame;
pub use hydrate::{hydrate as hydrate_impl, HydrateError, HydrateResult};
pub use scan::{scan, ScanError, ScanReport};

use serde::Serialize;
use wasm_bindgen::prelude::*;

/// serde-wasm-bindgen's default `to_value` serializes Rust maps to
/// JS `Map` objects, not plain JS objects. That breaks consumer code
/// that does `obj[key]` lookup or `Object.entries(obj)` iteration
/// (which is the canonical JS access pattern). Force the JSON-
/// compatible "maps as objects" output for all our serialized
/// payloads — every map in our types is keyed by string and meant to
/// be accessed as a record.
fn js_serializer() -> serde_wasm_bindgen::Serializer {
    serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true)
}

/// One-line description of the underlying parser. Retained from the M1.1
/// smoke as a diagnostic endpoint — the real scan/hydrate surface is below.
#[wasm_bindgen]
pub fn parser_info() -> String {
    let _file = blackbox_log::File::new(&[]);
    format!("wingtune-parser {}", env!("CARGO_PKG_VERSION"))
}

/// JS-callable scan entry point. Bytes are moved into Rust via wasm-bindgen
/// (`Box<[u8]>` transfers ownership without copying). Returns the full
/// `ScanReport` on success or a structured `ScanError` envelope on failure;
/// both are marshalled to plain JS objects via `serde-wasm-bindgen`.
///
/// The optional `on_progress` JS function is called with one argument
/// (`frames_so_far: number`) every PROGRESS_INTERVAL_FRAMES (256) main
/// frames. The JS side estimates expected total from file size and
/// derives a percent. Errors from the callback (return value, throw)
/// are silently swallowed — progress is best-effort and must not
/// abort the scan.
#[wasm_bindgen(js_name = scanLog)]
pub fn scan_log(
    bytes: &[u8],
    on_progress: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    let ser = js_serializer();
    let result = if let Some(cb) = on_progress {
        scan::scan_with_progress(bytes, &mut |frames| {
            let _ = cb.call1(&JsValue::NULL, &JsValue::from_f64(frames as f64));
        })
    } else {
        scan::scan(bytes)
    };
    match result {
        Ok(report) => report.serialize(&ser)
            .map_err(|e| JsValue::from_str(&format!("serialize ScanReport: {e}"))),
        Err(err) => Err(err.serialize(&ser)
            .unwrap_or_else(|_| JsValue::from_str("scan: unserializable error"))),
    }
}

/// Hydrate the named fields and return them to JS. Bytes are re-iterated
/// from the start; `FrameIndex` seek hints are still unused. Returns a
/// `HydrateResult` (struct with `fields` + `gps_times_sec`) so the bridge
/// can rebuild both axes; the JS side converts to typed arrays at the
/// boundary.
#[wasm_bindgen(js_name = hydrate)]
pub fn hydrate(bytes: &[u8], field_ids: Vec<String>) -> Result<JsValue, JsValue> {
    let ser = js_serializer();
    match hydrate::hydrate(bytes, &field_ids) {
        Ok(result) => result.serialize(&ser)
            .map_err(|e| JsValue::from_str(&format!("serialize hydrate: {e}"))),
        Err(err) => Err(err.serialize(&ser)
            .unwrap_or_else(|_| JsValue::from_str("hydrate: unserializable error"))),
    }
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
        eprintln!("filter_config: {:?}", report.filter_config);

        // M1.3.2: now hydrate the first three available main-frame fields
        // and confirm we get sample-count equal to total_frames for each.
        let sample_fields: Vec<String> =
            report.capability.fields_present.iter().take(3).cloned().collect();
        if sample_fields.is_empty() {
            return;
        }
        let result = hydrate_impl(&bytes, &sample_fields).expect("hydrate");
        assert_eq!(result.fields.len(), sample_fields.len());
        for (name, values) in &result.fields {
            assert_eq!(
                values.len() as u64,
                report.capability.total_frames,
                "hydrated field {name} should have one sample per main frame"
            );
        }
        eprintln!(
            "hydrate(WINGTUNE_TEST_LOG): {} fields, first sample of each: {:?}",
            result.fields.len(),
            result
                .fields
                .iter()
                .map(|(n, v)| (n.as_str(), v.first().copied().unwrap_or(0.0)))
                .collect::<Vec<_>>(),
        );

        // When the log has GPS, also exercise the GPS hydration path
        // and dump GPS_speed stats so we can verify unit scaling.
        if report.capability.gps_present {
            let gps_speed_name = String::from("gps:GPS_speed");
            if report.capability.fields_present.iter().any(|n| n == &gps_speed_name) {
                let probe = vec![gps_speed_name.clone()];
                let r = hydrate_impl(&bytes, &probe).expect("hydrate gps speed");
                let (_, values) = &r.fields[0];
                assert_eq!(values.len(), r.gps_times_sec.len());
                let mut min = f32::INFINITY;
                let mut max = f32::NEG_INFINITY;
                let mut sum = 0.0_f64;
                for &v in values.iter() {
                    if v < min { min = v; }
                    if v > max { max = v; }
                    sum += v as f64;
                }
                let mean = if values.is_empty() { 0.0 } else { sum / values.len() as f64 };
                eprintln!(
                    "hydrate gps:GPS_speed: samples={} window={:.1}..{:.1}s min={:.3} max={:.3} mean={:.3} m/s first5={:?}",
                    values.len(),
                    r.gps_times_sec.first().copied().unwrap_or(0.0),
                    r.gps_times_sec.last().copied().unwrap_or(0.0),
                    min, max, mean,
                    values.iter().take(5).copied().collect::<Vec<_>>(),
                );
            }
        }
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
            filter_config: FilterConfig::default(),
            header_params: std::collections::BTreeMap::new(),
        };
        let json = serde_json::to_string(&report).expect("serialize");
        let back: ScanReport = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.capability.total_frames, 0);
        assert!(back.events.is_empty());
    }
}
