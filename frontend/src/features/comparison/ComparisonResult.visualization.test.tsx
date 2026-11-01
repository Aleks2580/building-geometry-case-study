import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  massingPreviewResponseSchema, optionComparisonResponseSchema,
  type FeasibilityStatus, type MassingPreviewResponse, type OptionComparisonResponse, type OptionResponse,
} from "../../api/contracts";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { optionResponse } from "../../test/optionFixtures";
import "../visualization/Massing3D";
import type Massing3DScene from "../visualization/Massing3DScene";
import { prepareMassingScene } from "../visualization/massing3DGeometry";
import ComparisonResult from "./ComparisonResult";

const mocks = vi.hoisted(() => ({ failCanvas: false, scene: vi.fn(), mount: vi.fn(), unmount: vi.fn() }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      mocks.mount();
      return () => { mocks.unmount(); };
    }, []);
    if (mocks.failCanvas) throw new Error("No WebGL2 context");
    return <div data-testid="comparison-canvas">{children}</div>;
  },
}));
vi.mock("../visualization/Massing3DScene", () => ({
  default: (props: ComponentProps<typeof Massing3DScene>) => {
    mocks.scene(props);
    return <button type="button" onClick={props.onContextLost}>Lose comparison context</button>;
  },
}));

const captured = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../renderer-test/backendFixtures.json"), "utf8",
)) as Record<string, unknown>;
const ids = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
  "550e8400-e29b-41d4-a716-446655440003",
];

function capturedResult(name: string) {
  return massingPreviewResponseSchema.parse(captured[name]);
}

function valuePair<T>(left: T, right: T) {
  return { left, right, changed: JSON.stringify(left) !== JSON.stringify(right) };
}

function numericPairs(left: Record<string, number | null>, right: Record<string, number | null>) {
  return Object.fromEntries(Object.entries(left).map(([name, value]) => [name, {
    ...valuePair(value, right[name]), difference: value === null || right[name] === null ? null : right[name] - value,
  }]));
}

function comparisonOf(left: OptionResponse, right: OptionResponse) {
  return optionComparisonResponseSchema.parse({
    options: [left, right],
    inputs: {
      site_geometry: valuePair(left.site_geometry, right.site_geometry),
      hard_constraints: numericPairs(left.hard_constraints, right.hard_constraints),
      preferences: numericPairs(left.preferences, right.preferences),
      targets: numericPairs(left.targets, right.targets),
    },
    metrics: numericPairs(left.result.metrics, right.result.metrics),
    feasibility: {
      status: valuePair(left.feasibility_status, right.feasibility_status),
      reason: valuePair(left.result.feasibility.reason, right.result.feasibility.reason),
      hard_constraints_satisfied: valuePair(left.result.feasibility.hard_constraints_satisfied, right.result.feasibility.hard_constraints_satisfied),
      target_assessment: valuePair(left.result.feasibility.target_assessment, right.result.feasibility.target_assessment),
    },
    diagnostics: valuePair(left.result.feasibility.diagnostics, right.result.feasibility.diagnostics),
  });
}

function crossRootComparison() {
  return comparisonOf(
    optionResponse(backendPreviewResponse("notched"), { id: ids[0], name: "Split site root" }),
    optionResponse(backendPreviewResponse("holed"), { id: ids[1], name: "Courtyard root" }),
  );
}

function planPaths() {
  return [...screen.getByRole("img", { name: "Site plan" }).querySelectorAll("path")]
    .map((path) => [path.getAttribute("data-layer"), path.getAttribute("d")]);
}

function comparisonValues() {
  return ["Hard constraints", "Preferences and targets", "Site and setback metrics", "Hard upper bounds",
    "Generated default capacity", "Actual massing", "Feasibility", "Diagnostic comparison"]
    .map((name) => screen.getByRole("region", { name }).textContent);
}

function expectScene(result: MassingPreviewResponse) {
  const prepared = prepareMassingScene(result);
  if (!("scene" in prepared)) throw new Error("Expected a displayable comparison fixture.");
  expect(mocks.scene.mock.lastCall?.[0].scene).toEqual(prepared.scene);
  expect(screen.getAllByTestId("comparison-canvas")).toHaveLength(1);
}

function resultForStatus(status: FeasibilityStatus) {
  if (status === "infeasible") return capturedResult("empty");
  if (status === "generation_failed") return backendPreviewResponse("preferred_failed");
  const result = capturedResult("rectangle");
  if (status === "feasible_target_unmet") {
    result.targets.gfa_target_m2 = 5000;
    result.feasibility.status = status;
    result.feasibility.target_assessment = {
      requested_m2: 5000, actual_m2: 3876, shortfall_m2: 1124,
      status: "unmet", diagnostic_code: "TARGET_EXCEEDS_UPPER_BOUND",
    };
  }
  return result;
}

