import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { PolygonGeometry } from "../../api/contracts";
import { clientToViewportPosition, createViewportMapping, geometryPath } from "../visualization/svgGeometry";
import { closeExteriorRing, drawingGrid, drawingViewport as viewport, type DrawingExtent, type SitePosition } from "./siteDrawing";
import styles from "./CustomSiteEditor.module.css";

interface SiteDrawingCanvasProps {
  points: SitePosition[];
  geometry: PolygonGeometry | null;
  drawing: boolean;
  selectedIndex: number | null;
  extent: DrawingExtent;
  onPlace: (point: SitePosition) => void;
  onSelect: (index: number) => void;
  onFinish: () => void;
  onMoveStart: () => void;
  onMove: (index: number, point: SitePosition) => void;
  onMoveEnd: () => void;
  onMoveCancel: () => void;
}

interface Gesture {
  pointerId: number;
  start: SitePosition;
  vertex: number | null;
  dragging: boolean;
}

const formatCoordinate = (value: number, step: number) => {
  const digits = Math.min(15, Math.max(2, Math.ceil(Math.log10(Math.abs(value) / step || 1)) + 2));
  const text = new Intl.NumberFormat("en", { maximumSignificantDigits: digits }).format(value);
  return text.length > 6 ? value.toExponential(digits - 1) : text;
};

