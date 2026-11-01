// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DoubleSide,
  ExtrudeGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  ShapeUtils,
  Vector3,
} from "three";
import type { MassingPreviewResponse } from "../../api/contracts";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { previewResponse } from "../../test/massingFixtures";
import {
  createPolygonShape,
  fitMassingCamera,
  MAX_DISPLAY_FLOORS,
  MAX_DISPLAY_TRIANGLES,
  MAX_DISPLAY_VERTICES,
  prepareMassingScene,
  toWorldPosition,
  type PreparedMassingScene,
} from "./massing3DGeometry";

function sceneFor(result: MassingPreviewResponse): PreparedMassingScene {
  const prepared = prepareMassingScene(result);
  if (!("scene" in prepared)) throw new Error(prepared.message);
  return prepared.scene;
}

function withoutBuilding(): MassingPreviewResponse {
  return backendPreviewResponse("preferred_failed");
}

function manyVertexBuilding(vertices: number, floors: number): MassingPreviewResponse {
  const result = previewResponse();
  const ring = Array.from({ length: vertices }, (_, index): [number, number] => {
    const angle = index * 2 * Math.PI / vertices;
    return [20 + 20 * Math.cos(angle), 12.5 + 12.5 * Math.sin(angle)];
  });
  ring.push([...ring[0]]);
  const polygon = { type: "Polygon" as const, coordinates: [ring] };
  result.site_geometry = polygon;
  result.buildable_geometry = polygon;
  result.selected_buildable_geometry = polygon;
  result.footprint_geometry = polygon;
  result.floor_plate_geometry = polygon;
  result.metrics.floor_count = floors;
  result.metrics.height_m = floors * result.metrics.floor_to_floor_m;
  return result;
}

function freeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

function transformCoordinates(result: MassingPreviewResponse, scale: number, offset: number): void {
  const geometries = [result.site_geometry, result.buildable_geometry, result.selected_buildable_geometry, result.footprint_geometry, result.floor_plate_geometry];
  const transformed = new Set<object>();
  for (const geometry of geometries) {
    if (geometry === null || transformed.has(geometry)) continue;
    transformed.add(geometry);
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) for (const point of ring) {
      point[0] = point[0] * scale + offset;
      point[1] = point[1] * scale + offset;
    }
  }
  result.metrics.floor_to_floor_m *= scale;
  if (result.metrics.height_m !== null) result.metrics.height_m *= scale;
}

