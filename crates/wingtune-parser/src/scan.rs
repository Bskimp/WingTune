//! `scan(bytes) -> ScanReport`. Single pass over the log's bytes that
//! produces capability metadata + the Float32 time axis + the event list.
//! Does NOT materialize per-field typed arrays — that is what `hydrate()`
//! is for, and the hydrate impl lands in M1.3.
//!
//! M1.2.2 scope: minimal viable scan. `sample_check`,
//! `voltage_sag_summary`, and a real `frame_index` are stubbed (empty /
//! `None` / empty) and filled in by follow-ups.

use std::collections::{BTreeMap, HashMap};

use blackbox_log::File;
use blackbox_log::data::ParserEvent;
use blackbox_log::event::Event;
use blackbox_log::frame::{Frame, FrameDef};
use serde::{Deserialize, Serialize};

use crate::capability::{
    CapabilityReport, DynNotchConfig, FilterConfig, FrameIndex, LowPassConfig, RpmFilterConfig,
    SampleCheck,
};
use crate::event::EventFrame;
use crate::hydrate::{gps_value_to_f32, main_value_to_f32};

/// Sample every Nth main frame for `sample_check` activity probes. Main
/// frames fire at ~1 kHz on wings; checking every 32nd keeps the probe
/// at ~30 Hz (still fine-grained enough to catch any non-zero activity
/// in normal flight) while cutting the work to ~3 % of the naive cost.
/// GPS frames are NOT strided — they're already ~10 Hz so checking each
/// one is cheap.
const SAMPLE_STRIDE: u64 = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub capability: CapabilityReport,
    /// Log-time of each main frame, in seconds since the first frame.
    /// Stored as `Vec<f32>` here; the wasm-bindgen layer in M1.2.4/M1.2.5
    /// will convert this to a JS `Float32Array` at the boundary so the
    /// store can `shallowRef` it without Vue deep-proxying every value.
    pub time_sec: Vec<f32>,
    pub events: Vec<EventFrame>,
    pub firmware_revision: Option<String>,
    pub firmware_date: Option<String>,
    pub board_info: Option<String>,
    pub craft_name: Option<String>,
    /// Gyro/D-term LP + dyn-notch settings parsed from the BBL
    /// header's free-form text. Empty fields when the log's BF version
    /// uses different key names or the filter is OFF.
    pub filter_config: FilterConfig,
    /// All free-form header key/value pairs (PID values, rates, mixer
    /// config, filter cutoffs, etc.) BTreeMap-sorted by key so the
    /// browser-side dump renders deterministically. Includes the keys
    /// that `filter_config` already typed — exposed raw so the
    /// inspector can show the user every CLI param BF wrote into the
    /// log, including unknown ones we don't typify.
    pub header_params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScanError {
    /// File contains no log-start markers.
    NoLogs,
    /// Headers of the first log could not be parsed.
    InvalidHeaders { reason: String },
}

/// Frame-count interval at which `scan_with_progress` fires its
/// callback. 256 frames at BF's typical 1-2 kHz logging rate works
/// out to a callback every ~128-256 ms — fast enough for the UI to
/// feel responsive, slow enough not to flood the worker channel.
const PROGRESS_INTERVAL_FRAMES: u64 = 256;

/// No-callback wrapper preserved for Rust unit tests + the existing
/// internal call sites. WASM callers should prefer `scan_with_progress`.
pub fn scan(bytes: &[u8]) -> Result<ScanReport, ScanError> {
    scan_with_progress(bytes, &mut |_| {})
}

