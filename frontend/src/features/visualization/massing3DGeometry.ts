import { Path, Shape, ShapeUtils, Vector2 } from "three";
import type { MassingPreviewResponse, PolygonGeometry } from "../../api/contracts";

export const MAX_DISPLAY_FLOORS = 512;
export const MAX_DISPLAY_VERTICES = 20_000;
export const MAX_DISPLAY_TRIANGLES = 500_000;
const NORMALIZED_EXTENT = 10;

type Point2 = [number, number];
type Point3 = [number, number, number];
type SourcePolygon = PolygonGeometry["coordinates"];

export interface PreparedPolygon {
  rings: Point2[][];
}

interface TriangulatedPolygon extends PreparedPolygon {
  extrusionTriangles: number;
}

export interface SceneFrame {
  origin: Point2;
  scale: number;
}

export interface PreparedMassingScene {
  site: PreparedPolygon[];
  buildable: PreparedPolygon[];
  selectedBuildable: PreparedPolygon[];
  building: {
    footprint: PreparedPolygon;
    floorPlate: PreparedPolygon;
    floorCount: number;
    floorHeight: number;
    totalHeight: number;
    floorElevations: number[];
  } | null;
  frame: SceneFrame;
  bounds: { min: Point3; max: Point3 };
}

export type MassingScenePreparation =
  | { status: "ready" | "context-only"; scene: PreparedMassingScene }
  | { status: "invalid" | "unsupported"; message: string; planAvailable: boolean };

export interface CameraFit {
  position: Point3;
  target: Point3;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
}

class DisplayInputError extends Error {
  constructor(readonly status: "invalid" | "unsupported", message: string) {
    super(message);
  }
}

function invalid(message: string): never {
  throw new DisplayInputError("invalid", message);
}

function unsupported(message: string): never {
  throw new DisplayInputError("unsupported", message);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sourcePolygons(value: unknown, optional: boolean, allowMultiPolygon: boolean): SourcePolygon[] {
  if (value === null && optional) return [];
  if (typeof value !== "object" || value === null || !("type" in value) || !("coordinates" in value)) {
    return invalid("Geometry does not contain a polygon representation.");
  }
  if (value.type !== "Polygon" && value.type !== "MultiPolygon") {
    return unsupported("This geometry type cannot be displayed in 3D.");
  }
  if (value.type === "MultiPolygon" && !allowMultiPolygon) {
    return unsupported("This 3D layer requires a single Polygon.");
  }
  const polygons: unknown[] = value.type === "Polygon" ? [value.coordinates] : value.coordinates as unknown[];
  if (!Array.isArray(polygons) || polygons.length === 0) {
    return invalid("An available geometry must contain a Polygon.");
  }
  return polygons as SourcePolygon[];
}

function validatePolygons(polygons: SourcePolygon[], vertexBudget: { count: number }): void {
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) invalid("A Polygon must contain an exterior ring.");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) invalid("Polygon rings must contain at least four closed positions.");
      vertexBudget.count += ring.length - 1;
      // The backend intentionally has no rendering limits. Refuse expensive input
      // before allocating GPU data rather than silently simplifying its geometry.
      if (vertexBudget.count > MAX_DISPLAY_VERTICES) unsupported("The geometry exceeds the 3D vertex display limit.");
      for (const point of ring) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every((value) => typeof value === "number" && Number.isFinite(value))) {
          invalid("Polygon positions must contain two finite coordinates.");
        }
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) invalid("Polygon rings must be explicitly closed.");
      if (new Set(ring.slice(0, -1).map(([x, y]) => `${x},${y}`)).size < 3) {
        invalid("Polygon rings must contain at least three distinct positions.");
      }
    }
  }
}

function matchingPolygons(left: SourcePolygon, right: SourcePolygon): boolean {
  return left.length === right.length && left.every((ring, ringIndex) => (
    ring.length === right[ringIndex].length
    && ring.every(([x, y], index) => x === right[ringIndex][index][0] && y === right[ringIndex][index][1])
  ));
}