export default function SiteDrawingCanvas({ points, geometry, drawing, selectedIndex, extent,
  onPlace, onSelect, onFinish, onMoveStart, onMove, onMoveEnd, onMoveCancel,
}: SiteDrawingCanvasProps) {
  const id = useId();
  const surface = useRef<SVGSVGElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [cursor, setCursor] = useState<SitePosition | null>(null);
  const bounds = { minX: extent.minX, minY: extent.minY, maxX: extent.minX + extent.size, maxY: extent.minY + extent.size };
  const mapping = createViewportMapping(bounds, viewport)!;
  const grid = drawingGrid(extent);
  const xOrigin = Math.abs(bounds.minX) > extent.size * 100 ? bounds.minX : 0;
  const yOrigin = Math.abs(bounds.minY) > extent.size * 100 ? bounds.minY : 0;
  const path = geometry && geometryPath(geometry, mapping.toViewport);
  const canFinish = drawing && closeExteriorRing(points) !== null;
  const polyline = (positions: SitePosition[]) => positions.map((point) => mapping.toViewport(point).join(",")).join(" ");

  const resetPointer = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.dragging) onMoveCancel();
    if (current && container.current?.hasPointerCapture?.(current.pointerId)) container.current.releasePointerCapture(current.pointerId);
    setCursor(null);
  }, [onMoveCancel]);

  useEffect(() => {
    // Scrolling can move the canvas away from a stationary pointer without a
    // pointermove. Capture scrolls from nested containers as well as the window.
    window.addEventListener("scroll", resetPointer, true);
    window.addEventListener("blur", resetPointer);
    return () => {
      window.removeEventListener("scroll", resetPointer, true);
      window.removeEventListener("blur", resetPointer);
    };
  }, [resetPointer]);

  function position(event: PointerEvent<HTMLDivElement>, allowMargin = false): { model: SitePosition; screen: SitePosition; scale: number } | null {
    const rect = surface.current!.getBoundingClientRect();
    const screen = clientToViewportPosition([event.clientX, event.clientY], rect, viewport);
    if (!screen || (!allowMargin && screen.some((value) => value < viewport.padding || value > viewport.width - viewport.padding))) return null;
    return { model: mapping.toModel(screen), screen, scale: Math.min(rect.width / viewport.width, rect.height / viewport.height) };
  }

  function vertexAt(screen: SitePosition, scale: number, pointerType: string): number | null {
    const radius = pointerType === "touch" ? 24 : 16;
    let nearest: number | null = null;
    let distance = radius;
    points.forEach((point, index) => {
      const projected = mapping.toViewport(point);
      const candidate = Math.hypot(projected[0] - screen[0], projected[1] - screen[1]) * scale;
      if (candidate < distance) { nearest = index; distance = candidate; }
    });
    return nearest;
  }

  return <><div ref={container} className={styles.canvas}
      onWheel={resetPointer} onPointerCancel={resetPointer}
      onPointerLeave={resetPointer} onLostPointerCapture={resetPointer}
      onPointerDown={(event) => {
        if (event.isPrimary === false || event.button !== 0 || gesture.current) return;
        const hit = position(event, true);
        if (!hit) return;
        const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-handle]") : null;
        const handleIndex = handle ? Number(handle.dataset.handle) : null;
        const vertex = vertexAt(hit.screen, hit.scale, event.pointerType)
          ?? (handleIndex !== null && Number.isInteger(handleIndex) && handleIndex >= 0 && handleIndex < points.length ? handleIndex : null);
        if (vertex === null && !position(event)) return;
        gesture.current = { pointerId: event.pointerId, start: [event.clientX, event.clientY], vertex, dragging: false };
        surface.current?.focus({ preventScroll: true });
        // Only vertex gestures capture the pointer. Empty-canvas touch gestures
        // retain native vertical scrolling and must never turn into point drags.
        if (vertex !== null) {
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        const hit = position(event, current?.vertex !== null && current?.vertex !== undefined);
        if (!hit) { resetPointer(); return; }
        if (current && current.pointerId === event.pointerId && current.vertex !== null) {
          if (!current.dragging && Math.hypot(event.clientX - current.start[0], event.clientY - current.start[1]) >= 5) {
            current.dragging = true;
            onMoveStart();
            onSelect(current.vertex);
          }
          if (current.dragging) { setCursor(null); onMove(current.vertex, hit.model); return; }
        }
        setCursor(drawing && event.pointerType !== "touch" ? hit.model : null);
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        const hit = position(event, current?.vertex !== null && current?.vertex !== undefined);
        if (!current || current.pointerId !== event.pointerId) return;
        gesture.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setCursor(null);
        if (!hit) { if (current.dragging) onMoveCancel(); return; }
        if (current.dragging) { onMove(current.vertex!, hit.model); onMoveEnd(); return; }
        if (Math.hypot(event.clientX - current.start[0], event.clientY - current.start[1]) > 8) return;
        if (current.vertex === 0 && canFinish) onFinish();
        else if (current.vertex !== null) onSelect(current.vertex);
        else if (drawing) onPlace(hit.model);
      }}>
    <svg ref={surface} viewBox="0 0 400 400" width={400} height={400} preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Site polygon drawing area" tabIndex={0} aria-describedby={`${id}-instructions`}
      aria-keyshortcuts="Enter Escape" onBlur={resetPointer}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" && drawing) {
          event.preventDefault();
          const activeGesture = gesture.current !== null;
          resetPointer();
          if (!activeGesture) onFinish();
        }
        if (event.key === "Escape") { event.preventDefault(); resetPointer(); }
      }}>
      <desc id={`${id}-instructions`}>
        {drawing ? "Click or tap to add points. Click the starting point or press Enter here to finish. " : "Select a point to edit it. "}
        Drag a point to move it, or use the point selector and exact X/Y inputs below. Larger Y coordinates point upward.
      </desc>
      <defs><clipPath id={`${id}-clip`}><rect x={40} y={40} width={320} height={320} /></clipPath></defs>
      <rect x={40} y={40} width={320} height={320} className={styles.gridBoundary} />
      {grid?.x.map((value, index) => {
        const [screen] = mapping.toViewport([value, bounds.minY]);
        return <g key={`x-${value}`} className={styles.grid}>
          <line x1={screen} x2={screen} y1={40} y2={360} />
          {index % 2 === 0 && <text x={screen} y={387} textAnchor={screen < 70 ? "start" : screen > 330 ? "end" : "middle"}>{formatCoordinate(value - xOrigin, grid.step)}</text>}
        </g>;
      })}
      {grid?.y.map((value, index) => {
        const [, screen] = mapping.toViewport([bounds.minX, value]);
        return <g key={`y-${value}`} className={styles.grid}>
          <line x1={40} x2={360} y1={screen} y2={screen} />
          {index % 2 === 0 && <text x={34} y={screen} textAnchor="end" dominantBaseline="middle" textLength={formatCoordinate(value - yOrigin, grid.step).length > 3 ? 32 : undefined} lengthAdjust="spacingAndGlyphs">{formatCoordinate(value - yOrigin, grid.step)}</text>}
        </g>;
      })}
      <g clipPath={`url(#${id}-clip)`}>
        {!drawing && path && <path className={styles.outline} d={path} fillRule="evenodd" vectorEffect="non-scaling-stroke" />}
        {drawing && <polyline className={styles.line} points={polyline(points)} vectorEffect="non-scaling-stroke" />}
        {drawing && points.length > 0 && cursor && <polyline data-testid="next-segment" className={styles.next}
          points={polyline([points[points.length - 1], cursor])} vectorEffect="non-scaling-stroke" />}
        {points.map((point, index) => {
          const [cx, cy] = mapping.toViewport(point);
          if (![cx, cy].every(Number.isFinite)) return null;
          return <g key={index} data-vertex={index}>
            <circle cx={cx} cy={cy} r={index === 0 && canFinish ? 8 : 6}
              className={`${styles.vertex} ${index === selectedIndex ? styles.selectedVertex : ""} ${index === 0 && canFinish ? styles.startVertex : ""}`} />
          </g>;
        })}
      </g>
    </svg>
    {/* HTML hit areas prevent Chrome from treating a vertex drag as SVG page
        scrolling. Keep the empty SVG scrollable rather than disabling touch globally. */}
    {points.map((point, index) => {
      const [x, y] = mapping.toViewport(point);
      if (![x, y].every(Number.isFinite) || x < 40 || x > 360 || y < 40 || y > 360) return null;
      return <span key={index} aria-hidden="true" data-handle={index} className={styles.vertexTarget}
        style={{ left: `${x / 4}%`, top: `${y / 4}%` }}
        title={index === 0 && canFinish ? "Click to finish polygon" : `Point ${index + 1}: drag to move`} />;
    })}
    </div>
    {(xOrigin !== 0 || yOrigin !== 0) && <p className={styles.hint}>
      Grid origin: X {xOrigin} m · Y {yOrigin} m. Labels show distances from this origin.
    </p>}
  </>;
}
