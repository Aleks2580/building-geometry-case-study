import { Component, StrictMode, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { WebGLRenderer } from "three";
import type { MassingPreviewResponse } from "../../api/contracts";
import SitePlan from "./SitePlan";
import Massing3DScene from "./Massing3DScene";
import { prepareMassingScene } from "./massing3DGeometry";
import styles from "./Massing3D.module.css";

class CanvasBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const context = canvas.getContext("webgl2", { antialias: true, alpha: true });
  if (!context) throw new Error("WebGL2 is unavailable.");
  return new WebGLRenderer({ canvas, context: context as WebGL2RenderingContext, antialias: true, alpha: true });
}

export default function Massing3D({ result }: { result: MassingPreviewResponse }) {
  const id = useId();
  const prepared = useMemo(() => prepareMassingScene(result), [result]);
  const [reset, setReset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const onContextLost = useCallback(() => setContextLost(true), []);
  const retry = () => {
    setContextLost(false);
    setAttempt((value) => value + 1);
  };
  const fallback = <div className={styles.fallback}>
    <p role="status">Interactive 3D is unavailable. Showing the 2D plan.</p>
    <button type="button" onClick={retry}>Retry 3D</button>
    <SitePlan siteGeometry={result.site_geometry} buildableGeometry={result.buildable_geometry}
      selectedBuildableGeometry={result.selected_buildable_geometry} footprintGeometry={result.footprint_geometry} />
  </div>;

  if (!("scene" in prepared)) {
    return <figure className={styles.viewer} aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`}>3D massing</figcaption>
      <p role="status">{prepared.status === "invalid" ? "The 3D display input is invalid." : "This result exceeds the supported 3D display."} {prepared.message}</p>
      {prepared.status === "unsupported" && prepared.planAvailable && <SitePlan
        siteGeometry={result.site_geometry} buildableGeometry={result.buildable_geometry}
        selectedBuildableGeometry={result.selected_buildable_geometry} footprintGeometry={result.footprint_geometry} />}
    </figure>;
  }

  const { scene } = prepared;
  return <figure className={styles.viewer} aria-labelledby={`${id}-title`}>
    <figcaption id={`${id}-title`} className={styles.caption}>3D massing</figcaption>
    {contextLost ? fallback : <CanvasBoundary key={attempt} fallback={fallback}>
      <div className={styles.viewport}>
        <Canvas gl={createRenderer} frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 45 }}
          role="img" aria-label="Interactive 3D massing canvas" aria-describedby={`${id}-instructions`}>
          <StrictMode>
            <Massing3DScene scene={scene} reset={reset} onContextLost={onContextLost} />
          </StrictMode>
        </Canvas>
      </div>
      <div className={styles.controls}>
        <button type="button" onClick={() => setReset((value) => value + 1)}>Reset to fit</button>
        <p id={`${id}-instructions`}>Drag to orbit. Scroll or pinch to zoom.</p>
      </div>
    </CanvasBoundary>}
    <ul className={styles.legend} aria-label="3D massing layers">
      <li><span className={styles.site} />Original site boundary</li>
      {scene.buildable.length > 0 && <li><span className={styles.buildable} />Complete buildable region</li>}
      {scene.selectedBuildable.length > 0 && <li><span className={styles.selected} />Selected buildable component</li>}
      {scene.building && <li><span className={styles.building} />Actual building and footprint</li>}
    </ul>
    {scene.building ? <p className={styles.notice}>
      {result.metrics.floor_count} floors · {result.metrics.floor_to_floor_m} m per floor · {result.metrics.height_m} m total height.
    </p> : <p className={styles.notice} role="status">No actual building footprint is available. Showing site and setback context.</p>}
  </figure>;
}
