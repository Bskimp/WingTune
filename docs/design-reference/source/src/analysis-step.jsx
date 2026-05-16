// Step Response tab — multi-axis layout.
// Three axis rows (R/P/Y). Each row: [trace plot] + [Peak scatter] + [Latency scatter].
// Peak/Latency are scatters of N measurement windows (multiple setpoint steps
// detected across the flight), shown as dots with error bars per the PIDtoolbox
// pattern. This is how you judge tuning consistency — not just one number.

const { useState: useStateSR } = React;

// --- synthetic step response data ---
// 3 axes × multiple measurement windows × time series
const stepCurve = (i, peak, rise, settle) => {
  if (i < 8) return 0.2;
  const t = (i - 8) / rise;
  const env = Math.exp(-t * 1.6);
  return 0.2 + (peak - 0.2) * (1 - env * Math.cos(t * Math.PI * settle));
};

const SR_AX = {
  R: {
    label: "Roll",
    color: "#7ec8ff",
    // 6 measurement windows worth of (peak, latency_ms) values
    windows: [
      { peak: 1.34, latency: 11.5 },
      { peak: 1.28, latency: 12.1 },
      { peak: 1.32, latency: 10.8 },
      { peak: 1.40, latency: 13.2 },
      { peak: 1.25, latency: 11.0 },
      { peak: 1.30, latency: 11.8 },
    ],
    pid: "15,10,5,0,120",
    // mean curve
    curve: [...Array(200)].map((_, i) => stepCurve(i, 1.30, 30, 1.7)),
  },
  P: {
    label: "Pitch",
    color: "#ff9d6a",
    windows: [
      { peak: 1.04, latency: 62 },
      { peak: 1.08, latency: 58 },
      { peak: 0.98, latency: 65 },
      { peak: 1.12, latency: 60 },
    ],
    pid: "20,10,5,0,125",
    curve: [...Array(200)].map((_, i) => {
      if (i < 8) return 0.0;
      const t = (i - 8) / 70;
      return Math.min(1.05, Math.max(0,
        1.05 * (1 - Math.exp(-t * 2)) - 0.05 * Math.sin(t * 3)));
    }),
  },
  Y: {
    label: "Yaw",
    color: AN.warn,
    windows: [], // insufficient data — common for wings
    pid: "—",
    curve: null,
  },
};

// --- atoms ---

