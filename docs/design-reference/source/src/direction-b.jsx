// Direction B — "Telemetry Console"
// Cleaner engineering instrument. Hairline rules, micro-grid, cool blue
// accents, mono for numbers + sans for labels. Less loud than A.

const B_TOKENS = {
  bg:       "#0b0d10",
  surface:  "#131720",
  surface2: "#181d28",
  line:     "#232a36",
  line2:    "#2e3645",
  ink:      "#e6edf3",
  ink2:     "#b0bbcc",
  ink3:     "#8b97a7",
  dim:      "#5a6478",
  blue:     "#62b6ff",
  blueDim:  "#3a6f99",
  amber:    "#f5b35a",
  green:    "#6ad57f",
  red:      "#ff7866",
};

const B_FONT_SANS = "'Inter', system-ui, -apple-system, sans-serif";
const B_FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

// ---------- atoms ----------

const BPill = ({ level }) => {
  const map = {
    high:   { fg: B_TOKENS.green, label: "High" },
    medium: { fg: B_TOKENS.amber, label: "Medium" },
    low:    { fg: B_TOKENS.red,   label: "Low" },
  };
  const c = map[level];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 8px 2px 6px", borderRadius: 2,
      background: B_TOKENS.surface2, border: `1px solid ${B_TOKENS.line2}`,
      fontFamily: B_FONT_SANS, fontSize: 10, letterSpacing: "0.06em",
      color: B_TOKENS.ink2, textTransform: "uppercase",
    }}>
      <span style={{ width: 6, height: 6, background: c.fg, borderRadius: "50%",
                      boxShadow: `0 0 6px ${c.fg}` }} />
      {c.label}
    </span>
  );
};

const BLabel = ({ children, mb = 8 }) => (
  <div style={{
    fontFamily: B_FONT_SANS, fontSize: 10, letterSpacing: "0.16em",
    color: B_TOKENS.ink3, textTransform: "uppercase", marginBottom: mb,
  }}>{children}</div>
);

const BHairline = ({ my = 0 }) => (
  <div style={{ height: 1, background: B_TOKENS.line, margin: `${my}px 0` }} />
);

// Micro grid background — visible only on the drop zone
const BMicroGrid = ({ size = 20, color = "rgba(98,182,255,0.045)" }) => (
  <div style={{
    position: "absolute", inset: 0, pointerEvents: "none",
    backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
    backgroundSize: `${size}px ${size}px`,
  }} />
);

// ---------- header (shared between drop & caps artboards) ----------

const BHeader = () => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 0", marginBottom: 18,
    borderBottom: `1px solid ${B_TOKENS.line}`,
    fontFamily: B_FONT_SANS,
  }}>
    <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
      <span style={{ color: B_TOKENS.ink, fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em" }}>
        WingTune<span style={{ color: B_TOKENS.blue, fontWeight: 400 }}>.</span>
      </span>
      <span style={{ color: B_TOKENS.dim, fontSize: 11, fontFamily: B_FONT_MONO }}>v0.1.0 · m1.3</span>
    </div>
    <div style={{ display: "flex", gap: 18, fontSize: 11, color: B_TOKENS.ink3, fontFamily: B_FONT_SANS }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, background: B_TOKENS.green, borderRadius: "50%" }} /> WASM ready
      </span>
      <span>Offline</span>
      <span>Fixed wing</span>
    </div>
  </div>
);

// ---------- file drop ----------

const BDropFrame = ({ stateLabel, accent, accentDim, children, dashed = true, indicator }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontFamily: B_FONT_SANS, fontSize: 10, letterSpacing: "0.16em",
      color: B_TOKENS.ink3, textTransform: "uppercase", marginBottom: 6,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 6, height: 6, background: accent, borderRadius: "50%" }} />
        State · {stateLabel}
      </span>
      <span style={{ color: B_TOKENS.dim, fontFamily: B_FONT_MONO, letterSpacing: 0 }}>{indicator}</span>
    </div>
    <div style={{
      position: "relative", overflow: "hidden",
      border: `1px ${dashed ? "dashed" : "solid"} ${accentDim || B_TOKENS.line2}`,
      background: B_TOKENS.surface,
      padding: "28px 28px",
      minHeight: 150,
    }}>
      <BMicroGrid />
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  </div>
);

