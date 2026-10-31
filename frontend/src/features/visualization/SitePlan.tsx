import { useId } from "react";
import type { MassingPreviewResponse } from "../../api/contracts";
import { createViewportTransform, geometryBounds, geometryPath } from "./svgGeometry";
import styles from "./SitePlan.module.css";

export interface SitePlanProps {
  siteGeometry: MassingPreviewResponse["site_geometry"];
  buildableGeometry?: MassingPreviewResponse["buildable_geometry"];
  selectedBuildableGeometry?: MassingPreviewResponse["selected_buildable_geometry"];
  footprintGeometry?: MassingPreviewResponse["footprint_geometry"];
  width?: number;
  height?: number;
  padding?: number;
}

export default function SitePlan({
  siteGeometry,
  buildableGeometry = null,
  selectedBuildableGeometry = null,
  footprintGeometry = null,
  width = 640,
  height = 400,
  padding = 24,
}: SitePlanProps) {
  const id = useId();
  const bounds = geometryBounds(siteGeometry);
  // Frame every layer with the original site so missing or smaller results cannot
  // change its apparent scale. Selection and footprint fallbacks belong to the backend.
  const transform = bounds && createViewportTransform(bounds, { width, height, padding });
  const layers = [
    { key: "site", label: "Original site boundary", geometry: siteGeometry, className: styles.site },
    { key: "buildable", label: "Complete buildable region", geometry: buildableGeometry, className: styles.buildable },
    { key: "selected-buildable", label: "Selected buildable component", geometry: selectedBuildableGeometry, className: styles.selectedBuildable },
    { key: "footprint", label: "Actual building footprint", geometry: footprintGeometry, className: styles.footprint },
  ].map((layer) => ({
    ...layer,
    path: transform && layer.geometry ? geometryPath(layer.geometry, transform) : "",
  }));
  const visibleLayers = layers.filter((layer) => layer.path !== "");
  const hasSite = visibleLayers.some((layer) => layer.key === "site");
  const hasFootprint = visibleLayers.some((layer) => layer.key === "footprint");
  const description = [
    "Plan view of backend geometry in metres. Larger y coordinates point upward.",
    hasSite ? `Displayed layers: ${visibleLayers.map((layer) => layer.label).join(", ")}.` : "Site geometry cannot be displayed.",
    hasFootprint ? "" : "No building footprint is available.",
  ].filter(Boolean).join(" ");

  return (
    <figure className={styles.plan}>
      <svg
        className={styles.viewport}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <title id={`${id}-title`}>Site plan</title>
        <desc id={`${id}-description`}>{description}</desc>
        {visibleLayers.map((layer) => (
          <path
            key={layer.key}
            data-layer={layer.key}
            aria-label={layer.label}
            className={`${styles.layer} ${layer.className}`}
            d={layer.path}
            fillRule="evenodd"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <figcaption>
        {visibleLayers.length > 0 && (
          <ul className={styles.legend} aria-label="Site plan layers">
            {visibleLayers.map((layer) => (
              <li key={layer.key}>
                <span className={`${styles.swatch} ${layer.className}`} aria-hidden="true" />
                {layer.label}
              </li>
            ))}
          </ul>
        )}
        {!hasSite && <p className={styles.notice}>Site geometry cannot be displayed.</p>}
        {!hasFootprint && <p className={styles.notice}>No building footprint is available.</p>}
      </figcaption>
    </figure>
  );
}
