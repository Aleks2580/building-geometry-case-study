import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeasibilityStatus, MassingFeasibility } from "../../api/contracts";
import { previewResponse } from "../../test/massingFixtures";
import FeasibilitySummary from "./FeasibilitySummary";

function feasibility(
  status: FeasibilityStatus,
  satisfied: boolean | null,
  reason: MassingFeasibility["reason"] = null,
): MassingFeasibility {
  return {
    ...previewResponse().feasibility,
    status,
    hard_constraints_satisfied: satisfied,
    reason,
  };
}

describe("FeasibilitySummary", () => {
  it.each([
    ["feasible", true, "Feasible", "True"],
    ["feasible_target_unmet", true, "Feasible — GFA target unmet", "True"],
    ["infeasible", false, "Infeasible", "False"],
    ["generation_failed", null, "Generation failed", "Unknown"],
  ] satisfies [FeasibilityStatus, boolean | null, string, string][])(
    "presents %s with explicit hard-constraint satisfaction", (status, satisfied, title, label) => {
      render(<FeasibilitySummary feasibility={feasibility(status, satisfied)} />);

      const summary = screen.getByRole("status", { name: title });
      expect(within(summary).getByRole("heading", { name: title, level: 3 })).toBeInTheDocument();
      expect(within(summary).getByText("Hard constraints satisfied", { selector: "dt" }))
        .toBeInTheDocument();
      expect(within(summary).getByText(label, { selector: "dd" })).toBeInTheDocument();
      expect(summary).toHaveAttribute("data-status", status);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("keeps an unmet target separate from hard-constraint failure", () => {
    render(<FeasibilitySummary feasibility={feasibility("feasible_target_unmet", true)} />);

    expect(screen.getByText(/satisfies the hard constraints but misses the GFA target/))
      .toBeInTheDocument();
    expect(screen.getByText("True", { selector: "dd" })).toBeInTheDocument();
  });

  it("does not describe generation failure as mathematical infeasibility", () => {
    render(<FeasibilitySummary feasibility={feasibility(
      "generation_failed", null, "PREFERRED_FOOTPRINT_NOT_GENERATED",
    )} />);

    expect(screen.getByText(/does not establish mathematical infeasibility/)).toBeInTheDocument();
    expect(screen.getByText("Unknown", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("PREFERRED_FOOTPRINT_NOT_GENERATED", { selector: "code" }))
      .toBeInTheDocument();
  });

  it.each([
    "EMPTY_BUILDABLE_REGION",
    "ZERO_PERMITTED_FLOORS",
    "FOOTPRINT_NOT_GENERATED",
    "PREFERRED_FOOTPRINT_NOT_GENERATED",
  ] satisfies NonNullable<MassingFeasibility["reason"]>[])(
    "preserves backend reason %s", (reason) => {
      const failed = reason === "FOOTPRINT_NOT_GENERATED" || reason === "PREFERRED_FOOTPRINT_NOT_GENERATED";
      render(<FeasibilitySummary feasibility={feasibility(
        failed ? "generation_failed" : "infeasible", failed ? null : false, reason,
      )} />);

      expect(screen.getByText("Reason", { selector: "dt" })).toBeInTheDocument();
      expect(screen.getByText(reason, { selector: "code" })).toBeInTheDocument();
    },
  );

  it("omits the reason row when none was provided", () => {
    render(<FeasibilitySummary feasibility={previewResponse().feasibility} />);

    expect(screen.queryByText("Reason")).not.toBeInTheDocument();
  });
});
