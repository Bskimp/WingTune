// Recommend tab — actionable tuning suggestions grounded in detected log behavior.
// Each card: severity + confidence + current vs suggested + CLI commands +
// evidence chips that pin the synced cursor at the moment that triggered it.

const { useState: useStateRC } = React;

// --- data ---

const RECS = [
  {
    id: "servo-l-sat",
    domain: "Servo",
    axis: "Elevon-L",
    severity: "high",
    confidence: "high",
    title: "Left elevon saturated during launch climb",
    summary: "Hit 1000 µs endpoint for 412 ms across 3 events in the first 9 s.",
    detail: "Left elevon PWM bottomed out during wing-launch climb. Saturation = lost control authority — the surface is asking for more than it can deliver. Either reduce wing_launch_climb_angle so the requested pitch is achievable, OR raise pitch P so less surface deflection achieves the same correction. Saturation is a direct measurement, no inference, so confidence is high.",
    current: [
      ["wing_launch_climb_angle", "45 °"],
      ["pitch_p",                 "20"],
    ],
    suggested: [
      ["wing_launch_climb_angle", "35 °"],
      ["pitch_p",                 "20"],
    ],
    cli: ["set wing_launch_climb_angle = 35"],
    evidence: [
      { t: 0.045, label: "sat · launch + 0.5 s" },
      { t: 0.072, label: "sat · launch + 4 s"   },
      { t: 0.088, label: "sat · launch + 8 s"   },
    ],
  },
  {
    id: "servo-r-lag",
    domain: "Servo",
    axis: "Elevon-R",
    severity: "medium",
    confidence: "medium",
    title: "Right elevon lag exceeds D-term phase margin",
    summary: "22 ms rcCommand → PWM lag (left is 14 ms — mechanical asymmetry).",
    detail: "Right elevon shows 22 ms response lag vs 14 ms on the left. Likely gear backlash, servo wear, or a tighter horn. Current D-term PT2 at 80 Hz adds 1.4 ms of phase delay on top. Either match the servos mechanically, or back off D-term filtering on roll so its phase doesn't compound with the slowest servo's. Confidence is medium — mechanical asymmetry is hard to measure precisely from PWM alone.",
    current: [
      ["dterm_lowpass_type",      "PT2"],
      ["dterm_lowpass_hz",        "80"],
      ["d_roll",                  "24"],
    ],
    suggested: [
      ["dterm_lowpass_type",      "PT1"],
      ["dterm_lowpass_hz",        "120"],
      ["d_roll",                  "20"],
    ],
    cli: [
      "set dterm_lowpass_type = PT1",
      "set dterm_lowpass_hz = 120",
      "set d_roll = 20",
    ],
    evidence: [
      { t: 0.21, label: "step · n=2 · lag 21 ms" },
      { t: 0.36, label: "step · n=3 · lag 23 ms" },
      { t: 0.65, label: "step · n=4 · lag 22 ms" },
      { t: 0.81, label: "step · n=5 · lag 21 ms" },
    ],
    delta: { ms: -0.7, label: "saves 0.7 ms phase" },
  },
  {
    id: "spa-yaw",
    domain: "SPA",
    axis: "Y",
    severity: "medium",
    confidence: "medium",
    title: "Enable SPA on yaw",
    summary: "I-term wound up 3× on hard rudder kicks during cruise.",
    detail: "Yaw SPA is currently OFF. Detected 3 rudder events above 200 °/s setpoint with recovery time > 800 ms — symptomatic of I-term windup. PD_I_FREEZE on roll handles this on the main axis; yaw can use the lighter I_FREEZE mode.",
    current: [
      ["spa_yaw_mode",   "OFF"],
      ["spa_yaw_center", "0 °/s"],
      ["spa_yaw_width",  "0 °/s"],
    ],
    suggested: [
      ["spa_yaw_mode",   "I_FREEZE"],
      ["spa_yaw_center", "180 °/s"],
      ["spa_yaw_width",  "100 °/s"],
    ],
    cli: [
      "set spa_yaw_mode = I_FREEZE",
      "set spa_yaw_center = 180",
      "set spa_yaw_width = 100",
    ],
    evidence: [
      { t: 0.42, label: "kick 1 · 240 °/s" },
      { t: 0.58, label: "kick 2 · 220 °/s" },
      { t: 0.81, label: "kick 3 · 290 °/s" },
    ],
  },
  {
    id: "tpa-delay",
    domain: "TPA",
    axis: null,
    severity: "low",
    confidence: "low",
    title: "Increase TPA speed-estimator delay",
    summary: "Throttle-drop → oscillation onset lags model by ~400 ms.",
    detail: "BASIC estimator delay is 1000 ms. Cross-correlating throttle drops with onset of pitch oscillation suggests ~1400 ms is closer. Two events isn't enough for high confidence — re-run after a flight with more cuts to maneuver-and-glide.",
    current: [
      ["tpa_speed_est_type",         "BASIC"],
      ["tpa_speed_est_basic_delay",  "1000 ms"],
      ["tpa_speed_est_basic_gravity","50 %"],
    ],
    suggested: [
      ["tpa_speed_est_type",         "BASIC"],
      ["tpa_speed_est_basic_delay",  "1400 ms"],
      ["tpa_speed_est_basic_gravity","50 %"],
    ],
    cli: ["set tpa_speed_est_basic_delay = 1400"],
    evidence: [
      { t: 0.52, label: "throttle cut · cruise" },
      { t: 0.78, label: "throttle cut · approach" },
    ],
  },
  {
    id: "filter-notch",
    domain: "Filters",
    axis: null,
    severity: "high",
    confidence: "high",
    title: "Dynamic notch is missing the 47 Hz airframe peak",
    summary: "Tracker centered at 95 Hz but a persistent 47 Hz peak isn't covered.",
    detail: "Pre-filter gyro PSD shows a +14 dB peak at 47 Hz visible in 92 % of the cruise window. Post-filter still shows it at +8 dB — the tracker is sticking to the servo resonance at 95 Hz. Either widen the notch search range or add a static notch.",
    current: [
      ["dyn_notch_count",    "3"],
      ["dyn_notch_min_hz",   "85"],
      ["dyn_notch_max_hz",   "600"],
    ],
    suggested: [
      ["dyn_notch_count",    "3"],
      ["dyn_notch_min_hz",   "35"],
      ["dyn_notch_max_hz",   "600"],
    ],
    cli: ["set dyn_notch_min_hz = 35"],
    evidence: [
      { t: 0.18, label: "47 Hz peak · climb" },
      { t: 0.47, label: "47 Hz peak · cruise" },
      { t: 0.74, label: "47 Hz peak · cruise" },
    ],
  },
  {
    id: "filter-dterm",
    domain: "Filters",
    axis: null,
    severity: "low",
    confidence: "high",
    title: "Loosen D-term LPF1",
    summary: "PT2 at 90 Hz costs 1.4 ms · no D-spectrum peak above 60 Hz.",
    detail: "D-term spectrum has its highest persistent peak at 28 Hz. Current PT2 at 90 Hz over-filters and burns 1.4 ms of the 5 ms wing budget. PT1 at 120 Hz cuts that to 0.7 ms with no loss of coverage on the real peak.",
    current: [
      ["dterm_lowpass_type", "PT2"],
      ["dterm_lowpass_hz",   "90"],
    ],
    suggested: [
      ["dterm_lowpass_type", "PT1"],
      ["dterm_lowpass_hz",   "120"],
    ],
    cli: [
      "set dterm_lowpass_type = PT1",
      "set dterm_lowpass_hz = 120",
    ],
    evidence: [],
    delta: { ms: -0.7, label: "saves 0.7 ms" },
  },
  {
    id: "pid-roll-d",
    domain: "PID",
    axis: "R",
    severity: "low",
    confidence: "medium",
    title: "Roll D is on the low side for current setpoint slew",
    summary: "Step-response overshoot on roll averages 1.30 (target ≤ 1.20).",
    detail: "6 measurement windows show consistent 30 % overshoot on roll. Wing platform with PIDFS + SPA can absorb a stiffer D-term without ringing — S-term is doing the bulk of the maneuver work. Try D=8 instead of 5.",
    current: [["roll_d", "5"]],
    suggested: [["roll_d", "8"]],
    cli: ["set p_pitch = 20", "set d_roll = 8"],
    evidence: [
      { t: 0.21, label: "step · n=2 · peak 1.32" },
      { t: 0.65, label: "step · n=4 · peak 1.40" },
    ],
  },
  {
    id: "filter-budget-ok",
    domain: "Filters",
    axis: null,
    severity: "info",
    confidence: "high",
    title: "Filter chain inside wing budget",
    summary: "Current chain delay: 5.9 ms / 5.0 ms ceiling.",
    detail: "Over budget by 0.9 ms. The D-term loosen above (-0.7) and the notch widen (+0.2) net to inside-budget after applying recommendations.",
    current: [["chain_total", "5.9 ms"]],
    suggested: [["chain_total", "5.4 ms"]],
    cli: [],
    evidence: [],
  },
];

