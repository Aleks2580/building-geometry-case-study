import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PolygonGeometry } from "../../api/contracts";
import { createRectangleSite, exampleSite } from "./siteGeometry";
import type { SiteExampleKind } from "./siteGeometry";

type Position = PolygonGeometry["coordinates"][number][number];

function sourceVertices(name: "rectangle" | SiteExampleKind): Position[] {
  const source = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), `../../../../data/sites/${name}.json`), "utf8",
  )) as { polygon: Position[] };
  return source.polygon;
}

describe("createRectangleSite", () => {
  it("matches the supplied 40 by 25 metre rectangle with a closed ring at the origin", () => {
    const vertices = sourceVertices("rectangle");
    expect(createRectangleSite(40, 25)).toEqual({
      type: "Polygon", coordinates: [[...vertices, vertices[0]]],
    });
  });

  it("preserves decimal dimensions without rounding", () => {
    expect(createRectangleSite(40.125, 25.75)).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0], [40.125, 0], [40.125, 25.75], [0, 25.75], [0, 0]]],
    });
  });

  it("returns independent geometry and positions for repeated calls", () => {
    const first = createRectangleSite(40, 25);
    const second = createRectangleSite(40, 25);
    expect(first).toEqual(second);
    expect(first.coordinates[0][0]).not.toBe(first.coordinates[0][4]);
    first.coordinates[0][0][0] = -1;
    first.coordinates[0][1][0] = 100;
    expect(second).toEqual(createRectangleSite(40, 25));
    expect(first.coordinates[0][4]).toEqual([0, 0]);
  });
});

describe("exampleSite", () => {
  it.each(["l-shaped", "notched"] as const)("preserves every canonical %s vertex and appends closure", (kind) => {
    const vertices = sourceVertices(kind);
    const geometry = exampleSite(kind);
    const ring = geometry.coordinates[0];

    expect(geometry).toEqual({ type: "Polygon", coordinates: [[...vertices, vertices[0]]] });
    expect(ring).toHaveLength(vertices.length + 1);
    expect(ring.slice(0, -1)).toEqual(vertices);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
    expect(ring[ring.length - 1]).not.toBe(ring[0]);
  });

  it.each(["l-shaped", "notched"] as const)("returns independent %s geometry without mutating canonical coordinates", (kind) => {
    const first = exampleSite(kind);
    const second = exampleSite(kind);
    expect(first).toEqual(second);
    first.coordinates[0][0][0] = -100;
    first.coordinates[0][1][1] = 100;
    first.coordinates[0].pop();

    expect(second).toEqual(exampleSite(kind));
    expect(second.coordinates[0].slice(0, -1)).toEqual(sourceVertices(kind));
  });
});
