import { useId } from "react";
import type { PolygonGeometry } from "../../../api/contracts";
import { countSvgVertices, createViewportTransform, geometryBounds, geometryPath, MAX_SVG_VERTICES } from "../../visualization/svgGeometry";
import styles from "./DraftSitePreview.module.css";

export default function DraftSitePreview({ geometry, inherited = false }: {
  geometry: PolygonGeometry | null;
  inherited?: boolean;
}) {
  const id = useId();
  const exceedsBudget = countSvgVertices(geometry) > MAX_SVG_VERTICES;
  const bounds = !exceedsBudget && geometry && geometryBounds(geometry);
  const transform = bounds && createViewportTransform(bounds, { width: 320, height: 180, padding: 16 });
  const path = geometry && transform ? geometryPath(geometry, transform) : "";

  return (
    <figure className={styles.preview}>
      <figcaption>
        <p className={styles.heading}>{inherited ? "Inherited site" : "Live draft site"}</p>
        <p className={styles.hint}>{inherited
          ? "Saved boundary · Read-only"
          : "Generate Preview to check feasibility."}</p>
      </figcaption>
      {path ? (
        <svg
          className={styles.viewport}
          viewBox="0 0 320 180"
          width={320}
          height={180}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
        >
          <title id={`${id}-title`}>{inherited ? "Inherited site preview" : "Draft site preview"}</title>
          <desc id={`${id}-description`}>
            {inherited
              ? "Saved parent site in metres, fitted to this view. The boundary and any holes are shown. The site is read-only and inherited by every child."
              : "Unvalidated site outline in metres, fitted to this view. The boundary and any holes are shown. Choose Generate Preview to check geometry and calculate massing."}
          </desc>
          <path d={path} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <p className={styles.unavailable} role={exceedsBudget ? "status" : undefined}>
          {exceedsBudget
            ? "Site preview exceeds the 10,000-vertex display limit. The complete site input is unchanged."
            : inherited
            ? "Inherited site outline unavailable at this display scale. The saved site remains unchanged."
            : "Draft site preview unavailable. Enter valid site dimensions or Polygon JSON."}
        </p>
      )}
    </figure>
  );
}
