import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../../api/contracts";
import { massingPreviewResponseSchema } from "../../../api/contracts";
import { previewResponse } from "../../../test/massingFixtures";
import Diagnostics from "./Diagnostics";

function renderDiagnostics(diagnostics: Diagnostic[]) {
  const response = previewResponse();
  response.feasibility.diagnostics = diagnostics;
  const parsed = massingPreviewResponseSchema.parse(response);
  return render(<Diagnostics diagnostics={parsed.feasibility.diagnostics} />);
}

describe("Diagnostics", () => {
  it("provides an accessible empty state without an empty list", () => {
    renderDiagnostics([]);

    const section = screen.getByRole("region", { name: "Diagnostics" });
    expect(within(section).getByRole("heading", { name: "Diagnostics", level: 3 })).toBeInTheDocument();
    expect(within(section).getByText("No diagnostics reported.")).toBeInTheDocument();
    expect(within(section).queryByRole("list")).not.toBeInTheDocument();
  });

  it("displays multiple diagnostics with all severities and authoritative codes/messages", () => {
    const diagnostics: Diagnostic[] = [
      {
        code: "PREFERENCE_CLAMPED_TO_HARD_CAP",
        severity: "info",
        message: "The preferred footprint area was clamped to the hard area cap.",
      },
      {
        code: "BUILDABLE_REGION_SPLIT",
        severity: "warning",
        message: "The setback splits the buildable region; only the largest component is selected.",
      },
      {
        code: "PREFERRED_FOOTPRINT_NOT_GENERATED",
        severity: "error",
        message: "The preferred footprint could not be constructed.",
      },
    ];
    renderDiagnostics(diagnostics);

    const list = screen.getByRole("list", { name: "Diagnostics" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    diagnostics.forEach((diagnostic, index) => {
      const item = items[index];
      expect(item).toHaveAttribute("data-severity", diagnostic.severity);
      expect(within(item).getByText(diagnostic.code, { selector: "code" })).toBeInTheDocument();
      expect(within(item).getByText(diagnostic.message)).toBeInTheDocument();
    });
    expect(within(items[0]).getByText("Info", { selector: "strong" })).toBeInTheDocument();
    expect(within(items[1]).getByText("Warning", { selector: "strong" })).toBeInTheDocument();
    expect(within(items[2]).getByText("Error", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves optional paths and all detail primitives without rounding or dropping false/zero/null", () => {
    const path = "preferences.preferred_footprint_area_m2";
    renderDiagnostics([{
      code: "FOOTPRINT_AREA_APPROXIMATED",
      severity: "warning",
      message: "The generated footprint undershoots the requested area.",
      path,
      details: {
        requested_area_m2: 350,
        difference_m2: -25.640000000000043,
        tiny_undershoot_m2: 1e-12,
        discarded_area_m2: 0,
        target_met: false,
        fallback_area_m2: null,
        outcome: "approximated",
        empty_note: "",
      },
    }]);

    const diagnostic = screen.getByRole("listitem");
    expect(within(diagnostic).getByText("Path", { selector: "dt" })).toBeInTheDocument();
    expect(within(diagnostic).getByText(path, { selector: "code" })).toBeInTheDocument();
    const summary = within(diagnostic).getByText("Details", { selector: "summary" });
    const disclosure = summary.parentElement;
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");
    for (const value of ["350", "-25.640000000000043", "1e-12", "0", "false", "null", "approximated", '""']) {
      expect(within(diagnostic).getByText(value, { selector: "dd code" })).toBeInTheDocument();
    }
  });

  it.each([
    {},
    { path: null, details: null },
    { details: {} },
  ] satisfies Partial<Diagnostic>[])(
    "omits absent, nullable, or empty detail disclosures: %j", (optionalFields) => {
      renderDiagnostics([{
        code: "BUILDABLE_REGION_SPLIT",
        severity: "warning",
        message: "The setback has two buildable components.",
        ...optionalFields,
      }]);

      expect(screen.queryByText("Path", { selector: "dt" })).not.toBeInTheDocument();
      expect(screen.queryByText("Details", { selector: "summary" })).not.toBeInTheDocument();
      expect(screen.getByText("The setback has two buildable components.")).toBeInTheDocument();
    },
  );

  it("keeps repeated backend codes as separate diagnostic entries", () => {
    renderDiagnostics([
      { code: "FOOTPRINT_AREA_APPROXIMATED", severity: "warning", message: "First outcome." },
      { code: "FOOTPRINT_AREA_APPROXIMATED", severity: "warning", message: "Second outcome." },
    ]);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("First outcome.")).toBeInTheDocument();
    expect(screen.getByText("Second outcome.")).toBeInTheDocument();
  });
});
