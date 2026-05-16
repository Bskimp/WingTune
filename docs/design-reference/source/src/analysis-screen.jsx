// Analysis screen — composed.
// Wing-first layout: setpoint tracking on top, PID + step response,
// filter delay, SPA + TPA. Demoted strip below for config (controller,
// debug mode, phases). This is what the app actually looks like once
// a file is loaded.

const AnalysisHeader = ({ tab, setTab }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 14px",
    background: AN.surface, border: `1px solid ${AN.line2}`,
    borderTop: `2px solid ${AN.accent}`,
  }}>
    <div style={{ display: "flex", gap: 16, alignItems: "center", minWidth: 0 }}>
      <span style={{ color: AN.ink, fontFamily: FH, fontSize: 16, fontWeight: 600, letterSpacing: "-0.005em" }}>
        WingTune
      </span>
      <span style={{ width: 1, height: 18, background: AN.line2 }} />
      <IconFile size={13} />
      <span style={{ color: AN.ink, fontFamily: FM, fontSize: 13,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Skywing · 14:30:22
      </span>
      <span style={{ color: AN.ink3, fontFamily: FM, fontSize: 11 }}>4:32 · 47.2 MB · BF 2026.6.0-α</span>
    </div>
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      {/* primary nav — interactive */}
      <div style={{ display: "flex", gap: 1 }}>
        {[
          ["tracking", "Tracking"],
          ["spectrum", "Spectrum"],
          ["step",     "Step"],
          ["recommend","Recommend"],
        ].map(([id, label]) => {
          const sel = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: "5px 12px",
              fontFamily: FS, fontSize: 11.5, fontWeight: 600,
              color: sel ? AN.bg : AN.ink2,
              background: sel ? AN.accent : AN.surface2,
              border: `1px solid ${sel ? AN.accent : AN.line2}`,
              cursor: "pointer",
            }}>{label}</button>
          );
        })}
      </div>
      <span style={{ marginLeft: 6, color: AN.ink3, fontSize: 11, cursor: "pointer" }}>Swap log</span>
    </div>
  </div>
);

// Config strip — demoted info that's "configure once, then ignore"
const AnalysisConfigStrip = () => (
  <div style={{
    display: "flex", padding: 0, background: AN.surface,
    border: `1px solid ${AN.line2}`, borderTop: "none",
  }}>
    {[
      { k: "controller", v: "PIDFS",        sub: "S=22 · active",          color: AN.accent, stamp: "high",
        badge: { label: "DELTA", short: "2 elevons + thr" } },
      { k: "TPA",        v: "airspeed",     sub: "throttle+pitch · BASIC", color: AN.ok,     stamp: "high" },
      { k: "SPA",        v: "per-axis",     sub: "R:PD_I · P:I · Y:OFF",   color: AN.warn,   stamp: "medium" },
      { k: "debug",      v: "SPA",          sub: "+3 fields",              color: AN.ink,    stamp: "high" },
      { k: "phases",     v: "6 detected",   sub: "launch · cruise · throw · land", color: AN.ink, stamp: null },
    ].map((c, i) => (
      <div key={c.k} style={{
        flex: 1, padding: "8px 12px", minWidth: 0,
        borderLeft: i > 0 ? `1px solid ${AN.line2}` : "none",
        position: "relative",
      }}>
        <div style={{ color: AN.ink3, fontFamily: FS, fontSize: 9,
                       letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 3 }}>{c.k}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ color: c.color, fontFamily: FM, fontSize: 13, fontWeight: 500,
                         overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.v}</div>
          {c.badge && (
            <span style={{
              flexShrink: 0,
              padding: "1px 6px",
              border: `1px solid ${AN.line2}`,
              color: AN.accent, background: `${AN.accent}10`,
              fontFamily: FS, fontSize: 9, fontWeight: 700, letterSpacing: "0.16em",
            }}>{c.badge.label}</span>
          )}
        </div>
        <div style={{ color: AN.ink3, fontFamily: FM, fontSize: 10.5, marginTop: 2,
                       overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.badge ? `${c.sub} · ${c.badge.short}` : c.sub}
        </div>
        {c.stamp && (
          <span style={{
            position: "absolute", top: 8, right: 8,
            width: 6, height: 6, borderRadius: "50%",
            background: c.stamp === "high" ? AN.ok : c.stamp === "medium" ? AN.warn : AN.stamp,
            boxShadow: `0 0 6px ${c.stamp === "high" ? AN.ok : c.stamp === "medium" ? AN.warn : AN.stamp}`,
          }} />
        )}
      </div>
    ))}
  </div>
);

