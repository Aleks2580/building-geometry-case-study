import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MultiPolygonGeometry, PolygonGeometry } from "../../api/contracts";
import {
  createViewportTransform,
  geometryBounds,
  geometryPath,
  type Bounds,
  type CoordinateTransform,
  type Viewport,
} from "./svgGeometry";

type Position = PolygonGeometry["coordinates"][number][number];
const identity: CoordinateTransform = (position) => position;

function siteExample(name: "rectangle" | "l-shaped" | "notched"): PolygonGeometry {
  const fixture = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), `../../../../data/sites/${name}.json`), "utf8",
  )) as { polygon: Position[] };
  return { type: "Polygon", coordinates: [[...fixture.polygon, fixture.polygon[0]]] };
}

function polygon(ring: Position[], ...holes: Position[][]): PolygonGeometry {
  return { type: "Polygon", coordinates: [ring, ...holes] };
}

function requiredTransform(bounds: Bounds, viewport: Viewport): CoordinateTransform {
  const transform = createViewportTransform(bounds, viewport);
  if (transform === null) throw new Error("Expected a valid display frame.");
  return transform;
}

describe("geometryBounds", () => {
  it.each([
    ["rectangle", { minX: 0, minY: 0, maxX: 40, maxY: 25 }],
    ["l-shaped", { minX: 0, minY: 0, maxX: 40, maxY: 30 }],
    ["notched", { minX: 0, minY: 0, maxX: 50, maxY: 20 }],
  ] as const)("bounds the supplied %s site", (name, bounds) => {
    expect(geometryBounds(siteExample(name))).toEqual(bounds);
  });

  it("includes every component with negative and offset coordinates", () => {
    const geometry: MultiPolygonGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [[[-30, -20], [-10, -20], [-10, -5], [-30, -20]]],
        [[[80, 100], [90, 100], [90, 120], [80, 100]]],
      ],
    };
    expect(geometryBounds(geometry)).toEqual({ minX: -30, minY: -20, maxX: 90, maxY: 120 });
  });

  it.each([
    { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[]] },
    { type: "MultiPolygon", coordinates: [] },
    polygon([[1, 1], [1, 1], [1, 1], [1, 1]]),
    polygon([[1, 0], [1, 1], [1, 2], [1, 0]]),
    polygon([[0, 0], [Infinity, 0], [1, 1], [0, 0]]),
    polygon([[0, 0], [1, NaN], [1, 1], [0, 0]]),
  ] satisfies (PolygonGeometry | MultiPolygonGeometry)[])("rejects an empty or invalid frame: %j", (geometry) => {
    expect(geometryBounds(geometry)).toBeNull();
  });
});

