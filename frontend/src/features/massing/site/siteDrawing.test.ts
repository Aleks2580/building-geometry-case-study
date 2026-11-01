import { describe, expect, it } from "vitest";
import type { PolygonGeometry } from "../../../api/contracts";
import {
  closeExteriorRing, defaultDrawingExtent, drawingGrid, fitDrawingExtent,
  fitDrawingPoints, replaceExteriorRing, type SitePosition,
} from "./siteDrawing";

describe("closeExteriorRing", () => {
  it("closes an arbitrary concave exterior without rounding or changing its vertex order", () => {
    const points: SitePosition[] = [
      [-12.34567890123, 0.1234567890123], [50.000000000001, 0.1234567890123],
      [50.000000000001, 20], [13, 20], [13, 47], [-12.34567890123, 47],
    ];
    const original = structuredClone(points);
    const polygon = closeExteriorRing(points);

    expect(polygon).toEqual({ type: "Polygon", coordinates: [[...points, points[0]]] });
    expect(points).toEqual(original);
    expect(polygon?.coordinates[0][0]).not.toBe(points[0]);
    expect(polygon?.coordinates[0].slice(-1)[0]).not.toBe(polygon?.coordinates[0][0]);
    expect(JSON.parse(JSON.stringify(polygon))).toEqual(polygon);
  });

  it("does not append a second closure to an already closed ring", () => {
    const points: SitePosition[] = [[0, 0], [30, 0], [10, 20], [0, 0]];

    expect(closeExteriorRing(points)?.coordinates[0]).toEqual(points);
    expect(closeExteriorRing(points)?.coordinates[0]).not.toBe(points);
  });

  it.each(([
    [], [[0, 0]], [[0, 0], [1, 1]], [[0, 0], [1, 1], [0, 0]],
    [[0, 0], [0, 0], [0, 0], [0, 0]],
  ] satisfies SitePosition[][]).map((points) => ({ points })))("rejects insufficient distinct vertices: $points", ({ points }) => {
    expect(closeExteriorRing(points)).toBeNull();
  });

  it.each([Infinity, -Infinity, NaN])("rejects a non-finite coordinate %s", (coordinate) => {
    expect(closeExteriorRing([[0, 0], [30, 0], [10, coordinate]])).toBeNull();
  });

  it("leaves self-intersections and collinearity for backend validation", () => {
    const crossed: SitePosition[] = [[0, 0], [20, 20], [0, 20], [20, 0]];
    const collinear: SitePosition[] = [[0, 0], [10, 10], [20, 20]];

    expect(closeExteriorRing(crossed)?.coordinates[0]).toEqual([...crossed, crossed[0]]);
    expect(closeExteriorRing(collinear)?.coordinates[0]).toEqual([...collinear, collinear[0]]);
  });
});

describe("fitDrawingExtent", () => {
  it("provides a comprehensible default metric extent", () => {
    expect(defaultDrawingExtent).toEqual({ minX: 0, minY: 0, size: 60 });
  });

  it("fits offset coordinates with equal scale and margin without changing the polygon or holes", () => {
    const geometry: PolygonGeometry = {
      type: "Polygon",
      coordinates: [
        [[-100, 200], [-20, 200], [-20, 240], [-100, 240], [-100, 200]],
        [[-80, 210], [-70, 210], [-70, 220], [-80, 220], [-80, 210]],
      ],
    };
    const original = structuredClone(geometry);

    expect(fitDrawingExtent(geometry)).toEqual({ minX: -108, minY: 172, size: 96 });
    expect(geometry).toEqual(original);
  });

  it.each([
    { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[[0, 0], [Infinity, 0], [1, 1], [0, 0]]] },
    { type: "Polygon", coordinates: [[[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0], [0, 20], [-Number.MAX_VALUE, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1.7e308, 0], [1.7e308, 1], [0, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1e-310, 0], [1e-310, 1e-310], [0, 0]]] },
  ] satisfies PolygonGeometry[])("declines a degenerate or undisplayable extent: %j", (geometry) => {
    expect(fitDrawingExtent(geometry)).toBeNull();
  });
});

