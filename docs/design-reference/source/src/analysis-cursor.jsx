// Synchronized cursor across time-domain plots.
//
// React context holds a single `cursorT` (0..1 fraction of total flight, or null).
// Participating plots:
//   · AnalysisTimeBar (click to pin, drag to scrub)
//   · SetpointTrackingPanel (hover moves transient cursor)
//   · PIDContributionPanel (hover moves transient cursor)
// Other plots use non-time x-axes (frequency, setpoint rate, airspeed) and ignore it.
//
// A "pinned" cursor stays put when mouse leaves; a transient one clears on leave.

const CursorCtx = React.createContext({
  cursorT: null, setCursorT: () => {},
  pinned: false, setPinned: () => {},
});

const useCursor = () => React.useContext(CursorCtx);

const CursorProvider = ({ children }) => {
  const [cursorT, setCursorT] = React.useState(null);
  const [pinned, setPinned] = React.useState(false);
  return (
    <CursorCtx.Provider value={{ cursorT, setCursorT, pinned, setPinned }}>
      {children}
    </CursorCtx.Provider>
  );
};

// Sample arrays at a given 0..1 fraction
const sampleAt = (arr, t) => {
  if (t == null) return null;
  const idx = Math.max(0, Math.min(arr.length - 1, Math.round(t * (arr.length - 1))));
  return arr[idx];
};

const fmtClock = (t) => {
  if (t == null) return "—:—";
  const sec = t * 272;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0").slice(0, 2)}`;
};
// normalized 0.5-centered value → ° / s (matches our error/setpoint convention)
const normToDeg = (v) => v == null ? null : ((v - 0.5) * 60);

// The readout strip — sits between time bar and plot grid.
// When cursor is null: shows hint. When set: shows pinned values.
const CursorReadout = () => {
  const { cursorT, pinned, setCursorT, setPinned } = useCursor();
  if (cursorT == null) {
    return (
      <div style={{
        padding: "6px 14px", background: AN.surface,
        border: `1px solid ${AN.line2}`, borderTop: "none",
        color: AN.ink3, fontFamily: FM, fontSize: 11,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>hover a time-domain plot to read values · click the time bar to pin</span>
        <span style={{ color: AN.dim }}>cursor —</span>
      </div>
    );
  }
  const sp = normToDeg(sampleAt(SETPOINT, cursorT));
  const gy = normToDeg(sampleAt(GYRO, cursorT));
  const er = (gy - sp);
  const samples = [
    ["t",       fmtClock(cursorT), AN.ink],
    ["setpt",   `${sp.toFixed(1)} °/s`, AN.ink2],
    ["gyro",    `${gy.toFixed(1)} °/s`, AN.accent],
    ["error",   `${er >= 0 ? "+" : ""}${er.toFixed(1)} °/s`, Math.abs(er) > 8 ? AN.stamp : Math.abs(er) > 3 ? AN.warn : AN.ok],
    ["P",       (sampleAt(P_CONTRIB, cursorT) - 0.5).toFixed(2), AN.accent],
    ["I",       (sampleAt(I_CONTRIB, cursorT) - 0.5).toFixed(2), "#7ec8ff"],
    ["D",       (sampleAt(D_CONTRIB, cursorT) - 0.5).toFixed(2), "#ff9d6a"],
  ];
  return (
    <div style={{
      padding: "6px 14px", background: AN.surface,
      border: `1px solid ${AN.line2}`, borderTop: "none",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontFamily: FM, fontSize: 11.5,
    }}>
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        {samples.map(([k, v, color]) => (
          <span key={k} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
            <span style={{ color: AN.ink3, fontSize: 9.5, letterSpacing: "0.16em",
                            fontWeight: 700, textTransform: "uppercase" }}>{k}</span>
            <span style={{ color }}>{v}</span>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {pinned && (
          <span style={{
            padding: "1px 7px",
            border: `1px solid ${AN.accent}`, color: AN.accent,
            fontSize: 9, letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase",
          }}>PINNED</span>
        )}
        <button onClick={() => { setCursorT(null); setPinned(false); }} style={{
          padding: "2px 8px", background: "transparent",
          border: `1px solid ${AN.line2}`, color: AN.ink3,
          fontFamily: FM, fontSize: 10.5, cursor: "pointer",
        }}>clear</button>
      </div>
    </div>
  );
};

Object.assign(window, {
  CursorCtx, useCursor, CursorProvider, sampleAt, normToDeg, fmtClock, CursorReadout,
});