const BDropEmpty = () => (
  <BDropFrame stateLabel="Empty" accent={B_TOKENS.dim} accentDim={B_TOKENS.line2}
              indicator="0 files">
    <div style={{ textAlign: "center", fontFamily: B_FONT_SANS }}>
      <div style={{
        width: 44, height: 44, borderRadius: "50%",
        border: `1px solid ${B_TOKENS.line2}`,
        margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center",
        color: B_TOKENS.blue,
      }}>
        <IconUpload size={18} />
      </div>
      <div style={{ color: B_TOKENS.ink, fontSize: 16, fontWeight: 500, marginBottom: 4, letterSpacing: "-0.005em" }}>
        Drop a flight log
      </div>
      <div style={{ color: B_TOKENS.ink3, fontSize: 12, marginBottom: 16 }}>
        .bfl, .bbl, .txt &nbsp;·&nbsp; BF ≥ 4.5 (wing support)
      </div>
      <div style={{ display: "inline-flex", gap: 8, fontSize: 12 }}>
        <button style={{
          padding: "6px 12px", borderRadius: 2,
          background: B_TOKENS.blue, color: "#06121d", border: "none",
          fontFamily: B_FONT_SANS, fontWeight: 500, cursor: "pointer",
        }}>Select file</button>
        <button style={{
          padding: "6px 12px", borderRadius: 2,
          background: "transparent", color: B_TOKENS.ink2,
          border: `1px solid ${B_TOKENS.line2}`,
          fontFamily: B_FONT_SANS, cursor: "pointer",
        }}>Sample log</button>
      </div>
    </div>
  </BDropFrame>
);

const BDropHover = () => (
  <BDropFrame stateLabel="Hover" accent={B_TOKENS.blue} accentDim={B_TOKENS.blue}
              dashed={false} indicator="1 file detected">
    <div style={{
      position: "absolute", inset: -28, pointerEvents: "none",
      background: `radial-gradient(ellipse at center, rgba(98,182,255,0.10), transparent 70%)`,
    }} />
    <div style={{ position: "absolute", inset: 6, border: `1px dashed ${B_TOKENS.blue}`, opacity: 0.6, pointerEvents: "none" }} />
    <div style={{ textAlign: "center", fontFamily: B_FONT_SANS, position: "relative" }}>
      <div style={{ color: B_TOKENS.blue, fontSize: 18, fontWeight: 600, marginBottom: 6, letterSpacing: "-0.01em" }}>
        Release to ingest
      </div>
      <div style={{ color: B_TOKENS.ink2, fontSize: 12, fontFamily: B_FONT_MONO }}>
        BTFL_BLACKBOX_LOG_…143022.bfl <span style={{ color: B_TOKENS.ink3 }}>· 47.2 MB</span>
      </div>
    </div>
  </BDropFrame>
);