// --- atoms ---

const sevColor = (sev) =>
  sev === "high" ? AN.stamp :
  sev === "medium" ? AN.warn :
  sev === "low" ? AN.ok :
  AN.ink3;

const SevPill = ({ sev }) => {
  const c = sevColor(sev);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "1px 7px",
      border: `1px solid ${c}`,
      color: c,
      fontFamily: FS, fontSize: 9, fontWeight: 700,
      letterSpacing: "0.2em", textTransform: "uppercase",
    }}>
      <span style={{ width: 5, height: 5, background: c, borderRadius: "50%" }} />
      {sev === "info" ? "ok" : sev}
    </span>
  );
};

const ConfStamp = ({ conf }) => {
  const map = {
    high:   { fg: AN.ok,    label: "high conf" },
    medium: { fg: AN.warn,  label: "med conf" },
    low:    { fg: AN.stamp, label: "low conf" },
  };
  const c = map[conf];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "1px 6px",
      border: `1px solid ${c.fg}`,
      color: c.fg, background: "rgba(0,0,0,0.18)",
      fontFamily: FS, fontSize: 9, fontWeight: 700,
      letterSpacing: "0.18em", textTransform: "uppercase",
      transform: "rotate(-1deg)",
    }}>{c.label}</span>
  );
};

