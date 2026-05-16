// Synthetic but believable wing-shaped traces, in 0..1 space.
// 200 samples each — enough to look real, cheap to render.

const N = 200;
const range = n => [...Array(n).keys()];

// Setpoint: a few rolling turns + bidirectional aileron rolls (both peaks AND valleys)
const SETPOINT = range(N).map(i => {
  const t = i / N;
  return 0.5
    // gentle cruise oscillations — symmetric
    + 0.10 * Math.sin(t * Math.PI * 6)
    + 0.06 * Math.sin(t * Math.PI * 13.5 + 1.1)
    // aileron roll-pair around t=0.3 — left then right
    + (t > 0.28 && t < 0.36 ? 0.34 * Math.sin((t - 0.28) * Math.PI / 0.04) : 0)
    // hard turn at t=0.50 — single big positive
    + (t > 0.48 && t < 0.54 ? 0.30 * Math.sin((t - 0.48) * Math.PI / 0.06) : 0)
    // counter turn at t=0.62 — big negative (the valley we were missing)
    + (t > 0.60 && t < 0.68 ? -0.32 * Math.sin((t - 0.60) * Math.PI / 0.08) : 0)
    // small recovery flick at t=0.82
    + (t > 0.81 && t < 0.85 ? -0.18 * Math.sin((t - 0.81) * Math.PI / 0.04) : 0)
    // high-frequency stick chatter (real RC inputs have this)
    + 0.018 * Math.sin(t * Math.PI * 47)
    + 0.012 * Math.sin(t * Math.PI * 83 + 0.4);
});
// Gyro: setpoint with lag + a little overshoot + scope noise (the jittery look of real gyro)
const GYRO = SETPOINT.map((v, i) => {
  const lag = i > 6 ? SETPOINT[i - 6] : v;
  const overshoot = i > 0 ? (SETPOINT[i] - SETPOINT[i - 1]) * 1.4 : 0;
  // wide-band noise — what gyro looks like before filtering
  const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9) + Math.sin(i * 4.3) * 0.5 + Math.cos(i * 7.1) * 0.3) * 0.018;
  return lag + overshoot * 0.6 + noise;
});
// Error = gyro - setpoint (re-centered around 0.5 for plotting)
const ERROR = GYRO.map((g, i) => 0.5 + (g - SETPOINT[i]) * 1.8);

// PID contributions (normalized) — what each term is asking the actuator to do
const P_CONTRIB = ERROR.map(e => 0.5 + (e - 0.5) * 0.9);
const I_CONTRIB = (() => {
  let acc = 0.5;
  return ERROR.map(e => { acc = acc * 0.985 + (e - 0.5) * 0.018; return Math.max(0.05, Math.min(0.95, 0.5 + acc * 1.0)); });
})();
const D_CONTRIB = ERROR.map((e, i) => 0.5 + (i > 0 ? (ERROR[i] - ERROR[i - 1]) * 6 : 0));
const F_CONTRIB = SETPOINT.map((s, i) => 0.5 + (i > 0 ? (SETPOINT[i] - SETPOINT[i - 1]) * 8 : 0));
const S_CONTRIB = SETPOINT.map(s => 0.5 + (s - 0.5) * 0.35);

// Step response: classic underdamped curve with overshoot, settling ~ 200 ms
const STEP_REF = range(N).map(i => i < 8 ? 0.2 : 0.85);
const STEP_OUT = range(N).map(i => {
  if (i < 8) return 0.2;
  const t = (i - 8) / 40; // settling timescale
  const env = Math.exp(-t * 1.6);
  return 0.85 - env * 0.65 * Math.cos(t * Math.PI * 1.7);
});

// Filter group-delay budget across the chain (ms per stage)
const FILTER_BUDGET = [
  { name: "gyro LPF1",       ms: 1.1, kind: "biquad", note: "PT2 · 200 Hz" },
  { name: "gyro LPF2",       ms: 0.6, kind: "biquad", note: "PT1 · 350 Hz" },
  { name: "dyn notch",       ms: 0.9, kind: "notch",  note: "tracker · 3 bins" },
  { name: "D-term LPF1",     ms: 1.4, kind: "biquad", note: "PT2 · 90 Hz" },
  { name: "D-term LPF2",     ms: 0.7, kind: "biquad", note: "PT1 · 180 Hz" },
  { name: "yaw LPF",         ms: 1.2, kind: "biquad", note: "PT1 · 90 Hz" },
];

// SPA curve: attenuation vs setpoint rate (deg/s, 0..500)
const SPA_CURVE = range(60).map(i => {
  const rate = (i / 59) * 500;
  if (rate < 120) return 0.0;          // below threshold: no attenuation
  if (rate < 200) return (rate - 120) / 80 * 0.7;
  return 0.7;                           // ceiling
});
// recommended for wing
const SPA_REC = range(60).map(i => {
  const rate = (i / 59) * 500;
  if (rate < 180) return 0.0;
  if (rate < 280) return (rate - 180) / 100 * 0.55;
  return 0.55;
});

// TPA airspeed: attenuation vs airspeed (m/s, 0..30)
const TPA_CURVE = range(60).map(i => {
  const v = (i / 59) * 30;
  if (v < 12) return 0.0;
  if (v < 18) return (v - 12) / 6 * 0.35;
  if (v < 26) return 0.35 + (v - 18) / 8 * 0.30;
  return 0.65;
});

Object.assign(window, {
  SETPOINT, GYRO, ERROR,
  P_CONTRIB, I_CONTRIB, D_CONTRIB, F_CONTRIB, S_CONTRIB,
  STEP_REF, STEP_OUT,
  FILTER_BUDGET, SPA_CURVE, SPA_REC, TPA_CURVE,
});
