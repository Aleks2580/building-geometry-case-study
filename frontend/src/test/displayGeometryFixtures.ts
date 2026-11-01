import type { PolygonGeometry } from "../api/contracts";

export function polygonWithPositionCount(count: number): PolygonGeometry {
  const ring = Array.from({ length: count - 1 }, (_, index): [number, number] => {
    const angle = index * 2 * Math.PI / (count - 1);
    return [20 + 15 * Math.cos(angle), 20 + 15 * Math.sin(angle)];
  });
  return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
}
