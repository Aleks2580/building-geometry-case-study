import { useEffect, useId, useRef, useState } from "react";
import type { MassingPreviewResponse } from "../../api/contracts";
import { countSvgVertices, createViewportTransform, geometryBounds, geometryPath, MAX_SVG_VERTICES } from "./svgGeometry";
import { countDimensionEdges, dimensionEdgeLabel, dimensionRingLabel, formatDimensionLength, layoutAllDimensions, layoutDimension, MAX_DIMENSION_EDGES, measureGeometryEdges } from "./dimensionAnnotations";
import styles from "./SitePlan.module.css";

export interface SitePlanProps {
  siteGeometry: MassingPreviewResponse["site_geometry"];
  buildableGeometry?: MassingPreviewResponse["buildable_geometry"];
  selectedBuildableGeometry?: MassingPreviewResponse["selected_buildable_geometry"];
  footprintGeometry?: MassingPreviewResponse["footprint_geometry"];
  width?: number;
  height?: number;
  padding?: number;
  alignControlsWithViewTabs?: boolean;
}

export default function SitePlan(props: SitePlanProps) {
  if (countSvgVertices(props.siteGeometry, props.buildableGeometry, props.selectedBuildableGeometry,
    props.footprintGeometry) > MAX_SVG_VERTICES) {
    return <figure className={styles.plan}>
      <p className={styles.notice} role="status">2D plan exceeds the 10,000-vertex display limit. Results and option actions remain available.</p>
    </figure>;
  }
  return <SupportedSitePlan {...props} />;
}

