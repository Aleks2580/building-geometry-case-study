import { describe, expect, it } from "vitest";
import { configurationSchema, initialConfigurationDraft } from "./configuration";
import type { ConfigurationDraft } from "./configuration";

function draft(): ConfigurationDraft {
  return structuredClone(initialConfigurationDraft);
}

function issuePaths(value: ConfigurationDraft): string[] {
  const result = configurationSchema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("configurationSchema", () => {
  it("starts with a rectangular site and a valid default configuration", () => {
    const result = configurationSchema.parse(initialConfigurationDraft);

    expect(result).toEqual({
      site: {
        type: "Polygon",
        coordinates: [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]],
      },
      hard_constraints: {
        setback_m: 3,
        floor_to_floor_m: 3.5,
        max_height_m: null,
        max_floors: 6,
        site_coverage_ratio: null,
        max_footprint_m2: null,
      },
      preferences: { preferred_floor_count: null, preferred_footprint_area_m2: null },
      targets: { gfa_target_m2: null },
    });
  });

  it("converts every optional numeric field, including whitespace-only inputs, to null", () => {
    const value = draft();
    value.hard_constraints.max_height_m = "12";
    value.hard_constraints.max_floors = "  ";
    value.hard_constraints.site_coverage_ratio = "\t";
    value.hard_constraints.max_footprint_m2 = "  ";
    value.preferences.preferred_floor_count = "  ";
    value.preferences.preferred_footprint_area_m2 = "  ";
    value.targets.gfa_target_m2 = "  ";

    const result = configurationSchema.parse(value);

    expect(result.hard_constraints).toMatchObject({
      max_height_m: 12,
      max_floors: null,
      site_coverage_ratio: null,
      max_footprint_m2: null,
    });
    expect(result.preferences).toEqual({ preferred_floor_count: null, preferred_footprint_area_m2: null });
    expect(result.targets.gfa_target_m2).toBeNull();
  });

  it("preserves zero setbacks and zero GFA targets", () => {
    const value = draft();
    value.hard_constraints.setback_m = "0";
    value.targets.gfa_target_m2 = "0";

    const result = configurationSchema.parse(value);

    expect(result.hard_constraints.setback_m).toBe(0);
    expect(result.targets.gfa_target_m2).toBe(0);
  });

  it("accepts decimal and scientific numeric inputs without changing their meaning", () => {
    const value = draft();
    value.hard_constraints.setback_m = " .5 ";
    value.hard_constraints.floor_to_floor_m = "3.5e0";
    value.hard_constraints.max_height_m = "+2.4e1";
    value.hard_constraints.site_coverage_ratio = "1.";
    value.hard_constraints.max_footprint_m2 = "5e2";
    value.preferences.preferred_floor_count = "2e0";
    value.preferences.preferred_footprint_area_m2 = "250.5";
    value.targets.gfa_target_m2 = "1e3";

    const result = configurationSchema.parse(value);

    expect(result.hard_constraints).toMatchObject({
      setback_m: 0.5,
      floor_to_floor_m: 3.5,
      max_height_m: 24,
      site_coverage_ratio: 1,
      max_footprint_m2: 500,
    });
    expect(result.preferences).toEqual({ preferred_floor_count: 2, preferred_footprint_area_m2: 250.5 });
    expect(result.targets.gfa_target_m2).toBe(1000);
  });

  it.each(["", "  ", "word", "NaN", "Infinity", "1e999", "0x10", "1,000", "1 2"])(
    "rejects invalid required numeric input %j",
    (input) => {
      const value = draft();
      value.hard_constraints.setback_m = input;

      expect(issuePaths(value)).toContain("hard_constraints.setback_m");
    },
  );

  it.each(["word", "NaN", "Infinity", "1e999", "0x10"])(
    "rejects invalid optional numeric input %j",
    (input) => {
      const value = draft();
      value.targets.gfa_target_m2 = input;

      expect(issuePaths(value)).toContain("targets.gfa_target_m2");
    },
  );

  it.each([
    ["setback_m", "-1"],
    ["floor_to_floor_m", "0"],
    ["max_height_m", "0"],
    ["max_floors", "0"],
    ["max_floors", "1.5"],
    ["max_floors", "9007199254740992"],
    ["site_coverage_ratio", "0"],
    ["site_coverage_ratio", "1.01"],
    ["max_footprint_m2", "0"],
  ] as const)("enforces API bounds for %s=%s", (field, input) => {
    const value = draft();
    value.hard_constraints[field] = input;

    expect(issuePaths(value)).toContain(`hard_constraints.${field}`);
  });

  it.each([
    ["preferred_floor_count", "0"],
    ["preferred_floor_count", "1.5"],
    ["preferred_floor_count", "9007199254740992"],
    ["preferred_footprint_area_m2", "0"],
  ] as const)("enforces preference bounds for %s=%s", (field, input) => {
    const value = draft();
    value.preferences[field] = input;

    expect(issuePaths(value)).toContain(`preferences.${field}`);
  });

  it("rejects a negative GFA target", () => {
    const value = draft();
    value.targets.gfa_target_m2 = "-1";

    expect(issuePaths(value)).toContain("targets.gfa_target_m2");
  });

  it("requires a height or floor cap with an error at the floor-count field", () => {
    const value = draft();
    value.hard_constraints.max_floors = "";

    const result = configurationSchema.safeParse(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ["hard_constraints", "max_floors"],
        message: "Enter a maximum height or maximum floor count (or both).",
      }));
    }
  });

  it("accepts height as the only floor cap and leaves capacity decisions to the backend", () => {
    const value = draft();
    value.hard_constraints.max_height_m = "36";
    value.hard_constraints.floor_to_floor_m = "3.6";
    value.hard_constraints.max_floors = "";
    value.preferences.preferred_floor_count = "10";

    expect(configurationSchema.parse(value).preferences.preferred_floor_count).toBe(10);
  });

  it("accepts edited site coordinates with interior holes", () => {
    const value = draft();
    const site = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]],
        [[5, 5], [5, 10], [10, 10], [10, 5], [5, 5]],
      ],
    };
    value.site = JSON.stringify(site);

    expect(configurationSchema.parse(value).site).toEqual(site);
  });

  it.each([
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({ type: "MultiPolygon", coordinates: [] }),
    JSON.stringify({ type: "Polygon", coordinates: [] }),
    JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] }),
    JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0, 0]]] }),
    JSON.stringify({ type: "Polygon", coordinates: [[["0", 0], [1, 0], [1, 1], ["0", 0]]] }),
    JSON.stringify({ type: "Polygon", coordinates: [[[false, 0], [1, 0], [1, 1], [false, 0]]] }),
    '{"type":"Polygon","coordinates":[[[1e999,0],[1,0],[1,1],[1e999,0]]]}',
    JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]], extra: true }),
  ])("rejects malformed Polygon input %s", (site) => {
    const value = draft();
    value.site = site;

    expect(issuePaths(value)).toContain("site");
  });

  it.each([0, 1])("requires exterior and interior ring %i to be closed", (ringIndex) => {
    const value = draft();
    const coordinates = [
      [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]],
      [[5, 5], [5, 10], [10, 10], [10, 5], [5, 5]],
    ];
    coordinates[ringIndex].pop();
    value.site = JSON.stringify({ type: "Polygon", coordinates });

    expect(issuePaths(value)).toContain("site");
  });

  it("leaves self-intersection and polygon topology validation to the backend", () => {
    const value = draft();
    value.site = JSON.stringify({
      type: "Polygon",
      coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]],
    });

    expect(configurationSchema.safeParse(value).success).toBe(true);
  });
});