const KVRows = ({ rows, valueColor, label }) => (
  <div style={{
    flex: 1, padding: "8px 10px",
    background: AN.surface2, border: `1px solid ${AN.line}`,
    minWidth: 0,
  }}>
    <div style={{
      color: AN.ink3, fontFamily: FS, fontSize: 9,
      letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6,
    }}>{label}</div>
    {rows.map(([k, v]) => (
      <div key={k} style={{
        display: "flex", justifyContent: "space-between",
        fontFamily: FM, fontSize: 11.5, padding: "2px 0",
      }}>
        <span style={{ color: AN.ink3 }}>{k}</span>
        <span style={{ color: valueColor || AN.ink }}>{v}</span>
      </div>
    ))}
  </div>
);

const EvidenceChip = ({ ev }) => {
  const { setCursorT, setPinned } = useCursor();
  return (
    <button onClick={() => { setCursorT(ev.t); setPinned(true); }} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 9px",
      background: AN.surface2,
      border: `1px solid ${AN.line2}`,
      color: AN.ink2,
      fontFamily: FM, fontSize: 11, cursor: "pointer",
    }}>
      <span style={{ color: AN.accent, fontSize: 10 }}>↳</span>
      {fmtClock(ev.t)}
      <span style={{ color: AN.ink3 }}>· {ev.label}</span>
    </button>
  );
};

