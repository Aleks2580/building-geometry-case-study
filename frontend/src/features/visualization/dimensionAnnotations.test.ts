import { describe, expect, it } from "vitest";
import type { PolygonGeometry } from "../../api/contracts";
import { createViewportTransform, geometryBounds, type CoordinateTransform } from "./svgGeometry";
import {
  dimensionEdgeLabel, dimensionRingLabel, formatDimensionLength, layoutAllDimensions, layoutDimension, measureGeometryEdges,
  type DimensionEdge, type DimensionLayout,
} from "./dimensionAnnotations";

type Position = PolygonGeometry["coordinates"][number][number];
const rectangle: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]]] };
const identity: CoordinateTransform = (point) => [...point];
const viewport = { width: 640, height: 400 };

function edge(from: Position, to: Position): DimensionEdge {
  return { id: "site-0-0", layer: "site", ringIndex: 0, edgeIndex: 0, from, to, lengthM: Math.hypot(to[0] - from[0], to[1] - from[1]) };
}

function requiredLayout(selected: DimensionEdge, transform = identity, clientWidth = 640): DimensionLayout {
  const layout = layoutDimension(selected, transform, viewport, clientWidth);
  if (!layout) throw new Error("Expected a usable selected-edge dimension.");
  return layout;
}

function expectLabelWithinViewport(layout: DimensionLayout) {
  const { x, y, width, height } = layout.label;
  expect(x - width / 2).toBeGreaterThanOrEqual(0);
  expect(x + width / 2).toBeLessThanOrEqual(viewport.width);
  expect(y - height / 2).toBeGreaterThanOrEqual(0);
  expect(y + height / 2).toBeLessThanOrEqual(viewport.height);
  const positions = [layout.from, layout.to, layout.lineFrom, layout.lineTo,
    ...layout.ticks.flat(), ...layout.extensionLines.flat(), ...(layout.leader ?? [])];
  expect(positions.flat().every(Number.isFinite)).toBe(true);
}

