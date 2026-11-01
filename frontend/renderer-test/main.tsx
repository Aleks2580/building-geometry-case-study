import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { massingPreviewResponseSchema } from "../src/api/contracts";
import Massing3D from "../src/features/visualization/Massing3D";
import SitePlan from "../src/features/visualization/SitePlan";
import existingFixturesJson from "../src/test/backendPreviewFixtures.json?raw";
import capturedFixturesJson from "./backendFixtures.json?raw";
import { inspectWebGLResources, installWebGLResourceInspection } from "./webglResources";
import "../src/styles.css";
import "./styles.css";

const fixtures = Object.fromEntries(Object.entries({
  ...JSON.parse(existingFixturesJson) as Record<string, unknown>,
  ...JSON.parse(capturedFixturesJson) as Record<string, unknown>,
}).map(([name, result]) => [name, massingPreviewResponseSchema.parse(result)]));
const names = Object.keys(fixtures);
installWebGLResourceInspection();

function RendererHarness() {
  const [selected, setSelected] = useState("rectangle");
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const [measurementFixture, setMeasurementFixture] = useState("");
  const [frameTimes, setFrameTimes] = useState<number[]>([]);
  const [resources, setResources] = useState(inspectWebGLResources);
  const result = useMemo(() => revision === 0 ? fixtures[selected] : structuredClone(fixtures[selected]), [selected, revision]);

  useEffect(() => {
    if (remaining === 0) return;
    const timer = window.setTimeout(() => {
      setSelected((current) => names[(names.indexOf(current) + 1) % names.length]);
      setRevision((current) => current + 1);
      setRemaining((current) => current - 1);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  useEffect(() => {
    if (!measuring) return;
    let cancelled = false;
    async function measure() {
      const samples: number[] = [];
      for (let index = 0; index < 30; index++) {
        if (cancelled) return;
        const start = performance.now();
        setRevision((current) => current + 1);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        samples.push(performance.now() - start);
      }
      if (!cancelled) {
        setFrameTimes(samples);
        setMeasuring(false);
      }
    }
    void measure();
    return () => { cancelled = true; };
  }, [measuring]);

  return <main>
    <h1>3D renderer browser verification</h1>
    <p>Standalone backend responses. The existing workspace is not mounted.</p>
    <p><a href="?webgl=off">Verify unavailable WebGL</a> · <a href="?">Use browser WebGL</a></p>
    <div className="harness-controls">
      <label>Backend fixture
        <select value={selected} disabled={measuring} onChange={(event) => { setRemaining(0); setSelected(event.target.value); }}>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <button type="button" disabled={measuring} onClick={() => setMounted((current) => !current)}>{mounted ? "Unmount 3D" : "Mount 3D"}</button>
      <button type="button" disabled={!mounted || remaining > 0 || measuring} onClick={() => setRemaining(30)}>Run 30 fixture updates</button>
      <button type="button" disabled={!mounted || measuring} onClick={() => setRevision((current) => current + 1)}>Replace with equal response</button>
      <button type="button" disabled={!mounted || remaining > 0 || measuring} onClick={() => {
        setMeasurementFixture(selected);
        setFrameTimes([]);
        setMeasuring(true);
      }}>Measure 30 response replacements</button>
      <button type="button" disabled={!mounted || measuring} onClick={() => {
        document.querySelector("canvas")?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
      }}>Lose WebGL context</button>
      <button type="button" onClick={() => setResources(inspectWebGLResources())}>Inspect resources</button>
    </div>
    <p role="status">Selected fixture: {selected}. Backend status: {result.feasibility.status}. Updates remaining: {remaining}.</p>
    {measuring && <p role="status">Measuring 30 response replacements…</p>}
    {frameTimes.length > 0 && <p data-testid="render-measurement">
      Fixture {measurementFixture}: response replacement through two animation frames, including scheduling: {frameTimes.length} samples;
      median {[...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)].toFixed(2)} ms;
      maximum {Math.max(...frameTimes).toFixed(2)} ms. This is elapsed browser latency, not GPU execution time.
    </p>}
    <dl className="harness-metrics">
      <div><dt>Actual floors</dt><dd>{result.metrics.floor_count ?? "Unavailable"}</dd></div>
      <div><dt>Floor-to-floor height (m)</dt><dd>{result.metrics.floor_to_floor_m}</dd></div>
      <div><dt>Actual total height (m)</dt><dd>{result.metrics.height_m ?? "Unavailable"}</dd></div>
      <div><dt>Setback components</dt><dd>{result.setback.component_count}</dd></div>
    </dl>
    <div className="harness-views">
      <section aria-label="3D browser test">
        <h2>Interactive 3D</h2>
        <div data-renderer-viewer>{mounted ? <Massing3D result={result} /> : <p>3D renderer unmounted.</p>}</div>
      </section>
      <section aria-label="2D crosscheck">
        <h2>Authoritative 2D crosscheck</h2>
        <SitePlan siteGeometry={result.site_geometry} buildableGeometry={result.buildable_geometry}
          selectedBuildableGeometry={result.selected_buildable_geometry} footprintGeometry={result.footprint_geometry} />
      </section>
    </div>
    <section aria-label="WebGL resource inspection">
      <h2>WebGL resource inspection</h2>
      <p>Counters wrap native WebGL2 allocation, deletion, draw calls, and viewer interaction listeners in this test harness. Inspect after rendering and again after unmount cleanup. Context loss releases remaining GPU resources separately from explicit deletion. Listener records use weak references so inspection does not retain removed viewer elements.</p>
      <pre data-testid="webgl-resources">{JSON.stringify(resources, null, 2)}</pre>
    </section>
    <details><summary>Complete backend response</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing renderer harness root.");
const reactRoot = createRoot(root);
reactRoot.render(<StrictMode><RendererHarness /></StrictMode>);
import.meta.hot?.dispose(() => reactRoot.unmount());
