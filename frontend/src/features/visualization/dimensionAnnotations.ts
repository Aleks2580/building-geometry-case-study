import type { PolygonGeometry } from "../../api/contracts";
import type { CoordinateTransform } from "./svgGeometry";

type Position = PolygonGeometry["coordinates"][number][number];
type Segment = [Position, Position];

// All-edge label placement evaluates many candidates per edge; gate the complete
// measurement set before allocating edges instead of silently dropping labels.
export const MAX_DIMENSION_EDGES = 250;

export function countDimensionEdges(...geometries: (PolygonGeometry | null | undefined)[]): number {
  return geometries.reduce((count, geometry) => count + (geometry?.coordinates.reduce(
    (sum, ring) => sum + Math.max(0, ring.length - 1), 0,
  ) ?? 0), 0);
}

export interface DimensionEdge {
  id: string;
  layer: "site" | "footprint";
  ringIndex: number;
  edgeIndex: number;
  from: Position;
  to: Position;
  lengthM: number | null;
}

export interface DimensionLayout {
  from: Position;
  to: Position;
  lineFrom: Position;
  lineTo: Position;
  extensionLines: Segment[];
  ticks: Segment[];
  leader: Segment | null;
  shortEdge: boolean;
  label: {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    fontSize: number;
  };
}

export interface OverviewDimension {
  edge: DimensionEdge;
  anchor: Position;
  label: DimensionLayout["label"];
  leader: Segment | null;
}

export function measureGeometryEdges(site: PolygonGeometry, footprint?: PolygonGeometry | null): DimensionEdge[] {
  const edges: DimensionEdge[] = [];
  for (const [layer, geometry] of [["site", site], ["footprint", footprint]] as const) {
    if (!geometry) continue;
    geometry.coordinates.forEach((ring, ringIndex) => {
      for (let edgeIndex = 0; edgeIndex + 1 < ring.length; edgeIndex++) {
        const from: Position = [...ring[edgeIndex]];
        const to: Position = [...ring[edgeIndex + 1]];
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        edges.push({
          id: `${layer}-${ringIndex}-${edgeIndex}`, layer, ringIndex, edgeIndex, from, to,
          lengthM: from.every(Number.isFinite) && to.every(Number.isFinite) && Number.isFinite(length) ? length : null,
        });
      }
    });
  }
  return edges;
}

export function dimensionRingLabel(edge: DimensionEdge): string {
  if (edge.layer === "site") return edge.ringIndex === 0 ? "Site boundary" : `Site hole ${edge.ringIndex}`;
  return edge.ringIndex === 0 ? "Building footprint" : `Footprint hole ${edge.ringIndex}`;
}

export function dimensionEdgeLabel(edge: DimensionEdge): string {
  return `${dimensionRingLabel(edge)} · edge ${edge.edgeIndex + 1}`;
}

const ordinaryLength = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatDimensionLength(lengthM: number | null): string {
  if (lengthM === null || !Number.isFinite(lengthM) || lengthM < 0) return "Not available";
  if (lengthM !== 0 && (lengthM < 0.01 || lengthM >= 1e6)) return `${lengthM.toExponential(2)} m`;
  return `${ordinaryLength.format(lengthM === 0 ? 0 : lengthM)} m`;
}