const BDropParsing = () => (
  <BDropFrame stateLabel="Parsing" accent={B_TOKENS.blue} accentDim={B_TOKENS.line2}
              dashed={false} indicator="824 ms / est 1.3 s">
    <div style={{ fontFamily: B_FONT_SANS }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ color: B_TOKENS.ink, fontSize: 14, fontFamily: B_FONT_MONO }}>Skywing · 14:30:22</div>
          <div style={{ color: B_TOKENS.ink3, fontSize: 11, marginTop: 2 }}>Decoding main-frame block 348 712 / 544 800</div>
        </div>
        <div style={{ color: B_TOKENS.blue, fontSize: 18, fontFamily: B_FONT_MONO, fontWeight: 500 }}>64%</div>
      </div>
      {/* progress */}
      <div style={{
        position: "relative", height: 4, background: B_TOKENS.surface2,
        borderRadius: 1, overflow: "hidden", marginBottom: 14,
      }}>
        <div style={{
          position: "absolute", inset: "0 36% 0 0",
          background: `linear-gradient(90deg, ${B_TOKENS.blueDim}, ${B_TOKENS.blue})`,
        }} />
      </div>
      {/* checklist */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 18px", fontSize: 11,
                     fontFamily: B_FONT_MONO, color: B_TOKENS.ink2 }}>
        {[
          ["headers", "ok",            "done"],
          ["field map", "11/12",       "done"],
          ["main frames", "348 712",   "running"],
          ["event index", "—",         "pending"],
        ].map(([k, v, s]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: s === "done" ? B_TOKENS.green : s === "running" ? B_TOKENS.blue : "transparent",
                border: s === "pending" ? `1px solid ${B_TOKENS.line2}` : "none",
              }} />
              {k}
            </span>
            <span style={{ color: s === "pending" ? B_TOKENS.dim : B_TOKENS.ink3 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  </BDropFrame>
);

const BDropError = () => (
  <BDropFrame stateLabel="Error" accent={B_TOKENS.red} accentDim={B_TOKENS.red}
              dashed={false} indicator="aborted">
    <div style={{ fontFamily: B_FONT_SANS }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
        <span style={{ flexShrink: 0, marginTop: 2, color: B_TOKENS.red }}><IconWarn size={14} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ color: B_TOKENS.ink, fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Unsupported firmware version
          </div>
          <div style={{ color: B_TOKENS.ink2, fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ fontFamily: B_FONT_MONO, color: B_TOKENS.ink3 }}>Skywing · 12-May 09:22</span> declares <span style={{ fontFamily: B_FONT_MONO, color: B_TOKENS.amber }}>BF&nbsp;4.4.3</span>. WingTune requires <span style={{ fontFamily: B_FONT_MONO, color: B_TOKENS.green }}>≥&nbsp;4.5</span> for wing capability fields.
          </div>
          <div style={{ color: B_TOKENS.dim, fontSize: 11, marginTop: 6, fontFamily: B_FONT_MONO }}>
            err.code = E_UNSUPPORTED_FIRMWARE
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
        {[
          ["Dismiss", false],
          ["Open without wing tune", false],
          ["Copy error", false],
        ].map(([t, primary]) => (
          <button key={t} style={{
            padding: "5px 11px", borderRadius: 2,
            background: primary ? B_TOKENS.blue : "transparent",
            color: primary ? "#06121d" : B_TOKENS.ink2,
            border: `1px solid ${primary ? B_TOKENS.blue : B_TOKENS.line2}`,
            fontFamily: B_FONT_SANS, cursor: "pointer",
          }}>{t}</button>
        ))}
      </div>
    </div>
  </BDropFrame>
);

const BDropQueue = () => (
  <div style={{ marginTop: 6, padding: "14px 18px", background: B_TOKENS.surface,
                 border: `1px solid ${B_TOKENS.line}` }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <BLabel mb={0}>Queue · 3 files</BLabel>
      <span style={{ fontFamily: B_FONT_SANS, fontSize: 11, color: B_TOKENS.ink3 }}>
        <span style={{ color: B_TOKENS.blue, marginRight: 12, cursor: "pointer" }}>+ Add</span>
        <span style={{ cursor: "pointer" }}>Clear</span>
      </span>
    </div>
    <div style={{
      display: "grid", gridTemplateColumns: "16px 1fr 60px 110px 80px",
      gap: 12, fontSize: 10, color: B_TOKENS.dim,
      letterSpacing: "0.14em", textTransform: "uppercase",
      paddingBottom: 6, borderBottom: `1px solid ${B_TOKENS.line}`,
      fontFamily: B_FONT_SANS,
    }}>
      <span></span><span>File</span><span>Len</span><span>FW</span><span style={{ textAlign: "right" }}>State</span>
    </div>
    {WT_QUEUE.map((q, i) => {
      const isActive = q.state === "active";
      return (
        <div key={q.id} style={{
          display: "grid", gridTemplateColumns: "16px 1fr 60px 110px 80px",
          gap: 12, padding: "10px 0",
          borderBottom: i < WT_QUEUE.length - 1 ? `1px solid ${B_TOKENS.line}` : "none",
          alignItems: "center", fontSize: 12,
        }}>
          <span style={{ color: isActive ? B_TOKENS.blue : B_TOKENS.dim }}>
            {isActive ? <IconChevron size={9} /> : <span style={{ width: 4, height: 4, background: B_TOKENS.dim, borderRadius: "50%", display: "inline-block" }} />}
          </span>
          <span style={{
            color: isActive ? B_TOKENS.ink : B_TOKENS.ink2,
            fontFamily: B_FONT_MONO, fontSize: 12,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{q.short}</span>
          <span style={{ color: B_TOKENS.ink3, fontFamily: B_FONT_MONO }}>{q.duration}</span>
          <span style={{ color: B_TOKENS.ink3, fontFamily: B_FONT_MONO, fontSize: 11 }}>{q.fw}</span>
          <span style={{ textAlign: "right" }}>
            <span style={{
              fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
              fontFamily: B_FONT_SANS,
              color: isActive ? B_TOKENS.green : B_TOKENS.ink3,
            }}>{isActive ? "Active" : "Queued"}</span>
          </span>
        </div>
      );
    })}
  </div>
);

const BDirectionDrop = () => (
  <div style={{ background: B_TOKENS.bg, color: B_TOKENS.ink, padding: 22 }}>
    <BHeader />
    <BDropEmpty />
    <BDropHover />
    <BDropParsing />
    <BDropError />
    <BDropQueue />
  </div>
);

// ---------- capability summary ----------

const BCapCard = ({ cap, children }) => (
  <div style={{
    background: B_TOKENS.surface, border: `1px solid ${B_TOKENS.line}`,
    padding: "14px 16px", fontFamily: B_FONT_SANS,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
      <BLabel mb={0}>{cap.label}</BLabel>
      <BPill level={cap.confidence} />
    </div>
    <div style={{ color: B_TOKENS.ink, fontSize: 19, fontWeight: 500, letterSpacing: "-0.01em",
                   marginBottom: 4 }}>{cap.value}</div>
    <div style={{ color: B_TOKENS.ink3, fontSize: 11.5, fontFamily: B_FONT_MONO, marginBottom: children ? 12 : 0 }}>{cap.sub}</div>
    {children}
  </div>
);

const BKVGrid = ({ rows }) => (
  <div style={{
    display: "grid", gridTemplateColumns: "1fr 1fr",
    gap: "4px 16px", fontFamily: B_FONT_MONO, fontSize: 11.5,
    paddingTop: 10, borderTop: `1px solid ${B_TOKENS.line}`,
  }}>
    {rows.map(([k, v]) => (
      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
        <span style={{ color: B_TOKENS.ink3 }}>{k}</span>
        <span style={{ color: B_TOKENS.ink }}>{v}</span>
      </div>
    ))}
  </div>
);

const BPIDStrip = () => (
  <div style={{
    display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1,
    background: B_TOKENS.line, border: `1px solid ${B_TOKENS.line}`,
    marginTop: 8,
  }}>
    {WT_CAPS.controller.detail.map(([k, v]) => (
      <div key={k} style={{
        background: B_TOKENS.surface2, padding: "8px 4px", textAlign: "center",
      }}>
        <div style={{ fontFamily: B_FONT_SANS, color: B_TOKENS.ink3, fontSize: 10, letterSpacing: "0.16em",
                       textTransform: "uppercase", marginBottom: 4 }}>{k}</div>
        <div style={{ fontFamily: B_FONT_MONO, color: k === "S" ? B_TOKENS.amber : B_TOKENS.blue,
                       fontSize: 16, fontWeight: 500 }}>{v}</div>
      </div>
    ))}
  </div>
);

const BFieldTable = () => (
  <div style={{
    background: B_TOKENS.surface, border: `1px solid ${B_TOKENS.line}`,
    fontFamily: B_FONT_SANS, padding: "14px 16px",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <BLabel mb={0}>Main-frame fields · 12</BLabel>
      <span style={{ color: B_TOKENS.ink3, fontSize: 11, fontFamily: B_FONT_MONO }}>
        <span style={{ color: B_TOKENS.green }}>10</span> present · <span style={{ color: B_TOKENS.dim }}>2</span> missing
      </span>
    </div>
    <div style={{
      display: "grid", gridTemplateColumns: "18px 1.4fr 32px 48px 1fr",
      gap: 12, fontSize: 10, color: B_TOKENS.dim,
      letterSpacing: "0.14em", textTransform: "uppercase",
      paddingBottom: 6, borderBottom: `1px solid ${B_TOKENS.line}`,
    }}>
      <span></span><span>Field</span><span style={{ textAlign: "right" }}>N</span><span>Type</span><span>Note</span>
    </div>
    {WT_FIELDS.map((f, i) => (
      <div key={f.name} style={{
        display: "grid", gridTemplateColumns: "18px 1.4fr 32px 48px 1fr",
        gap: 12, padding: "6px 0",
        borderBottom: i < WT_FIELDS.length - 1 ? `1px solid ${B_TOKENS.line}` : "none",
        alignItems: "center", fontSize: 12,
        opacity: f.present ? 1 : 0.4,
      }}>
        <span style={{ color: f.present ? B_TOKENS.green : B_TOKENS.dim }}>
          {f.present ? <IconCheck size={11} /> : <span style={{ width: 6, height: 1, background: B_TOKENS.dim, display: "inline-block" }} />}
        </span>
        <span style={{ color: B_TOKENS.ink, fontFamily: B_FONT_MONO, fontSize: 12 }}>{f.name}</span>
        <span style={{ textAlign: "right", color: B_TOKENS.ink2, fontFamily: B_FONT_MONO }}>{f.count}</span>
        <span style={{ color: B_TOKENS.ink3, fontFamily: B_FONT_MONO }}>{f.dtype}</span>
        <span style={{ color: B_TOKENS.ink3, fontSize: 11.5,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.note}</span>
      </div>
    ))}
  </div>
);

const BDirectionCaps = () => (
  <div style={{ background: B_TOKENS.bg, color: B_TOKENS.ink, padding: 22 }}>
    <BHeader />

    {/* file strip */}
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 14px", border: `1px solid ${B_TOKENS.line2}`,
      borderLeft: `2px solid ${B_TOKENS.blue}`,
      background: B_TOKENS.surface, marginBottom: 18,
    }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", fontFamily: B_FONT_SANS }}>
        <IconFile size={14} />
        <span style={{ color: B_TOKENS.ink, fontFamily: B_FONT_MONO, fontSize: 13 }}>Skywing · 14:30:22</span>
        <span style={{ color: B_TOKENS.ink3, fontSize: 11.5, fontFamily: B_FONT_MONO }}>4:32 · 47.2 MB · parse 824 ms</span>
      </div>
      <span style={{ color: B_TOKENS.ink3, fontSize: 11, fontFamily: B_FONT_SANS }}>
        <span style={{ marginRight: 14, cursor: "pointer" }}>Swap</span>
        <span style={{ cursor: "pointer" }}><IconX size={11} /></span>
      </span>
    </div>

    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
      <BLabel mb={0}>Capability scan</BLabel>
      <span style={{ color: B_TOKENS.dim, fontSize: 10.5, fontFamily: B_FONT_MONO, letterSpacing: "0.04em" }}>
        6 capabilities · scanned in 12 ms
      </span>
    </div>

    {/* 2-col grid of cards */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
      <BCapCard cap={WT_CAPS.controller}>
        <BPIDStrip />
      </BCapCard>
      <BCapCard cap={WT_CAPS.tpa}>
        <BKVGrid rows={WT_CAPS.tpa.detail} />
      </BCapCard>
    </div>

    {/* SPA — full width because of the warning note */}
    <div style={{ marginBottom: 10 }}>
      <BCapCard cap={WT_CAPS.spa}>
        <BKVGrid rows={WT_CAPS.spa.detail} />
        <div style={{
          marginTop: 12, padding: "8px 12px",
          background: "rgba(245,179,90,0.06)",
          borderLeft: `2px solid ${B_TOKENS.amber}`,
          color: B_TOKENS.ink2, fontSize: 11.5, lineHeight: 1.5,
          fontFamily: B_FONT_SANS,
        }}>
          <span style={{ color: B_TOKENS.amber, fontWeight: 500, marginRight: 8 }}>Note</span>
          {WT_CAPS.spa.note}
        </div>
      </BCapCard>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
      <BCapCard cap={WT_CAPS.debug}>
        <div style={{ paddingTop: 10, borderTop: `1px solid ${B_TOKENS.line}` }}>
          <div style={{ color: B_TOKENS.ink3, fontSize: 10.5, letterSpacing: "0.14em",
                         textTransform: "uppercase", marginBottom: 6, fontFamily: B_FONT_SANS }}>
            Unlocks
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WT_CAPS.debug.unlocks.map(u => (
              <span key={u} style={{
                fontFamily: B_FONT_MONO, fontSize: 11,
                padding: "3px 8px",
                background: B_TOKENS.surface2,
                color: B_TOKENS.blue,
                border: `1px solid ${B_TOKENS.line2}`,
                borderRadius: 2,
              }}>{u}</span>
            ))}
          </div>
        </div>
      </BCapCard>
      <BCapCard cap={WT_CAPS.log}>
        <BKVGrid rows={WT_CAPS.log.detail} />
      </BCapCard>
    </div>

    <BFieldTable />
  </div>
);

Object.assign(window, { BDirectionDrop, BDirectionCaps, B_TOKENS });
