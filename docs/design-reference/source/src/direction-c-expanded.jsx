// Direction C — Expanded.
// Four palette studies + one enriched-density variant.
// Same slab + data-block + stamp DNA from the original C; palette is now
// a parameter, and the enriched variant adds sparklines, phase tags,
// data-source attribution, and a session-signature footer.

// ---------- palettes ----------

const PAL_BRASS = {
  name: "Brass on Walnut",
  bg: "#1a1611", surface: "#221d16", surface2: "#2a241c",
  line: "#3a3024", line2: "#50412f",
  ink: "#e9dcc7", ink2: "#bda88a", ink3: "#8c7c66", dim: "#5d503e",
  accent: "#c9a262", accentDim: "#8d6f3f",
  stamp: "#c3503b", ok: "#7fa86a", warn: "#d99f54",
  serifTint: "#e9dcc7",
};

const PAL_GRAPHITE = {
  name: "Graphite & Cyan",
  bg: "#0e1216", surface: "#161b22", surface2: "#1c232c",
  line: "#262e39", line2: "#34404e",
  ink: "#e5edf5", ink2: "#a4b3c4", ink3: "#7384960", dim: "#4d5a6c",
  // typo above — fix:
  ink3_: "#738496",
  accent: "#5ad1c8", accentDim: "#2f8f88",
  stamp: "#ff7a6b", ok: "#7fd394", warn: "#f5b454",
  serifTint: "#e5edf5",
};
PAL_GRAPHITE.ink3 = "#738496"; PAL_GRAPHITE.dim = "#4d5a6c";

const PAL_CARBON = {
  name: "Carbon & Sodium",
  bg: "#070707", surface: "#0f0f0f", surface2: "#161616",
  line: "#1f1f1f", line2: "#2b2b2b",
  ink: "#f4ecd8", ink2: "#c1b89e", ink3: "#827a64", dim: "#4a4538",
  accent: "#ffa744", accentDim: "#a86d28",
  stamp: "#ff6b50", ok: "#9bc46a", warn: "#ffc857",
  serifTint: "#f4ecd8",
};

const PAL_BLUEPRINT = {
  name: "Blueprint",
  bg: "#0a1729", surface: "#11223a", surface2: "#162b48",
  line: "#1f3a5a", line2: "#2b4d72",
  ink: "#eaf2ff", ink2: "#b6c7e0", ink3: "#7a90b0", dim: "#4a5e7e",
  accent: "#7ec8ff", accentDim: "#4880ad",
  stamp: "#ff8a7a", ok: "#6ed3a0", warn: "#ffc46a",
  serifTint: "#eaf2ff",
};

const PAL_FOREST = {
  name: "Forest & Phosphor",
  bg: "#0a120e", surface: "#101a14", surface2: "#15221b",
  line: "#1c2d23", line2: "#2a4434",
  ink: "#e6f0e3", ink2: "#a9c3a7", ink3: "#728874", dim: "#4a5b4e",
  accent: "#92e6a3", accentDim: "#4f9663",
  stamp: "#ff8870", ok: "#92e6a3", warn: "#e6c46a",
  serifTint: "#e6f0e3",
};

const CX_FONT_SLAB = "'IBM Plex Serif', Georgia, serif";
const CX_FONT_SANS = "'Inter', system-ui, sans-serif";
const CX_FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";

// ---------- atoms (palette-parameterized) ----------

const CXStamp = ({ level, P }) => {
  const map = {
    high:   { fg: P.ok,    label: "VERIFIED", rot: -2 },
    medium: { fg: P.warn,  label: "REVIEW",   rot:  1.5 },
    low:    { fg: P.stamp, label: "FLAGGED",  rot: -1 },
  };
  const c = map[level];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px",
      border: `1.5px solid ${c.fg}`,
      color: c.fg,
      fontFamily: CX_FONT_SANS, fontSize: 10, fontWeight: 700,
      letterSpacing: "0.22em",
      transform: `rotate(${c.rot}deg)`,
      background: "rgba(0,0,0,0.18)",
      boxShadow: `inset 0 0 0 1px ${P.bg}, inset 0 0 0 2px ${c.fg}`,
    }}>{c.label}</span>
  );
};

