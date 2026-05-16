// Log Viewer — single consolidated signal plot + output plot.
// Same shape as before: per-axis toggleable signals overlaid on ONE big plot,
// output (servos + throttle + motor) on a second plot below.
// All native units: rates in deg/s, PWM in µs.

const { useState: useStateLV, useRef: useRefLV } = React;

const _slicePath = (data, start, end, ymap) => {
  const n = end - start;
  if (n < 2) return "";
  return data.slice(start, end).map((v, i) =>
    `${(i / (n - 1)) * 100},${ymap(v)}`
  ).join(" ");
};
const _fmtTime = (idx, total) => {
  const sec = (idx / total) * 272;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const AXIS_LIST = [
  { k: "R", label: "Roll",  color: "#7ec8ff", sats: () => SAT_R },
  { k: "P", label: "Pitch", color: "#ff9d6a", sats: () => SAT_P },
  { k: "Y", label: "Yaw",   color: AN.warn,   sats: () => SAT_Y },
];
const fk = (ax, sig) => `${ax}.${sig}`;

// =========== main signal plot ============

const MainPlot = ({ zoom, setZoom, brush, setBrush, flags, autoY }) => {
  const TOTAL = SP_R.length;
  const visStart = zoom.start, visEnd = zoom.end;
  const visLen = visEnd - visStart;
  const plotRef = useRefLV(null);
  const { cursorT, setCursorT, pinned } = useCursor();

  const xFrac = (clientX) => {
    if (!plotRef.current) return 0;
    const r = plotRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const xFracToGlobal = (localFrac) => (visStart + localFrac * visLen) / TOTAL;
  const globalToLocalX = (globalT) => {
    const idx = globalT * TOTAL;
    if (idx < visStart || idx > visEnd) return null;
    return ((idx - visStart) / visLen) * 100;
  };

  const onMouseDown = (e) => {
    e.preventDefault();
    const x0 = xFrac(e.clientX);
    setBrush({ x0, x1: x0 });
    const onMove = (ev) => setBrush({ x0, x1: xFrac(ev.clientX) });
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const x1 = xFrac(ev.clientX);
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      setBrush(null);
      if (hi - lo > 0.01) {
        const newStart = visStart + Math.floor(lo * visLen);
        const newEnd   = visStart + Math.ceil(hi * visLen);
        setZoom({ start: newStart, end: Math.max(newStart + 4, newEnd) });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // which axes are actively showing any signal
  const activeAxes = AXIS_LIST.filter(a =>
    flags[fk(a.k, "gyro")] || flags[fk(a.k, "setpoint")] || flags[fk(a.k, "error")]
  );
  // primary for the right-hand stats badge
  const primary = activeAxes[0] || AXIS_LIST[0];
  const winER = TIME_DOMAIN[primary.k].err.slice(visStart, visEnd);
  const rmsErr = Math.sqrt(winER.reduce((a, e) => a + e * e, 0) / Math.max(1, winER.length));
  const peakErr = winER.length ? Math.max(...winER.map(Math.abs)) : 0;

  // Y range in deg/s — symmetric around 0, follows the data.
  let yRange = 250; // sensible empty-state default
  if (activeAxes.length > 0) {
    let maxDev = 0;
    activeAxes.forEach(a => {
      const ax = TIME_DOMAIN[a.k];
      const consider = [];
      if (flags[fk(a.k, "gyro")])     consider.push(ax.gy);
      if (flags[fk(a.k, "setpoint")]) consider.push(ax.sp);
      if (flags[fk(a.k, "error")])    consider.push(ax.err);
      consider.forEach(arr => {
        for (let i = visStart; i < visEnd; i++) {
          const d = Math.abs(arr[i]);
          if (d > maxDev) maxDev = d;
        }
      });
    });
    if (maxDev > 0) {
      // 10% headroom; in fixed mode round up to nearest 100/250/500 boundary
      const padded = maxDev * 1.1;
      if (autoY) {
        yRange = Math.max(25, padded);
      } else {
        const boundaries = [25, 50, 100, 150, 250, 500, 750, 1000, 1500, 2000];
        yRange = boundaries.find(b => b >= padded) || 2000;
      }
    }
  }
  // ±yRange → viewBox y 10..90
  const ymap = (deg) => 50 - (deg / yRange) * 40;

  // y-axis ticks rounded to a nice 4-step interval
  const tickStep = (() => {
    if (yRange <= 50)   return 25;
    if (yRange <= 100)  return 50;
    if (yRange <= 250)  return 50;
    if (yRange <= 500)  return 100;
    if (yRange <= 1000) return 250;
    return 500;
  })();
  const ticks = [];
  for (let t = -yRange; t <= yRange + 0.001; t += tickStep) {
    if (Math.abs(t) > yRange * 0.99 && Math.abs(t) !== yRange) continue;
    ticks.push(Math.round(t));
  }
  // make sure 0 is in there
  if (!ticks.includes(0)) ticks.push(0);
  ticks.sort((a, b) => a - b);

  return (
    <div style={{
      position: "relative", height: 360,
      background: AN.surface, borderBottom: `1px solid ${AN.line}`,
    }}>
      {/* legend top-left */}
      <div style={{
        position: "absolute", left: 56, top: 10, zIndex: 2,
        display: "flex", gap: 14, flexWrap: "wrap", maxWidth: "70%",
        fontFamily: FM, fontSize: 10.5,
      }}>
        {activeAxes.map(a => (
          <div key={a.k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{
              color: AN.ink3, fontFamily: FS, fontSize: 9,
              letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700,
            }}>{a.label}</span>
            {flags[fk(a.k, "gyro")] && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 2, background: a.color }} />
                <span style={{ color: AN.ink2 }}>gyro</span>
              </span>
            )}
            {flags[fk(a.k, "setpoint")] && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 0, borderTop: `1.5px dashed ${a.color}` }} />
                <span style={{ color: AN.ink2 }}>setpoint</span>
              </span>
            )}
            {flags[fk(a.k, "error")] && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 4, background: AN.stamp, opacity: 0.4 }} />
                <span style={{ color: AN.ink2 }}>error</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* stats top-right */}
      <div style={{
        position: "absolute", right: 14, top: 10, zIndex: 2,
        display: "flex", gap: 14, fontFamily: FM, fontSize: 10.5,
      }}>
        <span><span style={{ color: AN.ink3 }}>RMS </span><span style={{ color: AN.ink }}>{rmsErr.toFixed(1)} °/s</span></span>
        <span><span style={{ color: AN.ink3 }}>peak </span><span style={{ color: AN.ink }}>{peakErr.toFixed(1)} °/s</span></span>
        <span><span style={{ color: AN.ink3 }}>scale </span><span style={{ color: AN.ink }}>±{Math.round(yRange)}</span></span>
        <span style={{ color: AN.dim }}>· {primary.label}</span>
      </div>

      {/* y-axis label header */}
      <div style={{
        position: "absolute", left: 8, top: 10,
        fontFamily: FS, fontSize: 9, color: AN.ink3,
        letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
        pointerEvents: "none",
      }}>°/s</div>

      {/* y-axis tick labels */}
      <div style={{
        position: "absolute", left: 0, top: 38, bottom: 12, width: 50,
        pointerEvents: "none", fontFamily: FM, fontSize: 9.5, color: AN.ink3,
      }}>
        {ticks.map(t => (
          <span key={t} style={{
            position: "absolute",
            left: 0, right: 4, textAlign: "right",
            top: `${ymap(t)}%`,
            transform: "translateY(-50%)",
            color: t === 0 ? AN.ink2 : AN.ink3,
          }}>{t > 0 ? `+${t}` : t}</span>
        ))}
      </div>

      {/* plot */}
      <svg ref={plotRef}
           onMouseDown={onMouseDown}
           onMouseMove={(e) => { if (brush || pinned) return; setCursorT(xFracToGlobal(xFrac(e.clientX))); }}
           onMouseLeave={() => { if (!pinned && !brush) setCursorT(null); }}
           style={{
             position: "absolute", left: 52, right: 14, top: 38, bottom: 12,
             cursor: brush ? "ew-resize" : "crosshair", userSelect: "none",
           }}
           preserveAspectRatio="none" viewBox="0 0 100 100">
        {/* gridlines at each tick */}
        {ticks.map(t => (
          <line key={t} x1="0" x2="100" y1={ymap(t)} y2={ymap(t)}
                stroke={t === 0 ? AN.line2 : AN.line}
                strokeWidth={t === 0 ? 0.3 : 0.15}
                strokeDasharray={t === 0 ? "none" : "1,1"} />
        ))}

        {/* saturation strips */}
        {flags.sat && activeAxes.flatMap(a => a.sats().map((s, i) => {
          const lo = ((s.s * TOTAL) - visStart) / visLen * 100;
          const hi = ((s.e * TOTAL) - visStart) / visLen * 100;
          if (hi < 0 || lo > 100) return null;
          const x = Math.max(0, lo), w = Math.min(100, hi) - x;
          return (
            <g key={`${a.k}-${i}`}>
              <rect x={x} y="0" width={w} height="100"
                    fill={AN.stamp} opacity="0.13" />
              <line x1={x} x2={x} y1="0" y2="100" stroke={AN.stamp} strokeWidth="0.3" opacity="0.5" />
              <line x1={x + w} x2={x + w} y1="0" y2="100" stroke={AN.stamp} strokeWidth="0.3" opacity="0.5" />
            </g>
          );
        }))}

        {/* error fills (behind) */}
        {AXIS_LIST.map(a => flags[fk(a.k, "error")] && (
          <polygon key={`err-${a.k}`}
                   points={`0,${ymap(0)} ${_slicePath(TIME_DOMAIN[a.k].err, visStart, visEnd, ymap)} 100,${ymap(0)}`}
                   fill={AN.stamp} opacity="0.10" />
        ))}

        {/* setpoint traces (dashed) — before gyro */}
        {AXIS_LIST.map(a => flags[fk(a.k, "setpoint")] && (
          <polyline key={`sp-${a.k}`}
                    points={_slicePath(TIME_DOMAIN[a.k].sp, visStart, visEnd, ymap)}
                    fill="none" stroke={a.color} strokeWidth="0.5"
                    strokeDasharray="2,1" opacity="0.75" />
        ))}

        {/* gyro traces */}
        {AXIS_LIST.map(a => flags[fk(a.k, "gyro")] && (
          <polyline key={`gy-${a.k}`}
                    points={_slicePath(TIME_DOMAIN[a.k].gy, visStart, visEnd, ymap)}
                    fill="none" stroke={a.color} strokeWidth="0.7" />
        ))}

        {/* brush */}
        {brush && (
          <rect x={Math.min(brush.x0, brush.x1) * 100} y="0"
                width={Math.abs(brush.x1 - brush.x0) * 100} height="100"
                fill={AN.accent} opacity="0.18" stroke={AN.accent} strokeWidth="0.3" />
        )}

        {/* cursor */}
        {cursorT != null && (() => {
          const lx = globalToLocalX(cursorT);
          if (lx == null) return null;
          return (
            <g>
              <line x1={lx} x2={lx} y1="0" y2="100"
                    stroke={pinned ? AN.accent : AN.ink}
                    strokeWidth="0.4" opacity={pinned ? 0.9 : 0.6} />
              {AXIS_LIST.map(a => flags[fk(a.k, "gyro")] && (
                <circle key={`dot-${a.k}`} cx={lx}
                        cy={ymap(sampleAt(TIME_DOMAIN[a.k].gy, cursorT))}
                        r="1.2" fill={a.color} stroke={AN.bg} strokeWidth="0.4" />
              ))}
            </g>
          );
        })()}
      </svg>

      {activeAxes.length === 0 && (
        <div style={{
          position: "absolute", inset: "38px 14px 12px 52px",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: AN.dim, fontFamily: FM, fontSize: 12, letterSpacing: "0.08em",
          pointerEvents: "none",
        }}>
          no signals enabled — pick from the sidebar
        </div>
      )}
    </div>
  );
};

