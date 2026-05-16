//! Event-frame stream emitted alongside the capability report by `scan()`.
//! Each variant corresponds to a known event-frame kind in the BBL spec
//! (flight mode change, arm/disarm, RX loss, failsafe phase change).
//! `Other` is the catch-all for event types we haven't modeled yet so a
//! log that introduces a new event kind still scans without error.
//!
//! M1.4 renders these as vertical flags on the time-series timeline.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventFrame {
    FlightModeChange { time_sec: f32, flags: u64 },
    Arming { time_sec: f32 },
    Disarming { time_sec: f32, reason: Option<String> },
    RxLoss { time_sec: f32 },
    Failsafe { time_sec: f32, phase: String },
    /// Catch-all for event types this version of WingTune doesn't model.
    /// `name` carries the raw event name from `blackbox-log` so the M1.4
    /// timeline can still render it (as a generic flag) and so M1.6 can
    /// report it as "unrecognized event seen N times" without failing
    /// the scan.
    Other { time_sec: f32, name: String },
}
