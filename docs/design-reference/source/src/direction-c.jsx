// Direction C — "Hangar Logbook"
// Warm dark, ICAO/aviation data-block, brass accents, rubber-stamp confidence.
// Slab heading + mono data. Serious but slightly hand-stamped.

const C_TOKENS = {
  bg:       "#1a1611",
  surface:  "#221d16",
  surface2: "#2a241c",
  paper:    "#2f2820",
  line:     "#3a3024",
  line2:    "#50412f",
  rule:     "#705a3e",
  ink:      "#e9dcc7",
  ink2:     "#bda88a",
  ink3:     "#8c7c66",
  dim:      "#5d503e",
  brass:    "#c9a262",
  brassDim: "#8d6f3f",
  stamp:    "#c3503b",
  ok:       "#7fa86a",
  amber:    "#d99f54",
};

const C_FONT_SLAB = "'IBM Plex Serif', Georgia, serif";
const C_FONT_SANS = "'Inter', system-ui, sans-serif";
const C_FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";

// ---------- atoms ----------

// Rubber-stamp style confidence indicator
const CStamp = ({ level }) => {
  const map = {
    high:   { fg: C_TOKENS.ok,    label: "VERIFIED", rot: -2 },
    medium: { fg: C_TOKENS.amber, label: "REVIEW",   rot:  1.5 },
    low:    { fg: C_TOKENS.stamp, label: "FLAGGED",  rot: -1 },
  };
  const c = map[level];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px",
      border: `1.5px solid ${c.fg}`,
      color: c.fg,
      fontFamily: C_FONT_SANS, fontSize: 10, fontWeight: 700,
      letterSpacing: "0.22em",
      transform: `rotate(${c.rot}deg)`,
      background: "rgba(0,0,0,0.15)",
      // double-frame stamp look
      boxShadow: `inset 0 0 0 1px ${C_TOKENS.bg}, inset 0 0 0 2px ${c.fg}`,
    }}>{c.label}</span>
  );
};

// Aviation-form field block: small uppercase label, big mono value, optional sub.
const CField = ({ label, value, sub, accent, mono = true }) => (
  <div style={{ padding: "6px 10px", borderLeft: `1px solid ${C_TOKENS.line2}`, flex: 1, minWidth: 0 }}>
    <div style={{
      color: C_TOKENS.ink3, fontFamily: C_FONT_SANS,
      fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4,
    }}>{label}</div>
    <div style={{
      color: accent || C_TOKENS.ink, fontFamily: mono ? C_FONT_MONO : C_FONT_SLAB,
      fontSize: 15, fontWeight: 500, lineHeight: 1.1,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>{value}</div>
    {sub && <div style={{ color: C_TOKENS.ink3, fontSize: 10.5, fontFamily: C_FONT_MONO, marginTop: 3 }}>{sub}</div>}
  </div>
);

// Heavy bracketed section divider — "═══ TITLE ═══"
const CDivider = ({ title, right, mt = 20, mb = 12 }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12, marginTop: mt, marginBottom: mb,
  }}>
    <div style={{ flexShrink: 0,
                   fontFamily: C_FONT_SANS, fontSize: 10, letterSpacing: "0.32em",
                   color: C_TOKENS.brass, fontWeight: 600 }}>{title}</div>
    <div style={{ flex: 1, borderTop: `1px solid ${C_TOKENS.line2}`, borderBottom: `1px solid ${C_TOKENS.line2}`, height: 4 }} />
    {right && <div style={{ flexShrink: 0 }}>{right}</div>}
  </div>
);

// ---------- header ----------

