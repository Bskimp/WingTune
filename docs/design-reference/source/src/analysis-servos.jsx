// Servo / mixer data — wings steer with PWM servos, in native µs (1000-2000).

const MIXER = {
  id: "DELTA",
  label: "Delta",
  short: "2 elevons + thr",
  channels: [
    { id: "el_l", label: "Elevon-L", axes: ["P", "R"], color: "#7ec8ff", sign: { P: +1, R: +1 } },
    { id: "el_r", label: "Elevon-R", axes: ["P", "R"], color: "#ff9d6a", sign: { P: +1, R: -1 } },
    { id: "thr",  label: "Throttle", axes: [],         color: AN.warn,   sign: {} },
  ],
};

// Synthesize servo PWM directly in µs from per-axis setpoints
const _wingNoiseUs = (i, ampUs) => (Math.sin(i * 1.3) + Math.cos(i * 0.7) * 0.6) * ampUs;
// Use the normalized inputs from analysis-data.jsx for shape, scaled to µs
const ELEVON_L = SETPOINT.map((_, i) => {
  // pitch/roll combine to drive both elevons; use the (now native) deg/s values
  // and convert proportionally to PWM deflection. Wing rates of ±500°/s map to
  // about ±500 µs of servo deflection from center.
  const pitchDeg = SP_P[i];
  const rollDeg  = SP_R[i];
  const deflectUs = (pitchDeg + rollDeg) * 0.65;
  return Math.max(1000, Math.min(2000, 1500 + deflectUs + _wingNoiseUs(i, 12)));
});
const ELEVON_R = SETPOINT.map((_, i) => {
  const pitchDeg = SP_P[i];
  const rollDeg  = SP_R[i];
  const deflectUs = (pitchDeg - rollDeg) * 0.65;
  return Math.max(1000, Math.min(2000, 1500 + deflectUs + _wingNoiseUs(i + 11, 14)));
});

// Insert saturation events
const _saturate = (arr, ranges) => arr.map((v, i) => {
  for (const [s, e, val] of ranges) if (i >= s && i <= e) return val;
  return v;
});
const ELEVON_R_SAT = _saturate(ELEVON_R, [
  [128, 138, 2000],  // saturated high during throw
  [142, 146, 2000],
]);
const ELEVON_L_SAT = _saturate(ELEVON_L, [
  [12,  18,  1000],  // saturated low during launch recovery
]);

// Saturation event windows (kept as 0..1 fractions of total flight for overlay rendering)
const SAT_R = [{ s: 0.64, e: 0.69, src: "Elevon-R", label: "endpoint · throw" }];
const SAT_P = [{ s: 0.06, e: 0.09, src: "Elevon-L", label: "endpoint · launch" }];
const SAT_Y = [];

// Mixer presets reference
const MIXER_PRESETS = {
  DELTA:        { short: "2 elevons + thr",   channels: ["Elevon-L", "Elevon-R", "Throttle"] },
  CONVENTIONAL: { short: "ail+ele+rud+thr",   channels: ["Aileron", "Elevator", "Rudder", "Throttle"] },
  V_TAIL:       { short: "2 ruddervators + ail + thr", channels: ["Ruddervator-L", "Ruddervator-R", "Aileron", "Throttle"] },
};

Object.assign(window, {
  MIXER, MIXER_PRESETS,
  ELEVON_L: ELEVON_L_SAT, ELEVON_R: ELEVON_R_SAT,
  ELEVON_L_RAW: ELEVON_L, ELEVON_R_RAW: ELEVON_R,
  SAT_R, SAT_P, SAT_Y,
});

