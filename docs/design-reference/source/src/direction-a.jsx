// Direction A — "Phosphor Scope"
// PIDtoolbox heritage. Mono everywhere, phosphor green on near-black,
// bracket frames, ASCII bars, dashed rules. Loud telemetry-instrument vibe.

const A_TOKENS = {
  bg:       "#050807",
  surface:  "#0a1310",
  surface2: "#0c1813",
  grid:     "rgba(110,255,168,0.045)",
  line:     "#1a3d2a",
  line2:    "#2d4d3e",
  dim:      "#3d6850",
  ink:      "#b9ffd5",
  ink2:     "#80c79c",
  ink3:     "#5b9170",
  phos:     "#6effa8",
  amber:    "#ffcc4a",
  red:      "#ff6b66",
  blue:     "#7ec8ff",
};

const A_FONT_MONO = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace";

// ---------- atoms ----------

const APill = ({ level }) => {
  const map = {
    high:   { fg: A_TOKENS.phos,  bg: "rgba(110,255,168,0.12)", bd: "rgba(110,255,168,0.45)", t: "HIGH" },
    medium: { fg: A_TOKENS.amber, bg: "rgba(255,204,74,0.12)",  bd: "rgba(255,204,74,0.45)",  t: "MED " },
    low:    { fg: A_TOKENS.red,   bg: "rgba(255,107,102,0.12)", bd: "rgba(255,107,102,0.45)", t: "LOW " },
  };
  const c = map[level];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "1px 7px", fontSize: 10, letterSpacing: "0.12em",
      color: c.fg, background: c.bg, border: `1px solid ${c.bd}`,
      fontFamily: A_FONT_MONO,
    }}>
      <span style={{ width: 5, height: 5, background: c.fg, display: "inline-block" }} />
      {c.t}
    </span>
  );
};

const ABracket = ({ children, title, right, mb = 14 }) => (
  <div style={{ position: "relative", padding: "14px 14px 12px", border: `1px solid ${A_TOKENS.line}`, marginBottom: mb, background: A_TOKENS.surface }}>
    {/* corner ticks */}
    {[[0,0],[1,0],[0,1],[1,1]].map(([x,y],i) => (
      <span key={i} style={{
        position: "absolute",
        [x ? "right" : "left"]: -1, [y ? "bottom" : "top"]: -1,
        width: 7, height: 7,
        borderTop:    y ? "none" : `1px solid ${A_TOKENS.phos}`,
        borderBottom: y ? `1px solid ${A_TOKENS.phos}` : "none",
        borderLeft:   x ? "none" : `1px solid ${A_TOKENS.phos}`,
        borderRight:  x ? `1px solid ${A_TOKENS.phos}` : "none",
      }} />
    ))}
    {title && (
      <div style={{ position: "absolute", top: -8, left: 12, padding: "0 6px",
                    background: A_TOKENS.bg, color: A_TOKENS.ink3, fontSize: 10,
                    letterSpacing: "0.18em", fontFamily: A_FONT_MONO }}>
        {title}
      </div>
    )}
    {right && (
      <div style={{ position: "absolute", top: -8, right: 12, padding: "0 6px", background: A_TOKENS.bg }}>
        {right}
      </div>
    )}
    {children}
  </div>
);

// Dot-leaders dashed line between left & right
const ADotRow = ({ left, right, color }) => (
  <div style={{
    display: "flex", alignItems: "baseline", gap: 8,
    fontFamily: A_FONT_MONO, fontSize: 12, color: color || A_TOKENS.ink,
    padding: "3px 0",
  }}>
    <span>{left}</span>
    <span style={{
      flex: 1, alignSelf: "center", height: 1,
      backgroundImage: `linear-gradient(to right, ${A_TOKENS.line2} 50%, transparent 50%)`,
      backgroundSize: "4px 1px", backgroundRepeat: "repeat-x",
    }} />
    <span style={{ color: A_TOKENS.phos }}>{right}</span>
  </div>
);