// Single trace plot for one axis
const SRTrace = ({ axis }) => {
  const { cursorT, setCursorT, pinned } = useCursor();
  const plotRef = React.useRef(null);
  const xFrac = (clientX) => {
    const r = plotRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  if (!axis.curve) {
    return (
      <div style={{
        position: "relative", flex: 1, height: 150,
        background: AN.surface, border: `1px solid ${AN.line2}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: AN.ink3, fontFamily: FM, fontSize: 11,
        letterSpacing: "0.06em",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: AN.ink2, marginBottom: 4 }}>insufficient data</div>
          <div style={{ color: AN.dim, fontSize: 10 }}>need ≥4 isolated setpoint steps · {axis.label.toLowerCase()} had {axis.windows.length}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "relative", flex: 1, height: 150,
      background: AN.surface, border: `1px solid ${AN.line2}`,
    }}>
      {/* axis tag */}
      <div style={{
        position: "absolute", left: 8, top: 6, zIndex: 2,
        fontFamily: FS, fontSize: 9, color: AN.ink3,
        letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700,
      }}>
        {axis.label}
      </div>
      {/* pid stamp */}
      <div style={{
        position: "absolute", right: 8, top: 6, zIndex: 2,
        fontFamily: FM, fontSize: 10.5, color: AN.ink3,
      }}>
        P,I,D,Dm,F  <span style={{ color: AN.ink }}>{axis.pid}</span>
        <span style={{ color: AN.dim, marginLeft: 8 }}>(n={axis.windows.length})</span>
      </div>

      <svg ref={plotRef}
           onMouseMove={(e) => { if (!pinned) setCursorT(xFrac(e.clientX)); }}
           onMouseLeave={() => { if (!pinned) setCursorT(null); }}
           style={{ position: "absolute", inset: "26px 8px 8px 36px",
                    cursor: "crosshair" }}
           preserveAspectRatio="none" viewBox="0 0 100 100">
        {/* reference 1.0 line */}
        <line x1="0" x2="100" y1="35" y2="35" stroke={AN.line2} strokeWidth="0.4" strokeDasharray="2,1" />
        {/* settle band ±5% */}
        <rect x="0" y="32" width="100" height="6" fill={AN.ok} opacity="0.06" />
        {/* curve */}
        <polyline points={polyPath(axis.curve, 70, 90)}
                  fill="none" stroke={axis.color} strokeWidth="0.9" />
        {/* cursor */}
        {cursorT != null && (
          <line x1={cursorT * 100} x2={cursorT * 100} y1="0" y2="100"
                stroke={pinned ? AN.accent : AN.ink}
                strokeWidth="0.4" opacity={pinned ? 0.9 : 0.6} />
        )}
      </svg>
      {/* y-axis labels */}
      <div style={{ position: "absolute", left: 4, top: 22, bottom: 6,
                     width: 28, fontFamily: FM, fontSize: 9, color: AN.ink3,
                     display: "flex", flexDirection: "column", justifyContent: "space-between",
                     pointerEvents: "none" }}>
        <span>1.5</span>
        <span>1.0</span>
        <span>0.5</span>
        <span>0</span>
      </div>
      {/* x-axis label */}
      <div style={{ position: "absolute", left: 36, bottom: 4, right: 8,
                     fontFamily: FM, fontSize: 9, color: AN.ink3,
                     display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
        <span>0</span><span>250 ms</span><span>500 ms</span>
      </div>
    </div>
  );
};

// Scatter plot for Peak or Latency across measurement windows
const SRScatter = ({ axis, mode, yMin, yMax, target, units }) => {
  if (!axis.windows.length) {
    return (
      <div style={{
        position: "relative", width: 100, height: 150,
        background: AN.surface, border: `1px solid ${AN.line2}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: AN.dim, fontFamily: FM, fontSize: 9.5, textAlign: "center",
        padding: 6,
      }}>
        no data
      </div>
    );
  }
  const vals = axis.windows.map(w => mode === "peak" ? w.peak : w.latency);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const sd = Math.sqrt(variance);
  const dy = (v) => 100 - ((v - yMin) / (yMax - yMin)) * 80 - 10;

  return (
    <div style={{
      position: "relative", width: 100, height: 150,
      background: AN.surface, border: `1px solid ${AN.line2}`,
    }}>
      <div style={{
        position: "absolute", left: 6, top: 4,
        fontFamily: FS, fontSize: 8.5, color: AN.ink3,
        letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
      }}>
        {mode}
      </div>
      <div style={{
        position: "absolute", right: 6, top: 4,
        fontFamily: FM, fontSize: 10, color: axis.color,
      }}>
        {mean.toFixed(mode === "peak" ? 2 : 1)}
      </div>
      <svg style={{ position: "absolute", inset: "20px 4px 16px 22px" }}
           preserveAspectRatio="none" viewBox="0 0 100 100">
        {/* target line (peak=1.0 ideal, latency=target ms) */}
        {target != null && (
          <line x1="0" x2="100" y1={dy(target)} y2={dy(target)}
                stroke={AN.line2} strokeWidth="0.5" strokeDasharray="2,1" />
        )}
        {/* error bar (mean ± sd) */}
        <line x1="50" x2="50"
              y1={dy(mean + sd)} y2={dy(mean - sd)}
              stroke={axis.color} strokeWidth="0.6" opacity="0.7" />
        <line x1="40" x2="60" y1={dy(mean + sd)} y2={dy(mean + sd)}
              stroke={axis.color} strokeWidth="0.6" opacity="0.7" />
        <line x1="40" x2="60" y1={dy(mean - sd)} y2={dy(mean - sd)}
              stroke={axis.color} strokeWidth="0.6" opacity="0.7" />
        {/* individual dots, jittered slightly horizontally */}
        {vals.map((v, i) => (
          <circle key={i}
                  cx={50 + ((i % 3) - 1) * 8}
                  cy={dy(v)}
                  r="1.6" fill={axis.color} opacity="0.85" />
        ))}
        {/* mean dot (filled, larger) */}
        <circle cx="50" cy={dy(mean)} r="2.4" fill={axis.color}
                stroke={AN.bg} strokeWidth="0.4" />
      </svg>
      {/* y labels */}
      <div style={{ position: "absolute", left: 2, top: 18, bottom: 14, width: 18,
                     fontFamily: FM, fontSize: 8, color: AN.ink3,
                     display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <span>{yMax}</span>
        <span>{yMin}</span>
      </div>
      <div style={{ position: "absolute", bottom: 2, left: 22, right: 4,
                     fontFamily: FM, fontSize: 9, color: AN.ink3, textAlign: "center" }}>
        {units}
      </div>
    </div>
  );
};

// Axis row: label · trace · peak scatter · latency scatter
const SRAxisRow = ({ axis }) => (
  <div style={{ display: "flex", gap: 6 }}>
    <SRTrace axis={axis} />
    <SRScatter axis={axis} mode="peak"
               yMin={0.8} yMax={1.5}
               target={1.0} units="" />
    <SRScatter axis={axis} mode="latency"
               yMin={axis.label === "Pitch" ? 50 : 6}
               yMax={axis.label === "Pitch" ? 70 : 16}
               target={null} units="ms" />
  </div>
);

const StepResponseTab = () => {
  const [smoothing, setSmoothing] = useStateSR("normal");
  const [window, setWindow] = useStateSR("2s");
  return (
    <div style={{ marginTop: 10 }}>
      {/* controls bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px",
        background: AN.surface, border: `1px solid ${AN.line2}`,
        marginBottom: 10,
      }}>
        <div>
          <div style={{ color: AN.ink, fontFamily: FH, fontSize: 13, fontWeight: 600 }}>
            Step response · per-axis
          </div>
          <div style={{ color: AN.ink3, fontFamily: FM, fontSize: 10.5, marginTop: 1 }}>
            isolated setpoint-step responses, averaged across measurement windows · dots are individual windows · bars are ±1σ
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontFamily: FM, fontSize: 11 }}>
          <span style={{ color: AN.ink3 }}>smoothing</span>
          <select value={smoothing} onChange={e => setSmoothing(e.target.value)} style={{
            background: AN.surface2, color: AN.ink, border: `1px solid ${AN.line2}`,
            padding: "3px 8px", fontFamily: FM, fontSize: 11,
          }}>
            <option value="off">off</option>
            <option value="normal">normal</option>
            <option value="heavy">heavy</option>
          </select>
          <span style={{ color: AN.ink3, marginLeft: 8 }}>deconv. window</span>
          <select value={window} onChange={e => setWindow(e.target.value)} style={{
            background: AN.surface2, color: AN.ink, border: `1px solid ${AN.line2}`,
            padding: "3px 8px", fontFamily: FM, fontSize: 11,
          }}>
            <option value="1s">1 s</option>
            <option value="2s">2 s</option>
            <option value="3s">3 s</option>
          </select>
        </div>
      </div>

      {/* axis rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SRAxisRow axis={SR_AX.R} />
        <SRAxisRow axis={SR_AX.P} />
        <SRAxisRow axis={SR_AX.Y} />
      </div>
    </div>
  );
};

Object.assign(window, { StepResponseTab });