const CHeader = () => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "flex-end",
    paddingBottom: 12,
    borderBottom: `2px solid ${C_TOKENS.line2}`, position: "relative",
  }}>
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ color: C_TOKENS.ink, fontFamily: C_FONT_SLAB, fontSize: 22,
                        fontWeight: 600, letterSpacing: "-0.005em" }}>WingTune</span>
        <span style={{ color: C_TOKENS.brass, fontFamily: C_FONT_MONO, fontSize: 11 }}>
          v0.1.0
        </span>
      </div>
      <div style={{ color: C_TOKENS.ink3, fontSize: 10, letterSpacing: "0.16em",
                     textTransform: "uppercase", fontFamily: C_FONT_SANS, marginTop: 3 }}>
        Flight-log analysis · fixed wing
      </div>
    </div>
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <div style={{ fontFamily: C_FONT_MONO, fontSize: 10, color: C_TOKENS.ink3, textAlign: "right" }}>
        <div>STN · BROWSER</div>
        <div>OPS · OFFLINE</div>
      </div>
      <div style={{
        width: 1, height: 28, background: C_TOKENS.line2,
      }} />
      <div style={{
        padding: "3px 8px",
        border: `1px solid ${C_TOKENS.ok}`, color: C_TOKENS.ok,
        fontFamily: C_FONT_SANS, fontSize: 9, fontWeight: 700, letterSpacing: "0.2em",
      }}>WASM READY</div>
    </div>
    {/* hole-punch decoration on left */}
    <div style={{ position: "absolute", left: -8, top: "50%", transform: "translateY(-50%)",
                   width: 6, height: 6, borderRadius: "50%", background: C_TOKENS.bg,
                   boxShadow: `0 16px 0 ${C_TOKENS.bg}, 0 -16px 0 ${C_TOKENS.bg}`,
                   border: `1px solid ${C_TOKENS.line}` }} />
  </div>
);

// ---------- file drop ----------

const CDropFrame = ({ stateLabel, accent, children, dashed = true, indicator }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      paddingBottom: 6, marginBottom: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 5, height: 5, background: accent, borderRadius: "50%" }} />
        <span style={{ color: C_TOKENS.ink2, fontFamily: C_FONT_SANS, fontSize: 9.5,
                        letterSpacing: "0.24em", fontWeight: 600, textTransform: "uppercase" }}>
          ENTRY · {stateLabel}
        </span>
      </div>
      <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_MONO, fontSize: 10.5 }}>{indicator}</span>
    </div>
    <div style={{
      position: "relative",
      background: C_TOKENS.surface,
      border: `1px ${dashed ? "dashed" : "solid"} ${accent}`,
      // double-line aviation form look
      boxShadow: `inset 0 0 0 4px ${C_TOKENS.surface}, inset 0 0 0 5px ${C_TOKENS.line}`,
      padding: "26px 28px",
      minHeight: 150,
    }}>
      {children}
    </div>
  </div>
);

