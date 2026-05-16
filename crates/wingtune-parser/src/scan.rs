//! Scan output — what `scan(bytes)` returns. Bundles the capability
//! report, the time axis, event frames, and a handful of header strings
//! Layer 3 wants to render in the inspector. The actual `scan()` impl
//! lands in M1.2.2; this file is type-only for now.

use serde::{Deserialize, Serialize};

use crate::capability::CapabilityReport;
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
    /// Header strings useful to the M1.5 inspector. All optional — older
    /// firmware or aborted logs may be missing any subset.
    pub firmware_revision: Option<String>,
    pub firmware_date: Option<String>,
    pub board_info: Option<String>,
    pub craft_name: Option<String>,
}
