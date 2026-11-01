import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { optionSummarySchema } from "../../api/contracts";
import type { FeasibilityStatus, OptionSummary as SavedSummary } from "../../api/contracts";
import { optionResponse } from "../../test/optionFixtures";
import OptionSummary from "./OptionSummary";

function summary(): SavedSummary {
  const snapshot = optionResponse();
  return optionSummarySchema.parse({ ...snapshot, metrics: snapshot.result.metrics });
}

function value(label: string) {
  const region = screen.getByRole("region", { name: "Selected option summary" });
  return within(region).getByText(label, { selector: "dt" }).nextElementSibling;
}

describe("OptionSummary", () => {
  it("shows the persisted identity, parent, timestamp and relevant metrics without modifying the snapshot", () => {
    const option = summary();
    option.parent_id = "550e8400-e29b-41d4-a716-446655440001";
    option.created_at = "2026-10-31T12:34:56.123456+03:00";
    const original = structuredClone(option);
    render(<OptionSummary option={option} />);

    expect(value("Name")).toHaveTextContent(/^Rectangle study$/);
    expect(value("UUID")).toHaveTextContent(option.id);
    expect(value("Status")).toHaveTextContent(/^feasible$/);
    expect(value("Parent")).toHaveTextContent(option.parent_id);
    expect(value("Site area")).toHaveTextContent(/^1,000 m²$/);
    expect(value("Footprint area")).toHaveTextContent(/^646 m²$/);
    expect(value("Floor count")).toHaveTextContent(/^6$/);
    expect(value("Height")).toHaveTextContent(/^21 m$/);
    expect(value("GFA")).toHaveTextContent(/^3,876 m²$/);
    expect(value("Site coverage ratio")).toHaveTextContent(/^0.646$/);
    expect(value("Maximum permitted floors")).toHaveTextContent(/^6$/);
    expect(value("Hard GFA upper bound")).toHaveTextContent(/^3,876 m²$/);
    expect(value("Saved at")).toHaveTextContent(option.created_at);
    expect(screen.getByText(option.created_at, { selector: "time" })).toHaveAttribute("dateTime", option.created_at);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(option).toEqual(original);
  });

  it.each<FeasibilityStatus>([
    "feasible", "feasible_target_unmet", "infeasible", "generation_failed",
  ])("preserves the authoritative %s status", (status) => {
    const option = summary();
    option.feasibility_status = status;
    if (status === "infeasible" || status === "generation_failed") {
      option.metrics.footprint_area_m2 = null;
      option.metrics.floor_count = null;
      option.metrics.height_m = null;
      option.metrics.gfa_m2 = null;
      option.metrics.site_coverage_ratio = null;
    }
    render(<OptionSummary option={option} />);

    expect(value("Status")).toHaveTextContent(new RegExp(`^${status.replace(/_/g, " ")}$`));
    if (status === "infeasible" || status === "generation_failed") {
      for (const label of ["Footprint area", "Floor count", "Height", "GFA", "Site coverage ratio"]) {
        expect(value(label)).toHaveTextContent(/^Not available$/);
      }
    }
  });

  it("distinguishes unavailable building metrics from stored zero bounds and coverage", () => {
    const option = summary();
    option.name = null;
    option.metrics.maximum_permitted_floor_count = 0;
    option.metrics.gfa_upper_bound_m2 = 0;
    option.metrics.floor_count = null;
    option.metrics.gfa_m2 = null;
    option.metrics.site_coverage_ratio = 0;
    render(<OptionSummary option={option} />);

    expect(value("Name")).toHaveTextContent(/^Unnamed option$/);
    expect(value("Parent")).toHaveTextContent(/^None \(root option\)$/);
    expect(value("Maximum permitted floors")).toHaveTextContent(/^0$/);
    expect(value("Hard GFA upper bound")).toHaveTextContent(/^0 m²$/);
    expect(value("Site coverage ratio")).toHaveTextContent(/^0$/);
    expect(value("Floor count")).toHaveTextContent(/^Not available$/);
    expect(value("GFA")).toHaveTextContent(/^Not available$/);
  });
});