function preparePolygon(polygon: SourcePolygon, frame: SceneFrame): TriangulatedPolygon {
  const rings = polygon.map((ring) => ring.slice(0, -1).map(([x, y]): Point2 => [
    (x - frame.origin[0]) * frame.scale,
    (y - frame.origin[1]) * frame.scale,
  ]));
  for (const [ringIndex, ring] of rings.entries()) {
    for (const [index, point] of ring.entries()) {
      if (!point.every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
        unsupported("The coordinates exceed the 3D display range.");
      }
      const next = ring[(index + 1) % ring.length];
      const source = polygon[ringIndex];
      const sameSource = source[index][0] === source[(index + 1) % ring.length][0]
        && source[index][1] === source[(index + 1) % ring.length][1];
      // Centering and uniform scaling cannot preserve arbitrary aspect ratios in
      // Float32 buffers. Report lost distinct edges instead of deleting vertices.
      if (!sameSource && Math.fround(point[0]) === Math.fround(next[0]) && Math.fround(point[1]) === Math.fround(next[1])) {
        unsupported("Distinct geometry vertices collapse at 3D display precision.");
      }
    }
  }
  const prepared = { rings };
  const shape = createPolygonShape(prepared);
  const capTriangles = ShapeUtils.triangulateShape(shape.getPoints(), shape.holes.map((hole) => hole.getPoints())).length;
  if (capTriangles === 0) {
    invalid("The Polygon cannot produce any visible triangles.");
  }
  // This count must stay aligned with the scene's single-step, bevel-free extrusion.
  return { ...prepared, extrusionTriangles: 2 * capTriangles + 2 * rings.reduce((sum, ring) => sum + ring.length, 0) };
}

export function toWorldPosition(frame: SceneFrame, [x, y]: Point2, elevation: number): Point3 {
  return [(x - frame.origin[0]) * frame.scale, elevation * frame.scale, -(y - frame.origin[1]) * frame.scale];
}

export function prepareMassingScene(result: MassingPreviewResponse): MassingScenePreparation {
  let planAvailable = false;
  try {
    if (typeof result !== "object" || result === null || typeof result.metrics !== "object" || result.metrics === null) {
      return invalid("The massing result has no display metrics.");
    }
    const site = sourcePolygons(result.site_geometry, false, false);
    const buildable = sourcePolygons(result.buildable_geometry, true, true);
    const selectedBuildable = sourcePolygons(result.selected_buildable_geometry, true, false);
    const footprint = sourcePolygons(result.footprint_geometry, true, false);
    const floorPlate = sourcePolygons(result.floor_plate_geometry, true, false);
    const vertexBudget = { count: 0 };
    for (const layer of [site, buildable, selectedBuildable, footprint, floorPlate]) validatePolygons(layer, vertexBudget);
    // Safe, bounded source rings can still supply the existing SVG plan when a
    // later 3D-only limit prevents display; never send unbounded input to fallback.
    planAvailable = true;

    const metrics = result.metrics;
    if (!positiveFinite(metrics.floor_to_floor_m)) invalid("Floor spacing must be finite and positive.");
    const actualMetrics = [metrics.floor_count, metrics.height_m, metrics.footprint_area_m2, metrics.gfa_m2, metrics.site_coverage_ratio];
    const absentBuilding = footprint.length === 0 && floorPlate.length === 0 && actualMetrics.every((value) => value === null);
    if (!absentBuilding) {
      if (footprint.length !== 1 || floorPlate.length !== 1
        || !positiveFinite(metrics.floor_count) || !Number.isSafeInteger(metrics.floor_count)
        || !positiveFinite(metrics.height_m) || !positiveFinite(metrics.footprint_area_m2) || !positiveFinite(metrics.gfa_m2)
        || typeof metrics.site_coverage_ratio !== "number" || !Number.isFinite(metrics.site_coverage_ratio) || metrics.site_coverage_ratio < 0) {
        invalid("Actual building geometry and metrics are incomplete or invalid.");
      }
      if (metrics.floor_count > MAX_DISPLAY_FLOORS) unsupported("The building exceeds the 3D floor display limit.");
      if (!matchingPolygons(footprint[0], floorPlate[0])) invalid("The footprint and repeated floor plate disagree.");
      const placedHeight = metrics.floor_count * metrics.floor_to_floor_m;
      const tolerance = Number.EPSILON * 16 * Math.max(metrics.height_m, placedHeight);
      if (!Number.isFinite(placedHeight) || Math.abs(placedHeight - metrics.height_m) > tolerance) {
        invalid("The actual floor count, spacing, and total height disagree.");
      }
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of site[0]) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const width = maxX - minX;
    const depth = maxY - minY;
    if (width <= 0 || depth <= 0) invalid("The original site has no usable display frame.");
    const totalHeight = absentBuilding ? 0 : metrics.height_m as number;
    const extent = Math.max(width, depth, totalHeight);
    const scale = NORMALIZED_EXTENT / extent;
    if (!positiveFinite(extent) || !positiveFinite(scale)) unsupported("The site and building exceed the 3D display range.");
    // One shared frame preserves all plan proportions and vertical dimensions;
    // normalization changes display units only, never backend metrics.
    const frame: SceneFrame = { origin: [minX / 2 + maxX / 2, minY / 2 + maxY / 2], scale };
    const preparedSite = site.map((polygon) => preparePolygon(polygon, frame));
    const preparedBuildable = buildable.map((polygon) => preparePolygon(polygon, frame));
    const preparedSelected = selectedBuildable.map((polygon) => preparePolygon(polygon, frame));
    const preparedFootprint = absentBuilding ? null : preparePolygon(footprint[0], frame);
    const preparedFloorPlate = absentBuilding ? null : preparePolygon(floorPlate[0], frame);
    // Instancing reduces draw calls, but every floor still renders its caps and
    // walls. Bound their combined work before allocating placements or GPU data.
    if (preparedFloorPlate && preparedFloorPlate.extrusionTriangles * (metrics.floor_count as number) > MAX_DISPLAY_TRIANGLES) {
      unsupported("The building exceeds the 3D triangle display limit.");
    }
    const building = preparedFootprint && preparedFloorPlate ? {
      footprint: preparedFootprint,
      floorPlate: preparedFloorPlate,
      floorCount: metrics.floor_count as number,
      floorHeight: metrics.floor_to_floor_m * scale,
      totalHeight: totalHeight * scale,
      floorElevations: Array.from({ length: metrics.floor_count as number }, (_, index) => index * metrics.floor_to_floor_m * scale),
    } : null;
    if (building && (!positiveFinite(building.floorHeight) || Math.fround(building.floorHeight) === 0
      || !building.floorElevations.every(Number.isFinite))) {
      unsupported("The floor spacing cannot be represented at 3D display precision.");
    }
    const scene: PreparedMassingScene = {
      site: preparedSite,
      buildable: preparedBuildable,
      selectedBuildable: preparedSelected,
      building,
      frame,
      bounds: {
        min: toWorldPosition(frame, [minX, maxY], 0),
        max: toWorldPosition(frame, [maxX, minY], totalHeight),
      },
    };
    return { status: absentBuilding ? "context-only" : "ready", scene };
  } catch (error) {
    if (error instanceof DisplayInputError) return { status: error.status, message: error.message, planAvailable };
    return { status: "invalid", message: "The massing geometry cannot be prepared for display.", planAvailable };
  }
}