/// Like `scan` but invokes `progress(frames_so_far)` periodically so a
/// caller can render a real progress bar. Called every
/// `PROGRESS_INTERVAL_FRAMES` main frames; the caller is responsible
/// for any throttling beyond that. Total frame count isn't known
/// upfront — the caller estimates expected total from file-size /
/// typical-frame-bytes and clamps to 95% until scan resolves.
pub fn scan_with_progress(
    bytes: &[u8],
    progress: &mut dyn FnMut(u64),
) -> Result<ScanReport, ScanError> {
    let file = File::new(bytes);
    let first = file.iter().next().ok_or(ScanError::NoLogs)?;
    let headers =
        first.map_err(|e| ScanError::InvalidHeaders { reason: format!("{e}") })?;

    let firmware_revision = Some(headers.firmware_revision().to_string());
    let firmware_date = headers.firmware_date().map(|r| match r {
        Ok(dt) => dt.to_string(),
        Err(raw) => raw.to_string(),
    });
    let board_info = headers.board_info().map(|s| s.to_string());
    let craft_name = headers.craft_name().map(|s| s.to_string());
    let debug_mode = Some(format!("{:?}", headers.debug_mode()));
    // blackbox-log returns hashbrown::HashMap from headers.unknown();
    // copy into a std HashMap at this boundary so the rest of the
    // parsing code uses the project-standard type. Header k/v count
    // is small (≤ ~200 entries) so the copy is negligible.
    let unknown_std: HashMap<&str, &str> = headers
        .unknown()
        .iter()
        .map(|(k, v)| (*k, *v))
        .collect();
    let filter_config = parse_filter_config(&unknown_std);
    // BTreeMap so the JS-side renders alphabetical without sorting.
    let header_params: BTreeMap<String, String> = unknown_std
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();

    let mut fields_present: Vec<String> = headers
        .main_frame_def()
        .iter()
        .map(|f| f.name.to_string())
        .collect();
    if let Some(gps_def) = headers.gps_frame_def() {
        // Tag GPS field names so a consumer can tell them apart from
        // main-frame fields with the same base name (rare, but possible
        // for projected coordinates etc).
        for f in gps_def.iter() {
            fields_present.push(format!("gps:{}", f.name));
        }
    }

    // Per-field "have we ever seen a non-zero sample" trackers.
    // Sized to the unfiltered frame def length so indices line up with
    // `frame.get(i)`. Once a field flips to true, subsequent frames
    // skip the check for that field (short-circuit hot path).
    let main_field_count = headers.main_frame_def().len();
    let gps_field_count = headers.gps_frame_def().map_or(0, |d| d.len());
    let mut main_nonzero: Vec<bool> = vec![false; main_field_count];
    let mut gps_nonzero: Vec<bool> = vec![false; gps_field_count];
    // Per-field running min/max across sampled frames. `None` until the
    // first sample lands; `Some(v)` afterwards. Used to populate
    // `SampleCheck.value_min/value_max` for the signal registry's
    // `expected_range` guard (Layer 2).
    let mut main_min: Vec<Option<f64>> = vec![None; main_field_count];
    let mut main_max: Vec<Option<f64>> = vec![None; main_field_count];
    let mut gps_min: Vec<Option<f64>> = vec![None; gps_field_count];
    let mut gps_max: Vec<Option<f64>> = vec![None; gps_field_count];

    let mut parser = headers.data_parser();
    let mut total_frames: u64 = 0;
    let mut time_sec: Vec<f32> = Vec::new();
    let mut events: Vec<EventFrame> = Vec::new();
    let mut gps_present = false;
    let mut t0_micros: Option<u64> = None;

    while let Some(ev) = parser.next() {
        match ev {
            ParserEvent::Main(frame) => {
                total_frames += 1;
                let t_micros = frame.time_raw();
                let t0 = *t0_micros.get_or_insert(t_micros);
                // Subtract before casting to f32 to keep precision (f32
                // can't represent absolute microseconds-since-power-on
                // accurately for long flights; the delta is fine).
                let dt_sec = ((t_micros.saturating_sub(t0)) as f64 / 1_000_000.0) as f32;
                time_sec.push(dt_sec);

                if total_frames.is_multiple_of(SAMPLE_STRIDE) {
                    for i in 0..main_field_count {
                        if let Some(value) = frame.get(i) {
                            let v_f32 = main_value_to_f32(value);
                            if !main_nonzero[i] && v_f32 != 0.0 {
                                main_nonzero[i] = true;
                            }
                            let v = v_f32 as f64;
                            main_min[i] = Some(main_min[i].map_or(v, |prev| prev.min(v)));
                            main_max[i] = Some(main_max[i].map_or(v, |prev| prev.max(v)));
                        }
                    }
                }

                if total_frames.is_multiple_of(PROGRESS_INTERVAL_FRAMES) {
                    progress(total_frames);
                }
            }
            ParserEvent::Event(e) => {
                let last_time_sec = time_sec.last().copied().unwrap_or(0.0);
                events.push(map_event(e, last_time_sec));
            }
            ParserEvent::Gps(frame) => {
                gps_present = true;
                for i in 0..gps_field_count {
                    if let Some(value) = frame.get(i) {
                        let v_f32 = gps_value_to_f32(value);
                        if !gps_nonzero[i] && v_f32 != 0.0 {
                            gps_nonzero[i] = true;
                        }
                        let v = v_f32 as f64;
                        gps_min[i] = Some(gps_min[i].map_or(v, |prev| prev.min(v)));
                        gps_max[i] = Some(gps_max[i].map_or(v, |prev| prev.max(v)));
                    }
                }
            }
            ParserEvent::Slow(_) => {
                // Slow frames carry mode flags, vbat, etc. M1.3+ will
                // sample them for voltage_sag_summary and arm/disarm
                // inference; for M1.2 we ignore them.
            }
        }
    }

    let mut sample_check: BTreeMap<String, SampleCheck> = BTreeMap::new();
    for (i, field) in headers.main_frame_def().iter().enumerate() {
        sample_check.insert(
            field.name.to_string(),
            SampleCheck {
                all_zero: !main_nonzero[i],
                has_content: main_nonzero[i],
                value_min: main_min[i],
                value_max: main_max[i],
            },
        );
    }
    if let Some(gps_def) = headers.gps_frame_def() {
        for (i, field) in gps_def.iter().enumerate() {
            sample_check.insert(
                format!("gps:{}", field.name),
                SampleCheck {
                    all_zero: !gps_nonzero[i],
                    has_content: gps_nonzero[i],
                    value_min: gps_min[i],
                    value_max: gps_max[i],
                },
            );
        }
    }

    let capability = CapabilityReport {
        fields_present,
        debug_mode,
        gps_present,
        sample_check,
        frame_index: FrameIndex::default(),
        total_frames,
        voltage_sag_summary: None,
        firmware_revision: firmware_revision.clone(),
    };

    Ok(ScanReport {
        capability,
        time_sec,
        events,
        firmware_revision,
        firmware_date,
        board_info,
        craft_name,
        filter_config,
        header_params,
    })
}

