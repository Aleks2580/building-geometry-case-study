import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeasibilityStatus, OptionComparisonResponse } from "../../api/contracts";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { optionComparisonResponse } from "../../test/comparisonFixtures";
import { optionResponse } from "../../test/optionFixtures";
import ComparisonResult from "./ComparisonResult";

function row(label: string) {
  return within(screen.getByRole("group", { name: label }));
}

function renderComparison(response: OptionComparisonResponse) {
  const view = render(<ComparisonResult comparison={response} />);
  for (const label of ["Saved snapshot details", "Inputs and capacity", "Feasibility and diagnostics"]) {
    fireEvent.click(screen.getByText(label, { selector: "summary" }));
  }
  return view;
}

describe("ComparisonResult", () => {
  it("keeps the saved viewer and actual massing visible while advanced comparisons are collapsed", () => {
    render(<ComparisonResult comparison={optionComparisonResponse()} />);

    expect(screen.getByRole("region", { name: "Stored plan inspection" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Actual massing" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Hard constraints" })).not.toBeVisible();
    fireEvent.click(screen.getByText("Inputs and capacity", { selector: "summary" }));
    expect(screen.getByRole("region", { name: "Hard constraints" })).toBeVisible();
  });

  it("shows both complete identities and every comparison input and metric", () => {
    const response = optionComparisonResponse();
    renderComparison(response);

    const left = screen.getByRole("region", { name: "Option 1 compared option" });
    const right = screen.getByRole("region", { name: "Option 2 compared option" });
    expect(left).toHaveTextContent(response.options[0].name!);
    expect(left).toHaveTextContent(response.options[0].id);
    expect(left).toHaveTextContent("None (root option)");
    expect(right).toHaveTextContent(response.options[1].name!);
    expect(right).toHaveTextContent(response.options[1].id);
    expect(right).toHaveTextContent(response.options[0].id);
    expect(right).toHaveTextContent(response.options[1].algorithm_version);
    expect(right).toHaveTextContent(response.options[1].created_at);

    const labels = [
      "Setback", "Floor-to-floor height constraint", "Maximum height", "Maximum floor count",
      "Site coverage ratio constraint", "Maximum footprint", "Preferred floor count",
      "Preferred footprint area", "GFA target", "Site area", "Complete buildable area",
      "Selected buildable component area", "Maximum permitted floor count", "Hard footprint area upper bound",
      "Hard GFA upper bound", "Generated default footprint area", "Generated default GFA capacity",
      "Footprint area", "Floor count", "Height", "GFA", "Site coverage ratio", "Floor-to-floor height",
    ];
    for (const label of labels) {
      const values = row(label);
      expect(values.getByText("Option 1")).toBeInTheDocument();
      expect(values.getByText("Option 2")).toBeInTheDocument();
      expect(values.getByText("Difference")).toBeInTheDocument();
      expect(values.getByText("Comparison")).toBeInTheDocument();
    }
    expect(row("GFA").getByText("-1,292 m²")).toBeInTheDocument();
    expect(row("Height").getByText("-7 m")).toBeInTheDocument();
    expect(row("Floor count").getByText("-2")).toBeInTheDocument();
    expect(row("Preferred floor count").getByText("Changed")).toBeInTheDocument();
    expect(row("Site area").getByText("Unchanged")).toBeInTheDocument();
    expect(screen.getByText(/Theoretical hard upper bounds/)).toBeInTheDocument();
    expect(screen.getByText(/Demonstrated capacity is not a proven optimum/)).toBeInTheDocument();
  });

  it("renders authoritative values, flags, nullable differences and small signed ratios without recalculation", () => {
    const response = optionComparisonResponse();
    response.metrics.gfa_m2 = { left: 30, right: 40, difference: 2.5, changed: false };
    response.metrics.site_coverage_ratio = { left: 0.5, right: 0.5, difference: -1e-8, changed: true };
    response.metrics.footprint_area_m2 = { left: 646, right: null, difference: null, changed: true };
    renderComparison(response);

    expect(row("GFA").getByText("30 m²")).toBeInTheDocument();
    expect(row("GFA").getByText("40 m²")).toBeInTheDocument();
    expect(row("GFA").getByText("+2.5 m²")).toBeInTheDocument();
    expect(row("GFA").getByText("Unchanged")).toBeInTheDocument();
    expect(row("Site coverage ratio").getByText("-1.00e-8")).toBeInTheDocument();
    expect(row("Footprint area").getAllByText("Not available")).toHaveLength(2);
    expect(row("Footprint area").queryByText("0 m²")).not.toBeInTheDocument();
    expect(row("Maximum height").getAllByText("Not available")).toHaveLength(3);
    expect(row("Setback").getByText("0 m")).toBeInTheDocument();
  });

  it.each(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"] as const)(
    "preserves %s status, reasons, hard satisfaction, all target fields and full diagnostic lists", (status: FeasibilityStatus) => {
      const response = optionComparisonResponse();
      response.options[1].feasibility_status = status;
      response.feasibility.status.right = status;
      response.feasibility.status.changed = status !== "feasible";
      response.feasibility.reason = { left: null, right: "FOOTPRINT_NOT_GENERATED", changed: true };
      response.feasibility.hard_constraints_satisfied = { left: true, right: null, changed: true };
      response.feasibility.target_assessment.right = {
        requested_m2: 5000, actual_m2: null, shortfall_m2: 5000, status: "unmet", diagnostic_code: "TARGET_EXCEEDS_UPPER_BOUND",
      };
      response.diagnostics.changed = true;
      response.diagnostics.left = [
        { code: "BUILDABLE_REGION_SPLIT", severity: "warning", message: "First complete diagnostic", path: "site", details: { count: 2, available: false } },
        { code: "BUILDABLE_REGION_SPLIT", severity: "info", message: "Repeated code retained", details: { value: null, empty: "" } },
      ];
      response.diagnostics.right = [{ code: "FOOTPRINT_NOT_GENERATED", severity: "error", message: "Option 2 construction diagnostic" }];
      renderComparison(response);

      expect(row("Feasibility status").getAllByText(status.replace(/_/g, " ")).length).toBeGreaterThan(0);
      expect(row("Reason").getByText("FOOTPRINT_NOT_GENERATED")).toBeInTheDocument();
      expect(row("Hard constraints satisfied").getByText("Not available")).toBeInTheDocument();
      const target = within(screen.getByRole("region", { name: "Option 2 target assessment" }));
      expect(target.getByText("unmet")).toBeInTheDocument();
      expect(target.getAllByText("5,000 m²")).toHaveLength(2);
      expect(target.getByText("Not available")).toBeInTheDocument();
      expect(target.getByText("TARGET_EXCEEDS_UPPER_BOUND")).toBeInTheDocument();
      const leftDiagnostics = within(screen.getByRole("region", { name: "Option 1 diagnostics" }));
      const list = leftDiagnostics.getByRole("list", { name: "Diagnostics" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
      expect(list).toHaveTextContent("First complete diagnostic");
      expect(list).toHaveTextContent("Repeated code retained");
      expect(leftDiagnostics.getByText("site")).toBeInTheDocument();
      fireEvent.click(leftDiagnostics.getAllByText("Details", { selector: "summary" })[1]);
      expect(leftDiagnostics.getByText("null")).toBeInTheDocument();
      expect(leftDiagnostics.getByText('""')).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Option 2 diagnostics" })).toHaveTextContent("Option 2 construction diagnostic");
    },
  );

  it("shows structural site comparison and switches complete stored SVG layers while preserving holes and missing buildings", () => {
    const response = optionComparisonResponse();
    const rightResult = backendPreviewResponse("holed");
    rightResult.footprint_geometry = null;
    response.options[1] = optionResponse(rightResult, { id: response.options[1].id, name: "Holed saved site" });
    response.inputs.site_geometry.right = rightResult.site_geometry;
    response.inputs.site_geometry.changed = true;
    const original = structuredClone(response);
    renderComparison(response);

    const geometry = within(screen.getByRole("region", { name: "Site geometry" }));
    expect(geometry.getByText("Changed")).toBeInTheDocument();
    expect(geometry.getByText(/not a topological equivalence test/)).toBeInTheDocument();
    fireEvent.click(geometry.getByText("Option 2 stored site geometry", { selector: "summary" }));
    expect(geometry.getByText("Option 2 stored site geometry").parentElement?.querySelector("pre")?.textContent)
      .toBe(JSON.stringify(rightResult.site_geometry, null, 2));
    const before = screen.getByRole("img", { name: "Site plan" });
    expect(before.querySelectorAll("path")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "Option 1 plan" })).toBeChecked();
    const right = screen.getByRole("radio", { name: "Option 2 plan" });
    right.focus();
    expect(right).toHaveFocus();
    fireEvent.click(right);

    expect(right).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(`Displaying Option 2: Holed saved site (${response.options[1].id})`);
    const after = screen.getByRole("img", { name: "Site plan" });
    expect(after.querySelector('[data-layer="site"]')?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(after.querySelector('[data-layer="site"]')).toHaveAttribute("fill-rule", "evenodd");
    expect(after.querySelector('[data-layer="footprint"]')).toBeNull();
    expect(after).toHaveAccessibleDescription(/No building footprint is available/);
    fireEvent.click(screen.getByRole("radio", { name: "Option 1 plan" }));
    expect(screen.getByRole("img").querySelectorAll("path")).toHaveLength(4);
    expect(response).toEqual(original);
  });

  it("switches to a saved MultiPolygon without merging or substituting any layer", () => {
    const response = optionComparisonResponse();
    const result = backendPreviewResponse("notched");
    response.options[1] = optionResponse(result, { id: response.options[1].id });
    renderComparison(response);
    fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));

    const svg = screen.getByRole("img");
    expect(svg.querySelector('[data-layer="buildable"]')?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(svg.querySelector('[data-layer="selected-buildable"]')?.getAttribute("d")?.match(/M/g)).toHaveLength(1);
    expect(svg.querySelector('[data-layer="footprint"]')).toBeInTheDocument();
  });
});