export function layoutDimension(
  edge: DimensionEdge,
  transform: CoordinateTransform,
  viewport: { width: number; height: number },
  clientWidth: number,
): DimensionLayout | null {
  const { width, height } = viewport;
  if (![width, height, clientWidth].every(Number.isFinite) || width <= 0 || height <= 0 || clientWidth <= 0
    || edge.lengthM === null || !Number.isFinite(edge.lengthM) || edge.lengthM < 0) return null;
  const from = transform(edge.from);
  const to = transform(edge.to);
  if (![...from, ...to].every(Number.isFinite)) return null;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const projectedLength = Math.hypot(dx, dy);
  const unitsPerPixel = width / clientWidth;
  if (!Number.isFinite(projectedLength) || !Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0) return null;
  const text = formatDimensionLength(edge.lengthM);
  const fontSize = 12 * unitsPerPixel;
  const labelWidth = (text.length * 12 * 0.62 + 12) * unitsPerPixel;
  const labelHeight = 22 * unitsPerPixel;
  const margin = 4 * unitsPerPixel;
  if (![fontSize, labelWidth, labelHeight, margin].every(Number.isFinite)
    || labelWidth + 2 * margin > width || labelHeight + 2 * margin > height) return null;
  const tangent: Position = projectedLength === 0 ? [1, 0] : [dx / projectedLength, dy / projectedLength];
  const normal: Position = [-tangent[1], tangent[0]];
  const midpoint: Position = [from[0] / 2 + to[0] / 2, from[1] / 2 + to[1] / 2];
  const offset = 14 * unitsPerPixel;
  const shortEdge = projectedLength < 12 * unitsPerPixel;
  const overflow = ([x, y]: Position) => Math.max(0, margin - x, x - width + margin)
    + Math.max(0, margin - y, y - height + margin);

  const candidates = ([1, -1] as const).map((side) => {
    const direction: Position = [normal[0] * side, normal[1] * side];
    const lineFrom: Position = [from[0] + direction[0] * offset, from[1] + direction[1] * offset];
    const lineTo: Position = [to[0] + direction[0] * offset, to[1] + direction[1] * offset];
    const desired: Position = [midpoint[0] + direction[0] * offset, midpoint[1] + direction[1] * offset];
    const labelPosition: Position = [
      Math.max(margin + labelWidth / 2, Math.min(width - margin - labelWidth / 2, desired[0])),
      Math.max(margin + labelHeight / 2, Math.min(height - margin - labelHeight / 2, desired[1])),
    ];
    const clampedDistance = Math.hypot(labelPosition[0] - desired[0], labelPosition[1] - desired[1]);
    const awayFromCentre = (midpoint[0] - width / 2) * direction[0] + (midpoint[1] - height / 2) * direction[1];
    return { direction, lineFrom, lineTo, labelPosition, clampedDistance,
      score: (overflow(lineFrom) + overflow(lineTo) + clampedDistance) * 1000 - awayFromCentre };
  });
  // One selected edge avoids a collision engine. Prefer an in-frame annotation;
  // when both sides fit, put it away from the plan centre to preserve site context.
  const chosen = candidates[0].score <= candidates[1].score ? candidates[0] : candidates[1];
  const { lineFrom, lineTo, labelPosition, direction } = chosen;
  const tickHalf = 3 * unitsPerPixel;
  const tickDirection: Position = [(tangent[0] + normal[0]) / Math.SQRT2, (tangent[1] + normal[1]) / Math.SQRT2];
  const ticks: Segment[] = [lineFrom, lineTo].map(([x, y]) => [
    [x - tickDirection[0] * tickHalf, y - tickDirection[1] * tickHalf],
    [x + tickDirection[0] * tickHalf, y + tickDirection[1] * tickHalf],
  ]);
  const extensionLines: Segment[] = [
    [from, [lineFrom[0] + direction[0] * tickHalf, lineFrom[1] + direction[1] * tickHalf]],
    [to, [lineTo[0] + direction[0] * tickHalf, lineTo[1] + direction[1] * tickHalf]],
  ];
  const leader: Segment | null = shortEdge ? [midpoint, labelPosition]
    : chosen.clampedDistance > 0 ? [[lineFrom[0] / 2 + lineTo[0] / 2, lineFrom[1] / 2 + lineTo[1] / 2], labelPosition] : null;
  const allPositions = [from, to, lineFrom, lineTo, labelPosition,
    ...ticks.flat(), ...extensionLines.flat(), ...(leader ?? [])];
  if (allPositions.some((point) => !point.every(Number.isFinite))) return null;
  return {
    from, to, lineFrom, lineTo, extensionLines, ticks, leader, shortEdge,
    label: { x: labelPosition[0], y: labelPosition[1], width: labelWidth, height: labelHeight, text, fontSize },
  };
}

