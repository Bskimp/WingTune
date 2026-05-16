// The setpoint-tracking panel — headline of the analysis screen.
// Gyro vs setpoint overlay + error trace + brush-to-zoom + overview strip.

const { useState: useStateSP, useRef: useRefSP } = React;

// Resample a slice of the data into 0..100 viewBox x coords
const slicePath = (data, start, end, yScale, yOffset) => {
  const n = end - start;
  if (n < 2) return "";
  return data.slice(start, end).map((v, i) =>
    `${(i / (n - 1)) * 100},${yOffset - v * yScale}`
  ).join(" ");
};

const fmtTime = (idx) => {
  const sec = (idx / N) * 272;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const SetpointTrackingPanel = () => {
  const TOTAL = N;
  const [zoom, setZoom] = useStateSP({ start: 0, end: TOTAL });
  const [brush, setBrush] = useStateSP(null); // {x0, x1} in 0..1
  const plotRef = useRefSP(null);
  const { cursorT, setCursorT, pinned } = useCursor();

  const visStart = zoom.start, visEnd = zoom.end;
  const visLen = visEnd - visStart;
  const isZoomed = visStart > 0 || visEnd < TOTAL;

  // map a clientX relative to the plot to a 0..1 fraction (local-to-plot)
  const xFrac = (clientX) => {
    const r = plotRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  // local 0..1 fraction → global 0..1 (of the full N-sample flight)
  const xFracToGlobal = (localFrac) => (visStart + localFrac * visLen) / TOTAL;
  // global 0..1 → local viewBox x (0..100), or null if outside visible window
  const globalToLocalX = (globalT) => {
    const idx = globalT * TOTAL;
    if (idx < visStart || idx > visEnd) return null;
    return ((idx - visStart) / visLen) * 100;
  };

  const onMouseDown = (e) => {
    e.preventDefault();
    const x = xFrac(e.clientX);
    setBrush({ x0: x, x1: x });
    const onMove = (ev) => setBrush({ x0: x, x1: xFrac(ev.clientX) });
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const x1 = xFrac(ev.clientX);
      const lo = Math.min(x, x1), hi = Math.max(x, x1);
      setBrush(null);
      // require a meaningful brush (>1% of plot width)
      if (hi - lo > 0.01) {
        const newStart = visStart + Math.floor(lo * visLen);
        const newEnd   = visStart + Math.ceil(hi * visLen);
        setZoom({ start: newStart, end: Math.max(newStart + 4, newEnd) });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // recompute stats inside the visible window
  const winSP = SETPOINT.slice(visStart, visEnd);
  const winGY = GYRO.slice(visStart, visEnd);
  const winER = ERROR.slice(visStart, visEnd);
  const peakErrIdx = winER.reduce((bi, e, i) => Math.abs(e - 0.5) > Math.abs(winER[bi] - 0.5) ? i : bi, 0);
  const rmsErr = Math.sqrt(winER.reduce((a, e) => a + (e - 0.5) ** 2, 0) / winER.length);
  const peakErr = Math.abs(winER[peakErrIdx] - 0.5);
  // Re-scale to °/s based on ERROR's ±0.5 → ±30 °/s
  const errToDeg = (norm) => (norm * 60).toFixed(1);

  return (
    <AnPlot
      title="Setpoint tracking · roll axis"
      sub={
        isZoomed
          ? `${fmtTime(visStart)} → ${fmtTime(visEnd)}  ·  zoomed to ${((visLen / TOTAL) * 100).toFixed(0)}% of cruise`
          : "gyro vs setpoint  ·  0:48 → 4:18 (cruise window)  ·  drag to zoom"
      }
      height={290}
      right={
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {[
            ["RMS err", `${errToDeg(rmsErr)} °/s`],
            ["peak err", `${errToDeg(peakErr)} °/s`],
            ["lag", "11 ms"],
            ["tracking", `${(100 - rmsErr * 200).toFixed(1)} %`],
          ].map(([k, v]) => (
            <div key={k} style={{ textAlign: "right" }}>
              <div style={{ color: AN.ink3, fontFamily: FS, fontSize: 9, letterSpacing: "0.2em",
                             textTransform: "uppercase", fontWeight: 700 }}>{k}</div>
              <div style={{ color: AN.ink, fontFamily: FM, fontSize: 13 }}>{v}</div>
            </div>
          ))}
          {/* axis selector */}
          <div style={{ display: "flex", gap: 1, marginLeft: 8 }}>
            {["R", "P", "Y"].map((ax, i) => (
              <span key={ax} style={{
                padding: "3px 9px", fontFamily: FM, fontSize: 11,
                color: i === 0 ? AN.bg : AN.ink3,
                background: i === 0 ? AN.accent : AN.surface2,
                border: `1px solid ${i === 0 ? AN.accent : AN.line2}`,
                fontWeight: 600, cursor: "pointer",
              }}>{ax}</span>
            ))}
          </div>
          {isZoomed && (
            <button onClick={() => setZoom({ start: 0, end: TOTAL })} style={{
              padding: "3px 10px",
              background: AN.surface2, border: `1px solid ${AN.accent}`, color: AN.accent,
              fontFamily: FM, fontSize: 11, cursor: "pointer", fontWeight: 600,
            }}>⤺ reset</button>
          )}
        </div>
      }
    >
      <AnAxes vLines={10} hLines={4} />
      {/* main trace area — captures brush + cursor hover */}
      <svg ref={plotRef}
           onMouseDown={onMouseDown}
           onMouseMove={(e) => {
             if (brush || pinned) return;
             setCursorT(xFracToGlobal(xFrac(e.clientX)));
           }}
           onMouseLeave={() => { if (!pinned && !brush) setCursorT(null); }}
           style={{ position: "absolute", inset: 10, width: "calc(100% - 20px)", height: "200px",
                    cursor: brush ? "ew-resize" : "crosshair", userSelect: "none" }}
           preserveAspectRatio="none" viewBox="0 0 100 100">
        <line x1="0" x2="100" y1="50" y2="50" stroke={AN.line2} strokeWidth="0.3" strokeDasharray="1,1" />
        {/* setpoint (reference) */}
        <polyline points={slicePath(SETPOINT, visStart, visEnd, 80, 50)}
                  fill="none" stroke={AN.ink2} strokeWidth="0.5" strokeDasharray="2,1" />
        {/* gyro */}
        <polyline points={slicePath(GYRO, visStart, visEnd, 80, 50)}
                  fill="none" stroke={AN.accent} strokeWidth="0.8" />
        {/* peak-error marker (in visible window) */}
        <line x1={(peakErrIdx / Math.max(1, visLen - 1)) * 100}
              x2={(peakErrIdx / Math.max(1, visLen - 1)) * 100}
              y1="0" y2="100"
              stroke={AN.warn} strokeWidth="0.4" strokeDasharray="2,1" opacity="0.7" />
        {/* brush rectangle */}
        {brush && (
          <rect
            x={Math.min(brush.x0, brush.x1) * 100}
            y="0"
            width={Math.abs(brush.x1 - brush.x0) * 100}
            height="100"
            fill={AN.accent} opacity="0.18"
            stroke={AN.accent} strokeWidth="0.3"
          />
        )}
        {/* shared cursor */}
        {cursorT != null && (() => {
          const localX = globalToLocalX(cursorT);
          if (localX == null) return null;
          return (
            <g>
              <line x1={localX} x2={localX} y1="0" y2="100"
                    stroke={pinned ? AN.accent : AN.ink}
                    strokeWidth="0.4" opacity={pinned ? 0.9 : 0.6} />
              {/* dot at the gyro trace */}
              <circle cx={localX}
                      cy={50 - (sampleAt(GYRO, cursorT) - 0.5) * 80 * 2}
                      r="1.2" fill={AN.accent}
                      stroke={AN.bg} strokeWidth="0.4" />
            </g>
          );
        })()}
      </svg>

      {/* error sub-axis */}
      <div style={{
        position: "absolute", left: 10, right: 10, top: 220, height: 36,
        background: AN.surface2, border: `1px solid ${AN.line}`,
      }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
             preserveAspectRatio="none" viewBox="0 0 100 100">
          <line x1="0" x2="100" y1="50" y2="50" stroke={AN.line2} strokeWidth="0.4" />
          <polygon
            points={`0,50 ${slicePath(ERROR, visStart, visEnd, 90, 50)} 100,50`}
            fill={AN.stamp} opacity="0.18"
          />
          <polyline points={slicePath(ERROR, visStart, visEnd, 90, 50)}
                    fill="none" stroke={AN.stamp} strokeWidth="0.6" />
        </svg>
        <span style={{
          position: "absolute", left: 6, top: 4, fontFamily: FS, fontSize: 9,
          color: AN.ink3, letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase",
        }}>error</span>
        <span style={{
          position: "absolute", right: 6, top: 4, fontFamily: FM, fontSize: 10, color: AN.ink3,
        }}>±30 °/s</span>
      </div>

      {/* overview strip — shows visible window position within full flight */}
      <div style={{
        position: "absolute", left: 10, right: 10, top: 262, height: 18,
        background: AN.surface2, border: `1px solid ${AN.line}`,
        cursor: "pointer",
      }}
        onClick={(e) => {
          // click overview to pan-center on that point
          const r = e.currentTarget.getBoundingClientRect();
          const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          const len = visLen;
          const center = Math.round(frac * TOTAL);
          let s = center - Math.floor(len / 2), en = s + len;
          if (s < 0) { s = 0; en = len; }
          if (en > TOTAL) { en = TOTAL; s = TOTAL - len; }
          setZoom({ start: s, end: en });
        }}
      >
        {/* full setpoint mini-trace */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
             preserveAspectRatio="none" viewBox="0 0 100 100">
          <polyline points={slicePath(SETPOINT, 0, TOTAL, 70, 80)}
                    fill="none" stroke={AN.ink3} strokeWidth="0.5" />
        </svg>
        {/* visible window highlight */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left:  `${(visStart / TOTAL) * 100}%`,
          width: `${((visEnd - visStart) / TOTAL) * 100}%`,
          background: `${AN.accent}22`,
          borderLeft:  `1.5px solid ${AN.accent}`,
          borderRight: `1.5px solid ${AN.accent}`,
        }} />
        <span style={{
          position: "absolute", left: 6, top: 2, fontFamily: FS, fontSize: 8.5,
          color: AN.ink3, letterSpacing: "0.16em", fontWeight: 700, textTransform: "uppercase",
        }}>overview · click to pan</span>
      </div>

      {/* legend */}
      <div style={{ position: "absolute", left: 14, top: 12, display: "flex", gap: 12,
                     fontFamily: FS, fontSize: 10, color: AN.ink2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: AN.accent, display: "inline-block" }} /> gyro
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 0, borderTop: `1.5px dashed ${AN.ink2}`, display: "inline-block" }} /> setpoint
        </span>
      </div>
    </AnPlot>
  );
};

Object.assign(window, { SetpointTrackingPanel });
