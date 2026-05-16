// Analysis screen — wing-first multi-panel layout.
// Headline: setpoint tracking (gyro vs setpoint over time).
// Supporting: PID contribution · step response · filter delay budget · SPA curve · TPA(airspeed) curve.
// Demoted to a strip: controller mode, debug mode, flight phase pills.

const AN = PAL_GRAPHITE; // analysis screen uses Graphite & Cyan palette
const FS = CX_FONT_SANS, FM = CX_FONT_MONO, FH = CX_FONT_SLAB;

// ----- generic plot frame -----

const AnPlot = ({ title, sub, right, height = 180, children, dense = false }) => (
  <div style={{
    background: AN.surface, border: `1px solid ${AN.line2}`,
    display: "flex", flexDirection: "column", minWidth: 0,
  }}>
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: dense ? "6px 10px" : "8px 12px",
      borderBottom: `1px solid ${AN.line}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: AN.ink, fontFamily: FH, fontSize: 13, fontWeight: 600 }}>{title}</div>
        {sub && <div style={{ color: AN.ink3, fontFamily: FM, fontSize: 10.5, marginTop: 1 }}>{sub}</div>}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
    <div style={{ position: "relative", height, padding: "8px 10px" }}>{children}</div>
  </div>
);

// Plot grid (axes background)
const AnAxes = ({ vLines = 8, hLines = 4 }) => (
  <svg style={{ position: "absolute", inset: 10, width: "calc(100% - 20px)", height: "calc(100% - 20px)" }}
       preserveAspectRatio="none" viewBox="0 0 100 100">
    {vLines > 0 && [...Array(vLines + 1)].map((_, i) => (
      <line key={`v${i}`} x1={(i / vLines) * 100} x2={(i / vLines) * 100} y1="0" y2="100"
            stroke={AN.line} strokeWidth="0.2" />
    ))}
    {hLines > 0 && [...Array(hLines + 1)].map((_, i) => (
      <line key={`h${i}`} x1="0" x2="100" y1={(i / hLines) * 100} y2={(i / hLines) * 100}
            stroke={AN.line} strokeWidth="0.2" />
    ))}
  </svg>
);

// Helpers to render data as SVG polyline path in 0..100 viewBox space.
const polyPath = (data, yScale = 50, yOffset = 50) =>
  data.map((v, i) => `${(i / (data.length - 1)) * 100},${yOffset - v * yScale}`).join(" ");

Object.assign(window, { AN, FS, FM, FH, AnPlot, AnAxes, polyPath });
