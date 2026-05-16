// Filter delay budget · SPA curve · TPA(airspeed) curve.

const FilterDelayPanel = () => {
  const elecTotal = FILTER_BUDGET.reduce((a, b) => a + b.ms, 0);
  const maxMs = Math.max(...FILTER_BUDGET.map(f => f.ms));
  const elecBudget = 5.0;

  // Mechanical chain — servo + mixer mechanical lag (wing-specific, dominates electronic chain)
  const MECH = [
    { name: "servo response",   ms: 15.0, kind: "servo", note: "PT1-ish · ~50 Hz cutoff @ load" },
    { name: "mixer mechanical", ms:  2.0, kind: "mixer", note: "linkage + control horn" },
  ];
  const mechTotal = MECH.reduce((a, b) => a + b.ms, 0);
  const mechMax = Math.max(...MECH.map(f => f.ms));
  const mechBudget = 22.0;

  const totalAll = elecTotal + mechTotal;
  const totalBudget = elecBudget + mechBudget;

  const ChainRow = ({ f, max, kindColors }) => (
    <div style={{
      display: "grid", gridTemplateColumns: "120px 1fr 60px",
      alignItems: "center", gap: 10, padding: "4px 0",
      borderBottom: `1px solid ${AN.line}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: AN.ink, fontFamily: FM, fontSize: 11.5 }}>{f.name}</div>
        <div style={{ color: AN.ink3, fontFamily: FM, fontSize: 10 }}>{f.note}</div>
      </div>
      <div style={{ position: "relative", height: 10, background: AN.surface2,
                     border: `1px solid ${AN.line}` }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${(f.ms / max) * 100}%`,
          background: kindColors[f.kind] || AN.accent,
          opacity: 0.85,
        }} />
      </div>
      <div style={{ textAlign: "right", color: AN.ink, fontFamily: FM, fontSize: 12 }}>{f.ms.toFixed(1)} ms</div>
    </div>
  );

  const elecColors  = { notch: AN.warn, biquad: AN.accent };
  const mechColors  = { servo: AN.stamp, mixer: AN.ink2 };

  return (
    <AnPlot
      title="Output delay budget"
      sub={`gyro \u2192 surface chain  \u00b7  total ${totalAll.toFixed(1)} ms  \u00b7  wing ceiling ${totalBudget.toFixed(1)} ms`}
      height={420}
      right={
        <span style={{
          padding: "2px 8px",
          border: `1px solid ${totalAll > totalBudget ? AN.stamp : AN.ok}`,
          color: totalAll > totalBudget ? AN.stamp : AN.ok,
          fontFamily: FS, fontSize: 9, fontWeight: 700, letterSpacing: "0.2em",
        }}>{totalAll > totalBudget ? "OVER BUDGET" : "WITHIN BUDGET"}</span>
      }
    >
      <div style={{ position: "relative", height: "100%" }}>
        {/* ELECTRONIC CHAIN */}
        <div style={{
          color: AN.accent, fontFamily: FS, fontSize: 9,
          letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 700,
          marginBottom: 4,
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}>
          <span>Electronic chain</span>
          <span style={{ color: AN.ink3, letterSpacing: 0, fontFamily: FM, fontSize: 10, textTransform: "none", fontWeight: 400 }}>
            {elecTotal.toFixed(1)} / {elecBudget.toFixed(1)} ms
          </span>
        </div>
        {FILTER_BUDGET.map(f => (
          <ChainRow key={f.name} f={f} max={maxMs} kindColors={elecColors} />
        ))}

        {/* MECHANICAL CHAIN */}
        <div style={{
          color: AN.stamp, fontFamily: FS, fontSize: 9,
          letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 700,
          marginTop: 14, marginBottom: 4,
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}>
          <span>Mechanical chain · servo + linkage</span>
          <span style={{ color: AN.ink3, letterSpacing: 0, fontFamily: FM, fontSize: 10, textTransform: "none", fontWeight: 400 }}>
            {mechTotal.toFixed(1)} / {mechBudget.toFixed(1)} ms
          </span>
        </div>
        {MECH.map(f => (
          <ChainRow key={f.name} f={f} max={mechMax} kindColors={mechColors} />
        ))}

        {/* totals */}
        <div style={{
          marginTop: 12, paddingTop: 8, borderTop: `1px solid ${AN.line2}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontFamily: FM, fontSize: 11.5,
        }}>
          <span style={{ color: AN.ink3 }}>chain total · output lag</span>
          <span>
            <span style={{ color: AN.ink3, marginRight: 8 }}>
              elec {elecTotal.toFixed(1)} + mech {mechTotal.toFixed(1)} =
            </span>
            <span style={{ color: totalAll > totalBudget ? AN.stamp : AN.ink, fontWeight: 600 }}>
              {totalAll.toFixed(1)} ms
            </span>
            <span style={{ color: AN.ink3 }}> / {totalBudget.toFixed(1)} ms</span>
          </span>
        </div>
        <div style={{
          marginTop: 6, padding: "6px 10px",
          background: `${AN.warn}11`, borderLeft: `2px solid ${AN.warn}`,
          fontFamily: FS, fontSize: 11, color: AN.ink2, lineHeight: 1.45,
        }}>
          <span style={{ color: AN.warn, fontWeight: 700, marginRight: 6, fontSize: 10, letterSpacing: "0.18em" }}>NOTE</span>
          Mechanical chain ({mechTotal.toFixed(1)} ms) dominates the electronic chain ({elecTotal.toFixed(1)} ms). On wings, tuning is typically gated by servo lag, not filter delay.
        </div>
      </div>
    </AnPlot>
  );
};

// Generic curve plot: current (solid accent) vs recommended (dashed ink)
const CurvePanel = ({ title, sub, current, rec, xLabel, yLabel, marker }) => (
  <AnPlot
    title={title}
    sub={sub}
    height={170}
    right={
      <div style={{ display: "flex", gap: 12, fontFamily: FS, fontSize: 10, color: AN.ink2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 2, background: AN.accent, display: "inline-block" }} /> current
        </span>
        {rec && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 0, borderTop: `1.5px dashed ${AN.ink2}`, display: "inline-block" }} /> wing rec.
          </span>
        )}
      </div>
    }
  >
    <AnAxes vLines={6} hLines={4} />
    <svg style={{ position: "absolute", inset: 10, width: "calc(100% - 20px)", height: "calc(100% - 20px)" }}
         preserveAspectRatio="none" viewBox="0 0 100 100">
      {rec && (
        <polyline points={polyPath(rec, 80, 90)} fill="none"
                  stroke={AN.ink2} strokeWidth="0.5" strokeDasharray="2,1" />
      )}
      <polygon
        points={`0,90 ${polyPath(current, 80, 90)} 100,90`}
        fill={AN.accent} opacity="0.10"
      />
      <polyline points={polyPath(current, 80, 90)} fill="none"
                stroke={AN.accent} strokeWidth="0.8" />
      {marker && (
        <line x1={marker.x} x2={marker.x} y1="0" y2="100"
              stroke={AN.warn} strokeWidth="0.4" strokeDasharray="2,1" />
      )}
    </svg>
    <div style={{ position: "absolute", left: 14, bottom: 4, fontFamily: FM, fontSize: 9.5, color: AN.ink3 }}>
      {xLabel}
    </div>
    <div style={{ position: "absolute", left: 14, top: 12, fontFamily: FM, fontSize: 9.5, color: AN.ink3 }}>
      {yLabel}
    </div>
  </AnPlot>
);

const SpaPanel = () => (
  <CurvePanel
    title="SPA · setpoint-rate attenuation"
    sub="threshold 120 °/s  ·  below wing floor (180 °/s)"
    current={SPA_CURVE}
    rec={SPA_REC}
    xLabel="0  →  500 °/s"
    yLabel="0  →  1.0 atten."
    marker={{ x: (120 / 500) * 100 }}
  />
);

const TpaPanel = () => (
  <CurvePanel
    title="TPA · airspeed-scheduled"
    sub="breakpoint 18 m/s  ·  attenuation 0.65"
    current={TPA_CURVE}
    rec={null}
    xLabel="0  →  30 m/s"
    yLabel="0  →  1.0 atten."
    marker={{ x: (18 / 30) * 100 }}
  />
);

Object.assign(window, { FilterDelayPanel, SpaPanel, TpaPanel });