function SupportedSitePlan({
  siteGeometry,
  buildableGeometry = null,
  selectedBuildableGeometry = null,
  footprintGeometry = null,
  width = 640,
  height = 400,
  padding = 24,
  alignControlsWithViewTabs = false,
}: SitePlanProps) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const planViewport = useRef<HTMLDivElement>(null);
  const [dimensionsEnabled, setDimensionsEnabled] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [expandedWidth, setExpandedWidth] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [displayWidth, setDisplayWidth] = useState(width);
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
  const [, buildableLayer, selectedLayer] = layers;
  const distinctSelection = buildableLayer.path !== "" && selectedLayer.path !== "" &&
    buildableLayer.path !== selectedLayer.path;
  // Exact rendered paths share a legend item without assuming geometric equivalence.
  // A split region keeps its selection label even when the footprint fills it.
  const legendLayers = visibleLayers.filter((layer, index) => layer.key === "site" ||
    (layer.key === "selected-buildable" && distinctSelection) ||
    !visibleLayers.slice(index + 1).some((later) => later.path === layer.path));
  const hasSite = visibleLayers.some((layer) => layer.key === "site");
  const hasFootprint = visibleLayers.some((layer) => layer.key === "footprint");
  const dimensionsAvailable = countDimensionEdges(siteGeometry, hasFootprint ? footprintGeometry : null) <= MAX_DIMENSION_EDGES;
  const showDimensions = dimensionsEnabled && dimensionsAvailable;
  const edges = showDimensions && hasSite ? measureGeometryEdges(siteGeometry, hasFootprint ? footprintGeometry : null) : [];
  // Comparison switches reuse this component. Resolve against current props so a
  // missing footprint/hole can never leave a prior snapshot's measurement visible.
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? edges[0];
  const annotation = selectedEdge && transform ? layoutDimension(selectedEdge, transform, { width, height }, displayWidth) : null;
  const overview = showDimensions && showAll && transform ? layoutAllDimensions(edges, transform, { width, height }, displayWidth) : null;
  const expanded = showDimensions && showAll && expandedWidth !== null;
  const enlargedWidth = Math.max(640, expandedWidth ?? 0, Math.ceil(Math.sqrt(edges.reduce((area, edge) =>
    area + (formatDimensionLength(edge.lengthM).length * 6.2 + 10) * 19, 0) * width / height / 0.18)));
  const edgeGroups = new Map<string, typeof edges>();
  for (const edge of edges) {
    const key = `${edge.layer}-${edge.ringIndex}`;
    const group = edgeGroups.get(key);
    if (group) group.push(edge);
    else edgeGroups.set(key, [edge]);
  }
  const description = [
    "Plan view of the massing geometry in metres. Larger y coordinates point upward.",
    hasSite ? `Displayed layers: ${visibleLayers.map((layer) => layer.label).join(", ")}.` : "Site geometry cannot be displayed.",
    legendLayers.length < visibleLayers.length ? "The legend groups matching area outlines." : "",
    hasFootprint ? "" : "No building footprint is available.",
    showDimensions && selectedEdge ? `${showAll ? `Showing all ${overview?.annotations.length ?? 0} dimensions. ` : ""}Selected measurement: ${dimensionEdgeLabel(selectedEdge)}, ${formatDimensionLength(selectedEdge.lengthM)}.` : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    const element = svg.current;
    if (!showDimensions || !element) return;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) setDisplayWidth(measured);
    };
    // Font size and offsets use the rendered SVG width while geometry retains
    // its original logical frame. Fixed SVG text would become unreadable on mobile.
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [showDimensions]);

  function fitPlan() {
    setExpandedWidth(null);
    setDisplayWidth(planViewport.current?.getBoundingClientRect().width || width);
  }

  return (
    <figure className={`${styles.plan}${alignControlsWithViewTabs ? ` ${styles.withViewTabs}` : ""}`}>
      <div className={styles.dimensionControls}>
        <label className={styles.dimensionToggle}>
          <input type="checkbox" checked={showDimensions} disabled={!hasSite || !dimensionsAvailable}
            aria-describedby={!dimensionsAvailable ? `${id}-dimension-budget` : undefined}
            onChange={(event) => {
              const measured = svg.current?.getBoundingClientRect().width;
              if (measured && measured > 0) setDisplayWidth(measured);
              if (!event.target.checked) fitPlan();
              setDimensionsEnabled(event.target.checked);
            }} />
          Show dimensions
        </label>
        {!dimensionsAvailable && <p id={`${id}-dimension-budget`} className={styles.dimensionHelp} role="status">
          Dimensions are unavailable above the 250-edge display limit. The complete plan and calculated results are unchanged.
        </p>}
        {showDimensions && edges.length > 0 && <>
          <div className={styles.dimensionModes} role="group" aria-label="Dimension display">
            <button type="button" aria-pressed={!showAll} onClick={() => { setShowAll(false); fitPlan(); }}>Selected edge</button>
            <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>Show all</button>
            {showAll ? <button type="button" onClick={() => {
              if (expanded) fitPlan();
              else {
                const size = Math.max(enlargedWidth, Math.ceil((planViewport.current?.getBoundingClientRect().width || displayWidth) * 1.5));
                setExpandedWidth(size);
                setDisplayWidth(size);
              }
            }}>{expanded ? "Fit plan" : "Enlarge plan"}</button> : null}
          </div>
          <label className={styles.edgeSelector} htmlFor={`${id}-edge`}>Measure edge</label>
          <select id={`${id}-edge`} className={styles.edgeSelect} value={selectedEdge?.id ?? ""}
            aria-describedby={`${id}-dimension-help ${id}-measurement`}
            onChange={(event) => setSelectedEdgeId(event.target.value)}>
            {[...edgeGroups].map(([group, grouped]) => {
              const label = dimensionRingLabel(grouped[0]);
              return <optgroup key={group} label={label}>{grouped.map((edge) => (
                <option key={edge.id} value={edge.id}>{dimensionEdgeLabel(edge)} — {formatDimensionLength(edge.lengthM)}</option>
              ))}</optgroup>;
            })}
          </select>
        </>}
      </div>
      <div ref={planViewport} className={styles.planViewport} data-expanded={expanded}
        role={expanded ? "region" : undefined} aria-label={expanded ? "Scrollable dimension plan" : undefined}
        tabIndex={expanded ? 0 : undefined}>
      <svg
        ref={svg}
        className={styles.viewport}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={expanded ? { width: enlargedWidth } : undefined}
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
        {annotation && selectedEdge && <g className={styles.dimension} aria-hidden="true" data-dimensions="true">
          <line className={styles.measuredEdge} data-dimension-edge={selectedEdge.id}
            x1={annotation.from[0]} y1={annotation.from[1]} x2={annotation.to[0]} y2={annotation.to[1]}
            vectorEffect="non-scaling-stroke" />
          {annotation.extensionLines.map(([from, to], index) => (
            <line key={`extension-${index}`} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={annotation.lineFrom[0]} y1={annotation.lineFrom[1]} x2={annotation.lineTo[0]} y2={annotation.lineTo[1]}
            vectorEffect="non-scaling-stroke" />
          {annotation.ticks.map(([from, to], index) => (
            <line key={`tick-${index}`} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} vectorEffect="non-scaling-stroke" />
          ))}
          {!showAll && annotation.leader && <line x1={annotation.leader[0][0]} y1={annotation.leader[0][1]}
            x2={annotation.leader[1][0]} y2={annotation.leader[1][1]} vectorEffect="non-scaling-stroke" />}
          {annotation.shortEdge && <circle cx={(annotation.from[0] + annotation.to[0]) / 2} cy={(annotation.from[1] + annotation.to[1]) / 2}
            r={annotation.label.fontSize / 5} className={styles.edgeMarker} />}
          {!showAll && <><rect className={styles.dimensionBackground} x={annotation.label.x - annotation.label.width / 2}
            y={annotation.label.y - annotation.label.height / 2} width={annotation.label.width} height={annotation.label.height} rx={4} />
          <text className={styles.dimensionText} x={annotation.label.x} y={annotation.label.y} fontSize={annotation.label.fontSize}
            textAnchor="middle" dominantBaseline="middle">{annotation.label.text}</text></>}
        </g>}
        {showAll && overview && <g data-dimension-overview="true">
          {[...overview.annotations].sort((left, right) => Number(left.edge.id === selectedEdge?.id) - Number(right.edge.id === selectedEdge?.id)).map((item) => (
            <g key={item.edge.id} data-overview-dimension={item.edge.id} data-selected={item.edge.id === selectedEdge?.id}
              className={`${styles.overviewLabel} ${item.edge.layer === "site" ? styles.overviewSite : styles.overviewFootprint}`}
              onClick={() => setSelectedEdgeId(item.edge.id)}>
              <title>{dimensionEdgeLabel(item.edge)} — {item.label.text}</title>
              {item.leader && <line x1={item.leader[0][0]} y1={item.leader[0][1]} x2={item.leader[1][0]} y2={item.leader[1][1]}
                vectorEffect="non-scaling-stroke" />}
              <rect x={item.label.x - item.label.width / 2} y={item.label.y - item.label.height / 2}
                width={item.label.width} height={item.label.height} rx={3} vectorEffect="non-scaling-stroke" />
              <text x={item.label.x} y={item.label.y} fontSize={item.label.fontSize}
                textAnchor="middle" dominantBaseline="middle">{item.label.text}</text>
            </g>
          ))}
        </g>}
      </svg>
      </div>
      <figcaption>
        {showDimensions && <div className={styles.measurement}>
          <p id={`${id}-measurement`} aria-live="polite">{selectedEdge
            ? <><strong>{dimensionEdgeLabel(selectedEdge)}</strong>: {formatDimensionLength(selectedEdge.lengthM)}</>
            : "No boundary edges are available to measure."}</p>
          <p className={styles.dimensionHelp} id={`${id}-dimension-help`}>{showAll
            ? `${overview?.annotations.length ?? 0} of ${edges.length} edge dimensions shown. Choose an edge or click its label to highlight it.`
            : "Showing one edge at a time to keep the plan clear. Choose a site, footprint, or hole edge."} Measurements are for display only.</p>
          {showAll && overview?.crowded && <p className={styles.dimensionHelp}>Labels are crowded at this size. {expanded
            ? "Scroll to explore, or use Selected edge for a clear individual measurement."
            : "Enlarge the plan for more space, or use Selected edge for a clear individual measurement."}</p>}
          {expanded && <p className={styles.dimensionHelp}>Scroll within the enlarged plan. Fit plan returns to the full-site view.</p>}
          {showAll && overview?.unavailableIds.length ? <p className={styles.dimensionHelp}>Some labels cannot fit in this view. Enlarge the plan or select an individual edge to read its measurement.</p> : null}
          {!showAll && selectedEdge && !annotation && <p className={styles.dimensionHelp}>This edge cannot be annotated at the current display size. Its measurement is shown above.</p>}
        </div>}
        {legendLayers.length > 0 && (
          <ul className={styles.legend} aria-label="Site plan layers">
            {legendLayers.map((layer) => (
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
