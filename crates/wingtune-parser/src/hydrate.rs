//! `hydrate(bytes, field_ids) -> Vec<(String, Vec<f32>)>`.
//!
//! Given a log's bytes and a set of field names, decode every main frame
//! and pull out the value of each requested field per frame. Returns one
//! `Vec<f32>` per requested field, in the same order as `field_ids`. Fields
//! that don't exist in the log come back as empty vectors — the caller
//! checks `len() == 0` to detect that case.
//!
//! M1.3.2 keeps this stateless (re-iterates from the start) and ignores
//! the `FrameIndex` seek hints. Faster seek lands when blackbox-log exposes
//! byte offsets or when we add an iteration-skip helper.

use blackbox_log::File;
use blackbox_log::data::ParserEvent;
use blackbox_log::frame::{Frame, FrameDef, MainValue};
use blackbox_log::units::si::{
    acceleration::meter_per_second_squared, angular_velocity::degree_per_second,
    electric_current::ampere, electric_potential::volt,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HydrateError {
    NoLogs,
    InvalidHeaders { reason: String },
}

pub fn hydrate(
    bytes: &[u8],
    field_ids: &[String],
) -> Result<Vec<(String, Vec<f32>)>, HydrateError> {
    let file = File::new(bytes);
    let first = file.iter().next().ok_or(HydrateError::NoLogs)?;
    let headers =
        first.map_err(|e| HydrateError::InvalidHeaders { reason: format!("{e}") })?;

    // Resolve each requested field name to its index in main_frame_def.
    // Missing names get None and produce empty vectors downstream.
    let main_def = headers.main_frame_def();
    let resolved: Vec<Option<usize>> = field_ids
        .iter()
        .map(|name| main_def.iter().position(|f| f.name == *name))
        .collect();

    let mut buffers: Vec<Vec<f32>> = vec![Vec::new(); field_ids.len()];

    let mut parser = headers.data_parser();
    while let Some(ev) = parser.next() {
        let ParserEvent::Main(frame) = ev else {
            continue;
        };
        for (slot, maybe_idx) in buffers.iter_mut().zip(resolved.iter()) {
            let Some(idx) = maybe_idx else { continue };
            if let Some(value) = frame.get(*idx) {
                slot.push(main_value_to_f32(value));
            }
        }
    }

    Ok(field_ids.iter().cloned().zip(buffers).collect())
}

/// Project a `MainValue` to f32. Unit-bearing variants use the SI base unit
/// chosen by the M1 doc (radians/sec for gyro, m/s² for accel, volts, amps);
/// downstream callers re-scale to display units (deg/s, G, etc.) at render
/// time, not here.
fn main_value_to_f32(v: MainValue) -> f32 {
    match v {
        MainValue::Unsigned(u) => u as f32,
        MainValue::Signed(s) => s as f32,
        MainValue::Voltage(p) => p.get::<volt>() as f32,
        MainValue::Amperage(c) => c.get::<ampere>() as f32,
        MainValue::Acceleration(a) => a.get::<meter_per_second_squared>() as f32,
        MainValue::Rotation(r) => r.get::<degree_per_second>() as f32,
    }
}