// ASCII-style progress bar using block glyphs
const AAsciiBar = ({ pct, width = 30 }) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return (
    <span style={{ fontFamily: A_FONT_MONO, color: A_TOKENS.phos, letterSpacing: "0.05em" }}>
      {"▓".repeat(filled)}<span style={{ color: A_TOKENS.dim }}>{"░".repeat(width - filled)}</span>
    </span>
  );
};

// ---------- file-drop states ----------

const ADropFrame = ({ stateLabel, accent, children, dashed = true }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontFamily: A_FONT_MONO, fontSize: 10, letterSpacing: "0.22em",
      color: A_TOKENS.ink3, marginBottom: 6,
    }}>
      <span>┌─ STATE · {stateLabel}</span>
      <span>{`──┐`}</span>
    </div>
    <div style={{
      position: "relative",
      border: `1px ${dashed ? "dashed" : "solid"} ${accent}`,
      background: `
        repeating-linear-gradient(0deg, transparent 0, transparent 19px, ${A_TOKENS.grid} 19px, ${A_TOKENS.grid} 20px),
        repeating-linear-gradient(90deg, transparent 0, transparent 19px, ${A_TOKENS.grid} 19px, ${A_TOKENS.grid} 20px),
        ${A_TOKENS.surface}
      `,
      padding: "32px 28px",
      minHeight: 160,
    }}>
      {children}
    </div>
  </div>
);

const ADropEmpty = () => (
  <ADropFrame stateLabel="EMPTY · IDLE" accent={A_TOKENS.line2}>
    <div style={{ fontFamily: A_FONT_MONO, color: A_TOKENS.ink, textAlign: "center" }}>
      <div style={{ fontSize: 22, letterSpacing: "0.14em", color: A_TOKENS.phos, marginBottom: 14 }}>
        ▶ DROP .BFL  ·  .BBL  ·  .TXT
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.18em", color: A_TOKENS.ink3, marginBottom: 18 }}>
        OR  [ SELECT FILE ]   [ LOAD SAMPLE LOG ]
      </div>
      <div style={{
        display: "inline-flex", gap: 24, fontSize: 10, letterSpacing: "0.18em",
        color: A_TOKENS.dim,
      }}>
        <span>MAX 250 MB / FILE</span>
        <span>·</span>
        <span>BF ≥ 4.5  ·  WING SUPPORT</span>
      </div>
    </div>
  </ADropFrame>
);

const ADropHover = () => (
  <ADropFrame stateLabel="HOVER · FILE OVER ZONE" accent={A_TOKENS.phos} dashed={false}>
    <div style={{ position: "absolute", inset: 6, border: `1px dashed ${A_TOKENS.phos}`, pointerEvents: "none", opacity: 0.7 }} />
    <div style={{ fontFamily: A_FONT_MONO, textAlign: "center", color: A_TOKENS.phos }}>
      <div style={{ fontSize: 24, letterSpacing: "0.18em", marginBottom: 12,
                    textShadow: `0 0 12px ${A_TOKENS.phos}` }}>
        ◢◤ RELEASE TO INGEST ◥◣
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.22em", color: A_TOKENS.ink2 }}>
        1 FILE DETECTED  ·  BTFL_BLACKBOX_LOG_…143022.BFL  ·  47.2 MB
      </div>
    </div>
  </ADropFrame>
);