describe("prepareMassingScene", () => {
  it("maps backend XY into a centered world frame with one uniform scale", () => {
    const scene = sceneFor(previewResponse());
    expect(scene.frame).toEqual({ origin: [20, 12.5], scale: 0.25 });
    expect(toWorldPosition(scene.frame, [0, 0], 0)).toEqual([-5, 0, 3.125]);
    expect(toWorldPosition(scene.frame, [40, 25], 21)).toEqual([5, 5.25, -3.125]);
    expect(scene.bounds).toEqual({ min: [-5, 0, -3.125], max: [5, 5.25, 3.125] });
    expect(scene.site[0].rings[0]).toHaveLength(4);
    expect(scene.building?.floorHeight).toBe(0.875);
    expect(scene.building?.totalHeight).toBe(5.25);
    expect(scene.building?.floorElevations).toEqual([0, 0.875, 1.75, 2.625, 3.5, 4.375]);
  });

  it.each([1, 3, 9, MAX_DISPLAY_FLOORS])("places exactly %i actual floors independently of capacity", (count) => {
    const result = previewResponse();
    result.metrics.floor_count = count;
    result.metrics.height_m = count * result.metrics.floor_to_floor_m;
    result.metrics.maximum_permitted_floor_count = 999;
    result.hard_constraints.max_height_m = 10_000;
    const building = sceneFor(result).building;
    expect(building?.floorCount).toBe(count);
    expect(building?.floorElevations).toHaveLength(count);
    expect(building?.floorElevations.at(-1)).toBeCloseTo((count - 1) * (building?.floorHeight ?? 0));
    expect((building?.floorElevations.at(-1) ?? 0) + (building?.floorHeight ?? 0)).toBeCloseTo(building?.totalHeight ?? 0);
  });

  it("preserves the backend's nine-floor binary64 height-boundary outcome", () => {
    const result = previewResponse();
    result.hard_constraints.max_height_m = 36;
    result.hard_constraints.floor_to_floor_m = 3.6;
    result.metrics.floor_to_floor_m = 3.6;
    result.metrics.floor_count = 9;
    result.metrics.height_m = 32.4;
    expect(sceneFor(result).building?.floorCount).toBe(9);
  });

  it("uses the actual preferred footprint rather than the generated default", () => {
    const result = backendPreviewResponse("preferred");
    const scene = sceneFor(result);
    const source = result.footprint_geometry?.coordinates[0][0];
    expect(source).toBeDefined();
    expect(result.generated_footprint_geometry).not.toEqual(result.footprint_geometry);
    expect(scene.building?.footprint.rings[0][0]).toEqual([
      ((source?.[0] ?? 0) - scene.frame.origin[0]) * scene.frame.scale,
      ((source?.[1] ?? 0) - scene.frame.origin[1]) * scene.frame.scale,
    ]);
  });

  it("keeps every split setback component separate from backend selection", () => {
    const scene = sceneFor(backendPreviewResponse("notched"));
    expect(scene.site).toHaveLength(1);
    expect(scene.buildable).toHaveLength(2);
    expect(scene.selectedBuildable).toHaveLength(1);
    expect(scene.buildable[0]).not.toEqual(scene.buildable[1]);
    expect(scene.buildable).toContainEqual(scene.selectedBuildable[0]);
    expect(scene.building?.floorCount).toBe(6);
  });

  it("preserves exterior and hole rings in every supplied layer", () => {
    const scene = sceneFor(backendPreviewResponse("holed"));
    for (const polygon of [...scene.site, ...scene.buildable, ...scene.selectedBuildable]) {
      expect(polygon.rings).toHaveLength(2);
      expect(polygon.rings.map((ring) => ring.length)).toEqual([4, 4]);
    }
    expect(scene.building?.footprint.rings).toHaveLength(2);
    expect(scene.building?.floorPlate.rings).toHaveLength(2);
  });

  it("preserves a concave site's notch without convexifying it", () => {
    const result = withoutBuilding();
    result.site_geometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [40, 0], [40, 10], [10, 10], [10, 25], [0, 25], [0, 0]]],
    };
    result.buildable_geometry = null;
    result.selected_buildable_geometry = null;
    const scene = sceneFor(result);
    expect(scene.site[0].rings[0]).toHaveLength(6);
    expect(scene.site[0].rings[0][3]).toEqual([-2.5, -0.625]);
  });

  it("renders available context when actual building fields are null, ignoring default capacity", () => {
    const result = withoutBuilding();
    expect(result.generated_footprint_geometry).not.toBeNull();
    expect(result.metrics.maximum_permitted_floor_count).toBe(6);
    const prepared = prepareMassingScene(result);
    expect(prepared.status).toBe("context-only");
    const scene = sceneFor(result);
    expect(scene.building).toBeNull();
    expect(scene.buildable).toHaveLength(1);
    expect(scene.bounds.max[1]).toBe(0);
  });

  it("supports a zero-buildable-region diagnostic without inventing a building", () => {
    const result = withoutBuilding();
    result.buildable_geometry = null;
    result.selected_buildable_geometry = null;
    result.metrics.buildable_area_m2 = 0;
    result.metrics.selected_buildable_area_m2 = 0;
    result.feasibility.status = "infeasible";
    result.feasibility.reason = "EMPTY_BUILDABLE_REGION";
    const scene = sceneFor(result);
    expect(scene.building).toBeNull();
    expect(scene.buildable).toEqual([]);
    expect(scene.selectedBuildable).toEqual([]);
    expect(scene.site).toHaveLength(1);
  });

  it("renders an existing building whose GFA target is unmet", () => {
    const result = previewResponse();
    result.feasibility.status = "feasible_target_unmet";
    expect(prepareMassingScene(result).status).toBe("ready");
  });

  it("does not mutate or retain coordinate-array references from the backend response", () => {
    const result = backendPreviewResponse("holed");
    const original = structuredClone(result);
    freeze(result);
    const scene = sceneFor(result);
    createPolygonShape(scene.site[0]);
    expect(result).toEqual(original);
    scene.site[0].rings[0][0][0] += 1;
    expect(result).toEqual(original);
  });

  it.each([1e-6, 1e100])("normalizes scale %s uniformly without changing geometry proportions", (scale) => {
    const baseline = sceneFor(structuredClone(previewResponse()));
    const result = structuredClone(previewResponse());
    transformCoordinates(result, scale, 0);
    const scene = sceneFor(result);
    expect(scene.building?.floorHeight).toBeCloseTo(baseline.building?.floorHeight ?? 0);
    expect(scene.building?.totalHeight).toBeCloseTo(baseline.building?.totalHeight ?? 0);
    for (const [index, point] of scene.site[0].rings[0].entries()) {
      expect(point[0]).toBeCloseTo(baseline.site[0].rings[0][index][0]);
      expect(point[1]).toBeCloseTo(baseline.site[0].rings[0][index][1]);
    }
  });

  it("centers large coordinate offsets before Float32 conversion", () => {
    const result = structuredClone(previewResponse());
    transformCoordinates(result, 1, 1e12);
    const scene = sceneFor(result);
    expect(scene.frame.origin).toEqual([1e12 + 20, 1e12 + 12.5]);
    expect(scene.site[0].rings).toEqual(sceneFor(previewResponse()).site[0].rings);
  });

  it.each([
    ["missing footprint", (result: MassingPreviewResponse) => { result.footprint_geometry = null; }],
    ["missing floor plate", (result: MassingPreviewResponse) => { result.floor_plate_geometry = null; }],
    ["missing actual count", (result: MassingPreviewResponse) => { result.metrics.floor_count = null; }],
    ["missing actual height", (result: MassingPreviewResponse) => { result.metrics.height_m = null; }],
    ["missing actual area", (result: MassingPreviewResponse) => { result.metrics.footprint_area_m2 = null; }],
    ["missing actual GFA", (result: MassingPreviewResponse) => { result.metrics.gfa_m2 = null; }],
    ["missing actual coverage", (result: MassingPreviewResponse) => { result.metrics.site_coverage_ratio = null; }],
    ["zero floor count", (result: MassingPreviewResponse) => { result.metrics.floor_count = 0; }],
    ["fractional floor count", (result: MassingPreviewResponse) => { result.metrics.floor_count = 2.5; }],
    ["unsafe floor count", (result: MassingPreviewResponse) => { result.metrics.floor_count = Number.MAX_SAFE_INTEGER + 1; }],
    ["zero spacing", (result: MassingPreviewResponse) => { result.metrics.floor_to_floor_m = 0; }],
    ["infinite spacing", (result: MassingPreviewResponse) => { result.metrics.floor_to_floor_m = Infinity; }],
    ["inconsistent height", (result: MassingPreviewResponse) => { result.metrics.height_m = 22; }],
  ])("rejects %s as invalid display data", (_name, mutate) => {
    const result = structuredClone(previewResponse());
    mutate(result);
    expect(prepareMassingScene(result).status).toBe("invalid");
  });

  it("rejects a different repeated floor plate instead of choosing a substitute", () => {
    const result = structuredClone(previewResponse());
    result.floor_plate_geometry = structuredClone(result.floor_plate_geometry);
    if (result.floor_plate_geometry) result.floor_plate_geometry.coordinates[0][1][0] -= 1;
    expect(prepareMassingScene(result).status).toBe("invalid");
  });

  it.each([
    { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [1, 1]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [NaN, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1, 2], [0, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0], [0, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]] },
  ])("rejects malformed or undisplayable site rings: %j", (site) => {
    const result = { ...previewResponse(), site_geometry: site } as unknown as MassingPreviewResponse;
    expect(prepareMassingScene(result).status).toBe("invalid");
  });

  it("reports unsupported geometry types explicitly", () => {
    const result = { ...previewResponse(), site_geometry: { type: "LineString", coordinates: [] } } as unknown as MassingPreviewResponse;
    expect(prepareMassingScene(result)).toMatchObject({ status: "unsupported", planAvailable: false });
  });

  it("rejects a floor resource budget before constructing placements", () => {
    const result = previewResponse();
    result.metrics.floor_count = MAX_DISPLAY_FLOORS + 1;
    result.metrics.height_m = (MAX_DISPLAY_FLOORS + 1) * result.metrics.floor_to_floor_m;
    expect(prepareMassingScene(result)).toEqual({ status: "unsupported", message: expect.stringContaining("floor display limit"), planAvailable: true });
  });

  it("rejects a vertex resource budget without simplifying source rings", () => {
    const result = previewResponse();
    result.site_geometry = { type: "Polygon", coordinates: [Array.from({ length: MAX_DISPLAY_VERTICES + 2 }, () => [0, 0])] };
    expect(prepareMassingScene(result)).toEqual({ status: "unsupported", message: expect.stringContaining("vertex display limit"), planAvailable: false });
  });

  it("allows the exact combined triangle budget using Three's actual cap and wall counts", () => {
    const result = manyVertexBuilding(251, 500);
    const scene = sceneFor(result);
    expect(scene.building?.floorCount).toBe(500);
    const building = scene.building;
    if (!building) throw new Error("Expected an actual building at the triangle limit.");
    const geometry = new ExtrudeGeometry(createPolygonShape(building.floorPlate), {
      depth: building.floorHeight,
      bevelEnabled: false,
      steps: 1,
    });
    try {
      const triangles = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      expect(triangles).toBe(1000);
      expect(triangles * 500).toBe(MAX_DISPLAY_TRIANGLES);
    } finally {
      geometry.dispose();
    }
  });

  it("rejects one additional floor above the combined triangle budget without truncation", () => {
    const result = manyVertexBuilding(251, 501);
    const original = structuredClone(result);
    expect(prepareMassingScene(result)).toEqual({ status: "unsupported", message: expect.stringContaining("triangle display limit"), planAvailable: true });
    expect(result).toEqual(original);
  });

  it("bounds combined work even when source vertices and floor count fit their individual budgets", () => {
    const result = manyVertexBuilding(MAX_DISPLAY_VERTICES / 5, MAX_DISPLAY_FLOORS);
    expect(prepareMassingScene(result)).toEqual({ status: "unsupported", message: expect.stringContaining("triangle display limit"), planAvailable: true });
  });

  it("reports distinct edges lost at Float32 precision instead of rounding them away", () => {
    const result = previewResponse();
    result.site_geometry = { type: "Polygon", coordinates: [[[0, 0], [1e-12, 0], [40, 0], [40, 25], [0, 25], [0, 0]]] };
    expect(prepareMassingScene(result)).toEqual({ status: "unsupported", message: expect.stringContaining("vertices collapse"), planAvailable: true });
  });

  it("rejects coordinate ranges that cannot produce a finite common frame", () => {
    const result = withoutBuilding();
    result.site_geometry = { type: "Polygon", coordinates: [[[-1e308, 0], [1e308, 0], [1e308, 1], [-1e308, 1], [-1e308, 0]]] };
    expect(prepareMassingScene(result).status).toBe("unsupported");
  });

  it("rejects floors too thin for the shared display scale", () => {
    const result = previewResponse();
    result.metrics.floor_to_floor_m = 1e-100;
    result.metrics.height_m = 6e-100;
    expect(prepareMassingScene(result).status).toBe("unsupported");
  });
});

