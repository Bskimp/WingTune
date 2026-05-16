//! `scan(bytes) -> ScanReport`. Single pass over the log's bytes that
//! produces capability metadata + the Float32 time axis + the event list.
//! Does NOT materialize per-field typed arrays — that is what `hydrate()`
//! is for, and the hydrate impl lands in M1.3.
//!
//! M1.2.2 scope: minimal viable scan. `sample_check`,
//! `voltage_sag_summary`, and a real `frame_index` are stubbed (empty /
//! `None` / empty) and filled in by follow-ups.

use std::collections::BTreeMap;

use blackbox_log::File;
use blackbox_log::data::ParserEvent;
use blackbox_log::event::Event;
use blackbox_log::frame::FrameDef;
use serde::{Deserialize, Serialize};

use crate::capability::{CapabilityReport, FrameIndex};
use crate::event::EventFrame;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScanError {
    /// File contains no log-start markers.
    NoLogs,
    /// Headers of the first log could not be parsed.
    InvalidHeaders { reason: String },
}

pub fn scan(bytes: &[u8]) -> Result<ScanReport, ScanError> {
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
            }
            ParserEvent::Event(e) => {
                let last_time_sec = time_sec.last().copied().unwrap_or(0.0);
                events.push(map_event(e, last_time_sec));
            }
            ParserEvent::Gps(_) => {
                gps_present = true;
            }
            ParserEvent::Slow(_) => {
                // Slow frames carry mode flags, vbat, etc. M1.3+ will
                // sample them for voltage_sag_summary and arm/disarm
                // inference; for M1.2 we ignore them.
            }
        }
    }

    let capability = CapabilityReport {
        fields_present,
        debug_mode,
        gps_present,
        // Stubbed for M1.2 — filled in by follow-ups.
        sample_check: BTreeMap::new(),
        frame_index: FrameIndex::default(),
        total_frames,
        voltage_sag_summary: None,
    };

    Ok(ScanReport {
        capability,
        time_sec,
        events,
        firmware_revision,
        firmware_date,
        board_info,
        craft_name,
    })
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