export function createPolygonShape(polygon: PreparedPolygon): Shape {
  const [exterior, ...holes] = polygon.rings;
  const contour = exterior.map(([x, y]) => new Vector2(x, y));
  if (!ShapeUtils.isClockWise(contour)) contour.reverse();
  const shape = new Shape(contour);
  shape.closePath();
  shape.holes = holes.map((ring) => {
    const points = ring.map(([x, y]) => new Vector2(x, y));
    // Normalize copied rings before extrusion: Three's outer-ring correction does
    // not consistently correct holes when the exterior is already clockwise.
    if (ShapeUtils.isClockWise(points)) points.reverse();
    const path = new Path(points);
    path.closePath();
    return path;
  });
  return shape;
}

export function fitMassingCamera(scene: PreparedMassingScene, aspect: number, fov = 45): CameraFit {
  if (!positiveFinite(aspect) || !positiveFinite(fov) || fov >= 180) {
    throw new RangeError("Camera aspect and field of view must be finite and positive, with field of view below 180 degrees.");
  }
  const { min, max } = scene.bounds;
  const target: Point3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  const verticalHalf = fov * Math.PI / 360;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * aspect);
  const distance = radius / Math.sin(Math.min(verticalHalf, horizontalHalf)) * 1.15;
  if (!positiveFinite(radius) || !positiveFinite(distance)) {
    throw new RangeError("The camera fit exceeds the display range.");
  }
  const directionLength = Math.hypot(1, 0.8, 1);
  const position: Point3 = [target[0] + distance / directionLength, target[1] + distance * 0.8 / directionLength, target[2] + distance / directionLength];
  return {
    position,
    target,
    near: Math.max(radius * 0.0001, Number.EPSILON),
    far: distance * 8 + radius,
    minDistance: radius * 0.05,
    maxDistance: distance * 4,
  };
}
