import { useId } from "react";
import type { PolygonGeometry } from "../../api/contracts";
import { createViewportTransform, geometryBounds, geometryPath } from "../visualization/svgGeometry";
import styles from "./DraftSitePreview.module.css";

export default function DraftSitePreview({ geometry }: { geometry: PolygonGeometry | null }) {
  const id = useId();
  const bounds = geometry && geometryBounds(geometry);
  const transform = bounds && createViewportTransform(bounds, { width: 320, height: 180, padding: 16 });
  const path = geometry && transform ? geometryPath(geometry, transform) : "";

  return (
    <figure className={styles.preview}>
      <figcaption>
        <p className={styles.heading}>Live draft site</p>
        <p className={styles.hint}>Site outline only. Generate Preview to check geometry and calculate massing.</p>
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
          <title id={`${id}-title`}>Draft site preview</title>
          <desc id={`${id}-description`}>
            Unvalidated site outline in metres, fitted to this view. The boundary and any holes are shown.
            Geometry validity and massing are checked by the backend when you choose Generate Preview.
          </desc>
          <path d={path} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <p className={styles.unavailable}>
          Draft site preview unavailable. Enter valid site dimensions or Polygon JSON.
        </p>
      )}
    </figure>
  );
}
