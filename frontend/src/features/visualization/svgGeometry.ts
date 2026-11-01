import type { MultiPolygonGeometry, PolygonGeometry } from "../../api/contracts";

type DisplayGeometry = PolygonGeometry | MultiPolygonGeometry;
type Position = PolygonGeometry["coordinates"][number][number];

// Bound SVG work without simplifying backend geometry. Closing positions count
// because geometryPath emits them, and repeated layers each create their own path.
export const MAX_SVG_VERTICES = 10_000;

export function countSvgVertices(...geometries: (DisplayGeometry | null | undefined)[]): number {
  let count = 0;
  for (const geometry of geometries) {
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) count += ring.length;
    }
  }
  return count;
}

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

export type ViewportMapping = {
  toViewport: CoordinateTransform;
  toModel: CoordinateTransform;
  scale: number;
};

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
  viewport: Viewport,
): CoordinateTransform | null {
  return createViewportMapping(bounds, viewport)?.toViewport ?? null;
}

export function createViewportMapping(
  bounds: Bounds,
  { width, height, padding }: Viewport,
): ViewportMapping | null {
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
  return {
    toViewport: ([x, y]) => [
      offsetX + (x - bounds.minX) * scale,
      offsetY + (bounds.maxY - y) * scale,
    ],
    toModel: ([x, y]) => [
      bounds.minX + (x - offsetX) / scale,
      bounds.maxY - (y - offsetY) / scale,
    ],
    scale,
  };
}

export function clientToViewportPosition(
  [clientX, clientY]: Position,
  rect: { left: number; top: number; width: number; height: number },
  viewport: Pick<Viewport, "width" | "height">,
): Position | null {
  if (
    ![clientX, clientY, rect.left, rect.top, rect.width, rect.height, viewport.width, viewport.height]
      .every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0
  ) return null;

  // Match SVG's xMidYMid meet fit. A stretched client rectangle can contain
  // letterboxing; clicks there must not create off-canvas model coordinates.
  const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const left = rect.left + (rect.width - viewport.width * scale) / 2;
  const top = rect.top + (rect.height - viewport.height * scale) / 2;
  const x = (clientX - left) / scale;
  const y = (clientY - top) / scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null;
  return [x, y];
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
