import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import type { MassingPreviewResponse } from "../../api/contracts";
import SitePlan from "./SitePlan";
import styles from "./MassingVisualization.module.css";

const Massing3D = lazy(() => import("./Massing3D"));

// Import rejection happens before the renderer's own canvas boundary can mount.
class VisualizationBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function MassingVisualization({ result }: { result: MassingPreviewResponse }) {
  const [view, setView] = useState<"2d" | "3d">("2d");
  const plan = <SitePlan
    siteGeometry={result.site_geometry}
    buildableGeometry={result.buildable_geometry}
    selectedBuildableGeometry={result.selected_buildable_geometry}
    footprintGeometry={result.footprint_geometry}
  />;

  return <section className={styles.visualization} aria-label="Massing visualization">
    <div className={styles.controls} role="group" aria-label="Visualization view">
      <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D</button>
      <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D</button>
    </div>
    {view === "2d" ? plan : <VisualizationBoundary fallback={<>
      <p role="status">3D could not be displayed. Showing the 2D plan. You can continue working in 2D.</p>
      {plan}
    </>}>
      <Suspense fallback={<p role="status">Loading 3D visualization…</p>}>
        <Massing3D result={result} />
      </Suspense>
    </VisualizationBoundary>}
  </section>;
}