// Time-axis bar with phase shading — anchors everything to a flight clock.
// Click anywhere to pin a cursor. Drag to scrub.
const AnalysisTimeBar = () => {
  const { cursorT, setCursorT, pinned, setPinned } = useCursor();
  const barRef = React.useRef(null);
  const xFrac = (clientX) => {
    const r = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const onDown = (e) => {
    const t = xFrac(e.clientX);
    setCursorT(t); setPinned(true);
    const onMove = (ev) => setCursorT(xFrac(ev.clientX));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <div ref={barRef} onMouseDown={onDown} style={{
      position: "relative", height: 28,
      background: AN.surface, border: `1px solid ${AN.line2}`, borderTop: "none",
      cursor: "crosshair", userSelect: "none",
    }}>
      {/* phase blocks */}
      {[
        { l: 0,   w: 12,  c: AN.warn,   key: "L" },
        { l: 12,  w: 36,  c: AN.ok,     key: "C" },
        { l: 48,  w: 166, c: AN.accent, key: "C2", op: 0.35 },
        { l: 214, w: 17,  c: AN.warn,   key: "T" },
        { l: 258, w: 14,  c: AN.ok,     key: "Land" },
      ].map(b => (
        <div key={b.key} style={{
          position: "absolute", top: 6, height: 10,
          left:  `${(b.l / 272) * 100}%`,
          width: `${(b.w / 272) * 100}%`,
          background: b.c, opacity: b.op ?? 0.55, pointerEvents: "none",
        }} />
      ))}
      {/* analysis window highlight bracket */}
      <div style={{
        position: "absolute", left: `${(48 / 272) * 100}%`, right: `${100 - (258 / 272) * 100}%`,
        top: 4, bottom: 4, border: `1px solid ${AN.accent}`,
        background: "transparent", pointerEvents: "none",
      }} />
      {/* tick marks */}
      {[0, 1, 2, 3, 4].map(m => (
        <div key={m} style={{
          position: "absolute", left: `${(m * 60 / 272) * 100}%`, top: 18,
          transform: "translateX(-50%)",
          fontFamily: FM, fontSize: 9.5, color: AN.ink3, pointerEvents: "none",
        }}>{m}:00</div>
      ))}
      {/* cursor line */}
      {cursorT != null && (
        <>
          <div style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${cursorT * 100}%`, width: 1,
            background: pinned ? AN.accent : AN.ink,
            pointerEvents: "none",
            boxShadow: pinned ? `0 0 6px ${AN.accent}` : "none",
          }} />
          <div style={{
            position: "absolute", top: -1, left: `${cursorT * 100}%`,
            transform: "translateX(-50%)",
            background: pinned ? AN.accent : AN.ink, color: AN.bg,
            padding: "1px 5px",
            fontFamily: FM, fontSize: 9, fontWeight: 600,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}>{fmtClock(cursorT)}</div>
        </>
      )}
      <span style={{
        position: "absolute", right: 8, top: 4, fontFamily: FS, fontSize: 9,
        color: AN.accent, letterSpacing: "0.18em", fontWeight: 700, pointerEvents: "none",
      }}>ANALYSIS WINDOW · 3:30</span>
    </div>
  );
};

const TrackingTab = () => (
  <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 10, marginTop: 10, alignItems: "stretch" }}>
    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <LogViewerPanel />
    </div>
    <div style={{ display: "grid", gap: 10, minWidth: 0, gridTemplateRows: "1fr auto" }}>
      <FilterDelayPanel />
      <PIDContributionPanel />
    </div>
  </div>
);

const AnalysisScreen = ({ defaultTab = "tracking" }) => {
  const [tab, setTab] = React.useState(defaultTab);
  return (
    <CursorProvider>
      <div style={{ background: AN.bg, color: AN.ink, padding: 14, fontFamily: FS }}>
        <AnalysisHeader tab={tab} setTab={setTab} />
        <AnalysisConfigStrip />
        <AnalysisTimeBar />
        <CursorReadout />

        {tab === "tracking" && <TrackingTab />}
        {tab === "spectrum" && <SpectrumTab />}
        {tab === "step"     && <StepResponseTab />}
        {tab === "recommend"&& <RecommendTab />}
        {!["tracking", "spectrum", "step", "recommend"].includes(tab) && (
          <div style={{
            marginTop: 10, padding: "40px 24px",
            background: AN.surface, border: `1px solid ${AN.line2}`,
            color: AN.ink3, fontFamily: FM, fontSize: 12, textAlign: "center",
          }}>
            {tab} — not yet designed.  back to <button onClick={() => setTab("tracking")} style={{
              color: AN.accent, background: "transparent", border: "none", fontFamily: FM, fontSize: 12, cursor: "pointer", textDecoration: "underline",
            }}>Tracking</button>
          </div>
        )}

        {/* signature footer */}
        <div style={{
          marginTop: 12, padding: "8px 14px",
          background: AN.surface, border: `1px solid ${AN.line}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontFamily: FM, fontSize: 10.5, color: AN.ink3,
        }}>
          <div style={{ display: "flex", gap: 18 }}>
            <span><span style={{ color: AN.ink3 }}>sig</span> <span style={{ color: AN.ink2 }}>f3a91c2:b8e4</span></span>
            <span><span style={{ color: AN.ink3 }}>parser</span> <span style={{ color: AN.ink2 }}>blackbox-log 0.4.2-wing</span></span>
            <span><span style={{ color: AN.ink3 }}>wl</span> <span style={{ color: AN.ink2 }}>0.1.0-m1.3</span></span>
          </div>
          <span style={{ color: AN.ink3 }}>render 18 ms · 200 samples × 6 panels</span>
        </div>
      </div>
    </CursorProvider>
  );
};

Object.assign(window, { AnalysisScreen });