const CDropEmpty = () => (
  <CDropFrame stateLabel="EMPTY" accent={C_TOKENS.line2} indicator="0 files">
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 56, height: 56, margin: "0 auto 14px",
        border: `1px solid ${C_TOKENS.line2}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: C_TOKENS.brass,
        position: "relative",
      }}>
        <IconUpload size={20} />
        {/* corner tabs */}
        {[[0,0],[1,0],[0,1],[1,1]].map(([x,y],i)=>(
          <span key={i} style={{
            position: "absolute",
            [x ? "right" : "left"]: -1, [y ? "bottom" : "top"]: -1,
            width: 5, height: 5, background: C_TOKENS.brass,
          }}/>
        ))}
      </div>
      <div style={{ color: C_TOKENS.ink, fontSize: 18, fontWeight: 600,
                     fontFamily: C_FONT_SLAB, marginBottom: 4 }}>
        Log a flight
      </div>
      <div style={{ color: C_TOKENS.ink3, fontSize: 12, fontFamily: C_FONT_SANS, marginBottom: 16 }}>
        Drop <span style={{ fontFamily: C_FONT_MONO, color: C_TOKENS.ink2 }}>.bfl</span> · <span style={{ fontFamily: C_FONT_MONO, color: C_TOKENS.ink2 }}>.bbl</span> · <span style={{ fontFamily: C_FONT_MONO, color: C_TOKENS.ink2 }}>.txt</span> &nbsp;·&nbsp; BF ≥ 4.5
      </div>
      <div style={{ display: "inline-flex", gap: 8 }}>
        {[["Select file", true], ["Sample log", false]].map(([t, primary]) => (
          <button key={t} style={{
            padding: "7px 14px",
            background: primary ? C_TOKENS.brass : "transparent",
            color: primary ? "#1a1611" : C_TOKENS.ink2,
            border: `1px solid ${primary ? C_TOKENS.brass : C_TOKENS.line2}`,
            fontFamily: C_FONT_SANS, fontWeight: 600, fontSize: 12,
            letterSpacing: "0.04em", cursor: "pointer",
          }}>{t}</button>
        ))}
      </div>
    </div>
  </CDropFrame>
);

const CDropHover = () => (
  <CDropFrame stateLabel="STAGED" accent={C_TOKENS.brass} dashed={false} indicator="1 file detected">
    <div style={{ textAlign: "center", position: "relative" }}>
      <div style={{
        position: "absolute", inset: -26, pointerEvents: "none",
        background: `radial-gradient(ellipse at center, rgba(201,162,98,0.10), transparent 70%)`,
      }} />
      <div style={{ position: "relative" }}>
        <div style={{ color: C_TOKENS.brass, fontFamily: C_FONT_SLAB, fontSize: 20,
                       fontWeight: 600, marginBottom: 6 }}>
          Release to log
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12,
                       padding: "6px 14px",
                       border: `1px solid ${C_TOKENS.brassDim}`, background: C_TOKENS.surface2 }}>
          <IconFile size={13} />
          <span style={{ color: C_TOKENS.ink, fontFamily: C_FONT_MONO, fontSize: 12 }}>
            BTFL_BLACKBOX_LOG_…143022.bfl
          </span>
          <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_MONO, fontSize: 11 }}>47.2 MB</span>
        </div>
      </div>
    </div>
  </CDropFrame>
);

const CDropParsing = () => (
  <CDropFrame stateLabel="DECODING" accent={C_TOKENS.brass} dashed={false} indicator="824 ms elapsed">
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ color: C_TOKENS.ink, fontFamily: C_FONT_SLAB, fontSize: 15, fontWeight: 600 }}>
            Skywing · 14:30:22
          </div>
          <div style={{ color: C_TOKENS.ink3, fontSize: 11, fontFamily: C_FONT_SANS, marginTop: 2 }}>
            Decoding main-frame block 348 712 / 544 800
          </div>
        </div>
        <div style={{ color: C_TOKENS.brass, fontFamily: C_FONT_MONO, fontSize: 22, fontWeight: 500 }}>64%</div>
      </div>
      {/* progress: two-row hatch */}
      <div style={{
        position: "relative", height: 8, background: C_TOKENS.surface2,
        border: `1px solid ${C_TOKENS.line2}`, marginBottom: 14,
      }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: "64%",
          background: `repeating-linear-gradient(135deg, ${C_TOKENS.brass} 0 4px, ${C_TOKENS.brassDim} 4px 8px)`,
        }} />
      </div>
      {/* checklist as columns of data blocks */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0,
        border: `1px solid ${C_TOKENS.line2}`,
        background: C_TOKENS.surface2,
      }}>
        {[
          ["HEADERS",     "ok",        "done"],
          ["FIELD MAP",   "11/12",     "done"],
          ["MAIN FRAMES", "348 712",   "running"],
          ["EVENTS",      "—",         "pending"],
        ].map(([k, v, s], i) => (
          <div key={k} style={{
            padding: "8px 10px",
            borderRight: i < 3 ? `1px solid ${C_TOKENS.line2}` : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{
                width: 6, height: 6,
                background: s === "done" ? C_TOKENS.ok : s === "running" ? C_TOKENS.brass : "transparent",
                border: s === "pending" ? `1px solid ${C_TOKENS.dim}` : "none",
              }} />
              <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_SANS, fontSize: 9,
                              letterSpacing: "0.18em", fontWeight: 600 }}>{k}</span>
            </div>
            <div style={{ color: s === "pending" ? C_TOKENS.dim : C_TOKENS.ink,
                           fontFamily: C_FONT_MONO, fontSize: 12 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  </CDropFrame>
);

const CDropError = () => (
  <CDropFrame stateLabel="REJECTED" accent={C_TOKENS.stamp} dashed={false} indicator="aborted">
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                     gap: 16, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: C_TOKENS.stamp, fontFamily: C_FONT_SLAB, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            Unsupported firmware
          </div>
          <div style={{ color: C_TOKENS.ink2, fontSize: 12, lineHeight: 1.55, fontFamily: C_FONT_SANS }}>
            <span style={{ fontFamily: C_FONT_MONO, color: C_TOKENS.ink3 }}>Skywing · 12-May 09:22</span> declares <span style={{ fontFamily: C_FONT_MONO, color: C_TOKENS.amber }}>BF&nbsp;4.4.3</span>. WingTune requires <span style={{ fontFamily: C_FONT_MONO, color: C_TOKENS.ok }}>≥&nbsp;4.5</span> for wing capability fields.
          </div>
          <div style={{ color: C_TOKENS.ink3, fontSize: 10.5, marginTop: 8, fontFamily: C_FONT_MONO }}>
            E_UNSUPPORTED_FIRMWARE
          </div>
        </div>
        <div style={{ flexShrink: 0, marginTop: 4 }}>
          <span style={{
            display: "inline-block", padding: "3px 10px",
            border: `1.5px solid ${C_TOKENS.stamp}`,
            boxShadow: `inset 0 0 0 1px ${C_TOKENS.bg}, inset 0 0 0 2px ${C_TOKENS.stamp}`,
            color: C_TOKENS.stamp, fontFamily: C_FONT_SANS, fontWeight: 700, fontSize: 10,
            letterSpacing: "0.24em",
            transform: "rotate(-4deg)",
          }}>REJECTED</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {["Dismiss", "Open without wing tune", "Copy error"].map((t, i) => (
          <button key={t} style={{
            padding: "5px 12px",
            background: "transparent", color: C_TOKENS.ink2,
            border: `1px solid ${C_TOKENS.line2}`,
            fontFamily: C_FONT_SANS, fontSize: 11, cursor: "pointer",
          }}>{t}</button>
        ))}
      </div>
    </div>
  </CDropFrame>
);

const CDropQueue = () => (
  <div style={{ marginTop: 6 }}>
    <CDivider title="MANIFEST · 3 ENTRIES"
              right={
                <span style={{ fontFamily: C_FONT_SANS, fontSize: 11, color: C_TOKENS.ink3 }}>
                  <span style={{ color: C_TOKENS.brass, marginRight: 14, cursor: "pointer", fontWeight: 600 }}>+ Add</span>
                  <span style={{ cursor: "pointer" }}>Clear</span>
                </span>
              }
              mt={0} mb={8} />
    <div style={{
      background: C_TOKENS.surface, border: `1px solid ${C_TOKENS.line2}`,
      borderTop: `2px solid ${C_TOKENS.line2}`,
    }}>
      <div style={{
        display: "grid", gridTemplateColumns: "32px 1fr 60px 110px 90px",
        gap: 12, padding: "8px 14px",
        fontSize: 9.5, color: C_TOKENS.ink3, letterSpacing: "0.2em",
        fontWeight: 600, fontFamily: C_FONT_SANS, textTransform: "uppercase",
        borderBottom: `1px solid ${C_TOKENS.line2}`,
      }}>
        <span>NO.</span><span>ENTRY</span><span>HRS</span><span>FIRMWARE</span><span style={{ textAlign: "right" }}>STATUS</span>
      </div>
      {WT_QUEUE.map((q, i) => {
        const isActive = q.state === "active";
        return (
          <div key={q.id} style={{
            display: "grid", gridTemplateColumns: "32px 1fr 60px 110px 90px",
            gap: 12, padding: "10px 14px",
            borderBottom: i < WT_QUEUE.length - 1 ? `1px solid ${C_TOKENS.line}` : "none",
            alignItems: "center",
            background: isActive ? "rgba(201,162,98,0.05)" : "transparent",
          }}>
            <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_MONO, fontSize: 11 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{
              color: isActive ? C_TOKENS.ink : C_TOKENS.ink2,
              fontFamily: C_FONT_MONO, fontSize: 12,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{q.short}</span>
            <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_MONO, fontSize: 12 }}>{q.duration}</span>
            <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_MONO, fontSize: 11 }}>{q.fw}</span>
            <span style={{ textAlign: "right" }}>
              <span style={{
                display: "inline-block", padding: "2px 7px",
                fontFamily: C_FONT_SANS, fontSize: 9, fontWeight: 700, letterSpacing: "0.18em",
                color: isActive ? C_TOKENS.ok : C_TOKENS.ink3,
                border: `1px solid ${isActive ? C_TOKENS.ok : C_TOKENS.line2}`,
              }}>{isActive ? "ACTIVE" : "QUEUED"}</span>
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

const CDirectionDrop = () => (
  <div style={{ background: C_TOKENS.bg, color: C_TOKENS.ink, padding: 22 }}>
    <CHeader />
    <div style={{ height: 18 }} />
    <CDropEmpty />
    <CDropHover />
    <CDropParsing />
    <CDropError />
    <CDropQueue />
  </div>
);

// ---------- capability summary ----------

const CCapCard = ({ cap, children }) => (
  <div style={{
    background: C_TOKENS.surface, border: `1px solid ${C_TOKENS.line2}`,
    padding: "14px 16px",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
      <div>
        <div style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_SANS, fontSize: 9.5,
                       letterSpacing: "0.24em", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
          {cap.label}
        </div>
        <div style={{ color: C_TOKENS.ink, fontFamily: C_FONT_SLAB, fontSize: 20, fontWeight: 600,
                       letterSpacing: "-0.005em", lineHeight: 1.1 }}>
          {cap.value}
        </div>
        <div style={{ color: C_TOKENS.ink3, fontSize: 11, fontFamily: C_FONT_MONO, marginTop: 4 }}>{cap.sub}</div>
      </div>
      <CStamp level={cap.confidence} />
    </div>
    {children}
  </div>
);

const CKVStrip = ({ rows }) => (
  <div style={{
    display: "flex", marginTop: 10, paddingTop: 10,
    borderTop: `1px solid ${C_TOKENS.line2}`,
    marginLeft: -10, marginRight: -10, paddingBottom: 0,
  }}>
    {rows.map(([k, v], i) => (
      <div key={k} style={{
        flex: 1, padding: "2px 12px",
        borderLeft: i === 0 ? "none" : `1px solid ${C_TOKENS.line}`,
      }}>
        <div style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_SANS, fontSize: 9,
                       letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 3 }}>{k}</div>
        <div style={{ color: C_TOKENS.ink, fontFamily: C_FONT_MONO, fontSize: 13 }}>{v}</div>
      </div>
    ))}
  </div>
);

const CPIDStrip = () => (
  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C_TOKENS.line2}` }}>
    <div style={{ display: "flex", gap: 1, background: C_TOKENS.line2, border: `1px solid ${C_TOKENS.line2}` }}>
      {WT_CAPS.controller.detail.map(([k, v]) => (
        <div key={k} style={{
          flex: 1, padding: "10px 6px", textAlign: "center",
          background: k === "S" ? "rgba(201,162,98,0.08)" : C_TOKENS.surface2,
        }}>
          <div style={{ color: k === "S" ? C_TOKENS.brass : C_TOKENS.ink3,
                         fontFamily: C_FONT_SANS, fontSize: 9, letterSpacing: "0.22em",
                         fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{k}</div>
          <div style={{ color: k === "S" ? C_TOKENS.brass : C_TOKENS.ink,
                         fontFamily: C_FONT_MONO, fontSize: 17, fontWeight: 500 }}>{v}</div>
        </div>
      ))}
    </div>
  </div>
);

const CFieldTable = () => (
  <div>
    <CDivider title="MAIN-FRAME FIELDS · 12"
              right={
                <span style={{ fontFamily: C_FONT_MONO, fontSize: 11, color: C_TOKENS.ink3 }}>
                  <span style={{ color: C_TOKENS.ok }}>10</span> present · <span style={{ color: C_TOKENS.dim }}>2</span> missing
                </span>
              }
              mt={20} mb={10} />
    <div style={{ background: C_TOKENS.surface, border: `1px solid ${C_TOKENS.line2}` }}>
      <div style={{
        display: "grid", gridTemplateColumns: "18px 1.4fr 32px 48px 1fr",
        gap: 12, padding: "8px 14px",
        fontSize: 9.5, color: C_TOKENS.ink3, letterSpacing: "0.2em",
        fontWeight: 600, fontFamily: C_FONT_SANS, textTransform: "uppercase",
        borderBottom: `1px solid ${C_TOKENS.line2}`,
      }}>
        <span></span><span>Field</span><span style={{ textAlign: "right" }}>N</span><span>Type</span><span>Note</span>
      </div>
      {WT_FIELDS.map((f, i) => (
        <div key={f.name} style={{
          display: "grid", gridTemplateColumns: "18px 1.4fr 32px 48px 1fr",
          gap: 12, padding: "7px 14px",
          borderBottom: i < WT_FIELDS.length - 1 ? `1px solid ${C_TOKENS.line}` : "none",
          alignItems: "center", fontSize: 12,
          opacity: f.present ? 1 : 0.4,
        }}>
          <span style={{ color: f.present ? C_TOKENS.ok : C_TOKENS.dim,
                          display: "flex", alignItems: "center" }}>
            {f.present ? <IconCheck size={11} /> : <span style={{ width: 6, height: 1, background: C_TOKENS.dim, display: "inline-block" }} />}
          </span>
          <span style={{ color: C_TOKENS.ink, fontFamily: C_FONT_MONO, fontSize: 12 }}>{f.name}</span>
          <span style={{ textAlign: "right", color: C_TOKENS.ink2, fontFamily: C_FONT_MONO }}>{f.count}</span>
          <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_MONO }}>{f.dtype}</span>
          <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_SANS, fontSize: 11.5,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.note}</span>
        </div>
      ))}
    </div>
  </div>
);

