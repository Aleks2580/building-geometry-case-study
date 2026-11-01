import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { massingPreviewResponseSchema, type MassingPreviewResponse, type PolygonGeometry } from "../../../api/contracts";
import { previewResponse } from "../../../test/massingFixtures";
import DetailedMetrics from "./DetailedMetrics";

function measurement(section: string, label: string) {
  const region = screen.getByRole("region", { name: section });
  const term = within(region).getByText(label, { selector: "dt" });
  return term.nextElementSibling;
}

function rectangle(width: number, x = 3): PolygonGeometry {
  return { type: "Polygon", coordinates: [[[x, 3], [x + width, 3], [x + width, 23], [x, 23], [x, 3]]] };
}

function distinctMetrics(): MassingPreviewResponse {
  const result = previewResponse();
  result.hard_constraints.max_footprint_m2 = 350;
  result.preferences = { preferred_floor_count: 2, preferred_footprint_area_m2: 200 };
  result.buildable_geometry = { type: "MultiPolygon", coordinates: [rectangle(20).coordinates, rectangle(10, 25).coordinates] };
  result.selected_buildable_geometry = rectangle(20);
  result.generated_footprint_geometry = rectangle(15);
  result.footprint_geometry = rectangle(10);
  result.floor_plate_geometry = rectangle(10);
  result.metrics = {
    ...result.metrics,
    buildable_area_m2: 600,
    selected_buildable_area_m2: 400,
    footprint_area_upper_bound_m2: 350,
    gfa_upper_bound_m2: 2100,
    generated_footprint_area_m2: 300,
    generated_gfa_capacity_m2: 1800,
    footprint_area_m2: 200,
    floor_count: 2,
    height_m: 7,
    gfa_m2: 400,
    site_coverage_ratio: 0.2,
  };
  result.setback = { component_count: 2, retained_area_m2: 400, discarded_area_m2: 200 };
  result.preference_results = {
    preferred_floor_count: 2,
    footprint_area: {
      original_hard_area_upper_bound_m2: 350,
      requested_area_m2: 200,
      effective_target_m2: 200,
      actual_area_m2: 200,
      difference_m2: 0,
      effective_target_undershoot_m2: null,
      status: "met",
      diagnostic_codes: [],
    },
  };
  result.feasibility.target_assessment.actual_m2 = 400;
  return massingPreviewResponseSchema.parse(result);
}

