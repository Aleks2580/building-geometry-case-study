import type { MultiPolygonGeometry, PolygonGeometry } from "../../api/contracts";

type DisplayGeometry = PolygonGeometry | MultiPolygonGeometry;
type Position = PolygonGeometry["coordinates"][number][number];

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type Viewport = {
  width: number;
  height: number;
  padding: number;
};

export type CoordinateTransform = (position: Position) => Position;

export function geometryBounds(geometry: DisplayGeometry): Bounds | null {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX >= maxX || minY >= maxY) return null;
  return { minX, minY, maxX, maxY };
}

export function createViewportTransform(
  bounds: Bounds,
  { width, height, padding }: Viewport,
): CoordinateTransform | null {
  const innerWidth = width - 2 * padding;
  const innerHeight = height - 2 * padding;
  if (
    ![width, height, padding].every(Number.isFinite)
    || width <= 0 || height <= 0 || padding < 0
    || innerWidth <= 0 || innerHeight <= 0
  ) {
    throw new RangeError("Viewport dimensions must be finite and positive, with non-negative padding leaving a positive interior.");
  }

  const geometryWidth = bounds.maxX - bounds.minX;
  const geometryHeight = bounds.maxY - bounds.minY;
  if (
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, geometryWidth, geometryHeight]
      .every(Number.isFinite)
    || geometryWidth <= 0 || geometryHeight <= 0
  ) return null;

  const scale = Math.min(innerWidth / geometryWidth, innerHeight / geometryHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const offsetX = padding + (innerWidth - geometryWidth * scale) / 2;
  const offsetY = padding + (innerHeight - geometryHeight * scale) / 2;

  // Every layer must reuse the original site's frame; fitting each layer separately
  // would misrepresent setbacks and move the building relative to its site.
  return ([x, y]) => [
    offsetX + (x - bounds.minX) * scale,
    offsetY + (bounds.maxY - y) * scale,
  ];
}

export function geometryPath(geometry: DisplayGeometry, transform: CoordinateTransform): string {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const subpaths: string[] = [];

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length === 0) continue;
      const commands: string[] = [];
      for (const [index, position] of ring.entries()) {
        if (!position.every(Number.isFinite)) return "";
        const [x, y] = transform(position);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
        commands.push(`${index === 0 ? "M" : "L"}${x} ${y}`);
      }
      subpaths.push(`${commands.join(" ")} Z`);
    }
  }

  return subpaths.join(" ");
}
