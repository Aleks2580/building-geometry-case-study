import { describe, expect, it } from "vitest";
import { configurationDraftFromOption, configurationSchema, initialConfigurationDraft } from "./configuration";
import type { ConfigurationDraft } from "./configuration";
import { optionResponse } from "../../test/optionFixtures";

function draft(): ConfigurationDraft {
  return structuredClone(initialConfigurationDraft);
}

function issuePaths(value: ConfigurationDraft): string[] {
  const result = configurationSchema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("configurationDraftFromOption", () => {
  it("uses the saved site's coordinates and complete saved configuration without changing the snapshot", () => {
    const saved = optionResponse();
    saved.site_geometry = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [50, 0], [50, 40], [0, 40], [0, 0]],
        [[5, 5], [5, 10], [10, 10], [10, 5], [5, 5]],
      ],
    };
    saved.hard_constraints = {
      setback_m: 0, floor_to_floor_m: 3.25, max_height_m: null,
      max_floors: 4, site_coverage_ratio: 0.6, max_footprint_m2: 400,
    };
    saved.preferences = { preferred_floor_count: 2, preferred_footprint_area_m2: 300 };
    saved.targets = { gfa_target_m2: 0 };
    const original = structuredClone(saved);

    const value = configurationDraftFromOption(saved);

    expect(value.site).toEqual({ kind: "custom", json: JSON.stringify(saved.site_geometry) });
    expect(value.hard_constraints).toEqual({
      setback_m: "0", floor_to_floor_m: "3.25", max_height_m: "",
      max_floors: "4", site_coverage_ratio: "0.6", max_footprint_m2: "400",
    });
    expect(value.preferences).toEqual({ preferred_floor_count: "2", preferred_footprint_area_m2: "300" });
    expect(value.targets).toEqual({ gfa_target_m2: "0" });
    expect(configurationSchema.parse(value)).toEqual({
      site: saved.site_geometry,
      hard_constraints: saved.hard_constraints,
      preferences: saved.preferences,
      targets: saved.targets,
    });
    value.hard_constraints.max_floors = "1";
    value.preferences.preferred_floor_count = "1";
    value.targets.gfa_target_m2 = "100";
    value.site = { kind: "rectangle", width: "1", length: "1" };
    expect(saved).toEqual(original);
  });

  it("maps every absent optional number to an empty field", () => {
    const saved = optionResponse();
    saved.hard_constraints = {
      setback_m: 3, floor_to_floor_m: 3.5, max_height_m: 21,
      max_floors: null, site_coverage_ratio: null, max_footprint_m2: null,
    };
    saved.preferences = { preferred_floor_count: null, preferred_footprint_area_m2: null };
    saved.targets = { gfa_target_m2: null };

    const value = configurationDraftFromOption(saved);

    expect(value.hard_constraints).toMatchObject({
      max_height_m: "21", max_floors: "", site_coverage_ratio: "", max_footprint_m2: "",
    });
    expect(value.preferences).toEqual({ preferred_floor_count: "", preferred_footprint_area_m2: "" });
    expect(value.targets.gfa_target_m2).toBe("");
  });
});

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
    value.site = { kind: "custom", json: JSON.stringify(site) };

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
    value.site = { kind: "custom", json: site };

    expect(issuePaths(value)).toContain("site.json");
  });

  it.each([0, 1])("requires exterior and interior ring %i to be closed", (ringIndex) => {
    const value = draft();
    const coordinates = [
      [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]],
      [[5, 5], [5, 10], [10, 10], [10, 5], [5, 5]],
    ];
    coordinates[ringIndex].pop();
    value.site = { kind: "custom", json: JSON.stringify({ type: "Polygon", coordinates }) };

    expect(issuePaths(value)).toContain("site.json");
  });

  it("leaves self-intersection and polygon topology validation to the backend", () => {
    const value = draft();
    value.site = { kind: "custom", json: JSON.stringify({
      type: "Polygon",
      coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]],
    }) };

    expect(configurationSchema.safeParse(value).success).toBe(true);
  });

  it("creates decimal rectangle coordinates and emits only the API configuration", () => {
    const value = draft();
    value.site = { kind: "rectangle", width: " 40.5 ", length: ".25" };

    const result = configurationSchema.parse(value);

    expect(result.site).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0], [40.5, 0], [40.5, 0.25], [0, 0.25], [0, 0]]],
    });
    expect(Object.keys(result)).toEqual(["site", "hard_constraints", "preferences", "targets"]);
    expect(Object.keys(result.site)).toEqual(["type", "coordinates"]);
  });

  it.each(["width", "length"] as const)("validates the active rectangle %s", (field) => {
    for (const input of ["", " ", "0", "-1", "word", "NaN", "Infinity", "1e999", "0x10", "1,5", "1e-999"]) {
      const value = draft();
      value.site = { kind: "rectangle", width: "40", length: "25", [field]: input };

      expect(issuePaths(value), input).toContain(`site.${field}`);
    }
  });

  it.each(["l-shaped", "notched"] as const)("parses the %s selection to a closed Polygon", (kind) => {
    const value = draft();
    value.site = { kind };

    const result = configurationSchema.parse(value);
    const ring = result.site.coordinates[0];

    expect(result.site.type).toBe("Polygon");
    expect(ring[ring.length - 1]).toEqual(ring[0]);
    expect(result.site).not.toHaveProperty("kind");
  });
});