describe("fitDrawingPoints", () => {
  it.each([
    { name: "120 × 80 m site", points: [[0, 0], [120, 0], [120, 80], [0, 80]], size: 144 },
    { name: "250 × 150 m irregular site", points: [[0, 0], [250, 0], [210, 80], [120, 150], [0, 100]], size: 300 },
    { name: "small site", points: [[0, 0], [0.4, 0], [0.4, 0.3], [0, 0.3]], size: 0.48 },
    { name: "high-offset site", points: [[1e12, -1e12], [1e12 + 120, -1e12 + 80]], size: 144 },
    { name: "collinear unfinished site", points: [[0, 0], [0, 1], [0, 2]], size: 2.4 },
  ] satisfies { name: string; points: SitePosition[]; size: number }[])("fits every vertex of $name without changing coordinates", ({ points, size }) => {
    const original = structuredClone(points);
    const extent = fitDrawingPoints(points);
    expect(extent?.size).toBeCloseTo(size, 10);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(extent!.minX);
      expect(x).toBeLessThanOrEqual(extent!.minX + extent!.size);
      expect(y).toBeGreaterThanOrEqual(extent!.minY);
      expect(y).toBeLessThanOrEqual(extent!.minY + extent!.size);
    }
    expect(points).toEqual(original);
  });

  it("frames a single vertex without requiring a finished polygon", () => {
    expect(fitDrawingPoints([[125, -25]])).toEqual({ minX: 120, minY: -30, size: 10 });
    expect(fitDrawingPoints([[125, -25], [125, -25]])).toEqual({ minX: 120, minY: -30, size: 10 });
  });

  it("also fits structurally invalid polygon outlines without validating or repairing topology", () => {
    const geometry: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [0, 2], [0, 0]]] };
    const fitted = fitDrawingExtent(geometry);
    expect(fitted?.size).toBe(2.4);
    expect(fitted?.minX).toBe(-1.2);
    expect(fitted?.minY).toBeCloseTo(-0.2);
  });

  it.each(([
    [], [[NaN, 0]], [[0, Infinity]], [[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0]],
    [[1e308, 1e308]], [[0, 0], [1e-310, 1e-310]],
  ] satisfies SitePosition[][]).map((points) => ({ points })))("declines unsafe display coordinates: $points", ({ points }) => {
    expect(fitDrawingPoints(points)).toBeNull();
  });
});

describe("replaceExteriorRing", () => {
  it("updates only the exterior while retaining precise holes and original inputs", () => {
    const geometry: PolygonGeometry = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [40, 0], [40, 30], [0, 30], [0, 0]],
        [[5.1234567890123, 5], [10, 5], [10, 10], [5.1234567890123, 10], [5.1234567890123, 5]],
        [[20, 15], [25, 15], [25, 20], [20, 20], [20, 15]],
      ],
    };
    const points: SitePosition[] = [[-0.1234567890123, 0], [45, 0], [45, 35], [0, 35]];
    const original = structuredClone(geometry);
    const originalPoints = structuredClone(points);
    const result = replaceExteriorRing(geometry, points);

    expect(result?.coordinates[0]).toEqual([...points, points[0]]);
    expect(result?.coordinates.slice(1)).toEqual(geometry.coordinates.slice(1));
    expect(geometry).toEqual(original);
    expect(points).toEqual(originalPoints);
    expect(result?.coordinates[1]).not.toBe(geometry.coordinates[1]);
    expect(result?.coordinates[1][0]).not.toBe(geometry.coordinates[1][0]);
  });

  it("preserves the minimum distinct vertex count without repairing self-intersections", () => {
    const original = closeExteriorRing([[0, 0], [40, 0], [0, 30]])!;
    expect(replaceExteriorRing(original, [[0, 0], [10, 0], [0, 0]])).toBeNull();
    expect(replaceExteriorRing(original, [[0, 0], [20, 20], [0, 20], [20, 0]])?.coordinates[0])
      .toEqual([[0, 0], [20, 20], [0, 20], [20, 0], [0, 0]]);
  });
});

describe("drawingGrid", () => {
  it("retains the initial readable 10 m grid", () => {
    expect(drawingGrid(defaultDrawingExtent)).toEqual({
      step: 10, x: [0, 10, 20, 30, 40, 50, 60], y: [0, 10, 20, 30, 40, 50, 60],
    });
  });

  it.each([
    { minX: 0, minY: 0, size: 50 },
    { minX: 0, minY: 0, size: 100 },
    { minX: 0, minY: 0, size: 200 },
    { minX: 0, minY: 0, size: 500 },
    { minX: -12, minY: -28, size: 144 },
    { minX: -25, minY: -75, size: 300 },
    { minX: -0.04, minY: -0.09, size: 0.48 },
    { minX: 1e12, minY: -1e12, size: 120 },
  ])("uses bounded nice metric intervals for %j", (extent) => {
    const snapshot = { ...extent };
    const grid = drawingGrid(extent);
    expect(grid).not.toBeNull();
    expect(grid!.step).toBeGreaterThan(0);
    const magnitude = 10 ** Math.floor(Math.log10(grid!.step));
    expect([1, 2, 5, 10].some((value) => Math.abs(grid!.step / magnitude - value) < 1e-10)).toBe(true);
    for (const [axis, min] of [[grid!.x, extent.minX], [grid!.y, extent.minY]] as const) {
      expect(axis.length).toBeGreaterThanOrEqual(3);
      expect(axis.length).toBeLessThanOrEqual(10);
      for (const [index, coordinate] of axis.entries()) {
        expect(coordinate).toBeGreaterThanOrEqual(min);
        expect(coordinate).toBeLessThanOrEqual(min + extent.size);
        if (index > 0) expect(coordinate).toBeGreaterThan(axis[index - 1]);
      }
    }
    expect(extent).toEqual(snapshot);
  });

  it.each([
    { minX: 0, minY: 0, size: 0 },
    { minX: NaN, minY: 0, size: 60 },
    { minX: 0, minY: 0, size: Infinity },
    { minX: 0, minY: 0, size: 1e-310 },
    { minX: 1e308, minY: 1e308, size: 10 },
  ])("declines unsafe grid extents: %j", (extent) => {
    expect(drawingGrid(extent)).toBeNull();
  });
});