fn parse_filter_config(unknown: &HashMap<&str, &str>) -> FilterConfig {
    FilterConfig {
        dyn_notch:  parse_dyn_notch(unknown),
        gyro_lpf1:  parse_lpf(unknown, "gyro_lpf1"),
        gyro_lpf2:  parse_lpf(unknown, "gyro_lpf2"),
        dterm_lpf1: parse_lpf(unknown, "dterm_lpf1"),
        dterm_lpf2: parse_lpf(unknown, "dterm_lpf2"),
        rpm_filter: parse_rpm_filter(unknown),
    }
}

fn parse_rpm_filter(unknown: &HashMap<&str, &str>) -> Option<RpmFilterConfig> {
    let harmonics = parse_u32(unknown, "rpm_filter_harmonics").unwrap_or(0);
    if harmonics == 0 { return None; }
    Some(RpmFilterConfig {
        harmonics,
        lpf_hz: parse_u32(unknown, "rpm_filter_lpf_hz").unwrap_or(0),
        min_hz: parse_u32(unknown, "rpm_filter_min_hz").unwrap_or(0),
        q:      parse_u32(unknown, "rpm_filter_q").unwrap_or(0),
    })
}

fn parse_dyn_notch(unknown: &HashMap<&str, &str>) -> Option<DynNotchConfig> {
    let count = parse_u32(unknown, "dyn_notch_count").unwrap_or(0);
    if count == 0 { return None; }
    Some(DynNotchConfig {
        count,
        min_hz: parse_u32(unknown, "dyn_notch_min_hz").unwrap_or(0),
        max_hz: parse_u32(unknown, "dyn_notch_max_hz").unwrap_or(0),
        q:      parse_u32(unknown, "dyn_notch_q").unwrap_or(0),
    })
}