const ADropParsing = () => (
  <ADropFrame stateLabel="PARSING · IN PROGRESS" accent={A_TOKENS.line2} dashed={false}>
    <div style={{ fontFamily: A_FONT_MONO, fontSize: 12, color: A_TOKENS.ink, lineHeight: 1.7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ color: A_TOKENS.phos }}>▶ DECODE  ::  Skywing_…143022.bfl</span>
        <span style={{ color: A_TOKENS.ink3 }}>824 ms · 47.2 MB</span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <AAsciiBar pct={64} width={42} />
        <span style={{ marginLeft: 10, color: A_TOKENS.amber }}>64%</span>
      </div>
      <div style={{ color: A_TOKENS.ink3, fontSize: 11, letterSpacing: "0.04em" }}>
        <div><span style={{ color: A_TOKENS.phos }}>·</span> headers       <span style={{ color: A_TOKENS.ink3 }}>ok</span></div>
        <div><span style={{ color: A_TOKENS.phos }}>·</span> field map     <span style={{ color: A_TOKENS.ink3 }}>resolved 11/12</span></div>
        <div><span style={{ color: A_TOKENS.phos }}>·</span> main frames   <span style={{ color: A_TOKENS.amber }}>348 712 / 544 800</span></div>
        <div><span style={{ color: A_TOKENS.dim }}>·</span> event index   <span style={{ color: A_TOKENS.dim }}>pending</span></div>
      </div>
    </div>
  </ADropFrame>
);

const ADropError = () => (
  <ADropFrame stateLabel="ERROR · ABORT" accent={A_TOKENS.red} dashed={false}>
    <div style={{ fontFamily: A_FONT_MONO, fontSize: 12, color: A_TOKENS.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ color: A_TOKENS.red, fontSize: 14, letterSpacing: "0.2em" }}>✕ E_UNSUPPORTED_FIRMWARE</span>
        <span style={{ flex: 1, height: 1, borderTop: `1px dashed ${A_TOKENS.red}`, opacity: 0.5 }} />
      </div>
      <div style={{ color: A_TOKENS.ink2, marginBottom: 12 }}>
        BTFL_BLACKBOX_LOG_…092201.bfl  declares  <span style={{ color: A_TOKENS.amber }}>BF 4.4.3</span>.
        WingTune requires <span style={{ color: A_TOKENS.phos }}>≥ 4.5</span> for wing capability fields.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {["[ DISMISS ]", "[ OPEN ANYWAY · NO WING TUNE ]", "[ COPY ERROR ]"].map(t => (
          <span key={t} style={{
            padding: "4px 10px", border: `1px solid ${A_TOKENS.line2}`,
            color: A_TOKENS.ink2, fontSize: 11, letterSpacing: "0.12em",
            background: A_TOKENS.surface2,
          }}>{t}</span>
        ))}
      </div>
    </div>
  </ADropFrame>
);

const ADropQueue = () => (
  <ABracket title="QUEUE · 3 FILES" mb={0}
            right={<span style={{ color: A_TOKENS.ink3, fontFamily: A_FONT_MONO, fontSize: 10, letterSpacing: "0.18em" }}>[ + ADD ]  [ CLEAR ]</span>}>
    <div style={{ fontFamily: A_FONT_MONO, fontSize: 11, color: A_TOKENS.ink }}>
      <div style={{
        display: "grid", gridTemplateColumns: "16px 1fr 70px 110px 70px",
        gap: 10, color: A_TOKENS.dim, letterSpacing: "0.16em",
        fontSize: 9, paddingBottom: 6, borderBottom: `1px solid ${A_TOKENS.line}`,
      }}>
        <span>·</span><span>FILE</span><span>LEN</span><span>FW</span><span>STATE</span>
      </div>
      {WT_QUEUE.map((q, i) => {
        const isActive = q.state === "active";
        return (
          <div key={q.id} style={{
            display: "grid", gridTemplateColumns: "16px 1fr 70px 110px 70px",
            gap: 10, padding: "8px 0",
            borderBottom: i < WT_QUEUE.length - 1 ? `1px dashed ${A_TOKENS.line}` : "none",
            color: isActive ? A_TOKENS.ink : A_TOKENS.ink2,
          }}>
            <span style={{ color: isActive ? A_TOKENS.phos : A_TOKENS.dim }}>{isActive ? "▶" : "·"}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.short}</span>
            <span style={{ color: A_TOKENS.ink2 }}>{q.duration}</span>
            <span style={{ color: A_TOKENS.ink3 }}>{q.fw}</span>
            <span style={{ color: isActive ? A_TOKENS.phos : A_TOKENS.amber, letterSpacing: "0.12em" }}>
              {isActive ? "ACTIVE" : "QUEUED"}
            </span>
          </div>
        );
      })}
    </div>
  </ABracket>
);

