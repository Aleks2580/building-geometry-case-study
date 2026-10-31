import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { massingPreviewResponseSchema, type FootprintAreaPreferenceResult, type MassingPreviewResponse } from "../../api/contracts";
import { previewResponse } from "../../test/massingFixtures";
import PreferenceAssessments from "./PreferenceAssessments";

function assessment(section: string, label: string) {
  const region = screen.getByRole("region", { name: section });
  const term = within(region).getByText(label, { selector: "dt" });
  return term.nextElementSibling;
}

function withFootprint(footprint: FootprintAreaPreferenceResult): MassingPreviewResponse {
  const result = previewResponse();
  result.preferences.preferred_footprint_area_m2 = footprint.requested_area_m2;
  result.preference_results.footprint_area = footprint;
  result.metrics.footprint_area_m2 = footprint.actual_area_m2;
  result.metrics.gfa_m2 = footprint.actual_area_m2 === null ? null : footprint.actual_area_m2 * 6;
  result.metrics.site_coverage_ratio = footprint.actual_area_m2 === null ? null : footprint.actual_area_m2 / 1000;
  result.feasibility.target_assessment.actual_m2 = result.metrics.gfa_m2;
  if (footprint.actual_area_m2 === null) {
    result.metrics.floor_count = null;
    result.metrics.height_m = null;
    result.footprint_geometry = null;
    result.floor_plate_geometry = null;
    result.feasibility.status = "generation_failed";
    result.feasibility.reason = "PREFERRED_FOOTPRINT_NOT_GENERATED";
    result.feasibility.hard_constraints_satisfied = null;
  } else {
    const width = footprint.actual_area_m2 / 19;
    result.footprint_geometry = {
      type: "Polygon",
      coordinates: [[[3, 3], [3 + width, 3], [3 + width, 22], [3, 22], [3, 3]]],
    };
    result.floor_plate_geometry = result.footprint_geometry;
  }
  return massingPreviewResponseSchema.parse(result);
}

const met: FootprintAreaPreferenceResult = {
  original_hard_area_upper_bound_m2: 646,
  requested_area_m2: 300,
  effective_target_m2: 300,
  actual_area_m2: 300,
  difference_m2: 0,
  effective_target_undershoot_m2: null,
  status: "met",
  diagnostic_codes: [],
};