describe("measureGeometryEdges", () => {
  it("measures actual adjacent horizontal, vertical, and diagonal coordinates independently for site and footprint", () => {
    const footprint: PolygonGeometry = { type: "Polygon", coordinates: [[[2, 2], [5, 2], [5, 6], [2, 2]]] };
    const original = structuredClone([rectangle, footprint]);
    const edges = measureGeometryEdges(rectangle, footprint);
    expect(edges.map(({ id, lengthM }) => [id, lengthM])).toEqual([
      ["site-0-0", 10], ["site-0-1", 8], ["site-0-2", 10], ["site-0-3", 8],
      ["footprint-0-0", 3], ["footprint-0-1", 4], ["footprint-0-2", 5],
    ]);
    expect(edges[4].from).toEqual([2, 2]);
    expect(edges[4].to).toEqual([5, 2]);
    expect([rectangle, footprint]).toEqual(original);
    expect(edges[0].from).not.toBe(rectangle.coordinates[0][0]);
  });

  it("preserves every concave segment and vertex order", () => {
    const concave: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [40, 0], [40, 15], [20, 15], [20, 30], [0, 30], [0, 0]]] };
    const edges = measureGeometryEdges(concave);
    expect(edges.map((item) => item.lengthM)).toEqual([40, 15, 20, 15, 20, 30]);
    expect(edges.map((item) => item.from)).toEqual(concave.coordinates[0].slice(0, -1));
    expect(edges[edges.length - 1].to).toEqual(concave.coordinates[0][0]);
  });

  it("identifies all site and footprint holes without conflating rings", () => {
    const site = structuredClone(rectangle);
    const hole: Position[] = [[2, 2], [5, 2], [5, 6], [2, 6], [2, 2]];
    site.coordinates.push(hole, [[6, 2], [7, 2], [7, 3], [6, 2]]);
    const footprint: PolygonGeometry = { type: "Polygon", coordinates: [rectangle.coordinates[0], hole] };
    const edges = measureGeometryEdges(site, footprint);
    expect(edges.filter((item) => item.id.startsWith("site-1-")).map((item) => item.lengthM)).toEqual([3, 4, 3, 4]);
    expect(dimensionRingLabel(edges.find((item) => item.id === "site-0-0")!)).toBe("Site boundary");
    expect(dimensionEdgeLabel(edges.find((item) => item.id === "site-1-1")!)).toBe("Site hole 1 · edge 2");
    expect(dimensionEdgeLabel(edges.find((item) => item.id === "site-2-0")!)).toBe("Site hole 2 · edge 1");
    expect(dimensionRingLabel(edges.find((item) => item.id === "footprint-0-0")!)).toBe("Building footprint");
    expect(dimensionEdgeLabel(edges.find((item) => item.id === "footprint-1-3")!)).toBe("Footprint hole 1 · edge 4");
    expect(new Set(edges.map((item) => item.id)).size).toBe(edges.length);
  });

  it.each([undefined, null, { type: "Polygon", coordinates: [] }] satisfies (PolygonGeometry | null | undefined)[])(
    "never invents an actual footprint for %j", (footprint) => {
      expect(measureGeometryEdges(rectangle, footprint)).toHaveLength(4);
      expect(measureGeometryEdges(rectangle, footprint).every((item) => item.layer === "site")).toBe(true);
    },
  );

  it("retains exact short and zero edges, and does not repair an open input ring", () => {
    const source: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [1e-10, 0], [1e-10, 0], [0, 0]]] };
    expect(measureGeometryEdges(source).map((item) => item.lengthM)).toEqual([1e-10, 0, 1e-10]);
    expect(measureGeometryEdges({ type: "Polygon", coordinates: [[[0, 0], [3, 0], [3, 4]]] })
      .map((item) => item.lengthM)).toEqual([3, 4]);
    expect(measureGeometryEdges({ type: "Polygon", coordinates: [[], [[1, 1]]] })).toEqual([]);
  });

  it("preserves high-offset precision and uses no area, setback, or repair calculations", () => {
    const offset: PolygonGeometry = { type: "Polygon", coordinates: [[[1e12, -1e12], [1e12 + 3, -1e12 + 4], [1e12, -1e12]]] };
    const crossed: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]] };
    expect(measureGeometryEdges(offset).map((item) => item.lengthM)).toEqual([5, 5]);
    expect(measureGeometryEdges(crossed).map((item) => item.from)).toEqual(crossed.coordinates[0].slice(0, -1));
  });

  it.each([Infinity, NaN])("marks non-finite coordinates unavailable instead of reporting zero: %s", (invalid) => {
    const source: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [invalid, 0], [0, 0]]] };
    expect(measureGeometryEdges(source).map((item) => item.lengthM)).toEqual([null, null]);
  });

  it("marks an unrepresentable length unavailable", () => {
    const source: PolygonGeometry = { type: "Polygon", coordinates: [[[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0], [-Number.MAX_VALUE, 0]]] };
    expect(measureGeometryEdges(source).map((item) => item.lengthM)).toEqual([null, null]);
  });

  it("keeps every edge inspectable for a densely segmented polygon", () => {
    const ring = Array.from({ length: 400 }, (_, index): Position => [100 + 80 * Math.cos(index * Math.PI / 200), 100 + 80 * Math.sin(index * Math.PI / 200)]);
    const geometry: PolygonGeometry = { type: "Polygon", coordinates: [[...ring, ring[0]]] };
    expect(measureGeometryEdges(geometry)).toHaveLength(400);
    expect(measureGeometryEdges(geometry).every((item) => item.lengthM !== null && item.lengthM > 0)).toBe(true);
  });
});

