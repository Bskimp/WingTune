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
    /// BF firmware revision string from the log header (e.g.
    /// `"Betaflight/STM32F411 4.5.0 dev (abc123)"`). Duplicated from
    /// `ScanReport.firmware_revision` so Layer 2's `resolveSignal()`
    /// can apply `SignalSource.min_firmware` source-eligibility gates
    /// without callers needing to pass it separately.
    pub firmware_revision: Option<String>,
}

/// Cheap per-field "is this field actually carrying signal?" indicator.
/// `all_zero` is true when every sampled frame had value 0; `has_content`
/// is true when at least one sampled frame had a non-zero value. Both can
/// be false if the field wasn't present in the sampled frames at all.
///
/// `value_min` / `value_max` are the lowest and highest values observed
/// across the sampled frames. `None` when the field was absent from
/// every sampled frame (no value to measure). Used by Layer 2's signal
/// registry to surface `out_of_range` resolution states when sampled
/// values fall outside a per-signal `expected_range` — guards against
/// silent failure when a debug-mode channel index is wrong or a
/// firmware update changes a field's scaling without changing its name.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SampleCheck {
    pub all_zero: bool,
    pub has_content: bool,
    pub value_min: Option<f64>,
    pub value_max: Option<f64>,
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

/// Filter chain configuration extracted from BBL headers — the user's
/// gyro/D-term LP filters + dyn-notch settings. blackbox-log doesn't
/// type these (they live in `headers.unknown()` as raw text), so scan
/// parses them out and projects to a typed struct here. Unknown or
/// missing keys map to `None` rather than panicking — log shapes vary
/// across BF versions and we want graceful degradation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FilterConfig {
    pub dyn_notch:  Option<DynNotchConfig>,
    pub gyro_lpf1:  Option<LowPassConfig>,
    pub gyro_lpf2:  Option<LowPassConfig>,
    pub dterm_lpf1: Option<LowPassConfig>,
    pub dterm_lpf2: Option<LowPassConfig>,
    pub rpm_filter: Option<RpmFilterConfig>,
}

/// RPM filter — uses ESC telemetry to track per-motor RPM and apply a
/// swept notch at the motor frequency + harmonics. Different from the
/// dyn-notch bank (which hunts peaks in the gyro spectrum).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpmFilterConfig {
    /// Number of harmonics filtered (1 = fundamental only, 2 = +2nd, …).
    pub harmonics: u32,
    /// LP cutoff applied to the RPM signal feed before it's used for
    /// notch placement — smooths jitter in the motor RPM stream.
    pub lpf_hz: u32,
    /// Notches below this frequency are suppressed (idle-RPM floor).
    pub min_hz: u32,
    /// Q factor of each notch, BF-encoded ×100 (actual Q = q/100).
    pub q: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynNotchConfig {
    pub count:  u32,
    pub min_hz: u32,
    pub max_hz: u32,
    pub q:      u32,
}

/// One LP stage. `static_hz` is set when the filter is fixed-cutoff;
/// `dyn_min_hz` / `dyn_max_hz` are set when BF varies cutoff with
/// throttle. Both can coexist for hybrid setups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LowPassConfig {
    pub filter_type: String,
    pub static_hz:   Option<u32>,
    pub dyn_min_hz:  Option<u32>,
    pub dyn_max_hz:  Option<u32>,
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
