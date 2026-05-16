// Root app — wires all three directions into the design canvas.

const App = () => (
  <DesignCanvas
    title="WingTune · M1.3.4–5 design pass"
    subtitle="File drop + capability summary · 3 directions, dark mode"
  >
    <DCSection
      id="dir-a"
      title="A · Phosphor Scope"
      subtitle="PIDtoolbox heritage. Mono, bracket frames, ASCII bars, dashed rules — loud telemetry-instrument."
    >
      <DCArtboard id="a-drop" label="File drop · all states + queue" width={560} height={1280}>
        <ADirectionDrop />
      </DCArtboard>
      <DCArtboard id="a-caps" label="Capability summary" width={720} height={1280}>
        <ADirectionCaps />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="dir-b"
      title="B · Telemetry Console"
      subtitle="Cleaner instrument. Hairline rules, micro-grid, sans labels + mono numbers, cool blue accent."
    >
      <DCArtboard id="b-drop" label="File drop · all states + queue" width={580} height={1220}>
        <BDirectionDrop />
      </DCArtboard>
      <DCArtboard id="b-caps" label="Capability summary" width={760} height={1280}>
        <BDirectionCaps />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="dir-c"
      title="C · Hangar Logbook"
      subtitle="Warm dark · ICAO data-block · slab heading · brass accent · rubber-stamp confidence."
    >
      <DCArtboard id="c-drop" label="File drop · all states + manifest" width={600} height={1240}>
        <CDirectionDrop />
      </DCArtboard>
      <DCArtboard id="c-caps" label="Capability summary" width={780} height={1320}>
        <CDirectionCaps />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="dir-c-palettes"
      title="C · Palette studies"
      subtitle="Same DNA — slab heads, ICAO data block, rubber-stamp confidence — across 4 palettes. Pick a base, then density."
    >
      <DCArtboard id="c-pal-graphite" label="Graphite & Cyan · clinical" width={760} height={1040}>
        <CXVariant P={PAL_GRAPHITE} />
      </DCArtboard>
      <DCArtboard id="c-pal-carbon" label="Carbon & Sodium · night-panel" width={760} height={1040}>
        <CXVariant P={PAL_CARBON} />
      </DCArtboard>
      <DCArtboard id="c-pal-blueprint" label="Blueprint · drafting" width={760} height={1040}>
        <CXVariant P={PAL_BLUEPRINT} />
      </DCArtboard>
      <DCArtboard id="c-pal-forest" label="Forest &amp; Phosphor · scope-adjacent" width={760} height={1040}>
        <CXVariant P={PAL_FOREST} />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="dir-c-enriched"
      title="C · Enriched density"
      subtitle="Adds sparklines per capability, a phase-timeline strip, and a session-signature footer. Engineering-grade, not plain."
    >
      <DCArtboard id="c-rich-graphite" label="Enriched · Graphite & Cyan" width={820} height={1480}>
        <CXEnriched P={PAL_GRAPHITE} />
      </DCArtboard>
      <DCArtboard id="c-rich-carbon" label="Enriched · Carbon & Sodium" width={820} height={1480}>
        <CXEnriched P={PAL_CARBON} />
      </DCArtboard>
      <DCArtboard id="c-rich-blueprint" label="Enriched · Blueprint" width={820} height={1480}>
        <CXEnriched P={PAL_BLUEPRINT} />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="analysis"
      title="Analysis screen · setpoint-tracking-first"
      subtitle="Wing-first multi-axis layout. Tabs swap content; signals + zoom + cursor sync across plots."
    >
      <DCArtboard id="analysis-tracking" label="Tracking tab · single signal plot + output plot" width={1380} height={1000}>
        <AnalysisScreen defaultTab="tracking" />
      </DCArtboard>
      <DCArtboard id="analysis-spectrum" label="Spectrum tab · gyro PSD + filter overlays" width={1380} height={920}>
        <AnalysisScreen defaultTab="spectrum" />
      </DCArtboard>
      <DCArtboard id="analysis-step" label="Step response tab · per-axis with peak + latency scatters" width={1380} height={780}>
        <AnalysisScreen defaultTab="step" />
      </DCArtboard>
      <DCArtboard id="analysis-recommend" label="Recommend tab · Servo + SPA + TPA + Filter + PID, group + filter" width={1380} height={1900}>
        <AnalysisScreen defaultTab="recommend" />
      </DCArtboard>
    </DCSection>

    <DCPostIt x={32} y={-72} w={340}>
      Original A / B / C above. C-expanded explores palette + density.
      Palette studies = same content, 4 color directions.
      Enriched adds sparklines, phase-detection timeline, and a signature footer
      so each capability earns its own visual weight.
    </DCPostIt>
  </DesignCanvas>
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
