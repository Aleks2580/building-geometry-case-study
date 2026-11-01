import type { PolygonGeometry } from "../../api/contracts";
import { createViewportMapping } from "../visualization/svgGeometry";

export type SitePosition = PolygonGeometry["coordinates"][number][number];
export type DrawingExtent = { minX: number; minY: number; size: number };

export const defaultDrawingExtent: DrawingExtent = { minX: 0, minY: 0, size: 60 };
export const drawingViewport = { width: 400, height: 400, padding: 40 };

export function closeExteriorRing(points: SitePosition[]): PolygonGeometry | null {
  if (points.some((point) => !point.every(Number.isFinite))) return null;
  const distinct = new Set(points.map(([x, y]) => JSON.stringify([x, y])));
  if (distinct.size < 3) return null;
  const ring = points.map(([x, y]): SitePosition => [x, y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (last[0] !== first[0] || last[1] !== first[1]) ring.push([...first]);
  return { type: "Polygon", coordinates: [ring] };
}

export function replaceExteriorRing(geometry: PolygonGeometry, points: SitePosition[]): PolygonGeometry | null {
  const exterior = closeExteriorRing(points);
  if (!exterior) return null;
  return {
    type: "Polygon",
    coordinates: [
      exterior.coordinates[0],
      ...geometry.coordinates.slice(1).map((ring) => ring.map(([x, y]): SitePosition => [x, y])),
    ],
  };
}

export function fitDrawingPoints(points: SitePosition[]): DrawingExtent | null {
  if (points.length === 0 || points.some((point) => !point.every(Number.isFinite))) return null;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const size = span === 0 ? 10 : span * 1.2;
  const minX = bounds.minX - (size - (bounds.maxX - bounds.minX)) / 2;
  const minY = bounds.minY - (size - (bounds.maxY - bounds.minY)) / 2;
  if (![size, minX, minY, minX + size, minY + size].every(Number.isFinite)
    || size <= 0 || minX + size <= minX || minY + size <= minY) return null;
  if (!createViewportMapping({ minX, minY, maxX: minX + size, maxY: minY + size }, drawingViewport)) return null;
  return { minX, minY, size };
}

export function fitDrawingExtent(geometry: PolygonGeometry): DrawingExtent | null {
  return fitDrawingPoints(geometry.coordinates.flat());
}

export function drawingGrid(extent: DrawingExtent): { step: number; x: number[]; y: number[] } | null {
  const { minX, minY, size } = extent;
  const maxX = minX + size;
  const maxY = minY + size;
  if (!createViewportMapping({ minX, minY, maxX, maxY }, drawingViewport)) return null;
  const magnitude = 10 ** Math.floor(Math.log10(size / 6));
  const candidates = [1, 2, 5, 10].map((factor) => factor * magnitude);
  const step = candidates.reduce((best, candidate) =>
    Math.abs(size / candidate - 6) < Math.abs(size / best - 6) ? candidate : best);
  if (!Number.isFinite(step) || step <= 0) return null;

  function ticks(min: number, max: number): number[] | null {
    const first = Math.ceil(min / step) * step;
    const count = Math.floor((max - first) / step) + 1;
    if (!Number.isFinite(first) || !Number.isFinite(count) || count < 0 || count > 10) return null;
    const positions = Array.from({ length: count }, (_, index) => first + index * step)
      .filter((value) => value >= min && value <= max);
    if (positions.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= positions[index - 1]))) return null;
    return positions;
  }

  const x = ticks(minX, maxX);
  const y = ticks(minY, maxY);
  return x && y ? { step, x, y } : null;
}