const ADirectionDrop = () => (
  <div style={{ background: A_TOKENS.bg, color: A_TOKENS.ink, padding: 22, fontFamily: A_FONT_MONO }}>
    <AHeader />
    <ADropEmpty />
    <ADropHover />
    <ADropParsing />
    <ADropError />
    <ADropQueue />
  </div>
);

const AHeader = () => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 18, paddingBottom: 10, borderBottom: `1px solid ${A_TOKENS.line}`,
    fontFamily: A_FONT_MONO,
  }}>
    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
      <span style={{ color: A_TOKENS.phos, fontSize: 14, letterSpacing: "0.22em" }}>WINGTUNE</span>
      <span style={{ color: A_TOKENS.ink3, fontSize: 10, letterSpacing: "0.18em" }}>v0.1.0 · M1.3</span>
    </div>
    <div style={{ display: "flex", gap: 14, fontSize: 10, letterSpacing: "0.16em", color: A_TOKENS.ink3 }}>
      <span><span style={{ color: A_TOKENS.phos }}>●</span>&nbsp;WASM&nbsp;READY</span>
      <span>OFFLINE</span>
      <span>FIXED&nbsp;WING</span>
    </div>
  </div>
);

// ---------- capability summary ----------

const ACapCard = ({ cap, children, span = 1 }) => (
  <ABracket
    title={cap.label.toUpperCase()}
    right={<APill level={cap.confidence} />}
    mb={14}
  >
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: A_TOKENS.phos, fontSize: 16, letterSpacing: "0.06em",
                       fontFamily: A_FONT_MONO, marginBottom: 4 }}>
          {cap.value}
        </div>
        <div style={{ color: A_TOKENS.ink2, fontSize: 11, letterSpacing: "0.04em" }}>{cap.sub}</div>
      </div>
    </div>
    {children}
  </ABracket>
);