describe("createPolygonShape", () => {
  it.each([false, true])("keeps holes open when both source rings are clockwise: %s", (clockwise) => {
    const polygon = {
      rings: [
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [[3, 3], [7, 3], [7, 7], [3, 7]],
      ] as [number, number][][],
    };
    if (clockwise) polygon.rings.forEach((ring) => ring.reverse());
    const original = structuredClone(polygon);
    const shape = createPolygonShape(polygon);
    expect(shape.holes).toHaveLength(1);
    expect(ShapeUtils.isClockWise(shape.getPoints())).toBe(true);
    expect(ShapeUtils.isClockWise(shape.holes[0].getPoints())).toBe(false);
    const geometry = new ExtrudeGeometry(shape, { depth: 3.5, bevelEnabled: false, steps: 1 });
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    try {
      const ray = new Raycaster(new Vector3(5, 5, 10), new Vector3(0, 0, -1));
      expect(ray.intersectObject(mesh)).toHaveLength(0);
      ray.set(new Vector3(1, 1, 10), new Vector3(0, 0, -1));
      expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0]);
      expect(geometry.boundingBox?.max.toArray()).toEqual([10, 10, 3.5]);
      expect(polygon).toEqual(original);
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });
});

describe("fitMassingCamera", () => {
  it.each([0.4, 1, 2.5])("fits the full original site and actual building at aspect %s", (aspect) => {
    const scene = sceneFor(previewResponse());
    const fit = fitMassingCamera(scene, aspect);
    const camera = new PerspectiveCamera(45, aspect, fit.near, fit.far);
    camera.position.fromArray(fit.position);
    camera.lookAt(...fit.target);
    camera.updateMatrixWorld();
    for (const x of [scene.bounds.min[0], scene.bounds.max[0]]) {
      for (const y of [scene.bounds.min[1], scene.bounds.max[1]]) {
        for (const z of [scene.bounds.min[2], scene.bounds.max[2]]) {
          const point = new Vector3(x, y, z).project(camera);
          expect(Math.abs(point.x)).toBeLessThan(1);
          expect(Math.abs(point.y)).toBeLessThan(1);
          expect(point.z).toBeGreaterThan(-1);
          expect(point.z).toBeLessThan(1);
        }
      }
    }
    expect(fit.minDistance).toBeGreaterThan(fit.near);
    expect(fit.maxDistance).toBeLessThan(fit.far);
  });

  it("fits a tall building without changing the original site frame", () => {
    const result = previewResponse();
    result.metrics.floor_count = 100;
    result.metrics.height_m = 350;
    const scene = sceneFor(result);
    const fit = fitMassingCamera(scene, 0.5);
    expect(scene.frame.origin).toEqual([20, 12.5]);
    expect(scene.bounds.max[1]).toBe(10);
    expect(fit.target[1]).toBe(5);
  });

  it("fits a diagnostic site without a fabricated vertical extent", () => {
    const scene = sceneFor(withoutBuilding());
    expect(fitMassingCamera(scene, 1).target[1]).toBe(0);
  });

  it.each([0, -1, Infinity, NaN, Number.MIN_VALUE])("rejects an unusable aspect ratio %s", (aspect) => {
    expect(() => fitMassingCamera(sceneFor(previewResponse()), aspect)).toThrow(RangeError);
  });

  it.each([0, -1, 180, Infinity, NaN])("rejects an unusable field of view %s", (fov) => {
    expect(() => fitMassingCamera(sceneFor(previewResponse()), 1, fov)).toThrow(RangeError);
  });
});
