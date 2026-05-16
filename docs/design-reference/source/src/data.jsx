// Shared mock data for all three design directions.
// Realistic wing-specific values — BF 2026.6.0-alpha decoded log.

const WT_FILE = {
  name: "BTFL_BLACKBOX_LOG_Skywing_20260514_143022.bfl",
  shortName: "Skywing · 14:30:22",
  size_mb: 47.2,
  parsedAtMs: 824,
  hash: "f3a91c2",
};

const WT_QUEUE = [
  {
    id: "q1",
    name: "BTFL_BLACKBOX_LOG_Skywing_20260514_143022.bfl",
    short: "Skywing · 14:30:22",
    duration: "4:32",
    fw: "BF 2026.6.0-α",
    state: "active",
    size_mb: 47.2,
  },
  {
    id: "q2",
    name: "BTFL_BLACKBOX_LOG_Skywing_20260514_141507.bfl",
    short: "Skywing · 14:15:07",
    duration: "3:14",
    fw: "BF 2026.6.0-α",
    state: "queued",
    size_mb: 33.6,
  },
  {
    id: "q3",
    name: "BTFL_BLACKBOX_LOG_Skywing_20260512_092201.bfl",
    short: "Skywing · 12-May 09:22",
    duration: "8:51",
    fw: "BF 2026.5.2",
    state: "queued",
    size_mb: 91.0,
  },
];

const WT_CAPS = {
  firmware: {
    label: "Firmware",
    value: "Betaflight 2026.6.0-alpha",
    sub: "target STM32F411 · rev f3a91c2",
    confidence: "high",
  },
  controller: {
    label: "Controller",
    value: "PIDFS",
    sub: "S-term active · gain 22",
    detail: [
      ["P", "62"], ["I", "48"], ["D", "28"], ["F", "115"], ["S", "22"],
    ],
    confidence: "high",
  },
  tpa: {
    label: "TPA",
    value: "Airspeed-scheduled",
    sub: "throttle+pitch estimator · BASIC",
    detail: [
      ["mode",       "airspeed"],
      ["estimator",  "BASIC"],
      ["delay",      "1000 ms"],
      ["gravity",    "50 %"],
      ["v_max",      "25.2 V"],
      ["curve",      "hyperbolic 0.65"],
    ],
    confidence: "high",
  },
  spa: {
    label: "SPA",
    value: "per-axis attenuation",
    sub: "R: PD_I_FREEZE · P: I_FREEZE · Y: OFF",
    note: "Yaw is OFF — fine for cruise wings, but if you launch with sharp rudder kicks the I-term will wind up. Consider Y: I_FREEZE @ center 180°/s.",
    detail: [
      ["roll",  "PD_I_FREEZE"],
      ["r.ctr", "120 °/s"],
      ["r.wid", "80 °/s"],
      ["pitch", "I_FREEZE"],
      ["p.ctr", "160 °/s"],
      ["p.wid", "100 °/s"],
      ["yaw",   "OFF"],
    ],
    confidence: "medium",
  },
  debug: {
    label: "Debug mode",
    value: "SPA",
    sub: "3 axes · per-axis multiplier logged",
    unlocks: [
      "spa_factor_R",
      "spa_factor_P",
      "spa_factor_Y",
    ],
    confidence: "high",
  },
  log: {
    label: "Log",
    value: "4:32 · 2 kHz",
    sub: "0.02% dropped · 47.2 MB",
    detail: [
      ["duration", "272.4 s"],
      ["rate", "2 000 Hz"],
      ["dropped", "0.02 %"],
      ["size", "47.2 MB"],
    ],
    confidence: "high",
  },
};

// Main-frame fields. dtype is the on-wire decoded type. confidence here means
// "do we trust the field is what its name says it is" — false for fields the
// fw lookup couldn't resolve to a canonical name.
const WT_FIELDS = [
  { name: "gyroADC",         count: 3, dtype: "i16", present: true,  note: "roll · pitch · yaw" },
  { name: "rcCommand",       count: 4, dtype: "i16", present: true,  note: "roll · pitch · yaw · throttle" },
  { name: "setpoint",        count: 4, dtype: "i16", present: true,  note: "rate-domain" },
  { name: "motor",           count: 1, dtype: "u16", present: true,  note: "single-motor pusher" },
  { name: "servo",           count: 4, dtype: "i16", present: true,  note: "ail L · ail R · elev · rud" },
  { name: "GPS_speed",       count: 1, dtype: "u16", present: true,  note: "groundspeed · cm/s" },
  { name: "accSmooth",       count: 3, dtype: "i16", present: true,  note: "x · y · z" },
  { name: "vbatLatest",      count: 1, dtype: "u16", present: true,  note: "battery" },
  { name: "amperageLatest",  count: 1, dtype: "u16", present: false, note: "sensor not enabled" },
  { name: "magADC",          count: 3, dtype: "i16", present: false, note: "compass off" },
  { name: "baroAlt",         count: 1, dtype: "i32", present: true,  note: "baro · m × 100" },
  { name: "gpsCoord",        count: 2, dtype: "i32", present: true,  note: "lat · lon" },
];

Object.assign(window, { WT_FILE, WT_QUEUE, WT_CAPS, WT_FIELDS });