describe("layoutAllDimensions", () => {
  const site: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]] };
  const footprint: PolygonGeometry = { type: "Polygon", coordinates: [[[3, 3], [37, 3], [37, 22], [3, 22], [3, 3]]] };
  const transform = createViewportTransform(geometryBounds(site)!, { ...viewport, padding: 24 })!;

  function overlapCount(annotations: ReturnType<typeof layoutAllDimensions>["annotations"]): number {
    let count = 0;
    annotations.forEach(({ label }, index) => {
      for (const { label: other } of annotations.slice(index + 1)) {
        const x = Math.min(label.x + label.width / 2, other.x + other.width / 2)
          - Math.max(label.x - label.width / 2, other.x - other.width / 2);
        const y = Math.min(label.y + label.height / 2, other.y + other.height / 2)
          - Math.max(label.y - label.height / 2, other.y - other.height / 2);
        if (x > 1e-8 && y > 1e-8) count++;
      }
    });
    return count;
  }

  it.each([640, 390, 320, 248])("shows every rectangle measurement with compact bounded labels at %s px", (clientWidth) => {
    const edges = measureGeometryEdges(site, footprint);
    const snapshot = structuredClone(edges);
    const overview = layoutAllDimensions(edges, transform, viewport, clientWidth);
    expect(overview.annotations.map(({ edge }) => edge.id)).toEqual(edges.map(({ id }) => id));
    expect(overview.annotations).toHaveLength(8);
    expect(overview.unavailableIds).toEqual([]);
    expect(overview.crowded).toBe(false);
    expect(overlapCount(overview.annotations)).toBe(0);
    overview.annotations.forEach(({ edge, anchor, label, leader }) => {
      expect(label.fontSize * clientWidth / viewport.width).toBeCloseTo(10);
      expect(label.text).toBe(formatDimensionLength(edge.lengthM));
      const from = transform(edge.from);
      const to = transform(edge.to);
      expect(anchor).toEqual([from[0] / 2 + to[0] / 2, from[1] / 2 + to[1] / 2]);
      expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0);
      expect(label.y - label.height / 2).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width / 2).toBeLessThanOrEqual(viewport.width);
      expect(label.y + label.height / 2).toBeLessThanOrEqual(viewport.height);
      expect([anchor, ...(leader ?? [])].flat().every(Number.isFinite)).toBe(true);
    });
    expect(edges).toEqual(snapshot);
    expect(layoutAllDimensions(edges, transform, viewport, clientWidth)).toEqual(overview);
  });

  it("retains coincident site, footprint, and hole edges as distinct measurements", () => {
    const holed = structuredClone(site);
    holed.coordinates.push([[8, 8], [12, 8], [12, 12], [8, 12], [8, 8]]);
    const original = structuredClone(holed);
    const edges = measureGeometryEdges(holed, holed);
    const overview = layoutAllDimensions(edges, transform, viewport, 640);
    expect(overview.annotations).toHaveLength(16);
    expect(new Set(overview.annotations.map(({ edge }) => edge.id)).size).toBe(16);
    expect(overview.annotations.filter(({ edge }) => edge.ringIndex === 1)).toHaveLength(8);
    expect(overview.annotations.map(({ label }) => label.text)).toEqual(edges.map(({ lengthM }) => formatDimensionLength(lengthM)));
    expect(overview.unavailableIds).toEqual([]);
    expect(holed).toEqual(original);
  });

  it("shows concave, short, and zero-length edges without rounding, omitting, or repairing them", () => {
    const geometry: PolygonGeometry = { type: "Polygon", coordinates: [[[0, 0], [1e-6, 0], [1e-6, 0], [40, 0], [40, 15], [20, 15], [20, 30], [0, 30], [0, 0]]] };
    const edges = measureGeometryEdges(geometry);
    const original = structuredClone(edges);
    const frame = createViewportTransform(geometryBounds(geometry)!, { ...viewport, padding: 24 })!;
    const overview = layoutAllDimensions(edges, frame, viewport, 320);
    expect(overview.annotations).toHaveLength(edges.length);
    expect(overview.annotations[0].label.text).toBe("1.00e-6 m");
    expect(overview.annotations[1].label.text).toBe("0 m");
    expect(overview.annotations[0].leader).not.toBeNull();
    expect(edges).toEqual(original);
    expect(overview.unavailableIds).toEqual([]);
  });

  it("keeps every dense-polygon edge and reports unavoidable crowding honestly", () => {
    const ring = Array.from({ length: 100 }, (_, index): Position => [320 + Math.cos(index * Math.PI / 50) * 220, 200 + Math.sin(index * Math.PI / 50) * 150]);
    const edges = measureGeometryEdges({ type: "Polygon", coordinates: [[...ring, ring[0]]] });
    const compact = layoutAllDimensions(edges, identity, viewport, 248);
    const enlarged = layoutAllDimensions(edges, identity, viewport, 1280);
    expect(compact.annotations).toHaveLength(100);
    expect(compact.annotations.map(({ edge }) => edge.id)).toEqual(edges.map(({ id }) => id));
    expect(compact.crowded).toBe(true);
    expect(compact.unavailableIds).toEqual([]);
    expect(enlarged.annotations).toHaveLength(100);
    expect(overlapCount(enlarged.annotations)).toBeLessThan(overlapCount(compact.annotations));
  });

  it("reports unsafe or unusable labels separately instead of fabricating or silently losing them", () => {
    const edges = measureGeometryEdges(site);
    const invalid = { ...edges[0], id: "unavailable", lengthM: null };
    const overview = layoutAllDimensions([...edges, invalid], transform, viewport, 640);
    expect(overview.annotations).toHaveLength(4);
    expect(overview.unavailableIds).toEqual(["unavailable"]);
    const tiny = layoutAllDimensions(edges, transform, viewport, 20);
    expect(tiny.annotations).toEqual([]);
    expect(tiny.unavailableIds).toEqual(edges.map(({ id }) => id));
    expect(layoutAllDimensions(edges, () => [NaN, Infinity], viewport, 640).unavailableIds)
      .toEqual(edges.map(({ id }) => id));
    expect(layoutAllDimensions(edges, transform, viewport, 0).unavailableIds)
      .toEqual(edges.map(({ id }) => id));
    expect(layoutAllDimensions(edges, transform, viewport, 1e308).unavailableIds)
      .toEqual(edges.map(({ id }) => id));
  });
});