const CXLabel = ({ children, P, mb = 6 }) => (
  <div style={{
    color: P.ink3, fontFamily: CX_FONT_SANS, fontSize: 9.5,
    letterSpacing: "0.24em", fontWeight: 700, textTransform: "uppercase",
    marginBottom: mb,
  }}>{children}</div>
);

const CXDivider = ({ title, right, P, mt = 18, mb = 12 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: mt, marginBottom: mb }}>
    <div style={{ flexShrink: 0, fontFamily: CX_FONT_SANS, fontSize: 10,
                   letterSpacing: "0.32em", color: P.accent, fontWeight: 600 }}>{title}</div>
    <div style={{ flex: 1, borderTop: `1px solid ${P.line2}`, borderBottom: `1px solid ${P.line2}`, height: 4 }} />
    {right && <div style={{ flexShrink: 0 }}>{right}</div>}
  </div>
);

// ICAO data-block field
const CXField = ({ label, value, sub, P, accent, mono = true, narrow = false }) => (
  <div style={{
    padding: narrow ? "6px 10px" : "8px 12px",
    borderLeft: `1px solid ${P.line2}`, flex: 1, minWidth: 0,
  }}>
    <div style={{
      color: P.ink3, fontFamily: CX_FONT_SANS,
      fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700,
      marginBottom: 4,
    }}>{label}</div>
    <div style={{
      color: accent || P.ink, fontFamily: mono ? CX_FONT_MONO : CX_FONT_SLAB,
      fontSize: 15, fontWeight: 500, lineHeight: 1.1,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>{value}</div>
    {sub && <div style={{ color: P.ink3, fontSize: 10.5, fontFamily: CX_FONT_MONO, marginTop: 3 }}>{sub}</div>}
  </div>
);

// Top "flight strip"
const CXFlightStrip = ({ P, withDate = false }) => (
  <div style={{
    display: "flex",
    background: P.surface,
    border: `1px solid ${P.line2}`,
    borderTop: `2px solid ${P.accent}`,
  }}>
    <CXField P={P} label="ENTRY" value="Skywing · 14:30:22" mono={false} accent={P.ink} />
    <CXField P={P} label="HRS" value="0:04:32" sub="2 kHz · 0.02% drop" />
    <CXField P={P} label="FIRMWARE" value="BF 2026.6.0-α" sub="STM32F411 · f3a91c2" />
    <CXField P={P} label="SIZE" value="47.2 MB" sub="parse 824 ms" />
    {withDate && <CXField P={P} label="DATE" value="14-MAY-26" sub="local · KSEA" />}
    <div style={{
      display: "flex", alignItems: "center", padding: "0 14px",
      borderLeft: `1px solid ${P.line2}`, color: P.ink3, fontFamily: CX_FONT_SANS, fontSize: 10.5,
    }}>
      <span style={{ marginRight: 10, cursor: "pointer" }}>Swap</span>
      <IconX size={11} />
    </div>
  </div>
);

// ---------- capability cards (palette-driven) ----------

const CXCapCard = ({ cap, children, P, accentValue = false }) => (
  <div style={{
    background: P.surface, border: `1px solid ${P.line2}`,
    padding: "14px 16px",
    position: "relative",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <CXLabel P={P}>{cap.label}</CXLabel>
        <div style={{
          color: accentValue ? P.accent : P.ink, fontFamily: CX_FONT_SLAB, fontSize: 20,
          fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{cap.value}</div>
        <div style={{ color: P.ink3, fontSize: 11, fontFamily: CX_FONT_MONO, marginTop: 4 }}>{cap.sub}</div>
      </div>
      <CXStamp level={cap.confidence} P={P} />
    </div>
    {children}
  </div>
);

const CXKVStrip = ({ rows, P }) => (
  <div style={{
    display: "flex", marginTop: 10, paddingTop: 10,
    borderTop: `1px solid ${P.line2}`,
    marginLeft: -10, marginRight: -10,
  }}>
    {rows.map(([k, v], i) => (
      <div key={k} style={{
        flex: 1, padding: "2px 12px",
        borderLeft: i === 0 ? "none" : `1px solid ${P.line}`,
        minWidth: 0,
      }}>
        <div style={{ color: P.ink3, fontFamily: CX_FONT_SANS, fontSize: 9,
                       letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 3 }}>{k}</div>
        <div style={{ color: P.ink, fontFamily: CX_FONT_MONO, fontSize: 13,
                       overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
      </div>
    ))}
  </div>
);

const CXPIDStrip = ({ P }) => (
  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${P.line2}` }}>
    <div style={{ display: "flex", gap: 1, background: P.line2, border: `1px solid ${P.line2}` }}>
      {WT_CAPS.controller.detail.map(([k, v]) => (
        <div key={k} style={{
          flex: 1, padding: "10px 6px", textAlign: "center",
          background: k === "S" ? `${P.accent}14` : P.surface2,
        }}>
          <div style={{ color: k === "S" ? P.accent : P.ink3,
                         fontFamily: CX_FONT_SANS, fontSize: 9, letterSpacing: "0.22em",
                         fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{k}</div>
          <div style={{ color: k === "S" ? P.accent : P.ink,
                         fontFamily: CX_FONT_MONO, fontSize: 17, fontWeight: 500 }}>{v}</div>
        </div>
      ))}
    </div>
  </div>
);

const CXFieldTable = ({ P }) => (
  <div>
    <CXDivider title="MAIN-FRAME FIELDS · 12" P={P}
               right={
                 <span style={{ fontFamily: CX_FONT_MONO, fontSize: 11, color: P.ink3 }}>
                   <span style={{ color: P.ok }}>10</span> present · <span style={{ color: P.dim }}>2</span> missing
                 </span>
               } mt={18} mb={10} />
    <div style={{ background: P.surface, border: `1px solid ${P.line2}` }}>
      <div style={{
        display: "grid", gridTemplateColumns: "18px 1.4fr 32px 48px 1fr",
        gap: 12, padding: "8px 14px",
        fontSize: 9.5, color: P.ink3, letterSpacing: "0.2em",
        fontWeight: 700, fontFamily: CX_FONT_SANS, textTransform: "uppercase",
        borderBottom: `1px solid ${P.line2}`,
      }}>
        <span></span><span>Field</span><span style={{ textAlign: "right" }}>N</span><span>Type</span><span>Note</span>
      </div>
      {WT_FIELDS.map((f, i) => (
        <div key={f.name} style={{
          display: "grid", gridTemplateColumns: "18px 1.4fr 32px 48px 1fr",
          gap: 12, padding: "7px 14px",
          borderBottom: i < WT_FIELDS.length - 1 ? `1px solid ${P.line}` : "none",
          alignItems: "center", fontSize: 12,
          opacity: f.present ? 1 : 0.4,
        }}>
          <span style={{ color: f.present ? P.ok : P.dim, display: "flex" }}>
            {f.present ? <IconCheck size={11} /> : <span style={{ width: 6, height: 1, background: P.dim, display: "inline-block" }} />}
          </span>
          <span style={{ color: P.ink, fontFamily: CX_FONT_MONO }}>{f.name}</span>
          <span style={{ textAlign: "right", color: P.ink2, fontFamily: CX_FONT_MONO }}>{f.count}</span>
          <span style={{ color: P.ink3, fontFamily: CX_FONT_MONO }}>{f.dtype}</span>
          <span style={{ color: P.ink3, fontFamily: CX_FONT_SANS, fontSize: 11.5,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.note}</span>
        </div>
      ))}
    </div>
  </div>
);

// ---------- header ----------

const CXHeader = ({ P }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "flex-end",
    paddingBottom: 12, borderBottom: `2px solid ${P.line2}`,
  }}>
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ color: P.ink, fontFamily: CX_FONT_SLAB, fontSize: 22,
                        fontWeight: 600, letterSpacing: "-0.005em" }}>WingTune</span>
        <span style={{ color: P.accent, fontFamily: CX_FONT_MONO, fontSize: 11 }}>v0.1.0</span>
      </div>
      <div style={{ color: P.ink3, fontSize: 10, letterSpacing: "0.16em",
                     textTransform: "uppercase", fontFamily: CX_FONT_SANS, marginTop: 3 }}>
        Flight-log analysis · fixed wing · <span style={{ color: P.ink2 }}>{P.name}</span>
      </div>
    </div>
    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
      <div style={{ fontFamily: CX_FONT_MONO, fontSize: 10, color: P.ink3, textAlign: "right" }}>
        <div>STN · BROWSER</div>
        <div>OPS · OFFLINE</div>
      </div>
      <div style={{ width: 1, height: 28, background: P.line2 }} />
      <div style={{
        padding: "3px 8px",
        border: `1px solid ${P.ok}`, color: P.ok,
        fontFamily: CX_FONT_SANS, fontSize: 9, fontWeight: 700, letterSpacing: "0.2em",
      }}>WASM READY</div>
    </div>
  </div>
);

// ---------- palette variant (the basic capability summary in a palette) ----------

const CXVariant = ({ P }) => (
  <div style={{ background: P.bg, color: P.ink, padding: 22, fontFamily: CX_FONT_SANS }}>
    <CXHeader P={P} />
    <div style={{ marginTop: 18 }}>
      <CXFlightStrip P={P} />
    </div>

    <CXDivider title="WING CAPABILITY · 6 ITEMS" P={P}
               right={<span style={{ fontFamily: CX_FONT_MONO, fontSize: 10.5, color: P.ink3 }}>scanned in 12 ms</span>} />

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
      <CXCapCard cap={WT_CAPS.controller} P={P}><CXPIDStrip P={P} /></CXCapCard>
      <CXCapCard cap={WT_CAPS.tpa} P={P}><CXKVStrip rows={WT_CAPS.tpa.detail} P={P} /></CXCapCard>
    </div>

    <div style={{ marginBottom: 10 }}>
      <CXCapCard cap={WT_CAPS.spa} P={P}>
        <CXKVStrip rows={WT_CAPS.spa.detail} P={P} />
        <div style={{
          marginTop: 12, padding: "10px 14px 10px 16px",
          background: `${P.warn}11`,
          borderLeft: `3px solid ${P.warn}`,
          fontFamily: CX_FONT_SANS, fontSize: 12, lineHeight: 1.5, color: P.ink2,
        }}>
          <div style={{ color: P.warn, fontWeight: 700, fontSize: 9.5,
                         letterSpacing: "0.24em", marginBottom: 4 }}>FIELD NOTE</div>
          {WT_CAPS.spa.note}
        </div>
      </CXCapCard>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 0 }}>
      <CXCapCard cap={WT_CAPS.debug} P={P}>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${P.line2}` }}>
          <CXLabel P={P}>UNLOCKED FIELDS</CXLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WT_CAPS.debug.unlocks.map(u => (
              <span key={u} style={{
                fontFamily: CX_FONT_MONO, fontSize: 11,
                padding: "3px 9px",
                background: P.surface2, color: P.accent,
                border: `1px solid ${P.accentDim}`,
              }}>{u}</span>
            ))}
          </div>
        </div>
      </CXCapCard>
      <CXCapCard cap={WT_CAPS.firmware} P={P}>
        <CXKVStrip rows={[
          ["channel", "alpha"], ["target", "STM32F411"],
          ["rev", "f3a91c2"], ["wing", "yes"],
        ]} P={P} />
      </CXCapCard>
    </div>

    <CXFieldTable P={P} />
  </div>
);

// ---------- ENRICHED density variant ----------
// Same DNA, but pushed: sparklines on caps, phase tags, session signature footer.

// Tiny inline sparkline. data: array of 0..1 floats.
const CXSpark = ({ data, P, color, height = 22, width = 110 }) => {
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - v * (height - 2) - 1}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sp-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* baseline */}
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke={P.line2} strokeWidth="0.5" />
      {/* fill under curve */}
      <polygon
        points={`0,${height} ${pts} ${width},${height}`}
        fill={`url(#sp-${color.slice(1)})`}
      />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.25" />
    </svg>
  );
};

// Synthetic but believable wing-shaped traces
const SPARK_GYRO     = [0.4, 0.42, 0.38, 0.55, 0.7, 0.5, 0.45, 0.6, 0.85, 0.7, 0.45, 0.4, 0.38, 0.42, 0.4];
const SPARK_AIRSPEED = [0.1, 0.18, 0.32, 0.5, 0.62, 0.7, 0.74, 0.72, 0.76, 0.78, 0.74, 0.72, 0.7, 0.68, 0.65];
const SPARK_SETPOINT = [0.5, 0.5, 0.5, 0.7, 0.85, 0.6, 0.5, 0.5, 0.4, 0.2, 0.4, 0.5, 0.5, 0.5, 0.5];
const SPARK_DEBUG    = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.7, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

const CXCapCardSpark = ({ cap, sparkData, sparkColor, children, P }) => (
  <div style={{ background: P.surface, border: `1px solid ${P.line2}`, padding: "14px 16px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
      <div style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
        <CXLabel P={P}>{cap.label}</CXLabel>
        <div style={{
          color: P.ink, fontFamily: CX_FONT_SLAB, fontSize: 20,
          fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{cap.value}</div>
        <div style={{ color: P.ink3, fontSize: 11, fontFamily: CX_FONT_MONO, marginTop: 4 }}>{cap.sub}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <CXStamp level={cap.confidence} P={P} />
        <CXSpark data={sparkData} P={P} color={sparkColor} />
      </div>
    </div>
    {children}
  </div>
);

// Phase tags row — believable for a wing flight
const CX_PHASES = [
  { name: "launch",  t: "0:00 → 0:12",  color: "warn" },
  { name: "climb",   t: "0:12 → 0:48",  color: "ok"   },
  { name: "cruise",  t: "0:48 → 3:34",  color: "ok"   },
  { name: "turns ×4",t: "1:10 → 3:02",  color: "ok"   },
  { name: "throw",   t: "3:34 → 3:51",  color: "accent" },
  { name: "landing", t: "4:18 → 4:32",  color: "ok"   },
];

const CXPhaseTags = ({ P }) => (
  <div>
    <CXDivider title="FLIGHT PHASES · 6 DETECTED" P={P} mt={18} mb={10}
               right={<span style={{ fontFamily: CX_FONT_MONO, fontSize: 10.5, color: P.ink3 }}>4:32 total</span>} />
    <div style={{
      background: P.surface, border: `1px solid ${P.line2}`,
      padding: "10px 14px",
    }}>
      {/* timeline strip */}
      <div style={{ position: "relative", height: 18, marginBottom: 12 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "50%",
                       height: 1, background: P.line2 }} />
        {/* phase blocks at proportional positions, 0..272s */}
        {[
          { l: 0,    w: 12,  c: P.warn,   key: "launch" },
          { l: 12,   w: 36,  c: P.ok,     key: "climb" },
          { l: 48,   w: 166, c: P.accent, key: "cruise" },
          { l: 214,  w: 17,  c: P.warn,   key: "throw" },
          { l: 258,  w: 14,  c: P.ok,     key: "land" },
        ].map(b => (
          <div key={b.key} title={b.key} style={{
            position: "absolute", top: 5, height: 8,
            left:  `${(b.l / 272) * 100}%`,
            width: `${(b.w / 272) * 100}%`,
            background: b.c, opacity: 0.7,
            borderLeft: `1px solid ${P.bg}`, borderRight: `1px solid ${P.bg}`,
          }} />
        ))}
        {/* tick marks at 0, 1, 2, 3, 4 minutes */}
        {[0, 1, 2, 3, 4].map(m => (
          <div key={m} style={{
            position: "absolute", top: 14, left: `${(m * 60 / 272) * 100}%`,
            fontFamily: CX_FONT_MONO, fontSize: 9, color: P.ink3,
            transform: "translateX(-50%)",
          }}>{m}:00</div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {CX_PHASES.map(ph => {
          const c = ph.color === "warn" ? P.warn : ph.color === "accent" ? P.accent : P.ok;
          return (
            <span key={ph.name} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "3px 9px",
              background: P.surface2,
              border: `1px solid ${P.line2}`,
              fontFamily: CX_FONT_MONO, fontSize: 11, color: P.ink2,
            }}>
              <span style={{ width: 6, height: 6, background: c, borderRadius: "50%" }} />
              {ph.name}
              <span style={{ color: P.ink3, fontSize: 10.5 }}>{ph.t}</span>
            </span>
          );
        })}
      </div>
    </div>
  </div>
);

const CXSignature = ({ P }) => (
  <div style={{
    marginTop: 18, padding: "10px 14px",
    background: P.surface, border: `1px solid ${P.line}`,
    display: "flex", justifyContent: "space-between", alignItems: "center",
    fontFamily: CX_FONT_MONO, fontSize: 10.5,
    color: P.ink3,
  }}>
    <div style={{ display: "flex", gap: 18 }}>
      <span><span style={{ color: P.ink3 }}>sig</span> <span style={{ color: P.ink2 }}>f3a91c2:b8e4</span></span>
      <span><span style={{ color: P.ink3 }}>parser</span> <span style={{ color: P.ink2 }}>blackbox-log 0.4.2-wing</span></span>
      <span><span style={{ color: P.ink3 }}>wt</span> <span style={{ color: P.ink2 }}>0.1.0-m1.3</span></span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span>signed</span>
      <span style={{
        padding: "1px 8px",
        border: `1px solid ${P.ok}`, color: P.ok,
        letterSpacing: "0.18em", fontWeight: 700, fontFamily: CX_FONT_SANS, fontSize: 9,
        transform: "rotate(-1deg)",
      }}>14-MAY · 14:34 UTC</span>
    </div>
  </div>
);

// Enriched palette variant
const CXEnriched = ({ P }) => (
  <div style={{ background: P.bg, color: P.ink, padding: 22, fontFamily: CX_FONT_SANS }}>
    <CXHeader P={P} />
    <div style={{ marginTop: 18 }}>
      <CXFlightStrip P={P} withDate />
    </div>

    <CXPhaseTags P={P} />

    <CXDivider title="WING CAPABILITY · 6 ITEMS" P={P}
               right={<span style={{ fontFamily: CX_FONT_MONO, fontSize: 10.5, color: P.ink3 }}>scanned in 12 ms</span>} />

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
      <CXCapCardSpark cap={WT_CAPS.controller} sparkData={SPARK_GYRO}     sparkColor={P.accent} P={P}>
        <CXPIDStrip P={P} />
      </CXCapCardSpark>
      <CXCapCardSpark cap={WT_CAPS.tpa}        sparkData={SPARK_AIRSPEED} sparkColor={P.ok}     P={P}>
        <CXKVStrip rows={WT_CAPS.tpa.detail} P={P} />
      </CXCapCardSpark>
    </div>

    <div style={{ marginBottom: 10 }}>
      <CXCapCardSpark cap={WT_CAPS.spa} sparkData={SPARK_SETPOINT} sparkColor={P.warn} P={P}>
        <CXKVStrip rows={WT_CAPS.spa.detail} P={P} />
        <div style={{
          marginTop: 12, padding: "10px 14px 10px 16px",
          background: `${P.warn}11`, borderLeft: `3px solid ${P.warn}`,
          fontFamily: CX_FONT_SANS, fontSize: 12, lineHeight: 1.5, color: P.ink2,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: P.warn, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.24em" }}>FIELD NOTE</span>
            <span style={{ color: P.ink3, fontFamily: CX_FONT_MONO, fontSize: 10.5 }}>recommendation pending</span>
          </div>
          {WT_CAPS.spa.note}
        </div>
      </CXCapCardSpark>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <CXCapCardSpark cap={WT_CAPS.debug} sparkData={SPARK_DEBUG} sparkColor={P.accent} P={P}>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${P.line2}` }}>
          <CXLabel P={P}>UNLOCKED FIELDS</CXLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WT_CAPS.debug.unlocks.map(u => (
              <span key={u} style={{
                fontFamily: CX_FONT_MONO, fontSize: 11,
                padding: "3px 9px",
                background: P.surface2, color: P.accent,
                border: `1px solid ${P.accentDim}`,
              }}>{u}</span>
            ))}
          </div>
        </div>
      </CXCapCardSpark>
      <CXCapCard cap={WT_CAPS.firmware} P={P}>
        <CXKVStrip rows={[
          ["channel", "alpha"], ["target", "STM32F411"],
          ["rev", "f3a91c2"], ["wing", "yes"],
        ]} P={P} />
      </CXCapCard>
    </div>

    <CXFieldTable P={P} />
    <CXSignature P={P} />
  </div>
);

Object.assign(window, {
  CXVariant, CXEnriched,
  PAL_BRASS, PAL_GRAPHITE, PAL_CARBON, PAL_BLUEPRINT, PAL_FOREST,
});
