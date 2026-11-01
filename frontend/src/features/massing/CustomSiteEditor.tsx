import { useEffect, useId, useRef, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { createViewportMapping } from "../visualization/svgGeometry";
import { requiredNumberDraft, siteInputSchema } from "./configuration";
import {
  closeExteriorRing, defaultDrawingExtent, drawingGrid, drawingViewport as viewport,
  fitDrawingPoints, replaceExteriorRing, type DrawingExtent, type SitePosition,
} from "./siteDrawing";
import SiteDrawingCanvas from "./SiteDrawingCanvas";
import styles from "./CustomSiteEditor.module.css";

interface EditorSnapshot {
  json: string;
  points: SitePosition[] | null;
  selectedIndex: number | null;
}

const displayNumber = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 5 }).format(value);

export default function CustomSiteEditor({ value, onChange, jsonField, error }: {
  value: string;
  onChange: (json: string) => void;
  jsonField: UseFormRegisterReturn<"site.json">;
  error?: string;
}) {
  const id = useId();
  const [mode, setMode] = useState<"draw" | "json">("draw");
  const [points, setPoints] = useState<SitePosition[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<EditorSnapshot[]>([]);
  const dragBefore = useRef<EditorSnapshot | null>(null);
  const dragChanged = useRef(false);
  const [extent, setExtent] = useState(defaultDrawingExtent);
  const [viewDraft, setViewDraft] = useState({ minX: "0", minY: "0", size: "60" });
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [pointError, setPointError] = useState("");
  const [viewError, setViewError] = useState("");
  const [notice, setNotice] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const rangeDetails = useRef<HTMLDetailsElement>(null);
  const parsed = siteInputSchema.safeParse({ kind: "custom", json: value });
  const geometry = parsed.success ? parsed.data : null;
  const drawing = points !== null;
  const activePoints = points ?? geometry?.coordinates[0].slice(0, -1) ?? [];
  const allPoints = drawing ? activePoints : geometry?.coordinates.flat() ?? [];
  const fit = fitDrawingPoints(allPoints);
  const grid = drawingGrid(extent);
  const bounds = { minX: extent.minX, minY: extent.minY, maxX: extent.minX + extent.size, maxY: extent.minY + extent.size };
  const outsideView = allPoints.some(([x, y]) => x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY);
  const segments = activePoints.slice(1).map((point, index) => [activePoints[index], point]);
  if (!drawing && activePoints.length > 2) segments.push([activePoints[activePoints.length - 1], activePoints[0]]);

  useEffect(() => {
    if (error && mode === "draw") panel.current?.focus();
  }, [error, mode]);

  function snapshot(): EditorSnapshot {
    return { json: value, points: points === null ? null : structuredClone(points), selectedIndex };
  }

  function remember(previous = snapshot()) {
    // One entry per user operation (including a whole drag), bounded to avoid
    // retaining unlimited copies of imported polygons. JSON uses native text undo.
    setHistory((entries) => [...entries.slice(-49), previous]);
  }

  function selectPoint(index: number | null, positions = activePoints) {
    setSelectedIndex(index);
    const point = index === null ? undefined : positions[index];
    setX(point ? String(point[0]) : "");
    setY(point ? String(point[1]) : "");
    setPointError("");
  }

  function restore(previous: EditorSnapshot) {
    onChange(previous.json);
    setPoints(previous.points);
    const parsedPrevious = siteInputSchema.safeParse({ kind: "custom", json: previous.json });
    selectPoint(previous.selectedIndex, previous.points ?? (parsedPrevious.success ? parsedPrevious.data.coordinates[0].slice(0, -1) : []));
  }

  function cancelDrag() {
    const previous = dragBefore.current;
    dragBefore.current = null;
    dragChanged.current = false;
    if (previous) restore(previous);
  }

  function changeMode(next: "draw" | "json") {
    cancelDrag();
    setMode(next);
  }

  function changeExtent(next: DrawingExtent) {
    cancelDrag();
    setExtent(next);
    setViewDraft({ minX: String(next.minX), minY: String(next.minY), size: String(next.size) });
    setViewError("");
  }

  function applyExtent() {
    const minX = requiredNumberDraft.safeParse(viewDraft.minX);
    const minY = requiredNumberDraft.safeParse(viewDraft.minY);
    const size = requiredNumberDraft.safeParse(viewDraft.size);
    if (!minX.success || !minY.success || !size.success || size.data <= 0
      || !createViewportMapping({ minX: minX.data, minY: minY.data, maxX: minX.data + size.data, maxY: minY.data + size.data }, viewport)) {
      setViewError("Enter finite view coordinates and a positive span that can be displayed.");
      return;
    }
    changeExtent({ minX: minX.data, minY: minY.data, size: size.data });
  }

  function startDrawing() {
    remember();
    // Clear the form-owned geometry before accepting unfinished vertices. A new
    // outline must never leave the previous valid polygon available to submit/save.
    onChange("");
    setPoints([]);
    selectPoint(null);
    setNotice("New drawing started. The previous site can be restored with Undo.");
  }

  function addPoint(point: SitePosition) {
    if (points === null) return;
    if (points.some(([x, y]) => x === point[0] && y === point[1])) {
      setPointError("This point already exists. Use Finish Polygon to close the outline.");
      return;
    }
    remember();
    setPoints([...points, point]);
    selectPoint(null);
    setNotice("");
  }

  function writePoints(next: SitePosition[]): boolean {
    if (new Set(next.map((point) => JSON.stringify(point))).size !== next.length) {
      setPointError("Each point needs a different position.");
      return false;
    }
    if (drawing) setPoints(next);
    else {
      const updated = geometry && replaceExteriorRing(geometry, next);
      if (!updated) { setPointError("A finished polygon needs at least three distinct points."); return false; }
      // Finished edits go straight to RHF, including during a drag. This keeps
      // dirty/save guards current instead of retaining a second live polygon copy.
      onChange(JSON.stringify(updated));
    }
    setPointError("");
    return true;
  }

  function enteredPoint(): SitePosition | null {
    const parsedX = requiredNumberDraft.safeParse(x);
    const parsedY = requiredNumberDraft.safeParse(y);
    if (!parsedX.success || !parsedY.success) {
      setPointError("Enter finite decimal X and Y coordinates in metres.");
      return null;
    }
    return [parsedX.data, parsedY.data];
  }

  function applyPoint() {
    const point = enteredPoint();
    if (!point) return;
    if (selectedIndex === null) { addPoint(point); return; }
    const current = activePoints[selectedIndex];
    if (current && current[0] === point[0] && current[1] === point[1]) {
      setPointError("");
      setNotice("Point unchanged.");
      return;
    }
    const previous = snapshot();
    if (writePoints(activePoints.map((position, index) => index === selectedIndex ? point : position))) {
      remember(previous);
      setNotice(`Point ${selectedIndex + 1} updated.`);
    }
  }

  function deletePoint() {
    if (selectedIndex === null || (!drawing && activePoints.length <= 3)) return;
    const previous = snapshot();
    if (writePoints(activePoints.filter((_, index) => index !== selectedIndex))) {
      remember(previous);
      selectPoint(null);
      setNotice("Point deleted. Undo restores it.");
    }
  }

  function finishPolygon() {
    const polygon = points && closeExteriorRing(points);
    if (!polygon) { setPointError("Place at least three distinct points before finishing the polygon."); return; }
    remember();
    onChange(JSON.stringify(polygon));
    setPoints(null);
    selectPoint(null);
    setNotice("Polygon finished. Generate Preview to check the site and create the building.");
  }

  return <div className={styles.editor} ref={panel} tabIndex={-1} role="group" aria-label="Custom polygon editor"
    aria-describedby={error ? `${id}-error` : undefined}>
    <div className={styles.actions} role="group" aria-label="Custom site input method">
      <button type="button" aria-pressed={mode === "draw"} onClick={() => changeMode("draw")}>Draw polygon</button>
      <button type="button" aria-pressed={mode === "json"} onClick={() => changeMode("json")}>Advanced JSON</button>
    </div>
    {mode === "draw" ? <>
      <p className={styles.hint}>{drawing
        ? "Tap to add points. Tap the starting point or choose Finish Polygon when the outline is ready."
        : geometry ? "Select or drag a point to adjust the outline. Generate Preview when you are ready." : "Start a drawing, then tap the grid to trace your site."}</p>
      <div className={styles.scaleControls}>
        <label>View scale
          <select value={[50, 60, 100, 200, 500].includes(extent.size) ? String(extent.size) : "custom"}
            onChange={(event) => {
              if (event.target.value === "custom" && rangeDetails.current) {
                rangeDetails.current.open = true;
                rangeDetails.current.querySelector("input")?.focus();
              }
              else changeExtent({ ...extent, size: Number(event.target.value) });
            }}>
            <option value="custom">Custom range</option>
            {[50, 60, 100, 200, 500].map((size) => <option key={size} value={size}>{size} × {size} m</option>)}
          </select>
        </label>
        <button type="button" disabled={!fit} onClick={() => { if (fit) changeExtent(fit); }}>Fit Drawing</button>
      </div>
      <p className={styles.hint}>Visible: {displayNumber(extent.size)} × {displayNumber(extent.size)} m. This is the view, not a site-size limit.</p>
      <SiteDrawingCanvas points={activePoints} geometry={geometry} drawing={drawing} selectedIndex={selectedIndex} extent={extent}
        onPlace={addPoint} onSelect={selectPoint} onFinish={finishPolygon}
        onMoveStart={() => { dragBefore.current = snapshot(); dragChanged.current = false; }}
        onMove={(index, point) => {
          const previous = activePoints[index];
          if (previous && previous[0] === point[0] && previous[1] === point[1]) return;
          if (writePoints(activePoints.map((position, vertex) => vertex === index ? point : position))) {
            dragChanged.current = true;
            setSelectedIndex(index); setX(String(point[0])); setY(String(point[1]));
          }
        }}
        onMoveEnd={() => {
          if (dragBefore.current && dragChanged.current) {
            remember(dragBefore.current);
            setNotice("Point moved. Undo restores its previous position.");
          }
          dragBefore.current = null;
          dragChanged.current = false;
        }}
        onMoveCancel={cancelDrag} />
      <div className={styles.actions}>
        {drawing && <button type="button" className={styles.primary} onClick={finishPolygon}>Finish Polygon</button>}
        <button type="button" disabled={history.length === 0} onClick={() => {
          const previous = history[history.length - 1];
          if (!previous) return;
          restore(previous);
          setHistory(history.slice(0, -1));
          setNotice("Last change undone.");
        }}>Undo</button>
        <button type="button" onClick={startDrawing}>{drawing ? "Clear and restart" : value ? "Replace polygon and draw" : "Start drawing"}</button>
      </div>
      <p className={styles.state} role="status">{drawing
        ? `Drawing unfinished: ${activePoints.length} points. Finish before generating a preview.`
        : geometry ? `Polygon ready · ${activePoints.length} points` : "No polygon yet"}</p>
      {grid && <p className={styles.hint}>Grid: {displayNumber(grid.step)} m per cell · X → · Y ↑</p>}
      {outsideView && <p className={styles.hint}>Some points are outside this view. Choose Fit Drawing to see them all.</p>}
      {geometry && geometry.coordinates.length > 1 && <p className={styles.hint}>
        {geometry.coordinates.length - 1} interior holes are preserved. Use Advanced JSON to edit holes.
      </p>}
      {activePoints.length > 0 && <label className={styles.pointSelector}>Selected point
        <select value={selectedIndex ?? ""} onChange={(event) => selectPoint(event.target.value === "" ? null : Number(event.target.value))}>
          <option value="">{drawing ? "Add points" : "Select a point to edit"}</option>
          {activePoints.map((_, index) => <option key={index} value={index}>Point {index + 1}</option>)}
        </select>
      </label>}
      {(drawing || selectedIndex !== null) && <div className={styles.pointEntry} role="group" aria-label="Site point coordinates"
        aria-describedby={pointError ? `${id}-point-error` : undefined}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); applyPoint(); }
        }}>
        <label>X (m)<input type="text" inputMode="decimal" value={x} onChange={(event) => setX(event.target.value)} /></label>
        <label>Y (m)<input type="text" inputMode="decimal" value={y} onChange={(event) => setY(event.target.value)} /></label>
        <button type="button" onClick={applyPoint}>{selectedIndex === null ? "Add point" : "Update point"}</button>
        {selectedIndex !== null && <>
          <button type="button" disabled={!drawing && activePoints.length <= 3} onClick={deletePoint}>Delete point</button>
          {drawing && <button type="button" onClick={() => selectPoint(null)}>Continue drawing</button>}
        </>}
        <p className={styles.hint}>Exact coordinates in metres. No snapping. You can enter points outside the view.</p>
      </div>}
      {pointError && <p className={styles.error} id={`${id}-point-error`} role="alert">{pointError}</p>}
      <details ref={rangeDetails} className={styles.details}>
        <summary id={`${id}-extent`} tabIndex={0}>Custom view range</summary>
        <p className={styles.hint}>Change the view without moving any points. Coordinates stay unchanged.</p>
        <div className={styles.viewInputs} onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); applyExtent(); }
        }}>
          <label>View minimum X (m)<input value={viewDraft.minX} inputMode="decimal" onChange={(event) => setViewDraft({ ...viewDraft, minX: event.target.value })} /></label>
          <label>View minimum Y (m)<input value={viewDraft.minY} inputMode="decimal" onChange={(event) => setViewDraft({ ...viewDraft, minY: event.target.value })} /></label>
          <label>View span (m)<input value={viewDraft.size} inputMode="decimal" onChange={(event) => setViewDraft({ ...viewDraft, size: event.target.value })} /></label>
        </div>
        <button type="button" onClick={applyExtent}>Apply range</button>
        {viewError && <p className={styles.error} role="alert">{viewError}</p>}
      </details>
      {segments.length > 0 && <details className={styles.details}>
        <summary>Segment lengths ({segments.length})</summary>
        <ol className={styles.segments}>{segments.map(([from, to], index) => <li key={index}>
          Edge {index + 1}: {displayNumber(Math.hypot(to[0] - from[0], to[1] - from[1]))} m
        </li>)}</ol>
      </details>}
      <p className={styles.hint}>Starting a replacement clears the outline and any holes. Undo restores the previous site.</p>
    </> : <div className={styles.json}>
      <label htmlFor={`${id}-json`}>Site Polygon JSON</label>
      <textarea {...jsonField} id={`${id}-json`} rows={12} spellCheck={false} value={value}
        aria-required="true" aria-invalid={Boolean(error)} aria-describedby={`${id}-json-hint${error ? ` ${id}-error` : ""}`}
        onChange={(event) => {
          setNotice(points !== null ? "JSON editing replaced the unfinished drawing." : "Polygon JSON updated.");
          setPoints(null); selectPoint(null); setHistory([]); onChange(event.target.value);
        }} />
      <p className={styles.hint} id={`${id}-json-hint`}>
        Local coordinates in metres. Use a GeoJSON Polygon with closed [x, y] rings:
        the first ring is the boundary; subsequent rings are holes. Geometry validity is checked by the backend.
      </p>
      {points !== null && <p className={styles.hint}>The unfinished drawing is kept in Draw polygon. Editing JSON replaces it.</p>}
    </div>}
    {error && <p className={styles.error} id={`${id}-error`} role="alert">{drawing ? "Finish the polygon before generating a preview." : error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </div>;
}