const RecCard = ({ rec }) => {
  const [open, setOpen] = useStateRC(false);
  const [copied, setCopied] = useStateRC(false);

  const copyCli = () => {
    if (rec.cli.length === 0) return;
    navigator.clipboard?.writeText(rec.cli.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{
      background: AN.surface, border: `1px solid ${AN.line2}`,
      borderLeft: `3px solid ${sevColor(rec.severity)}`,
    }}>
      {/* head */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
          <SevPill sev={rec.severity} />
          <span style={{
            color: AN.ink3, fontFamily: FM, fontSize: 10,
            letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase",
          }}>
            {rec.domain}{rec.axis ? ` · ${rec.axis}` : ""}
          </span>
          <div style={{ flex: 1 }} />
          <ConfStamp conf={rec.confidence} />
        </div>
        <div style={{
          color: AN.ink, fontFamily: FH, fontSize: 15, fontWeight: 600,
          marginBottom: 4,
        }}>{rec.title}</div>
        <div style={{ color: AN.ink2, fontFamily: FS, fontSize: 12, lineHeight: 1.4 }}>
          {rec.summary}
        </div>
        {rec.delta && (
          <div style={{
            display: "inline-block", marginTop: 6,
            padding: "1px 7px",
            background: `${AN.ok}1a`,
            border: `1px solid ${AN.ok}55`,
            color: AN.ok, fontFamily: FM, fontSize: 10.5, fontWeight: 600,
          }}>{rec.delta.label}</div>
        )}
      </div>

      {/* body */}
      {open && (
        <div style={{ padding: "0 16px 12px 16px" }}>
          <div style={{ color: AN.ink3, fontFamily: FS, fontSize: 12, lineHeight: 1.55, marginBottom: 12 }}>
            {rec.detail}
          </div>

          {/* current vs suggested */}
          {rec.current && rec.suggested && (
            <div style={{ display: "flex", gap: 1, marginBottom: 12 }}>
              <KVRows rows={rec.current}   label="current"   valueColor={AN.ink} />
              <div style={{
                display: "flex", alignItems: "center",
                background: AN.bg, padding: "0 4px",
                color: AN.accent, fontFamily: FM, fontSize: 14, fontWeight: 700,
              }}>→</div>
              <KVRows rows={rec.suggested} label="suggested" valueColor={AN.accent} />
            </div>
          )}

          {/* evidence */}
          {rec.evidence.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                color: AN.ink3, fontFamily: FS, fontSize: 9,
                letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6,
              }}>Evidence · click to pin cursor</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {rec.evidence.map((ev, i) => <EvidenceChip key={i} ev={ev} />)}
              </div>
            </div>
          )}

          {/* cli */}
          {rec.cli.length > 0 && (
            <div>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 6,
              }}>
                <div style={{
                  color: AN.ink3, fontFamily: FS, fontSize: 9,
                  letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700,
                }}>CLI commands</div>
                <button onClick={copyCli} style={{
                  padding: "2px 10px",
                  background: copied ? AN.ok : AN.surface2,
                  border: `1px solid ${copied ? AN.ok : AN.line2}`,
                  color: copied ? AN.bg : AN.ink2,
                  fontFamily: FM, fontSize: 10.5, cursor: "pointer",
                  fontWeight: 600,
                }}>{copied ? "✓ copied" : "Copy"}</button>
              </div>
              <pre style={{
                margin: 0, padding: "8px 12px",
                background: AN.bg, border: `1px solid ${AN.line}`,
                fontFamily: FM, fontSize: 11.5, color: AN.ink,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}>{rec.cli.join("\n")}</pre>
            </div>
          )}
        </div>
      )}

      {/* footer */}
      <div style={{
        padding: "6px 16px",
        borderTop: open ? `1px solid ${AN.line}` : "none",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <button onClick={() => setOpen(o => !o)} style={{
          background: "transparent", border: "none",
          color: AN.ink3, fontFamily: FM, fontSize: 11,
          cursor: "pointer", padding: 0,
        }}>
          {open ? "▾ collapse" : "▸ details"}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{
            padding: "3px 10px",
            background: "transparent",
            border: `1px solid ${AN.line2}`,
            color: AN.ink3, fontFamily: FS, fontSize: 11, cursor: "pointer",
          }}>Dismiss</button>
          <button style={{
            padding: "3px 10px",
            background: AN.accent,
            border: `1px solid ${AN.accent}`,
            color: AN.bg, fontFamily: FS, fontSize: 11, cursor: "pointer", fontWeight: 600,
          }}>Mark applied</button>
        </div>
      </div>
    </div>
  );
};

// --- header / score ---