const CDirectionCaps = () => (
  <div style={{ background: C_TOKENS.bg, color: C_TOKENS.ink, padding: 22 }}>
    <CHeader />

    {/* aviation-form top strip — REG/TYPE/HRS/FW data block */}
    <div style={{
      display: "flex",
      background: C_TOKENS.surface,
      border: `1px solid ${C_TOKENS.line2}`,
      borderTop: `2px solid ${C_TOKENS.brass}`,
      marginTop: 18, marginBottom: 0,
    }}>
      <CField label="ENTRY"     value="Skywing · 14:30:22" mono={false} accent={C_TOKENS.ink} />
      <CField label="HRS"       value="0:04:32" sub="2 kHz · 0.02% drop" />
      <CField label="FIRMWARE"  value="BF 2026.6.0-α" sub="STM32F411 · f3a91c2" />
      <CField label="SIZE"      value="47.2 MB" sub="parse 824 ms" />
      <div style={{ display: "flex", alignItems: "center", padding: "6px 14px",
                     borderLeft: `1px solid ${C_TOKENS.line2}` }}>
        <span style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_SANS, fontSize: 10.5, marginRight: 10, cursor: "pointer" }}>Swap</span>
        <IconX size={11} />
      </div>
    </div>

    <CDivider title="WING CAPABILITY · 6 ITEMS"
              right={<span style={{ fontFamily: C_FONT_MONO, fontSize: 10.5, color: C_TOKENS.ink3 }}>scanned in 12 ms</span>} />

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
      <CCapCard cap={WT_CAPS.controller}>
        <CPIDStrip />
      </CCapCard>
      <CCapCard cap={WT_CAPS.tpa}>
        <CKVStrip rows={WT_CAPS.tpa.detail} />
      </CCapCard>
    </div>

    <div style={{ marginBottom: 10 }}>
      <CCapCard cap={WT_CAPS.spa}>
        <CKVStrip rows={WT_CAPS.spa.detail} />
        <div style={{
          marginTop: 12, padding: "10px 14px 10px 16px",
          background: "rgba(217,159,84,0.06)",
          borderLeft: `3px solid ${C_TOKENS.amber}`,
          fontFamily: C_FONT_SANS, fontSize: 12, lineHeight: 1.5,
          color: C_TOKENS.ink2,
        }}>
          <div style={{ color: C_TOKENS.amber, fontWeight: 700, fontSize: 9.5,
                         letterSpacing: "0.24em", marginBottom: 4 }}>FIELD NOTE</div>
          {WT_CAPS.spa.note}
        </div>
      </CCapCard>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
      <CCapCard cap={WT_CAPS.debug}>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C_TOKENS.line2}` }}>
          <div style={{ color: C_TOKENS.ink3, fontFamily: C_FONT_SANS, fontSize: 9,
                         letterSpacing: "0.22em", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
            UNLOCKED FIELDS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WT_CAPS.debug.unlocks.map(u => (
              <span key={u} style={{
                fontFamily: C_FONT_MONO, fontSize: 11,
                padding: "3px 9px",
                background: C_TOKENS.surface2,
                color: C_TOKENS.brass,
                border: `1px solid ${C_TOKENS.brassDim}`,
              }}>{u}</span>
            ))}
          </div>
        </div>
      </CCapCard>
      <CCapCard cap={WT_CAPS.firmware}>
        <CKVStrip rows={[
          ["channel", "alpha"],
          ["target",  "STM32F411"],
          ["rev",     "f3a91c2"],
          ["wing", "yes"],
        ]} />
      </CCapCard>
    </div>

    <CFieldTable />
  </div>
);

Object.assign(window, { CDirectionDrop, CDirectionCaps, C_TOKENS });