describe("PreferenceAssessments", () => {
  it("identifies absent preferences and targets without replacing absent metrics with zero", () => {
    render(<PreferenceAssessments result={massingPreviewResponseSchema.parse(previewResponse())} />);

    expect(assessment("Preferences and target", "Preferred floor count")).toHaveTextContent(/^Not requested$/);
    expect(within(screen.getByRole("region", { name: "Footprint preference" })).getByText("Not requested")).toBeInTheDocument();
    expect(screen.queryByText("Requested footprint area")).not.toBeInTheDocument();
    expect(assessment("GFA target", "GFA target assessment")).toHaveTextContent(/^Not requested$/);
    expect(assessment("GFA target", "Requested GFA target")).toHaveTextContent(/^Not requested$/);
    expect(assessment("GFA target", "Actual GFA for target")).toHaveTextContent(/^3,876 m²$/);
    expect(assessment("GFA target", "GFA shortfall")).toHaveTextContent(/^Not available$/);
  });

  it("shows the assessed preferred floor count as an integer", () => {
    const result = previewResponse();
    result.preferences.preferred_floor_count = 2;
    result.preference_results.preferred_floor_count = 2;
    render(<PreferenceAssessments result={massingPreviewResponseSchema.parse(result)} />);

    expect(assessment("Preferences and target", "Preferred floor count")).toHaveTextContent(/^2$/);
  });

  it("preserves a requested footprint when infeasibility prevents an assessment", () => {
    const result = previewResponse();
    result.preferences.preferred_footprint_area_m2 = 300;
    result.hard_constraints.max_height_m = 1;
    result.metrics.maximum_permitted_floor_count = 0;
    result.metrics.gfa_upper_bound_m2 = 0;
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
    result.feasibility.status = "infeasible";
    result.feasibility.reason = "ZERO_PERMITTED_FLOORS";
    result.feasibility.hard_constraints_satisfied = false;
    result.feasibility.target_assessment.actual_m2 = null;
    render(<PreferenceAssessments result={massingPreviewResponseSchema.parse(result)} />);

    expect(assessment("Footprint preference", "Requested footprint area")).toHaveTextContent(/^300 m²$/);
    expect(screen.getByText("No footprint assessment was returned for the requested area.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Footprint preference" })).queryByText("Not requested"))
      .not.toBeInTheDocument();
    for (const label of ["Footprint assessment", "Effective footprint target", "Actual preferred footprint area", "Signed footprint difference", "Effective-target undershoot"]) {
      expect(assessment("Footprint preference", label)).toHaveTextContent(/^Not available$/);
    }
  });

  it("shows a met footprint assessment and exact zero difference", () => {
    render(<PreferenceAssessments result={withFootprint(met)} />);

    expect(assessment("Footprint preference", "Footprint assessment")).toHaveTextContent(/^Met$/);
    expect(assessment("Footprint preference", "Requested footprint area")).toHaveTextContent(/^300 m²$/);
    expect(assessment("Footprint preference", "Effective footprint target")).toHaveTextContent(/^300 m²$/);
    expect(assessment("Footprint preference", "Actual preferred footprint area")).toHaveTextContent(/^300 m²$/);
    expect(assessment("Footprint preference", "Signed footprint difference")).toHaveTextContent(/^0 m²$/);
    expect(assessment("Footprint preference", "Effective-target undershoot")).toHaveTextContent(/^Not available$/);
  });

  it.each([
    [646, 0, ["PREFERENCE_CLAMPED_TO_HARD_CAP"]],
    [600, 46, ["PREFERENCE_CLAMPED_TO_HARD_CAP", "FOOTPRINT_AREA_APPROXIMATED"]],
  ] satisfies [number, number, FootprintAreaPreferenceResult["diagnostic_codes"]][])(
    "keeps a clamped assessment when the effective target yields %s m²", (actual, undershoot, codes) => {
      render(<PreferenceAssessments result={withFootprint({
        ...met,
        requested_area_m2: 800,
        effective_target_m2: 646,
        actual_area_m2: actual,
        difference_m2: actual - 800,
        effective_target_undershoot_m2: undershoot,
        status: "clamped",
        diagnostic_codes: codes,
      })} />);

      expect(assessment("Footprint preference", "Footprint assessment")).toHaveTextContent(/^Clamped$/);
      expect(assessment("Footprint preference", "Requested footprint area")).toHaveTextContent(/^800 m²$/);
      expect(assessment("Footprint preference", "Effective footprint target")).toHaveTextContent(/^646 m²$/);
      expect(assessment("Footprint preference", "Actual preferred footprint area")).toHaveTextContent(`${actual} m²`);
      expect(assessment("Footprint preference", "Signed footprint difference")).toHaveTextContent(`${actual - 800} m²`);
      expect(assessment("Footprint preference", "Effective-target undershoot")).toHaveTextContent(`${undershoot} m²`);
    },
  );

  it("shows an approximated footprint and keeps the signed difference separate from effective-target undershoot", () => {
    render(<PreferenceAssessments result={withFootprint({
      ...met,
      actual_area_m2: 280,
      difference_m2: -20,
      status: "approximated",
      diagnostic_codes: ["FOOTPRINT_AREA_APPROXIMATED"],
    })} />);

    expect(assessment("Footprint preference", "Footprint assessment")).toHaveTextContent(/^Approximated$/);
    expect(assessment("Footprint preference", "Actual preferred footprint area")).toHaveTextContent(/^280 m²$/);
    expect(assessment("Footprint preference", "Signed footprint difference")).toHaveTextContent(/^-20 m²$/);
    expect(assessment("Footprint preference", "Effective-target undershoot")).toHaveTextContent(/^Not available$/);
  });

  it("shows an unmet construction with unavailable actual area and differences", () => {
    render(<PreferenceAssessments result={withFootprint({
      ...met,
      actual_area_m2: null,
      difference_m2: null,
      status: "unmet",
      diagnostic_codes: ["PREFERRED_FOOTPRINT_NOT_GENERATED"],
    })} />);

    expect(assessment("Footprint preference", "Footprint assessment")).toHaveTextContent(/^Unmet$/);
    for (const label of ["Actual preferred footprint area", "Signed footprint difference", "Effective-target undershoot"]) {
      expect(assessment("Footprint preference", label)).toHaveTextContent(/^Not available$/);
    }
    expect(assessment("Footprint preference", "Requested footprint area")).toHaveTextContent(/^300 m²$/);
  });

  it("preserves a small negative difference even when displayed requested and actual areas round equally", () => {
    render(<PreferenceAssessments result={withFootprint({
      ...met,
      actual_area_m2: 299.999,
      difference_m2: -0.001,
      status: "approximated",
      diagnostic_codes: ["FOOTPRINT_AREA_APPROXIMATED"],
    })} />);

    expect(assessment("Footprint preference", "Requested footprint area")).toHaveTextContent(/^300 m²$/);
    expect(assessment("Footprint preference", "Actual preferred footprint area")).toHaveTextContent(/^300 m²$/);
    expect(assessment("Footprint preference", "Signed footprint difference")).toHaveTextContent(/^-1.00e-3 m²$/);
  });

  it("renders a positive difference supplied by the response without recalculating it", () => {
    render(<PreferenceAssessments result={withFootprint({
      ...met,
      actual_area_m2: 300.0000001,
      difference_m2: 1e-7,
    })} />);

    expect(assessment("Footprint preference", "Footprint assessment")).toHaveTextContent(/^Met$/);
    expect(assessment("Footprint preference", "Signed footprint difference")).toHaveTextContent(/^\+1.00e-7 m²$/);
  });

  it.each([
    [0, 3876, null, "met", "Met", "0 m²", "3,876 m²", "Not available"],
    [1000, 1292, null, "met", "Met", "1,000 m²", "1,292 m²", "Not available"],
    [5000, 3876, 1124, "unmet", "Unmet", "5,000 m²", "3,876 m²", "1,124 m²"],
    [0, null, null, "not_evaluated", "Not evaluated", "0 m²", "Not available", "Not available"],
    [1000, null, null, "not_evaluated", "Not evaluated", "1,000 m²", "Not available", "Not available"],
  ] as const)(
    "displays requested GFA %s with backend assessment %s/%s/%s", (requested, actual, shortfall, status, title, requestedText, actualText, shortfallText) => {
      const result = previewResponse();
      result.targets.gfa_target_m2 = requested;
      if (actual === null) {
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
        result.feasibility.status = "generation_failed";
        result.feasibility.reason = "FOOTPRINT_NOT_GENERATED";
        result.feasibility.hard_constraints_satisfied = null;
      } else {
        result.metrics.floor_count = actual / 646;
        result.metrics.height_m = actual / 646 * 3.5;
        result.metrics.gfa_m2 = actual;
        result.feasibility.status = status === "unmet" ? "feasible_target_unmet" : "feasible";
      }
      result.feasibility.target_assessment = {
        requested_m2: requested,
        actual_m2: actual,
        shortfall_m2: shortfall,
        status,
        diagnostic_code: status === "unmet" ? "TARGET_EXCEEDS_UPPER_BOUND" : null,
      };
      render(<PreferenceAssessments result={massingPreviewResponseSchema.parse(result)} />);

      expect(assessment("GFA target", "GFA target assessment")).toHaveTextContent(title);
      expect(assessment("GFA target", "Requested GFA target")).toHaveTextContent(requestedText);
      expect(assessment("GFA target", "Actual GFA for target")).toHaveTextContent(actualText);
      expect(assessment("GFA target", "GFA shortfall")).toHaveTextContent(shortfallText);
    },
  );
});
