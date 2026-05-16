// Multi-axis time-domain log data — in NATIVE BF units.
//
// Rate signals (gyro, setpoint, error)  →  deg/s    (typically ±500)
// Actuator signals (throttle, motor)    →  µs       (1000–2000)
//
// Servos live in analysis-servos.jsx and are also in µs.
// SPA factor (analysis-data-multi.jsx) stays as a 0..1 multiplier — that IS
// its native form (DEBUG_SPA logs it as 0..1000 in BF, scaled here).

const _N = N;
const _range = n => [...Array(n).keys()];

// helpers — produce native-unit arrays from normalized 0..1 shapes
const _toDeg = (norm) => (norm - 0.5) * 1000;  // 0..1  → -500..+500 °/s
const _toUs  = (norm) => 1000 + norm * 1000;   // 0..1  → 1000..2000 µs

// gyro with servo-lag + small overshoot + scope noise, in deg/s — no clamping
const _lagGyro = (spDegArr, lagSamples, overshootScale, noiseDeg) =>
  spDegArr.map((v, i) => {
    const lag = i > lagSamples ? spDegArr[i - lagSamples] : v;
    const oversh = i > 0 ? (spDegArr[i] - spDegArr[i - 1]) * overshootScale : 0;
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * noiseDeg;
    return lag + oversh * 0.6 + noise;
  });

// --- Roll — most maneuverable axis ---
// inherits the SETPOINT shape from analysis-data.jsx, converted to deg/s
const SP_R = SETPOINT.map(_toDeg);
const GY_R = _lagGyro(SP_R, 6, 1.4, 12);
const ERR_R = GY_R.map((g, i) => g - SP_R[i]);

// --- Pitch — gentle climb + dive segments + recovery (bidirectional) ---
const SP_P = _range(_N).map(i => {
  const t = i / _N;
  const norm = 0.5
    + 0.04 * Math.sin(t * Math.PI * 4 + 0.3)              // cruise breathing
    + (t > 0.05 && t < 0.20 ? 0.14 : 0)                   // climb pitch up
    + (t > 0.42 && t < 0.50 ? -0.20 * Math.sin((t - 0.42) * Math.PI / 0.08) : 0) // dive
    + (t > 0.55 && t < 0.60 ? 0.16 * Math.sin((t - 0.55) * Math.PI / 0.05) : 0)  // pull-out
    + (t > 0.84 && t < 0.95 ? -0.14 : 0)                  // landing flare
    + 0.012 * Math.sin(t * Math.PI * 51)                  // stick chatter
    + 0.008 * Math.sin(t * Math.PI * 79 + 0.7);
  return _toDeg(norm);
});
const GY_P = _lagGyro(SP_P, 5, 1.1, 8);
const ERR_P = GY_P.map((g, i) => g - SP_P[i]);

// --- Yaw — small coordinating corrections, both directions ---
const SP_Y = _range(_N).map(i => {
  const t = i / _N;
  const norm = 0.5
    + 0.04 * Math.sin(t * Math.PI * 7 + 1.4)
    + (t > 0.30 && t < 0.34 ? 0.06 * Math.sin((t - 0.30) * Math.PI / 0.04) : 0)
    + (t > 0.62 && t < 0.66 ? -0.05 * Math.sin((t - 0.62) * Math.PI / 0.04) : 0)
    + 0.010 * Math.sin(t * Math.PI * 63 + 0.2);
  return _toDeg(norm);
});
const GY_Y = _lagGyro(SP_Y, 7, 1.0, 6);
const ERR_Y = GY_Y.map((g, i) => g - SP_Y[i]);

// --- Throttle in µs (real BF blackbox stores rcCommand[3] this way) ---
const THROTTLE = _range(_N).map(i => {
  const t = i / _N;
  let norm;
  if (t < 0.05) norm = 1.0;                                          // launch full
  else if (t < 0.18) norm = 0.85 + 0.05 * Math.sin(t * 30);          // climb
  else if (t > 0.45 && t < 0.55) norm = 0.15;                        // dive idle
  else if (t > 0.85 && t < 0.95) norm = 0.25 + 0.1 * Math.sin(t * 20); // approach
  else norm = 0.55 + 0.08 * Math.sin(t * Math.PI * 8)
              + (t > 0.62 && t < 0.72 ? 0.25 : 0);
  return _toUs(Math.max(0, Math.min(1, norm)));
});

// Single motor (push-prop wing), tiny dither vs throttle command — also µs
const MOTOR_1 = THROTTLE.map((th, i) => Math.max(1000, Math.min(2000, th + Math.sin(i * 1.3) * 10)));

// TPA factor — multiplier 0..1 (matches DEBUG_TPA[0] scaling)
const TPA_FACTOR_T = _range(_N).map(i => {
  const t = i / _N;
  const thN = (THROTTLE[i] - 1000) / 1000;
  const pitchDeg = SP_P[i]; // in deg/s already
  const speedEst = thN * (1.0 - pitchDeg * 0.0004);
  return Math.max(0, Math.min(1, 1.0 - speedEst * 0.55));
});

// SPA per-axis factor — kicks toward 0 when |setpoint| is high (deg/s threshold)
const _spaFactor = (spDegArr, centerDeg, widthDeg) => spDegArr.map(v => {
  const sr = Math.abs(v);
  const lo = centerDeg - widthDeg / 2, hi = centerDeg + widthDeg / 2;
  if (sr <= lo) return 1.0;
  if (sr >= hi) return 0.0;
  const t = (sr - lo) / (hi - lo);
  return 0.5 + 0.5 * Math.cos(t * Math.PI);
});
const SPA_R = _spaFactor(SP_R, 120, 80);   // center 120 °/s, width 80
const SPA_P = _spaFactor(SP_P, 160, 100);
const SPA_Y = SP_Y.map(() => 1.0);          // yaw SPA OFF

// Per-axis bundle — sp/gy/err in deg/s, spa is 0..1
const TIME_DOMAIN = {
  R: { sp: SP_R, gy: GY_R, err: ERR_R, spa: SPA_R, color: "#7ec8ff" },
  P: { sp: SP_P, gy: GY_P, err: ERR_P, spa: SPA_P, color: "#ff9d6a" },
  Y: { sp: SP_Y, gy: GY_Y, err: ERR_Y, spa: SPA_Y, color: AN.warn },
};

Object.assign(window, {
  SP_R, GY_R, ERR_R,
  SP_P, GY_P, ERR_P,
  SP_Y, GY_Y, ERR_Y,
  SPA_R, SPA_P, SPA_Y,
  THROTTLE, MOTOR_1, TPA_FACTOR_T,
  TIME_DOMAIN,
});