export function layoutAllDimensions(
  edges: DimensionEdge[],
  transform: CoordinateTransform,
  viewport: { width: number; height: number },
  clientWidth: number,
): { annotations: OverviewDimension[]; crowded: boolean; unavailableIds: string[] } {
  const annotations: OverviewDimension[] = [];
  const unavailableIds: string[] = [];
  const unitsPerPixel = viewport.width / clientWidth;
  if (![viewport.width, viewport.height, clientWidth, unitsPerPixel].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || clientWidth <= 0 || unitsPerPixel <= 0) {
    return { annotations, crowded: false, unavailableIds: edges.map((edge) => edge.id) };
  }
  const margin = 4 * unitsPerPixel;
  const spacing = 2 * unitsPerPixel;
  const cellSize = 32 * unitsPerPixel;
  // Cell indices must advance when incremented; absurd finite display sizes can
  // otherwise exceed integer precision and make spatial iteration non-terminating.
  if (!Number.isFinite(cellSize) || cellSize <= 0
    || !Number.isSafeInteger(Math.ceil(viewport.width / cellSize))
    || !Number.isSafeInteger(Math.ceil(viewport.height / cellSize))) {
    return { annotations, crowded: false, unavailableIds: edges.map((edge) => edge.id) };
  }
  type Rectangle = { left: number; top: number; right: number; bottom: number };
  const placed: Rectangle[] = [];
  const cells = new Map<string, number[]>();
  let crowded = false;

  function bounds(x: number, y: number, width: number, height: number): Rectangle {
    return {
      left: x - width / 2 - spacing / 2, right: x + width / 2 + spacing / 2,
      top: y - height / 2 - spacing / 2, bottom: y + height / 2 + spacing / 2,
    };
  }

  function occupiedCells(rectangle: Rectangle): string[] {
    const keys: string[] = [];
    for (let x = Math.floor(rectangle.left / cellSize); x <= Math.floor(rectangle.right / cellSize); x++) {
      for (let y = Math.floor(rectangle.top / cellSize); y <= Math.floor(rectangle.bottom / cellSize); y++) keys.push(`${x}:${y}`);
    }
    return keys;
  }

  function overlap(rectangle: Rectangle): number {
    const nearby = new Set(occupiedCells(rectangle).flatMap((key) => cells.get(key) ?? []));
    let area = 0;
    for (const index of nearby) {
      const other = placed[index];
      area += (Math.max(0, Math.min(rectangle.right, other.right) - Math.max(rectangle.left, other.left)) / unitsPerPixel)
        * (Math.max(0, Math.min(rectangle.bottom, other.bottom) - Math.max(rectangle.top, other.top)) / unitsPerPixel);
    }
    return area;
  }

  for (const edge of edges) {
    const base = layoutDimension(edge, transform, viewport, clientWidth);
    if (!base) { unavailableIds.push(edge.id); continue; }
    const anchor: Position = [base.from[0] / 2 + base.to[0] / 2, base.from[1] / 2 + base.to[1] / 2];
    const length = Math.hypot(base.to[0] - base.from[0], base.to[1] - base.from[1]);
    const tangent: Position = length === 0 ? [1, 0] : [(base.to[0] - base.from[0]) / length, (base.to[1] - base.from[1]) / length];
    const normal: Position = [-tangent[1], tangent[0]];
    const width = base.label.width * 10 / 12;
    const height = base.label.height * 10 / 12;
    const desired: Position[] = [[base.label.x, base.label.y]];
    for (const lane of [10, 22, 36, 52, 70]) {
      for (const side of [1, -1]) {
        for (const shift of [0, -12, 12, -24, 24, -40, 40, -64, 64]) {
          desired.push([
            anchor[0] + (normal[0] * lane * side + tangent[0] * shift) * unitsPerPixel,
            anchor[1] + (normal[1] * lane * side + tangent[1] * shift) * unitsPerPixel,
          ]);
        }
      }
    }
    const candidates = desired.map(([desiredX, desiredY]) => {
      const x = Math.max(margin + width / 2, Math.min(viewport.width - margin - width / 2, desiredX));
      const y = Math.max(margin + height / 2, Math.min(viewport.height - margin - height / 2, desiredY));
      const rectangle = bounds(x, y, width, height);
      const obscuresAnchor = anchor[0] >= rectangle.left && anchor[0] <= rectangle.right
        && anchor[1] >= rectangle.top && anchor[1] <= rectangle.bottom;
      return { x, y, rectangle, obscuresAnchor, overlap: overlap(rectangle), distance: Math.hypot(x - anchor[0], y - anchor[1]) };
    });
    // Preserve every edge even when a finite viewport cannot fit all labels.
    // Enlarge/selected-edge controls handle crowding; never turn this into a cap
    // or deduplication pass that silently loses short, coincident, or hole edges.
    const chosen = candidates.reduce((best, candidate) => candidate.overlap < best.overlap
      || (candidate.overlap === best.overlap && Number(candidate.obscuresAnchor) < Number(best.obscuresAnchor))
      || (candidate.overlap === best.overlap && candidate.obscuresAnchor === best.obscuresAnchor && candidate.distance < best.distance) ? candidate : best);
    // Ignore only floating-point contact between the 2 CSS px spacing boxes.
    if (chosen.overlap > 1e-6 || chosen.obscuresAnchor) crowded = true;
    const index = placed.push(chosen.rectangle) - 1;
    for (const key of occupiedCells(chosen.rectangle)) {
      const cell = cells.get(key);
      if (cell) cell.push(index);
      else cells.set(key, [index]);
    }
    const label = { ...base.label, x: chosen.x, y: chosen.y, width, height, fontSize: 10 * unitsPerPixel };
    const anchorInside = anchor[0] >= label.x - width / 2 && anchor[0] <= label.x + width / 2
      && anchor[1] >= label.y - height / 2 && anchor[1] <= label.y + height / 2;
    annotations.push({ edge, anchor, label, leader: anchorInside ? null : [anchor, [label.x, label.y]] });
  }
  return { annotations, crowded, unavailableIds };
}