describe("formatDimensionLength", () => {
  it.each([
    [0, "0 m"], [3, "3 m"], [3.456, "3.46 m"], [1234.567, "1,234.57 m"],
    [0.00999, "9.99e-3 m"], [1e-10, "1.00e-10 m"], [1e-310, "1.00e-310 m"],
    [1e6, "1.00e+6 m"], [1e100, "1.00e+100 m"],
    [null, "Not available"], [Infinity, "Not available"], [NaN, "Not available"], [-1, "Not available"],
  ])("formats %s as %s", (length, expected) => {
    expect(formatDimensionLength(length)).toBe(expected);
  });
});

describe("layoutDimension", () => {
  it.each([
    [[100, 100], [300, 100]], [[300, 100], [100, 100]],
    [[100, 100], [100, 300]], [[100, 300], [100, 100]],
    [[100, 100], [300, 300]], [[300, 300], [100, 100]],
    [[300, 100], [100, 300]], [[100, 300], [300, 100]],
  ] satisfies [Position, Position][])("keeps a readable horizontal label for oriented edge %j → %j", (from, to) => {
    const selected = edge(from, to);
    const layout = requiredLayout(selected);
    expect(layout.from).toEqual(from);
    expect(layout.to).toEqual(to);
    expect(layout.label.text).toBe(formatDimensionLength(selected.lengthM));
    expect(layout.label.fontSize).toBe(12);
    expect(layout.ticks).toHaveLength(2);
    expect(layout.extensionLines).toHaveLength(2);
    const originalVector = [to[0] - from[0], to[1] - from[1]];
    const dimensionVector = [layout.lineTo[0] - layout.lineFrom[0], layout.lineTo[1] - layout.lineFrom[1]];
    expect(originalVector[0] * dimensionVector[1] - originalVector[1] * dimensionVector[0]).toBeCloseTo(0, 8);
    expectLabelWithinViewport(layout);
  });

  it.each([640, 390, 320, 248])("preserves approximately 12 CSS px text at a %s px client width without refitting geometry", (clientWidth) => {
    const transform = createViewportTransform(geometryBounds(rectangle)!, { ...viewport, padding: 24 })!;
    const selected = measureGeometryEdges(rectangle)[0];
    const layout = requiredLayout(selected, transform, clientWidth);
    expect(layout.label.fontSize * clientWidth / viewport.width).toBeCloseTo(12, 10);
    expect(layout.label.height * clientWidth / viewport.width).toBeCloseTo(22, 10);
    expect(layout.from).toEqual(transform(selected.from));
    expect(layout.to).toEqual(transform(selected.to));
    expectLabelWithinViewport(layout);
  });

  it("chooses an in-frame normal side rather than putting an offset dimension outside the plot", () => {
    const layout = requiredLayout(edge([24, 376], [616, 376]), identity, 248);
    expect(layout.lineFrom[1]).toBeLessThan(376);
    expect(layout.lineTo[1]).toBeLessThan(376);
    expectLabelWithinViewport(layout);
  });

  it("clamps the whole label and connects it with a leader when the edge is close to a border", () => {
    const layout = requiredLayout(edge([5, 5], [5, 395]), identity, 248);
    expect(layout.leader).not.toBeNull();
    expectLabelWithinViewport(layout);
  });

  it.each([
    [[100, 100], [100.00001, 100]], [[100, 100], [100, 100]],
  ] satisfies [Position, Position][])("uses a leader for short or zero projected edge %j → %j", (from, to) => {
    const selected = edge(from, to);
    const layout = requiredLayout(selected);
    expect(layout.shortEdge).toBe(true);
    expect(layout.leader).not.toBeNull();
    expect(layout.label.text).toBe(formatDimensionLength(selected.lengthM));
    expectLabelWithinViewport(layout);
  });

  it("handles tiny model coordinates and large coordinate offsets through the supplied common frame", () => {
    for (const geometry of [
      { type: "Polygon", coordinates: [[[0, 0], [0.0003, 0], [0.0003, 0.0004], [0, 0]]] },
      { type: "Polygon", coordinates: [[[1e12, -1e12], [1e12 + 120, -1e12], [1e12 + 120, -1e12 + 80], [1e12, -1e12]]] },
    ] satisfies PolygonGeometry[]) {
      const transform = createViewportTransform(geometryBounds(geometry)!, { ...viewport, padding: 24 })!;
      const snapshot = structuredClone(geometry);
      for (const selected of measureGeometryEdges(geometry)) expectLabelWithinViewport(requiredLayout(selected, transform, 248));
      expect(geometry).toEqual(snapshot);
    }
  });

  it("lays out a concave hole edge without changing its layer or ring identity", () => {
    const selected: DimensionEdge = { ...edge([100, 100], [140, 140]), id: "footprint-1-2", layer: "footprint", ringIndex: 1, edgeIndex: 2 };
    const original = structuredClone(selected);
    const first = requiredLayout(selected);
    expect(requiredLayout(selected)).toEqual(first);
    expect(selected).toEqual(original);
    expect(dimensionEdgeLabel(selected)).toBe("Footprint hole 1 · edge 3");
  });

  it.each([
    [{ width: 0, height: 400 }, 640], [{ width: 640, height: -1 }, 640],
    [{ width: Infinity, height: 400 }, 640], [{ width: 640, height: NaN }, 640],
    [viewport, 0], [viewport, -1], [viewport, Infinity], [viewport, NaN],
    [viewport, 20], [{ width: 640, height: 5 }, 640],
  ])("declines unusable logical/client frame %j / %s", (frame, clientWidth) => {
    expect(layoutDimension(edge([100, 100], [300, 100]), identity, frame, clientWidth)).toBeNull();
  });

  it("declines unavailable lengths and unprojectable coordinates instead of fabricating annotations", () => {
    const selected = edge([100, 100], [300, 100]);
    for (const lengthM of [null, NaN, Infinity, -1]) {
      expect(layoutDimension({ ...selected, lengthM }, identity, viewport, 640)).toBeNull();
    }
    expect(layoutDimension(selected, () => [NaN, Infinity], viewport, 640)).toBeNull();
  });
});