describe("createViewportTransform", () => {
  const bounds: Bounds = { minX: 0, minY: 0, maxX: 40, maxY: 20 };

  it.each([
    [{ width: 120, height: 120, padding: 10 }, [10, 85], [110, 35]],
    [{ width: 240, height: 100, padding: 10 }, [40, 90], [200, 10]],
    [{ width: 100, height: 240, padding: 10 }, [10, 140], [90, 100]],
    [{ width: 40, height: 20, padding: 0 }, [0, 20], [40, 0]],
  ] satisfies [Viewport, Position, Position][])("fits and centers within %j with uniform scale", (viewport, bottomLeft, topRight) => {
    const transform = requiredTransform(bounds, viewport);
    expect(transform([0, 0])).toEqual(bottomLeft);
    expect(transform([40, 20])).toEqual(topRight);
    expect(transform([20, 10])).toEqual([viewport.width / 2, viewport.height / 2]);
    const origin = transform([0, 0]);
    const stepX = transform([1, 0]);
    const stepY = transform([0, 1]);
    expect(stepX[0] - origin[0]).toBeCloseTo(origin[1] - stepY[1]);
    expect(stepY[1]).toBeLessThan(origin[1]);
  });

  it("normalizes translated coordinates before scaling", () => {
    const viewport = { width: 140, height: 100, padding: 10 };
    const transform = requiredTransform({ minX: -10, minY: 200, maxX: 30, maxY: 220 }, viewport);
    expect(transform([-10, 200])).toEqual([10, 80]);
    expect(transform([30, 220])).toEqual([130, 20]);
    expect(transform([10, 210])).toEqual([70, 50]);
  });

  it("keeps setback and footprint aligned in the original site frame", () => {
    const site = siteExample("rectangle");
    const transform = requiredTransform(
      geometryBounds(site)!, { width: 120, height: 100, padding: 10 },
    );
    const setback = polygon([[3, 3], [37, 3], [37, 22], [3, 22], [3, 3]]);
    const footprint = polygon([[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]);
    expect(geometryPath(site, transform))
      .toBe("M10 81.25 L110 81.25 L110 18.75 L10 18.75 L10 81.25 Z");
    expect(geometryPath(setback, transform))
      .toBe("M17.5 73.75 L102.5 73.75 L102.5 26.25 L17.5 26.25 L17.5 73.75 Z");
    expect(geometryPath(footprint, transform))
      .toBe("M22.5 68.75 L47.5 68.75 L47.5 43.75 L22.5 43.75 L22.5 68.75 Z");
  });

  it.each([
    { minX: 0, minY: 0, maxX: 0, maxY: 1 },
    { minX: 0, minY: 0, maxX: 1, maxY: 0 },
    { minX: 2, minY: 0, maxX: 1, maxY: 1 },
    { minX: NaN, minY: 0, maxX: 1, maxY: 1 },
    { minX: 0, minY: 0, maxX: Infinity, maxY: 1 },
    { minX: -Number.MAX_VALUE, minY: 0, maxX: Number.MAX_VALUE, maxY: 1 },
  ])("returns no transform for degenerate or non-finite bounds: %j", (invalidBounds) => {
    expect(createViewportTransform(invalidBounds, { width: 100, height: 100, padding: 10 }))
      .toBeNull();
  });

  it.each([
    { width: 0, height: 100, padding: 10 },
    { width: 100, height: -1, padding: 10 },
    { width: Infinity, height: 100, padding: 10 },
    { width: 100, height: NaN, padding: 10 },
    { width: 100, height: 100, padding: -1 },
    { width: 100, height: 100, padding: Infinity },
    { width: 100, height: 100, padding: 50 },
    { width: 100, height: 100, padding: 60 },
  ])("rejects an invalid viewport: %j", (viewport) => {
    expect(() => createViewportTransform(bounds, viewport)).toThrow(RangeError);
  });
});

describe("geometryPath", () => {
  it.each([
    ["rectangle", "M0 0 L40 0 L40 25 L0 25 L0 0 Z"],
    ["l-shaped", "M0 0 L40 0 L40 15 L20 15 L20 30 L0 30 L0 0 Z"],
    ["notched", "M0 0 L50 0 L50 20 L30 20 L30 6 L20 6 L20 20 L0 20 L0 0 Z"],
  ] as const)("preserves every boundary vertex of the supplied %s site", (name, expected) => {
    expect(geometryPath(siteExample(name), identity)).toBe(expected);
  });

  it("keeps holes as closed subpaths regardless of winding", () => {
    const exterior: Position[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole: Position[] = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    expect(geometryPath(polygon(exterior, hole), identity))
      .toBe("M0 0 L10 0 L10 10 L0 10 L0 0 Z M2 2 L4 2 L4 4 L2 4 L2 2 Z");
    expect(geometryPath(polygon(exterior, [...hole].reverse()), identity))
      .toBe("M0 0 L10 0 L10 10 L0 10 L0 0 Z M2 2 L2 4 L4 4 L4 2 L2 2 Z");
  });

  it("preserves every MultiPolygon component and its holes", () => {
    const first = polygon(
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]],
    );
    const second = polygon([[20, 0], [30, 0], [30, 10], [20, 0]]);
    const geometry: MultiPolygonGeometry = {
      type: "MultiPolygon", coordinates: [first.coordinates, second.coordinates],
    };
    expect(geometryPath(geometry, identity))
      .toBe(`${geometryPath(first, identity)} ${geometryPath(second, identity)}`);
    expect(geometryPath(geometry, identity).match(/M/g)).toHaveLength(3);
    expect(geometryPath(geometry, identity).match(/Z/g)).toHaveLength(3);
  });

  it.each([
    { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[]] },
    { type: "MultiPolygon", coordinates: [] },
    { type: "MultiPolygon", coordinates: [[], [[]]] },
  ] satisfies (PolygonGeometry | MultiPolygonGeometry)[])("omits empty geometry without inventing paths: %j", (geometry) => {
    expect(geometryPath(geometry, identity)).toBe("");
  });

  it("omits empty rings alongside available rings", () => {
    const ring: Position[] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(geometryPath({ type: "Polygon", coordinates: [[], ring, []] }, identity))
      .toBe("M0 0 L1 0 L1 1 L0 0 Z");
  });

  it("does not emit non-finite source or transformed coordinates", () => {
    const geometry = polygon([[0, 0], [1, 0], [1, 1], [0, 0]]);
    expect(geometryPath(polygon([[0, 0], [Infinity, 0], [1, 1], [0, 0]]), identity)).toBe("");
    expect(geometryPath(geometry, () => [NaN, Infinity])).toBe("");
  });

  it("is deterministic without rounding coordinates or mutating inputs", () => {
    const geometry = polygon([[0, 0], [1.000000000000001, 0], [1, 1], [0, 0]]);
    const snapshot = structuredClone(geometry);
    for (const ring of geometry.coordinates) {
      for (const position of ring) Object.freeze(position);
      Object.freeze(ring);
    }
    Object.freeze(geometry.coordinates);
    Object.freeze(geometry);
    const bounds = geometryBounds(geometry)!;
    Object.freeze(bounds);
    const viewport = Object.freeze({ width: 100, height: 100, padding: 10 });
    const transform = requiredTransform(bounds, viewport);

    expect(geometryPath(geometry, identity)).toContain("1.000000000000001");
    expect(geometryPath(geometry, transform)).toBe(geometryPath(geometry, transform));
    expect(geometry).toEqual(snapshot);
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 1.000000000000001, maxY: 1 });
    expect(viewport).toEqual({ width: 100, height: 100, padding: 10 });
  });
});
