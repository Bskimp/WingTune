// Spectrum tab — gyro PSD with toggleable per-filter overlays.
// X axis: log frequency, 1 → 500 Hz. Wing-interesting band (0–50 Hz) is
// the prominent half. Y axis: dB.
//
// What gets plotted:
//   · pre-filter trace (raw gyro noise floor)
//   · post-filter trace (after every enabled filter applies in series)
//   · each enabled filter's transfer function |H(f)|² (dB), faded
//
// Toggling a filter chip recomputes the post-filter curve live — you see
// exactly which band each filter is doing work in.

const { useState: useStateSp } = React;

// --- frequency axis ---
const SP_FMIN = 1, SP_FMAX = 500, SP_NF = 240;
const SP_FREQ = [...Array(SP_NF)].map((_, i) =>
  SP_FMIN * Math.pow(SP_FMAX / SP_FMIN, i / (SP_NF - 1))
);

// log-x position in 0..100 for a freq f
const fx = f => (Math.log(f / SP_FMIN) / Math.log(SP_FMAX / SP_FMIN)) * 100;

// db-y position in 0..100 for a dB value in [-90..+10]
const SP_DB_MIN = -90, SP_DB_MAX = 10;
const dy = db => (1 - (db - SP_DB_MIN) / (SP_DB_MAX - SP_DB_MIN)) * 100;

// --- pre-filter spectrum (synthetic but believable) ---
const peakBump = (f, f0, q, gain) => gain * Math.exp(-Math.pow((f - f0) / q, 2));
const pinkBase  = f => -10 * Math.log10(f) - 8;
const SP_PEAKS  = [
  { f0: 28,  q: 3.5, gain: 22, label: "prop · 28 Hz"   },
  { f0: 47,  q: 4,   gain: 14, label: "airframe · 47 Hz" },
  { f0: 95,  q: 6,   gain: 18, label: "servo · 95 Hz"   },
  { f0: 190, q: 14,  gain: 16, label: "motor · 190 Hz"  },
];
const SP_PRE = SP_FREQ.map(f => {
  let v = pinkBase(f);
  SP_PEAKS.forEach(p => v += peakBump(f, p.f0, p.q, p.gain));
  v += (Math.sin(f * 0.7) + Math.cos(f * 1.3) * 0.6) * 0.5; // noise
  return v;
});

// --- filter transfer functions ---
const pt1Db   = (f, fc)        => -10 * Math.log10(1 + Math.pow(f / fc, 2));
const pt2Db   = (f, fc)        => -20 * Math.log10(1 + Math.pow(f / fc, 2));
const notchDb = (f, f0, qBand) => {
  // Gaussian-ish dip: -depth dB at f0, width controlled by qBand (bandwidth)
  const depth = 32;
  const r = (f - f0) / qBand;
  return -depth * Math.exp(-r * r);
};

// chain definition matches the gyro side of FILTER_BUDGET (analysis-data.jsx)
const SP_CHAIN = [
  { id: "lpf1",  name: "gyro LPF1", kind: "PT2",   fc: 200, ms: 1.1, color: AN.accent, fn: f => pt2Db(f, 200) },
  { id: "lpf2",  name: "gyro LPF2", kind: "PT1",   fc: 350, ms: 0.6, color: "#7ec8ff", fn: f => pt1Db(f, 350) },
  { id: "notch", name: "dyn notch", kind: "notch", fc: 95,  ms: 0.9, color: AN.warn,
    note: "tracker · Q≈8", fn: f => notchDb(f, 95, 12) },
];

// Apply enabled filters in series to pre-filter spectrum.
const applyFilters = (enabledIds) => SP_FREQ.map((f, i) => {
  let db = SP_PRE[i];
  SP_CHAIN.forEach(filt => { if (enabledIds[filt.id]) db += filt.fn(f); });
  return db;
});

// Path-builder for absolute log/db coords
const spPath = (vals) => vals.map((v, i) => `${fx(SP_FREQ[i])},${dy(v)}`).join(" ");