const ACapDetail = ({ rows }) => (
  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${A_TOKENS.line}` }}>
    {rows.map(([k, v]) => <ADotRow key={k} left={k} right={v} />)}
  </div>
);

const ACapKVStrip = ({ pairs }) => (
  <div style={{
    display: "grid", gridTemplateColumns: `repeat(${pairs.length}, 1fr)`,
    gap: 1, marginTop: 10,
    background: A_TOKENS.line,
    border: `1px solid ${A_TOKENS.line}`,
  }}>
    {pairs.map(([k, v]) => (
      <div key={k} style={{
        background: A_TOKENS.surface2, padding: "8px 6px", textAlign: "center",
        fontFamily: A_FONT_MONO,
      }}>
        <div style={{ color: A_TOKENS.dim, fontSize: 9, letterSpacing: "0.22em", marginBottom: 4 }}>{k.toUpperCase()}</div>
        <div style={{ color: A_TOKENS.phos, fontSize: 15 }}>{v}</div>
      </div>
    ))}
  </div>
);

const AFieldTable = () => (
  <ABracket title="MAIN-FRAME FIELDS · 12">
    <div style={{ fontFamily: A_FONT_MONO, fontSize: 11 }}>
      <div style={{
        display: "grid", gridTemplateColumns: "18px 1fr 30px 40px 1.4fr",
        gap: 10, color: A_TOKENS.dim, letterSpacing: "0.16em",
        fontSize: 9, paddingBottom: 6, borderBottom: `1px solid ${A_TOKENS.line}`,
      }}>
        <span></span><span>FIELD</span><span style={{ textAlign: "right" }}>N</span><span>TYPE</span><span>NOTE</span>
      </div>
      {WT_FIELDS.map((f, i) => (
        <div key={f.name} style={{
          display: "grid", gridTemplateColumns: "18px 1fr 30px 40px 1.4fr",
          gap: 10, padding: "5px 0",
          borderBottom: i < WT_FIELDS.length - 1 ? `1px dashed ${A_TOKENS.line}` : "none",
          color: f.present ? A_TOKENS.ink : A_TOKENS.dim,
          opacity: f.present ? 1 : 0.55,
        }}>
          <span style={{ color: f.present ? A_TOKENS.phos : A_TOKENS.dim }}>{f.present ? "✓" : "·"}</span>
          <span style={{ color: f.present ? A_TOKENS.ink : A_TOKENS.dim }}>{f.name}</span>
          <span style={{ textAlign: "right", color: A_TOKENS.ink2 }}>{f.count}</span>
          <span style={{ color: A_TOKENS.ink3 }}>{f.dtype}</span>
          <span style={{ color: f.present ? A_TOKENS.ink3 : A_TOKENS.dim,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.note}</span>
        </div>
      ))}
      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: `1px solid ${A_TOKENS.line}`,
        display: "flex", justifyContent: "space-between", color: A_TOKENS.ink3, fontSize: 10, letterSpacing: "0.16em",
      }}>
        <span>10 / 12  PRESENT</span>
        <span style={{ color: A_TOKENS.dim }}>2  MISSING · amperageLatest · magADC</span>
      </div>
    </div>
  </ABracket>
);

const ADirectionCaps = () => (
  <div style={{ background: A_TOKENS.bg, color: A_TOKENS.ink, padding: 22 }}>
    <AHeader />
    {/* file strip — collapsed when loaded */}
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 12px", border: `1px solid ${A_TOKENS.line2}`,
      marginBottom: 18, background: A_TOKENS.surface,
      fontFamily: A_FONT_MONO, fontSize: 11,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ color: A_TOKENS.phos }}>▶</span>
        <span style={{ color: A_TOKENS.ink }}>Skywing · 14:30:22</span>
        <span style={{ color: A_TOKENS.ink3 }}>4:32  ·  47.2 MB  ·  parse 824 ms</span>
      </div>
      <span style={{ color: A_TOKENS.ink3, letterSpacing: "0.18em" }}>[ SWAP ]  [ × ]</span>
    </div>

    <div style={{ color: A_TOKENS.ink3, fontFamily: A_FONT_MONO, fontSize: 10,
                  letterSpacing: "0.22em", marginBottom: 10 }}>
      // CAPABILITY SCAN
    </div>

    <ACapCard cap={WT_CAPS.controller}>
      <ACapKVStrip pairs={WT_CAPS.controller.detail} />
    </ACapCard>

    <ACapCard cap={WT_CAPS.tpa}>
      <ACapDetail rows={WT_CAPS.tpa.detail} />
    </ACapCard>

    <ACapCard cap={WT_CAPS.spa}>
      <ACapDetail rows={WT_CAPS.spa.detail} />
      <div style={{
        marginTop: 10, padding: "8px 10px",
        border: `1px solid ${A_TOKENS.amber}`, color: A_TOKENS.amber,
        fontFamily: A_FONT_MONO, fontSize: 11, letterSpacing: "0.02em",
        background: "rgba(255,204,74,0.06)",
      }}>
        <span style={{ letterSpacing: "0.16em", marginRight: 6 }}>⚠ NOTE</span>
        {WT_CAPS.spa.note}
      </div>
    </ACapCard>

    <ACapCard cap={WT_CAPS.debug}>
      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {WT_CAPS.debug.unlocks.map(u => (
          <span key={u} style={{
            fontFamily: A_FONT_MONO, fontSize: 11,
            padding: "2px 8px", border: `1px solid ${A_TOKENS.line2}`,
            color: A_TOKENS.phos, background: A_TOKENS.surface2,
          }}>+ {u}</span>
        ))}
      </div>
    </ACapCard>

    <AFieldTable />
  </div>
);

Object.assign(window, { ADirectionDrop, ADirectionCaps, A_TOKENS });
