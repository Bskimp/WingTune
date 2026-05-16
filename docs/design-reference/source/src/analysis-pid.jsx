// Step response + PID contribution panels.

const StepResponsePanel = () => {
  // overshoot / rise / settle estimates from STEP_OUT
  const peak = Math.max(...STEP_OUT);
  const overshoot = ((peak - 0.85) / (0.85 - 0.2) * 100).toFixed(1);
  return (
    <AnPlot
      title="Step response · roll"
      sub="injected 100 °/s setpoint step  ·  10 windows averaged"
      height={170}
      right={
        <div style={{ display: "flex", gap: 12 }}>
          {[
            ["rise", "84 ms"],
            ["over", `${overshoot} %`],
            ["settle", "212 ms"],
          ].map(([k, v]) => (
            <div key={k} style={{ textAlign: "right" }}>
              <div style={{ color: AN.ink3, fontFamily: FS, fontSize: 9, letterSpacing: "0.18em",
                             textTransform: "uppercase", fontWeight: 700 }}>{k}</div>
              <div style={{ color: AN.ink, fontFamily: FM, fontSize: 12 }}>{v}</div>
            </div>
          ))}
        </div>
      }
    >
      <AnAxes vLines={8} hLines={4} />
      <svg style={{ position: "absolute", inset: 10, width: "calc(100% - 20px)", height: "calc(100% - 20px)" }}
           preserveAspectRatio="none" viewBox="0 0 100 100">
        {/* ideal step (reference) */}
        <polyline points={polyPath(STEP_REF, 70, 85)} fill="none"
                  stroke={AN.ink3} strokeWidth="0.5" strokeDasharray="1.5,1" />
        {/* actual response */}
        <polyline points={polyPath(STEP_OUT, 70, 85)} fill="none"
                  stroke={AN.accent} strokeWidth="0.8" />
        {/* settle band ± 5% */}
        <rect x="0" y={85 - 0.85 * 70 - 3} width="100" height="6"
              fill={AN.ok} opacity="0.08" />
      </svg>
      <div style={{ position: "absolute", left: 14, top: 12, fontFamily: FM, fontSize: 10,
                     color: AN.ink3 }}>
        0 ms <span style={{ marginLeft: 8 }}>→</span><span style={{ marginLeft: 8 }}>500 ms</span>
      </div>
    </AnPlot>
  );
};

const PID_TERMS = [
  { k: "P", c: AN.accent,  data: () => P_CONTRIB, width: 0.6  },
  { k: "I", c: "#7ec8ff",  data: () => I_CONTRIB, width: 0.6  },
  { k: "D", c: "#ff9d6a",  data: () => D_CONTRIB, width: 0.6  },
  { k: "F", c: AN.ok,      data: () => F_CONTRIB, width: 0.6  },
  { k: "S", c: AN.warn,    data: () => S_CONTRIB, width: 0.75 },
];

const PIDContributionPanel = () => {
  const [shown, setShown] = React.useState({ P: true, I: true, D: true, F: true, S: true });
  const { cursorT, setCursorT, pinned } = useCursor();
  const plotRef = React.useRef(null);
  const xFrac = (clientX) => {
    const r = plotRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const toggle = (k, e) => {
    // shift-click = solo (turn just this one on, rest off)
    if (e && e.shiftKey) {
      const onlyMe = Object.fromEntries(PID_TERMS.map(t => [t.k, t.k === k]));
      // if already soloed, restore all
      const isSoloed = shown[k] && PID_TERMS.filter(t => t.k !== k).every(t => !shown[t.k]);
      setShown(isSoloed ? Object.fromEntries(PID_TERMS.map(t => [t.k, true])) : onlyMe);
    } else {
      setShown(s => ({ ...s, [k]: !s[k] }));
    }
  };
  const allOn = PID_TERMS.every(t => shown[t.k]);
  const noneOn = PID_TERMS.every(t => !shown[t.k]);
  const bulk = () => setShown(Object.fromEntries(PID_TERMS.map(t => [t.k, noneOn || !allOn])));

  return (
    <AnPlot
      title="PID contribution · roll"
      sub="click a term to toggle  ·  shift-click to solo  ·  hover for values"
      height={170}
      right={
        <div style={{ display: "flex", gap: 4, alignItems: "center", fontFamily: FM, fontSize: 11 }}>
          {PID_TERMS.map(t => {
            const on = shown[t.k];
            return (
              <button key={t.k} onClick={(e) => toggle(t.k, e)} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "3px 8px",
                background: on ? `${t.c}1a` : "transparent",
                border: `1px solid ${on ? t.c : AN.line2}`,
                color: on ? t.c : AN.ink3,
                fontFamily: FM, fontSize: 11, fontWeight: 600,
                cursor: "pointer", borderRadius: 2,
                transition: "all 120ms",
              }}>
                <span style={{
                  width: 9, height: 2,
                  background: on ? t.c : AN.line2,
                  display: "inline-block",
                }} />
                {t.k}
              </button>
            );
          })}
          <span onClick={bulk} style={{
            marginLeft: 6, color: AN.ink3, fontSize: 10, cursor: "pointer",
            letterSpacing: "0.12em", textTransform: "uppercase",
          }}>{allOn ? "hide all" : "show all"}</span>
        </div>
      }
    >
      <AnAxes vLines={8} hLines={4} />
      <svg ref={plotRef}
           onMouseMove={(e) => { if (!pinned) setCursorT(xFrac(e.clientX)); }}
           onMouseLeave={() => { if (!pinned) setCursorT(null); }}
           style={{ position: "absolute", inset: 10, width: "calc(100% - 20px)", height: "calc(100% - 20px)",
                    cursor: "crosshair" }}
           preserveAspectRatio="none" viewBox="0 0 100 100">
        <line x1="0" x2="100" y1="50" y2="50" stroke={AN.line2} strokeWidth="0.3" strokeDasharray="1,1" />
        {PID_TERMS.filter(t => shown[t.k]).map(t => (
          <polyline key={t.k}
                    points={polyPath(t.data(), 70, 50)}
                    fill="none" stroke={t.c} strokeWidth={t.width}
                    opacity={0.92} />
        ))}
        {/* shared cursor */}
        {cursorT != null && (
          <g>
            <line x1={cursorT * 100} x2={cursorT * 100} y1="0" y2="100"
                  stroke={pinned ? AN.accent : AN.ink}
                  strokeWidth="0.4" opacity={pinned ? 0.9 : 0.6} />
            {PID_TERMS.filter(t => shown[t.k]).map(t => (
              <circle key={t.k}
                      cx={cursorT * 100}
                      cy={50 - (sampleAt(t.data(), cursorT) - 0.5) * 70 * 2}
                      r="1.1" fill={t.c} stroke={AN.bg} strokeWidth="0.4" />
            ))}
          </g>
        )}
      </svg>
      {/* empty-state hint */}
      {PID_TERMS.every(t => !shown[t.k]) && (
        <div style={{
          position: "absolute", inset: 10, display: "flex", alignItems: "center", justifyContent: "center",
          color: AN.ink3, fontFamily: FM, fontSize: 11, letterSpacing: "0.08em",
          pointerEvents: "none",
        }}>
          all terms hidden — click a chip above
        </div>
      )}
    </AnPlot>
  );
};

Object.assign(window, { StepResponsePanel, PIDContributionPanel });