beforeEach(() => {
  mocks.failCanvas = false;
  mocks.scene.mockClear();
  mocks.mount.mockClear();
  mocks.unmount.mockClear();
});

function renderComparison(response: OptionComparisonResponse) {
  const view = render(<ComparisonResult comparison={response} />);
  for (const label of ["Saved snapshot details", "Inputs and capacity", "Feasibility and diagnostics"]) {
    fireEvent.click(screen.getByText(label, { selector: "summary" }));
  }
  return view;
}

describe("ComparisonResult visualization", () => {
  it("measures only the active Option 1 or Option 2 snapshot without changing comparison values or requesting data", () => {
    const response = crossRootComparison();
    const original = structuredClone(response);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderComparison(response);
    const initialPaths = planPaths();
    const initialValues = comparisonValues();
    const readout = () => screen.getByRole("img", { name: "Site plan" }).closest("figure")?.querySelector("figcaption [aria-live='polite']");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show dimensions" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Measure edge" }), { target: { value: "footprint-0-0" } });
    expect(readout()).toHaveTextContent("Building footprint · edge 1: 14 m");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("img", { name: "Site plan" }).querySelectorAll("[data-overview-dimension]")).toHaveLength(12);
    expect(screen.getByRole("img", { name: "Site plan" }).querySelector("[data-overview-dimension='footprint-0-0'] text")).toHaveTextContent("14 m");
    fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).toBeChecked();
    expect(readout()).toHaveTextContent("Building footprint · edge 1: 20 m");
    expect(screen.getByRole("button", { name: "Show all" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Site plan" }).querySelectorAll("[data-overview-dimension]")).toHaveLength(16);
    expect(screen.getByRole("img", { name: "Site plan" }).querySelector("[data-overview-dimension='footprint-0-0'] text")).toHaveTextContent("20 m");
    expect(screen.getByRole("combobox", { name: "Measure edge" })).toHaveValue("footprint-0-0");
    fireEvent.change(screen.getByRole("combobox", { name: "Measure edge" }), { target: { value: "footprint-1-0" } });
    expect(readout()).toHaveTextContent("Footprint hole 1 · edge 1: 5 m");
    fireEvent.click(screen.getByRole("radio", { name: "Option 1 plan" }));
    expect(readout()).toHaveTextContent("Site boundary · edge 1: 50 m");
    expect(screen.getByRole("img", { name: "Site plan" }).querySelectorAll("[data-overview-dimension]")).toHaveLength(12);
    expect(screen.getByRole("img", { name: "Site plan" }).querySelector("[data-overview-dimension='footprint-1-0']")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Measure edge" })).toHaveValue("site-0-0");
    expect(planPaths()).toEqual(initialPaths);
    expect(comparisonValues()).toEqual(initialValues);
    expect(response).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.mount).not.toHaveBeenCalled();
  });

  it("defaults to the Option 1 2D plan and keeps 3D selected while switching exact cross-root snapshots", async () => {
    const response = crossRootComparison();
    const original = structuredClone(response);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderComparison(response);
    const leftPaths = planPaths();
    const values = comparisonValues();
    expect(screen.getByRole("button", { name: "2D Plan" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "Option 1 plan" })).toBeChecked();
    expect(mocks.mount).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
    await screen.findByTestId("comparison-canvas");
    expectScene(response.options[0].result);
    fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
    expect(screen.getByRole("button", { name: "3D Massing" })).toHaveAttribute("aria-pressed", "true");
    expectScene(response.options[1].result);
    expect(screen.getByRole("status")).toHaveTextContent(`Courtyard root (${response.options[1].id})`);
    expect(mocks.unmount).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    const courtyard = screen.getByRole("img", { name: "Site plan" });
    expect(courtyard.querySelector('[data-layer="site"]')?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(screen.queryByTestId("comparison-canvas")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Option 1 plan" }));
    expect(planPaths()).toEqual(leftPaths);
    expect(comparisonValues()).toEqual(values);
    expect(response).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["parent-child", "siblings", "nested"] as const)(
    "inspects coherent %s snapshots with different floor counts without changing comparison values", async (relationship) => {
      const left = optionResponse(capturedResult("rectangle"), {
        id: ids[1], parent_id: relationship === "parent-child" ? null : ids[0], name: "Six floors",
      });
      const right = optionResponse(capturedResult("single-floor"), {
        id: ids[3], parent_id: relationship === "parent-child" ? left.id : relationship === "siblings" ? ids[0] : ids[2],
        name: "One floor",
      });
      expect(right.site_geometry).toEqual(left.site_geometry);
      const response = comparisonOf(left, right);
      const original = structuredClone(response);
      renderComparison(response);
      const values = comparisonValues();
      const floors = within(screen.getByRole("group", { name: "Floor count" }));
      expect(floors.getByText("-5")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByTestId("comparison-canvas");
      expectScene(left.result);
      expect(mocks.scene.mock.lastCall?.[0].scene.building.floorCount).toBe(6);
      fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
      expectScene(right.result);
      expect(mocks.scene.mock.lastCall?.[0].scene.building.floorCount).toBe(1);
      const dimensions = screen.getByRole("group", { name: "Building dimensions" });
      expect(dimensions).toHaveTextContent("3.5 m total height");
      expect(dimensions).toHaveTextContent("1 floor · 3.5 m per floor");
      expect(comparisonValues()).toEqual(values);
      expect(response).toEqual(original);
    },
  );

  it.each<FeasibilityStatus>(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])(
    "preserves %s snapshots, nulls and diagnostics when replacing the displayed 3D building", async (status) => {
      const result = resultForStatus(status);
      const response = comparisonOf(optionResponse(capturedResult("single-floor")), optionResponse(result, { id: ids[1] }));
      const original = structuredClone(response);
      renderComparison(response);
      const values = comparisonValues();
      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByTestId("comparison-canvas");
      fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
      expectScene(result);
      expect(within(screen.getByRole("group", { name: "Feasibility status" }))
        .getAllByText(status.replace(/_/g, " ")).length).toBeGreaterThan(0);
      if (result.footprint_geometry === null) {
        expect(mocks.scene.mock.lastCall?.[0].scene.building).toBeNull();
        expect(screen.getByText(/No actual building footprint is available/)).toBeInTheDocument();
        expect(within(screen.getByRole("group", { name: "GFA" })).getAllByText("Not available")).toHaveLength(2);
        if (status === "generation_failed") expect(result.generated_footprint_geometry).not.toBeNull();
      }
      expect(comparisonValues()).toEqual(values);
      expect(response).toEqual(original);
    },
  );

  it("updates the fallback plan on side changes and retries the current snapshot after WebGL2 failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const suppressExpected = (event: ErrorEvent) => {
      if (event.message.includes("No WebGL2 context")) event.preventDefault();
    };
    window.addEventListener("error", suppressExpected);
    try {
      const response = crossRootComparison();
      renderComparison(response);
      const leftPaths = planPaths();
      mocks.failCanvas = true;
      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByText(/Interactive 3D is unavailable/);
      expect(planPaths()).toEqual(leftPaths);
      fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
      expect(screen.getByText(/Interactive 3D is unavailable/)).toBeInTheDocument();
      expect(planPaths()).not.toEqual(leftPaths);
      expect(screen.getByRole("img", { name: "Site plan" }).querySelector('[data-layer="site"]')?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
      mocks.failCanvas = false;
      fireEvent.click(screen.getByRole("button", { name: "Retry 3D" }));
      await screen.findByTestId("comparison-canvas");
      expectScene(response.options[1].result);
    } finally {
      errors.mockRestore();
      window.removeEventListener("error", suppressExpected);
    }
  });

  it("isolates context loss to one snapshot and mounts the next side in 3D", async () => {
    const response = crossRootComparison();
    renderComparison(response);
    const values = comparisonValues();
    fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
    await screen.findByTestId("comparison-canvas");
    fireEvent.click(screen.getByRole("button", { name: "Lose comparison context" }));
    expect(screen.queryByTestId("comparison-canvas")).not.toBeInTheDocument();
    expect(screen.getByText(/Interactive 3D is unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
    await screen.findByTestId("comparison-canvas");
    expect(screen.queryByText(/Interactive 3D is unavailable/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3D Massing" })).toHaveAttribute("aria-pressed", "true");
    expectScene(response.options[1].result);
    expect(comparisonValues()).toEqual(values);
  });

  it("unmounts each previous scene during repeated side and mode changes", async () => {
    const response = crossRootComparison();
    renderComparison(response);
    fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
    await screen.findByTestId("comparison-canvas");
    for (let index = 0; index < 3; index++) {
      fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
      expectScene(response.options[1].result);
      fireEvent.click(screen.getByRole("radio", { name: "Option 1 plan" }));
      expectScene(response.options[0].result);
      fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
      expect(screen.queryByTestId("comparison-canvas")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByTestId("comparison-canvas");
    }
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    expect(mocks.mount).toHaveBeenCalledTimes(10);
    expect(mocks.unmount).toHaveBeenCalledTimes(10);
    expect(screen.queryByTestId("comparison-canvas")).not.toBeInTheDocument();
  });
});