// =========== output plot (µs only) ============

const OutputPlot = ({ zoom, flags }) => {
  const { cursorT, pinned } = useCursor();
  const TOTAL = THROTTLE.length;
  const visStart = zoom.start, visEnd = zoom.end;
  const visLen = visEnd - visStart;
  const globalToLocalX = (globalT) => {
    const idx = globalT * TOTAL;
    if (idx < visStart || idx > visEnd) return null;
    return ((idx - visStart) / visLen) * 100;
  };
  const ymapUs = (us) => 95 - ((us - 1000) / 1000) * 90;

  const channels = [
    { id: "throttle", label: "Throttle", data: THROTTLE,  color: AN.warn,   fill: true, dash: null },
    { id: "motor",    label: "Motor 1",  data: MOTOR_1,   color: AN.ink2,   fill: false, dash: "1.5,1" },
    { id: "el_l",     label: "Elevon-L", data: ELEVON_L,  color: "#7ec8ff", fill: false, dash: null },
    { id: "el_r",     label: "Elevon-R", data: ELEVON_R,  color: "#ff9d6a", fill: false, dash: null },
  ];
  const active = channels.filter(c => flags[c.id]);
  const satCount = ["el_l", "el_r"].reduce((acc, id) => {
    if (!flags[id]) return acc;
    const data = id === "el_l" ? ELEVON_L : ELEVON_R;
    return acc + data.slice(visStart, visEnd).filter(v => v >= 1990 || v <= 1010).length;
  }, 0);

  return (
    <div style={{
      position: "relative", height: 200,
      background: AN.surface2, borderTop: `1px solid ${AN.line2}`,
    }}>
      <div style={{
        position: "absolute", left: 8, top: 10,
        fontFamily: FS, fontSize: 9, color: AN.ink3,
        letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
        pointerEvents: "none",
      }}>µs</div>

      <div style={{
        position: "absolute", left: 56, top: 10, zIndex: 2,
        display: "flex", gap: 14, flexWrap: "wrap",
        fontFamily: FM, fontSize: 10.5,
      }}>
        <span style={{
          color: AN.ink, fontFamily: FH, fontSize: 13, fontWeight: 600,
          marginRight: 6,
        }}>Output</span>
        {active.map(ch => (
          <span key={ch.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 12,
              height: ch.fill ? 6 : 2,
              background: ch.fill ? `${ch.color}66` : ch.color,
              borderTop: ch.dash ? `1.5px dashed ${ch.color}` : "none",
            }} />
            <span style={{ color: AN.ink2 }}>{ch.label}</span>
          </span>
        ))}
        {satCount > 0 && (
          <span style={{
            padding: "1px 7px",
            border: `1px solid ${AN.stamp}`, color: AN.stamp,
            fontFamily: FS, fontSize: 9, fontWeight: 700, letterSpacing: "0.18em",
          }}>SAT · {satCount}</span>
        )}
      </div>

      <div style={{
        position: "absolute", left: 0, top: 38, bottom: 12, width: 50,
        pointerEvents: "none", fontFamily: FM, fontSize: 9.5, color: AN.ink3,
      }}>
        {[2000, 1750, 1500, 1250, 1000].map(t => (
          <span key={t} style={{
            position: "absolute",
            left: 0, right: 4, textAlign: "right",
            top: `${ymapUs(t)}%`,
            transform: "translateY(-50%)",
            color: t === 1500 ? AN.ink2 : AN.ink3,
          }}>{t}</span>
        ))}
      </div>

      <svg style={{ position: "absolute", left: 52, right: 14, top: 38, bottom: 12 }}
           preserveAspectRatio="none" viewBox="0 0 100 100">
        {[2000, 1750, 1500, 1250, 1000].map(t => (
          <line key={t} x1="0" x2="100"
                y1={ymapUs(t)} y2={ymapUs(t)}
                stroke={t === 1500 ? AN.line2 : AN.line}
                strokeWidth={t === 1500 ? 0.3 : 0.15}
                strokeDasharray={t === 1500 ? "none" : "1,1"} />
        ))}
        <rect x="0" y={ymapUs(2000)}     width="100" height={2} fill={AN.stamp} opacity="0.06" />
        <rect x="0" y={ymapUs(1000) - 2} width="100" height={2} fill={AN.stamp} opacity="0.06" />

        {flags.throttle && (
          <polygon
            points={`0,${ymapUs(1000)} ${_slicePath(THROTTLE, visStart, visEnd, ymapUs)} 100,${ymapUs(1000)}`}
            fill={AN.warn} opacity="0.14" />
        )}
        {active.map(ch => (
          <g key={ch.id}>
            <polyline points={_slicePath(ch.data, visStart, visEnd, ymapUs)}
                      fill="none" stroke={ch.color} strokeWidth="0.7"
                      strokeDasharray={ch.dash || "none"} />
            {(ch.id === "el_l" || ch.id === "el_r") && ch.data.slice(visStart, visEnd).map((v, i) => (
              (v >= 1990 || v <= 1010) ? (
                <circle key={i}
                  cx={(i / Math.max(1, visLen - 1)) * 100}
                  cy={ymapUs(v)}
                  r="0.9" fill={AN.stamp} />
              ) : null
            ))}
          </g>
        ))}

        {cursorT != null && (() => {
          const lx = globalToLocalX(cursorT);
          if (lx == null) return null;
          return (
            <g>
              <line x1={lx} x2={lx} y1="0" y2="100"
                    stroke={pinned ? AN.accent : AN.ink}
                    strokeWidth="0.4" opacity={pinned ? 0.9 : 0.6} />
              {active.map(ch => (
                <circle key={ch.id} cx={lx}
                        cy={ymapUs(sampleAt(ch.data, cursorT))}
                        r="1.1" fill={ch.color} stroke={AN.bg} strokeWidth="0.4" />
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
};

// =========== time axis ============

const TimeAxisRow = ({ zoom }) => {
  const TOTAL = SP_R.length;
  const startSec = (zoom.start / TOTAL) * 272;
  const endSec   = (zoom.end / TOTAL) * 272;
  const span = endSec - startSec;
  const step = span > 120 ? 30 : span > 60 ? 15 : span > 30 ? 10 : span > 12 ? 5 : 2;
  const ticks = [];
  for (let s = Math.ceil(startSec / step) * step; s <= endSec; s += step) {
    ticks.push(s);
  }
  return (
    <div style={{
      position: "relative", height: 22,
      background: AN.surface, borderTop: `1px solid ${AN.line2}`,
    }}>
      <div style={{
        position: "absolute", left: 8, top: 4,
        fontFamily: FS, fontSize: 9, color: AN.ink3,
        letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
      }}>Time · s</div>
      <div style={{ position: "absolute", left: 52, right: 14, bottom: 2, height: 18 }}>
        {ticks.map(t => {
          const x = ((t - startSec) / span) * 100;
          return (
            <span key={t} style={{
              position: "absolute",
              left: `${x}%`, transform: "translateX(-50%)",
              fontFamily: FM, fontSize: 10, color: AN.ink2,
            }}>{t}s</span>
          );
        })}
      </div>
    </div>
  );
};

// =========== sidebar ============

const SignalSidebar = ({ flags, setFlags }) => {
  const toggle = (k) => setFlags(s => ({ ...s, [k]: !s[k] }));
  const Row = ({ k, label, color, dashed, fill }) => {
    const on = flags[k];
    return (
      <div onClick={() => toggle(k)} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 0", cursor: "pointer", opacity: on ? 1 : 0.55,
      }}>
        <span style={{
          width: 10, height: 10,
          border: `1.5px solid ${on ? color : AN.line2}`,
          background: on ? color : "transparent",
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{on && <IconCheck size={6} />}</span>
        <span style={{
          width: 16, height: fill ? 4 : 0,
          background: fill && on ? color : "transparent",
          borderTop: !fill ? (dashed
            ? `1.5px dashed ${on ? color : AN.line2}`
            : `1.5px solid ${on ? color : AN.line2}`) : "none",
          opacity: fill ? 0.45 : 1,
          display: "inline-block", flexShrink: 0,
        }} />
        <span style={{
          fontFamily: FM, fontSize: 11.5,
          color: on ? AN.ink : AN.ink3, flex: 1,
        }}>{label}</span>
      </div>
    );
  };
  const Section = ({ title, color, children }) => (
    <div>
      <div style={{
        color: color || AN.ink3, fontFamily: FS, fontSize: 9,
        letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700,
        marginBottom: 6,
      }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{
      width: 180, flexShrink: 0,
      background: AN.surface, borderRight: `1px solid ${AN.line2}`,
      padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 14,
      fontFamily: FS,
    }}>
      <div style={{
        color: AN.ink, fontFamily: FH, fontSize: 13, fontWeight: 600,
        paddingBottom: 6, borderBottom: `1px solid ${AN.line2}`,
      }}>Signals</div>

      {AXIS_LIST.map(a => (
        <Section key={a.k} title={a.label} color={a.color}>
          <Row k={fk(a.k, "gyro")}     label="gyro"     color={a.color} />
          <Row k={fk(a.k, "setpoint")} label="setpoint" color={a.color} dashed />
          <Row k={fk(a.k, "error")}    label="error"    color={AN.stamp} fill />
        </Section>
      ))}

      <Section title="overlays">
        <Row k="sat" label="saturation" color={AN.stamp} fill />
      </Section>

      <Section title="output · µs">
        <Row k="throttle" label="throttle" color={AN.warn}   fill />
        <Row k="motor"    label="motor 1"  color={AN.ink2}   dashed />
        <Row k="el_l"     label="Elevon-L" color="#7ec8ff" />
        <Row k="el_r"     label="Elevon-R" color="#ff9d6a" />
      </Section>
    </div>
  );
};

// =========== panel ============

const LogViewerPanel = () => {
  const TOTAL = SP_R.length;
  const [zoom, setZoom] = useStateLV({ start: 0, end: TOTAL });
  const [brush, setBrush] = useStateLV(null);
  const [autoY, setAutoY] = useStateLV(true); // auto-fit by default — scale follows data
  const [flags, setFlags] = useStateLV({
    "R.gyro": true, "R.setpoint": true, "R.error": false,
    "P.gyro": false, "P.setpoint": false, "P.error": false,
    "Y.gyro": false, "Y.setpoint": false, "Y.error": false,
    sat: true,
    throttle: true, motor: false, el_l: true, el_r: true,
  });
  const isZoomed = zoom.start > 0 || zoom.end < TOTAL;

  return (
    <div style={{
      background: AN.surface, border: `1px solid ${AN.line2}`,
      display: "flex", flexDirection: "column", minWidth: 0,
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        padding: "8px 14px", borderBottom: `1px solid ${AN.line}`,
      }}>
        <div>
          <div style={{ color: AN.ink, fontFamily: FH, fontSize: 13, fontWeight: 600 }}>
            Log viewer
          </div>
          <div style={{ color: AN.ink3, fontFamily: FM, fontSize: 10.5, marginTop: 1 }}>
            {isZoomed
              ? `${_fmtTime(zoom.start, TOTAL)} → ${_fmtTime(zoom.end, TOTAL)}  ·  ${((zoom.end - zoom.start) / TOTAL * 100).toFixed(0)}% of flight`
              : "full flight 0:00 → 4:32  ·  drag to zoom"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setAutoY(v => !v)} style={{
            padding: "3px 10px",
            background: autoY ? `${AN.accent}1a` : AN.surface2,
            border: `1px solid ${autoY ? AN.accent : AN.line2}`,
            color: autoY ? AN.accent : AN.ink3,
            fontFamily: FM, fontSize: 11, cursor: "pointer", fontWeight: 600,
          }}>{autoY ? "✓ auto fit Y" : "snap to nice scale"}</button>
          {isZoomed && (
            <button onClick={() => setZoom({ start: 0, end: TOTAL })} style={{
              padding: "3px 10px",
              background: AN.surface2, border: `1px solid ${AN.accent}`, color: AN.accent,
              fontFamily: FM, fontSize: 11, cursor: "pointer", fontWeight: 600,
            }}>⤺ reset zoom</button>
          )}
        </div>
      </div>

      <div style={{ display: "flex" }}>
        <SignalSidebar flags={flags} setFlags={setFlags} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <MainPlot zoom={zoom} setZoom={setZoom} brush={brush} setBrush={setBrush} flags={flags} autoY={autoY} />
          <OutputPlot zoom={zoom} flags={flags} />
          <TimeAxisRow zoom={zoom} />
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { LogViewerPanel });
