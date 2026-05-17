//! `hydrate(bytes, field_ids) -> HydrateResult`.
//!
//! Given a log's bytes and a set of field names, decode every frame and pull
//! out the requested values. Two flavours of field share one call:
//!
//!   · main-frame fields — request by their `main_frame_def` name. Returned
//!     values align with the scan report's `time_sec` axis (one sample per
//!     main frame).
//!   · GPS-frame fields — request with the `gps:` prefix (matching how
//!     scan.rs surfaces them in `fields_present`). The prefix is stripped
//!     before lookup in `gps_frame_def`. Returned values align with the
//!     `gps_times_sec` axis on the result — GPS frames fire at ~5–10 Hz
//!     vs ~125 Hz main frames, so each axis is independent.
//!
//! Both axes share a time origin: seconds since the first main frame's
//! `time_raw()`. Layer 2's `lib/timeAlign.ts` resamples GPS values onto
//! the main-frame axis when an analytics module wants length-matched
//! arrays (e.g. the M3 airspeed fit needs throttle + vbat + gpsSpeed all
//! aligned to one time axis).
//!
//! Stateless re-iteration from the start; `FrameIndex` seek hints are
//! still unused.

use blackbox_log::File;
use blackbox_log::data::ParserEvent;
use blackbox_log::frame::{Frame, FrameDef, GpsValue, MainValue};
use blackbox_log::units::si::{
    acceleration::meter_per_second_squared, angular_velocity::degree_per_second,
    electric_current::ampere, electric_potential::volt, length::meter,
    velocity::meter_per_second,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HydrateError {
    NoLogs,
    InvalidHeaders { reason: String },
}

const GPS_PREFIX: &str = "gps:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HydrateResult {
    /// (field_name, values), one entry per requested id in request order.
    /// Names with the `gps:` prefix align with `gps_times_sec`; others
    /// align with the scan report's `time_sec`.
    pub fields: Vec<(String, Vec<f32>)>,
    /// Per-GPS-frame timestamps in seconds since first main frame. Empty
    /// when no `gps:` field was requested (the iteration short-circuits
    /// past GPS frames in that case).
    pub gps_times_sec: Vec<f32>,
}

pub fn hydrate(
    bytes: &[u8],
    field_ids: &[String],
) -> Result<HydrateResult, HydrateError> {
    let file = File::new(bytes);
    let first = file.iter().next().ok_or(HydrateError::NoLogs)?;
    let headers =
        first.map_err(|e| HydrateError::InvalidHeaders { reason: format!("{e}") })?;

    let main_def = headers.main_frame_def();
    let gps_def = headers.gps_frame_def();

    enum Resolution {
        Main(usize),
        Gps(usize),
        Missing,
    }

    let resolved: Vec<Resolution> = field_ids
        .iter()
        .map(|name| {
            if let Some(stripped) = name.strip_prefix(GPS_PREFIX) {
                gps_def
                    .as_ref()
                    .and_then(|d| d.iter().position(|f| f.name == stripped))
                    .map_or(Resolution::Missing, Resolution::Gps)
            } else {
                main_def
                    .iter()
                    .position(|f| f.name == *name)
                    .map_or(Resolution::Missing, Resolution::Main)
            }
        })
        .collect();

    let any_gps_requested = resolved.iter().any(|r| matches!(r, Resolution::Gps(_)));

    let mut buffers: Vec<Vec<f32>> = vec![Vec::new(); field_ids.len()];
    let mut gps_times_sec: Vec<f32> = Vec::new();
    let mut t0_micros: Option<u64> = None;

    let mut parser = headers.data_parser();
    while let Some(ev) = parser.next() {
        match ev {
            ParserEvent::Main(frame) => {
                t0_micros.get_or_insert(frame.time_raw());
                for (slot, res) in buffers.iter_mut().zip(resolved.iter()) {
                    let Resolution::Main(idx) = res else { continue };
                    if let Some(value) = frame.get(*idx) {
                        slot.push(main_value_to_f32(value));
                    }
                }
            }
            ParserEvent::Gps(frame) if any_gps_requested => {
                let t_raw = frame.time_raw();
                let t0 = *t0_micros.get_or_insert(t_raw);
                let dt_sec = (t_raw.saturating_sub(t0) as f64 / 1_000_000.0) as f32;
                gps_times_sec.push(dt_sec);
                for (slot, res) in buffers.iter_mut().zip(resolved.iter()) {
                    let Resolution::Gps(idx) = res else { continue };
                    if let Some(value) = frame.get(*idx) {
                        slot.push(gps_value_to_f32(value));
                    }
                }
            }
            _ => {}
        }
    }

    Ok(HydrateResult {
        fields: field_ids.iter().cloned().zip(buffers).collect(),
        gps_times_sec,
    })
}

pub(crate) fn main_value_to_f32(v: MainValue) -> f32 {
    match v {
        MainValue::Unsigned(u) => u as f32,
        MainValue::Signed(s) => s as f32,
        MainValue::Voltage(p) => p.get::<volt>() as f32,
        MainValue::Amperage(c) => c.get::<ampere>() as f32,
        MainValue::Acceleration(a) => a.get::<meter_per_second_squared>() as f32,
        MainValue::Rotation(r) => r.get::<degree_per_second>() as f32,
    }
}

pub(crate) fn gps_value_to_f32(v: GpsValue) -> f32 {
    match v {
        GpsValue::Coordinate(c) => c as f32,
        GpsValue::Altitude(a) => a.get::<meter>() as f32,
        GpsValue::Velocity(v) => v.get::<meter_per_second>() as f32,
        GpsValue::Heading(h) => h as f32,
        GpsValue::Unsigned(u) => u as f32,
        GpsValue::Signed(s) => s as f32,
    }
}
