//! Capability report — emitted once per log by `scan()`. Documents what
//! the log contains (fields, debug mode, GPS, voltage behavior) and the
//! seek hints needed by M1.3's fielded lazy hydration. Consumed by M1.6's
//! readiness report and by every workspace/module that needs to know
//! "can this log run analysis X?" before requesting hydration.
//!
//! Pure data — no scan logic lives here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityReport {
    /// Every main-frame field name observed in the log.
    pub fields_present: Vec<String>,
    /// `debug_mode` header value if present (e.g. `"GYRO_RAW"`,
    /// `"WING_LAUNCH"`). `None` when no debug mode is set.
    pub debug_mode: Option<String>,
    /// Whether GPS frames were present at all (separate from
    /// `gps_location_class` which is a corpus-hygiene attribute).
    pub gps_present: bool,
    /// Per-field activity sample: did N spaced-out frames show any
    /// non-zero content for this field? Keyed by field name.
    pub sample_check: BTreeMap<String, SampleCheck>,
    /// Seek hints for hydration — byte offsets into the original log
    /// bytes, paralleled with their log-time-seconds. M1.3's hydrate
    /// path uses this to jump into the log without rescanning.
    pub frame_index: FrameIndex,
    /// Count of main-frame entries decoded during scan.
    pub total_frames: u64,
    /// Summary of `vbatLatest` behavior over the log. `None` when the
    /// log doesn't carry battery data. M3+ uses this as a confidence
    /// input for tuning recommendations.
    pub voltage_sag_summary: Option<VoltageSagSummary>,
}

/// Cheap per-field "is this field actually carrying signal?" indicator.
/// `all_zero` is true when every sampled frame had value 0; `has_content`
/// is true when at least one sampled frame had a non-zero value. Both can
/// be false if the field wasn't present in the sampled frames at all.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SampleCheck {
    pub all_zero: bool,
    pub has_content: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FrameIndex {
    /// Seek-point identifier for each entry. In M1.2 this is the
    /// main-frame iteration count (the monotonic `iteration` field on
    /// each `MainFrame`) because `blackbox-log` doesn't expose the
    /// parser's current byte position. M1.3's hydrate path uses this
    /// to fast-forward when re-decoding fields. Will switch to true
    /// byte offsets if/when the upstream parser exposes them.
    pub offsets: Vec<u64>,
    /// Log-time (seconds since first frame) at each seek point, parallel
    /// to `offsets`. Time axis is f32 because the dtype rule is
    /// Float32-everywhere per `wingtune-memory-model`.
    pub times_sec: Vec<f32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct VoltageSagSummary {
    pub min_v: f32,
    pub max_v: f32,
    /// 99th-percentile of `vbatLatest` over the scan window.
    pub p99_v: f32,
    /// Fraction (0.0..=1.0) of frames whose `vbatLatest` was below the
    /// threshold the scan used. Threshold itself isn't carried in the
    /// summary — M3 will recompute when it cares about a different cell
    /// count or chemistry.
    pub pct_below_threshold: f32,
}