const RecommendHeader = ({ filter, setFilter, counts, groupBy, setGroupBy }) => (
  <div style={{
    background: AN.surface, border: `1px solid ${AN.line2}`,
    padding: "12px 16px", marginBottom: 10,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18 }}>
      <div>
        <div style={{ color: AN.ink, fontFamily: FH, fontSize: 15, fontWeight: 600 }}>
          Tuning suggestions · {RECS.length} items
        </div>
        <div style={{ color: AN.ink3, fontFamily: FM, fontSize: 11, marginTop: 3 }}>
          generated from this log · click evidence to pin cursor · copy commands to apply
        </div>
      </div>

      {/* health score */}
      <div style={{
        display: "flex", gap: 0,
        background: AN.bg, border: `1px solid ${AN.line2}`,
      }}>
        {[
          { k: "high",   l: "must",   c: AN.stamp },
          { k: "medium", l: "should", c: AN.warn },
          { k: "low",    l: "could",  c: AN.ok },
          { k: "info",   l: "ok",     c: AN.ink3 },
        ].map((s, i) => (
          <div key={s.k} style={{
            padding: "6px 14px",
            borderLeft: i > 0 ? `1px solid ${AN.line2}` : "none",
            cursor: "pointer",
            background: filter === s.k ? `${s.c}1a` : "transparent",
          }}
            onClick={() => setFilter(filter === s.k ? "all" : s.k)}>
            <div style={{
              color: s.c, fontFamily: FM, fontSize: 18, fontWeight: 600, textAlign: "center",
            }}>{counts[s.k] || 0}</div>
            <div style={{
              color: AN.ink3, fontFamily: FS, fontSize: 9,
              letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, marginTop: 2,
            }}>{s.l}</div>
          </div>
        ))}
      </div>
    </div>

    {/* filters + group toggle row */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          ["all",     `all (${RECS.length})`],
          ["Servo",   `Servo (${RECS.filter(r => r.domain === "Servo").length})`],
          ["SPA",     `SPA (${RECS.filter(r => r.domain === "SPA").length})`],
          ["TPA",     `TPA (${RECS.filter(r => r.domain === "TPA").length})`],
          ["Filters", `Filters (${RECS.filter(r => r.domain === "Filters").length})`],
          ["PID",     `PID (${RECS.filter(r => r.domain === "PID").length})`],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: "3px 10px",
            background: filter === k ? `${AN.accent}1a` : "transparent",
            border: `1px solid ${filter === k ? AN.accent : AN.line2}`,
            color: filter === k ? AN.accent : AN.ink3,
            fontFamily: FM, fontSize: 11, cursor: "pointer", fontWeight: 600,
          }}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: FM, fontSize: 11 }}>
        <span style={{ color: AN.ink3 }}>group by</span>
        <div style={{ display: "flex", gap: 1 }}>
          {[
            ["severity", "severity"],
            ["domain",   "domain"],
            ["axis",     "axis"],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setGroupBy(k)} style={{
              padding: "3px 10px",
              background: groupBy === k ? AN.accent : AN.surface2,
              color: groupBy === k ? AN.bg : AN.ink3,
              border: `1px solid ${groupBy === k ? AN.accent : AN.line2}`,
              fontFamily: FS, fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const groupRecs = (recs, by) => {
  if (by === "severity") {
    const sorted = [...recs].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    return [{ title: null, rows: sorted }];
  }
  const buckets = {};
  recs.forEach(r => {
    const key = by === "domain" ? r.domain : (r.axis || "—");
    (buckets[key] = buckets[key] || []).push(r);
  });
  return Object.entries(buckets).map(([title, rows]) => ({
    title,
    rows: rows.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]),
  }));
};

const RecommendTab = () => {
  const [filter, setFilter] = useStateRC("all");
  const [groupBy, setGroupBy] = useStateRC("severity");
  const counts = RECS.reduce((a, r) => ({ ...a, [r.severity]: (a[r.severity] || 0) + 1 }), {});
  const filtered = RECS.filter(r => {
    if (filter === "all") return true;
    if (["high", "medium", "low", "info"].includes(filter)) return r.severity === filter;
    return r.domain === filter;
  });
  const groups = groupRecs(filtered, groupBy);
  return (
    <div style={{ marginTop: 10 }}>
      <RecommendHeader
        filter={filter} setFilter={setFilter}
        counts={counts}
        groupBy={groupBy} setGroupBy={setGroupBy}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && (
              <div style={{
                color: AN.accent, fontFamily: FS, fontSize: 10,
                letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 700,
                marginBottom: 6, paddingBottom: 4,
                borderBottom: `1px solid ${AN.line2}`,
                display: "flex", justifyContent: "space-between",
              }}>
                <span>{g.title}</span>
                <span style={{ color: AN.ink3, letterSpacing: 0, fontFamily: FM, fontSize: 10.5, textTransform: "none", fontWeight: 400 }}>
                  {g.rows.length}
                </span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {g.rows.map(rec => <RecCard key={rec.id} rec={rec} />)}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{
            padding: "40px 24px",
            background: AN.surface, border: `1px solid ${AN.line2}`,
            color: AN.ink3, fontFamily: FM, fontSize: 12, textAlign: "center",
          }}>
            nothing matches this filter
          </div>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { RecommendTab });
