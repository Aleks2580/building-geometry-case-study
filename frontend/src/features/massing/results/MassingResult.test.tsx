import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { previewResponse } from "../../../test/massingFixtures";
import MassingResult from "./MassingResult";

function kpi(label: string) {
  return within(screen.getByRole("region", { name: "Actual massing" }))
    .getByText(label, { selector: "dt" }).nextElementSibling;
}

describe("MassingResult dashboard", () => {
  it("presents the four submitted metrics and keeps advanced results available on demand", () => {
    const result = previewResponse();
    const original = structuredClone(result);
    render(<MassingResult result={result} actions={<button type="button">Save current option</button>} />);

    expect(kpi("Footprint")).toHaveTextContent(/^646 m²$/);
    expect(kpi("GFA")).toHaveTextContent(/^3,876 m²$/);
    expect(kpi("Floors")).toHaveTextContent(/^6$/);
    expect(kpi("Height")).toHaveTextContent(/^21 m$/);
    expect(screen.getByRole("img", { name: "Site plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save current option" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Generated default capacity" })).not.toBeVisible();
    fireEvent.click(screen.getByText(/^Metrics & capacity/, { selector: "summary" }));
    expect(screen.getByRole("region", { name: "Hard constraints and capacity" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Generated default capacity" })).toBeVisible();
    expect(screen.getByText(/theoretical upper bounds do not guarantee/)).toBeVisible();
    expect(screen.getByText(/demonstrated capacity, not a proven optimum/)).toBeVisible();
    fireEvent.click(screen.getByText(/^Preferences & target/, { selector: "summary" }));
    expect(screen.getByRole("region", { name: "Preferences and target" })).toBeVisible();
    fireEvent.click(screen.getByText(/^Diagnostics/, { selector: "summary" }));
    expect(screen.getByRole("region", { name: "Diagnostics" })).toHaveTextContent("No diagnostics reported.");
    expect(result).toEqual(original);
  });

  it("does not replace unavailable actual metrics with theoretical bounds or default capacity", () => {
    const result = previewResponse();
    result.feasibility.status = "generation_failed";
    result.feasibility.hard_constraints_satisfied = null;
    result.feasibility.reason = "FOOTPRINT_NOT_GENERATED";
    result.metrics.footprint_area_m2 = null;
    result.metrics.gfa_m2 = null;
    result.metrics.floor_count = null;
    result.metrics.height_m = null;
    result.footprint_geometry = null;
    result.floor_plate_geometry = null;
    render(<MassingResult result={result} />);

    for (const label of ["Footprint", "GFA", "Floors", "Height"]) expect(kpi(label)).toHaveTextContent(/^Not available$/);
    expect(screen.getByRole("status", { name: "Generation failed" })).toBeVisible();
    expect(screen.getByText("No building footprint is available.", { selector: "p" })).toBeVisible();
    expect(screen.getByText("Hard upper bound: 646 m²")).toBeVisible();
  });
});