fn parse_lpf(unknown: &HashMap<&str, &str>, prefix: &str) -> Option<LowPassConfig> {
    let type_key = format!("{prefix}_type");
    let raw_type = unknown.get(type_key.as_str()).map(|s| s.to_string())?;
    // BF logs the filter type as either an integer enum index (older
    // versions: "0" = PT1, "1" = BIQUAD, "2" = PT2, "3" = PT3) or a
    // name string (newer versions: "PT1", "BIQUAD", etc.). Only the
    // literal "OFF" disables the filter — "0" in this position is the
    // default PT1 enum value, NOT the off marker (gyro_hardware_lpf
    // handles real off).
    let display_type = match raw_type.to_ascii_uppercase().as_str() {
        "0"    => "PT1".to_string(),
        "1"    => "BIQUAD".to_string(),
        "2"    => "PT2".to_string(),
        "3"    => "PT3".to_string(),
        "OFF"  => return None,
        _      => raw_type,
    };

    let static_hz = parse_u32(unknown, &format!("{prefix}_static_hz"));
    // Dynamic LPF range is logged as "min,max" in a single _dyn_hz key
    // (BF convention). Absent or "0,0" means dynamic LPF is disabled.
    let (dyn_min_hz, dyn_max_hz) = parse_dyn_hz_pair(unknown, &format!("{prefix}_dyn_hz"));

    // If neither static nor dynamic cutoff is configured, the filter
    // is effectively off regardless of what _type says.
    if static_hz.unwrap_or(0) == 0 && dyn_min_hz.is_none() {
        return None;
    }

    Some(LowPassConfig {
        filter_type: display_type,
        static_hz,
        dyn_min_hz,
        dyn_max_hz,
    })
}

fn parse_dyn_hz_pair(unknown: &HashMap<&str, &str>, key: &str) -> (Option<u32>, Option<u32>) {
    let Some(value) = unknown.get(key) else { return (None, None); };
    let parts: Vec<u32> = value
        .split(',')
        .filter_map(|s| s.trim().parse::<u32>().ok())
        .collect();
    if parts.len() != 2 || (parts[0] == 0 && parts[1] == 0) {
        return (None, None);
    }
    (Some(parts[0]), Some(parts[1]))
}

fn parse_u32(unknown: &HashMap<&str, &str>, key: &str) -> Option<u32> {
    unknown.get(key).and_then(|s| s.trim().parse::<u32>().ok())
}

fn map_event(e: Event, time_sec: f32) -> EventFrame {
    match e {
        Event::Disarm(reason_code) => EventFrame::Disarming {
            time_sec,
            reason: Some(format!("code:{reason_code}")),
        },
        Event::End { disarm_reason } => EventFrame::Disarming {
            time_sec,
            reason: disarm_reason.map(|r| format!("end:{r}")),
        },
        Event::FlightMode { flags, last_flags: _ } => EventFrame::FlightModeChange {
            time_sec,
            flags: u64::from(flags),
        },
        other => EventFrame::Other {
            time_sec,
            // `{:?}` gives a stable enough discriminator for the M1.4
            // event-track to render; M1.6's readiness report can pretty
            // -print using a lookup table later.
            name: format!("{other:?}"),
        },
    }
}
