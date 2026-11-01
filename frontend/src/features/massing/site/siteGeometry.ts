import type { PolygonGeometry } from "../../../api/contracts";

type Position = PolygonGeometry["coordinates"][number][number];
export type SiteExampleKind = "l-shaped" | "notched";

// Keep the frontend Docker context self-contained; parity tests compare these
// vertices with the canonical examples in data/sites/.
const exampleVertices: Record<SiteExampleKind, readonly (readonly [number, number])[]> = {
  "l-shaped": [[0, 0], [40, 0], [40, 15], [20, 15], [20, 30], [0, 30]],
  notched: [[0, 0], [50, 0], [50, 20], [30, 20], [30, 6], [20, 6], [20, 20], [0, 20]],
};

export function createRectangleSite(width: number, length: number): PolygonGeometry {
  return {
    type: "Polygon",
    coordinates: [[[0, 0], [width, 0], [width, length], [0, length], [0, 0]]],
  };
}

export function exampleSite(kind: SiteExampleKind): PolygonGeometry {
  const vertices = exampleVertices[kind];
  const ring = vertices.map(([x, y]): Position => [x, y]);
  const [x, y] = vertices[0];
  ring.push([x, y]);
  return { type: "Polygon", coordinates: [ring] };
}