describe("DetailedMetrics", () => {
  it("distinguishes theoretical hard bounds, demonstrated default capacity and selected massing", () => {
    const result = distinctMetrics();
    const original = structuredClone(result);
    render(<DetailedMetrics result={result} />);

    expect(measurement("Hard constraints and capacity", "Maximum permitted floor count")).toHaveTextContent(/^6$/);
    expect(measurement("Hard constraints and capacity", "Hard footprint area upper bound")).toHaveTextContent(/^350 m²$/);
    expect(measurement("Hard constraints and capacity", "Hard GFA upper bound")).toHaveTextContent(/^2,100 m²$/);
    expect(measurement("Generated default capacity", "Generated default footprint area")).toHaveTextContent(/^300 m²$/);
    expect(measurement("Generated default capacity", "Generated default GFA capacity")).toHaveTextContent(/^1,800 m²$/);
    expect(measurement("Actual massing", "Footprint area")).toHaveTextContent(/^200 m²$/);
    expect(measurement("Actual massing", "Floor count")).toHaveTextContent(/^2$/);
    expect(measurement("Actual massing", "Height")).toHaveTextContent(/^7 m$/);
    expect(measurement("Actual massing", "GFA")).toHaveTextContent(/^400 m²$/);
    expect(measurement("Actual massing", "Site coverage ratio")).toHaveTextContent(/^0.2$/);
    expect(measurement("Actual massing", "Floor-to-floor height")).toHaveTextContent(/^3.5 m$/);
    expect(screen.getByText(/theoretical upper bounds do not guarantee/)).toBeInTheDocument();
    expect(screen.getByText(/demonstrated capacity, not a proven optimum/)).toBeInTheDocument();
    expect(screen.getAllByText("Footprint area", { selector: "dt" })).toHaveLength(1);
    expect(result).toEqual(original);
  });

  it("shows complete and selected setback measurements separately", () => {
    render(<DetailedMetrics result={distinctMetrics()} />);

    expect(measurement("Site and setback", "Site area")).toHaveTextContent(/^1,000 m²$/);
    expect(measurement("Site and setback", "Complete buildable area")).toHaveTextContent(/^600 m²$/);
    expect(measurement("Site and setback", "Selected buildable component area")).toHaveTextContent(/^400 m²$/);
    expect(measurement("Site and setback", "Setback component count")).toHaveTextContent(/^2$/);
    expect(measurement("Site and setback", "Retained setback area")).toHaveTextContent(/^400 m²$/);
    expect(measurement("Site and setback", "Discarded setback area")).toHaveTextContent(/^200 m²$/);
  });

  it.each(["infeasible", "generation_failed"] as const)("does not invent selected or generated metrics for %s", (status) => {
    const result = previewResponse();
    result.feasibility.status = status;
    result.feasibility.hard_constraints_satisfied = status === "infeasible" ? false : null;
    result.feasibility.reason = status === "infeasible" ? "ZERO_PERMITTED_FLOORS" : "FOOTPRINT_NOT_GENERATED";
    result.metrics.generated_footprint_area_m2 = null;
    result.metrics.generated_gfa_capacity_m2 = null;
    result.metrics.footprint_area_m2 = null;
    result.metrics.floor_count = null;
    result.metrics.height_m = null;
    result.metrics.gfa_m2 = null;
    result.metrics.site_coverage_ratio = null;
    result.generated_footprint_geometry = null;
    result.footprint_geometry = null;
    result.floor_plate_geometry = null;
    result.feasibility.target_assessment.actual_m2 = null;
    if (status === "infeasible") {
      result.hard_constraints.max_height_m = 1;
      result.metrics.maximum_permitted_floor_count = 0;
      result.metrics.gfa_upper_bound_m2 = 0;
    }
    render(<DetailedMetrics result={massingPreviewResponseSchema.parse(result)} />);

    for (const label of ["Footprint area", "Floor count", "Height", "GFA", "Site coverage ratio"]) {
      expect(measurement("Actual massing", label)).toHaveTextContent(/^Not available$/);
    }
    expect(measurement("Generated default capacity", "Generated default footprint area")).toHaveTextContent(/^Not available$/);
    expect(measurement("Generated default capacity", "Generated default GFA capacity")).toHaveTextContent(/^Not available$/);
    expect(measurement("Actual massing", "Floor-to-floor height")).toHaveTextContent(/^3.5 m$/);
  });

  it("retains known default capacity after a preferred footprint construction fails", () => {
    const result = distinctMetrics();
    result.feasibility.status = "generation_failed";
    result.feasibility.reason = "PREFERRED_FOOTPRINT_NOT_GENERATED";
    result.feasibility.hard_constraints_satisfied = null;
    result.metrics.footprint_area_m2 = null;
    result.metrics.floor_count = null;
    result.metrics.height_m = null;
    result.metrics.gfa_m2 = null;
    result.metrics.site_coverage_ratio = null;
    result.footprint_geometry = null;
    result.floor_plate_geometry = null;
    result.feasibility.target_assessment.actual_m2 = null;
    const preference = result.preference_results.footprint_area;
    if (preference !== null) {
      preference.actual_area_m2 = null;
      preference.difference_m2 = null;
      preference.status = "unmet";
      preference.diagnostic_codes = ["PREFERRED_FOOTPRINT_NOT_GENERATED"];
    }
    render(<DetailedMetrics result={massingPreviewResponseSchema.parse(result)} />);

    expect(measurement("Actual massing", "Footprint area")).toHaveTextContent(/^Not available$/);
    expect(measurement("Generated default capacity", "Generated default footprint area")).toHaveTextContent(/^300 m²$/);
    expect(measurement("Generated default capacity", "Generated default GFA capacity")).toHaveTextContent(/^1,800 m²$/);
  });

  it("keeps tiny positive measurements nonzero and counts integral", () => {
    const result = previewResponse();
    result.metrics.footprint_area_m2 = 0.001;
    result.metrics.gfa_m2 = 0.006;
    result.metrics.site_coverage_ratio = 0.000001;
    render(<DetailedMetrics result={result} />);

    expect(measurement("Actual massing", "Footprint area")).toHaveTextContent(/^<0.01 m²$/);
    expect(measurement("Actual massing", "GFA")).toHaveTextContent(/^<0.01 m²$/);
    expect(measurement("Actual massing", "Site coverage ratio")).toHaveTextContent(/^<0.0001$/);
    expect(measurement("Actual massing", "Floor count")).toHaveTextContent(/^6$/);
  });
});