// --- ticks for log-x axis ---
const SP_TICKS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const SP_TICKS_MAJOR = new Set([1, 10, 50, 100, 500]);

// --- panel ---

const SpectrumPanel = () => {
  const [enabled, setEnabled] = useStateSp({ lpf1: true, lpf2: true, notch: true });
  const [showPre, setShowPre] = useStateSp(true);
  const [showPost, setShowPost] = useStateSp(true);
  const [axis, setAxis] = useStateSp("R");

  const post = applyFilters(enabled);

  // peak detection (very simple: argmax in pre and post over the wing band 0..150 Hz)
  const peakIdx = arr => {
    let best = 0;
    arr.forEach((v, i) => { if (SP_FREQ[i] < 150 && v > arr[best]) best = i; });
    return best;
  };
  const prePk  = peakIdx(SP_PRE);
  const postPk = peakIdx(post);
  const attenuationDb = SP_PRE[prePk] - post[prePk];
  const totalMs = SP_CHAIN.reduce((a, f) => a + (enabled[f.id] ? f.ms : 0), 0);

  const toggle = id => setEnabled(s => ({ ...s, [id]: !s[id] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* filter chain bar */}
      <div style={{
        background: AN.surface, border: `1px solid ${AN.line2}`,
        padding: "10px 12px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div>
            <div style={{ color: AN.ink, fontFamily: FH, fontSize: 13, fontWeight: 600 }}>
              Filter chain · gyro side
            </div>
            <div style={{ color: AN.ink3, fontFamily: FM, fontSize: 10.5, marginTop: 1 }}>
              click to toggle  ·  see each filter's attenuation overlay live on the plot below
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", fontFamily: FM, fontSize: 11 }}>
            <span style={{ color: AN.ink3 }}>chain delay</span>
            <span style={{ color: totalMs > 5 ? AN.stamp : AN.ink, fontFamily: FM, fontSize: 13 }}>
              {totalMs.toFixed(1)} ms <span style={{ color: AN.ink3 }}>/ 5.0</span>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SP_CHAIN.map(f => {
            const on = enabled[f.id];
            const attHere = -f.fn(f.fc); // attenuation at corner / center freq
            return (
              <button key={f.id} onClick={() => toggle(f.id)} style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "5px 10px",
                background: on ? `${f.color}14` : "transparent",
                border: `1px solid ${on ? f.color : AN.line2}`,
                color: on ? AN.ink : AN.ink3,
                fontFamily: FM, fontSize: 11.5,
                cursor: "pointer", borderRadius: 2,
                transition: "all 120ms",
              }}>
                <span style={{
                  width: 10, height: 10,
                  border: `1.5px solid ${on ? f.color : AN.line2}`,
                  background: on ? f.color : "transparent",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  color: AN.bg,
                }}>{on && <IconCheck size={7} />}</span>
                <span style={{ color: on ? AN.ink : AN.ink3 }}>{f.name}</span>
                <span style={{ color: on ? f.color : AN.dim }}>{f.kind}</span>
                <span style={{ color: AN.ink3 }}>·</span>
                <span style={{ color: AN.ink3 }}>{f.fc} Hz</span>
                <span style={{ color: AN.ink3 }}>·</span>
                <span style={{ color: AN.ink3 }}>{f.ms.toFixed(1)} ms</span>
                {f.note && <span style={{ color: AN.dim, fontSize: 10.5 }}>· {f.note}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* main spectrum plot */}
      <AnPlot
        title="Gyro PSD · roll axis"
        sub="frequency response, dB · log scale 1 → 500 Hz · wing band 0–50 Hz highlighted"
        height={360}
        right={
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {/* pre/post toggles */}
            <div style={{ display: "flex", gap: 8, fontFamily: FM, fontSize: 11 }}>
              <button onClick={() => setShowPre(v => !v)} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "3px 8px",
                background: showPre ? `${AN.ink2}1a` : "transparent",
                border: `1px solid ${showPre ? AN.ink2 : AN.line2}`,
                color: showPre ? AN.ink : AN.ink3,
                cursor: "pointer", fontFamily: FM, fontSize: 11,
              }}>
                <span style={{ width: 12, height: 0, borderTop: `1.5px dashed ${showPre ? AN.ink2 : AN.line2}`, display: "inline-block" }} />
                pre
              </button>
              <button onClick={() => setShowPost(v => !v)} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "3px 8px",
                background: showPost ? `${AN.accent}1a` : "transparent",
                border: `1px solid ${showPost ? AN.accent : AN.line2}`,
                color: showPost ? AN.accent : AN.ink3,
                cursor: "pointer", fontFamily: FM, fontSize: 11,
              }}>
                <span style={{ width: 12, height: 2, background: showPost ? AN.accent : AN.line2, display: "inline-block" }} />
                post
              </button>
            </div>
            {/* axis selector */}
            <div style={{ display: "flex", gap: 1 }}>
              {["R", "P", "Y"].map(ax => (
                <span key={ax} onClick={() => setAxis(ax)} style={{
                  padding: "3px 9px", fontFamily: FM, fontSize: 11,
                  color: ax === axis ? AN.bg : AN.ink3,
                  background: ax === axis ? AN.accent : AN.surface2,
                  border: `1px solid ${ax === axis ? AN.accent : AN.line2}`,
                  fontWeight: 600, cursor: "pointer",
                }}>{ax}</span>
              ))}
            </div>
          </div>
        }
      >
        {/* wing band highlight (0..50 Hz) */}
        <div style={{
          position: "absolute", left: 10, top: 10, height: "calc(100% - 20px)",
          width: `calc(${fx(50)}% - 10px)`,
          background: `linear-gradient(90deg, ${AN.ok}0a, transparent)`,
          borderRight: `1px dashed ${AN.ok}55`,
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", left: 14, top: 12,
          fontFamily: FS, fontSize: 9, color: AN.ok,
          letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase",
        }}>wing band</div>

        <AnAxes vLines={0} hLines={5} />
        <svg style={{ position: "absolute", inset: 10, width: "calc(100% - 20px)", height: "calc(100% - 20px)" }}
             preserveAspectRatio="none" viewBox="0 0 100 100">
          {/* major freq gridlines */}
          {SP_TICKS.map(t => (
            <line key={t} x1={fx(t)} x2={fx(t)} y1="0" y2="100"
                  stroke={SP_TICKS_MAJOR.has(t) ? AN.line2 : AN.line}
                  strokeWidth={SP_TICKS_MAJOR.has(t) ? 0.3 : 0.15}
                  strokeDasharray={SP_TICKS_MAJOR.has(t) ? "none" : "1,1"} />
          ))}
          {/* 0 dB reference */}
          <line x1="0" x2="100" y1={dy(0)} y2={dy(0)}
                stroke={AN.line2} strokeWidth="0.3" strokeDasharray="2,1" />

          {/* filter transfer overlays (only enabled, faded) */}
          {SP_CHAIN.filter(f => enabled[f.id]).map(f => {
            const vals = SP_FREQ.map(freq => f.fn(freq));
            return (
              <g key={f.id} opacity="0.55">
                <polyline points={spPath(vals)} fill="none" stroke={f.color} strokeWidth="0.6" strokeDasharray="1.5,1" />
                {/* marker at cutoff */}
                <line x1={fx(f.fc)} x2={fx(f.fc)} y1="0" y2="100"
                      stroke={f.color} strokeWidth="0.25" strokeDasharray="1,2" opacity="0.6" />
              </g>
            );
          })}

          {/* pre-filter */}
          {showPre && (
            <polyline points={spPath(SP_PRE)} fill="none" stroke={AN.ink2} strokeWidth="0.6" strokeDasharray="2.5,1.5" />
          )}
          {/* post-filter (filled under) */}
          {showPost && (
            <>
              <polygon
                points={`${fx(SP_FMIN)},100 ${spPath(post)} ${fx(SP_FMAX)},100`}
                fill={AN.accent} opacity="0.12"
              />
              <polyline points={spPath(post)} fill="none" stroke={AN.accent} strokeWidth="0.85" />
            </>
          )}

          {/* annotate the pre-filter peaks (clean) */}
          {showPre && SP_PEAKS.map(p => (
            <g key={p.f0} opacity="0.7">
              <line x1={fx(p.f0)} x2={fx(p.f0)} y1={dy(SP_PRE[Math.round(p.f0)] || 0)} y2={dy(SP_PRE[Math.round(p.f0)] || 0) - 4}
                    stroke={AN.ink3} strokeWidth="0.3" />
            </g>
          ))}
        </svg>

        {/* x-axis tick labels */}
        <div style={{ position: "absolute", left: 10, right: 10, bottom: 0, height: 14, pointerEvents: "none" }}>
          {SP_TICKS.filter(t => SP_TICKS_MAJOR.has(t)).map(t => (
            <span key={t} style={{
              position: "absolute", left: `${fx(t)}%`, transform: "translateX(-50%)",
              fontFamily: FM, fontSize: 9.5, color: AN.ink3,
            }}>{t} Hz</span>
          ))}
        </div>

        {/* y-axis tick labels */}
        <div style={{ position: "absolute", left: 0, top: 10, height: "calc(100% - 30px)", width: 10, pointerEvents: "none" }}>
          {[0, -30, -60].map(db => (
            <span key={db} style={{
              position: "absolute", top: `${dy(db)}%`, left: 0,
              transform: "translateY(-50%)",
              fontFamily: FM, fontSize: 9, color: AN.ink3,
              background: AN.surface, padding: "0 2px",
            }}>{db}</span>
          ))}
        </div>

        {/* peak annotations (above plot, top-right) */}
        <div style={{
          position: "absolute", top: 12, right: 14,
          fontFamily: FM, fontSize: 10.5, color: AN.ink3, textAlign: "right",
        }}>
          <div>pre peak <span style={{ color: AN.ink }}>{SP_FREQ[prePk].toFixed(1)} Hz · {SP_PRE[prePk].toFixed(1)} dB</span></div>
          <div>post peak <span style={{ color: AN.ink }}>{SP_FREQ[postPk].toFixed(1)} Hz · {post[postPk].toFixed(1)} dB</span></div>
          <div style={{ color: AN.ok, marginTop: 2 }}>
            Δ {attenuationDb.toFixed(1)} dB at {SP_FREQ[prePk].toFixed(1)} Hz
          </div>
        </div>
      </AnPlot>

      {/* legend / hint strip */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 12px", background: AN.surface,
        border: `1px solid ${AN.line2}`,
        fontFamily: FM, fontSize: 11, color: AN.ink3,
      }}>
        <div style={{ display: "flex", gap: 18 }}>
          <span><span style={{ width: 14, height: 0, borderTop: `1.5px dashed ${AN.ink2}`, display: "inline-block", marginRight: 6, verticalAlign: "middle" }} /> pre-filter (raw gyro)</span>
          <span><span style={{ width: 14, height: 2, background: AN.accent, display: "inline-block", marginRight: 6, verticalAlign: "middle" }} /> post-filter</span>
          <span><span style={{ width: 14, height: 1, borderTop: `1.5px dashed ${AN.ink2}55`, display: "inline-block", marginRight: 6, verticalAlign: "middle", opacity: 0.5 }} /> filter transfer |H(f)|</span>
        </div>
        <span style={{ color: AN.ink3 }}>
          known peaks: {SP_PEAKS.map(p => p.label).join("  ·  ")}
        </span>
      </div>
    </div>
  );
};

const SpectrumTab = () => (
  <div style={{ marginTop: 10 }}>
    <SpectrumPanel />
  </div>
);

Object.assign(window, { SpectrumPanel, SpectrumTab });
