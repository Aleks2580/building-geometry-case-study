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

export default function MassingVisualization({ result, resultKey }: { result: MassingPreviewResponse; resultKey?: string }) {
  const [view, setView] = useState<"2d" | "3d">("2d");
  const plan = <SitePlan
    siteGeometry={result.site_geometry}
    buildableGeometry={result.buildable_geometry}
    selectedBuildableGeometry={result.selected_buildable_geometry}
    footprintGeometry={result.footprint_geometry}
    alignControlsWithViewTabs={view === "2d"}
  />;

  return <section className={styles.visualization} aria-label="Massing visualization">
    <div className={styles.controls} role="group" aria-label="Visualization view">
      <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 3h14v14H3zM3 3l14 14M3 9l8 8M9 3l8 8" /></svg>
        2D Plan
      </button>
      <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M10 2l7 4v8l-7 4-7-4V6zM3 6l7 4 7-4M10 10v8" /></svg>
        3D Massing
      </button>
    </div>
    {/* Snapshot changes retain the view choice but reset renderer failures, camera, and GPU ownership. */}
    {view === "2d" ? plan : <VisualizationBoundary key={resultKey} fallback={<>
      <p role="status">3D could not be displayed. Showing the 2D plan. You can continue working in 2D.</p>
      {plan}
    </>}>
      <Suspense fallback={<p role="status">Loading 3D visualization…</p>}>
        <Massing3D result={result} />
      </Suspense>
    </VisualizationBoundary>}
  </section>;
}
