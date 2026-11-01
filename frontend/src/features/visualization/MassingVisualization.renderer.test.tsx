import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { massingPreviewResponseSchema, type FeasibilityStatus } from "../../api/contracts";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import MassingResult from "../massing/results/MassingResult";
import "./Massing3D";
import type Massing3DScene from "./Massing3DScene";

const mocks = vi.hoisted(() => ({ failCanvas: false, scene: vi.fn(), mount: vi.fn(), unmount: vi.fn() }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      mocks.mount();
      return () => { mocks.unmount(); };
    }, []);
    if (mocks.failCanvas) throw new Error("No WebGL2 context");
    return <div data-testid="integrated-canvas">{children}</div>;
  },
}));
vi.mock("./Massing3DScene", () => ({
  default: (props: ComponentProps<typeof Massing3DScene>) => {
    mocks.scene(props);
    return <button type="button" onClick={props.onContextLost}>Lose WebGL context</button>;
  },
}));

const captured = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../renderer-test/backendFixtures.json"), "utf8",
)) as Record<string, unknown>;

function resultForStatus(status: FeasibilityStatus) {
  if (status === "infeasible") return massingPreviewResponseSchema.parse(captured.empty);
  if (status === "generation_failed") return backendPreviewResponse("preferred_failed");
  const result = backendPreviewResponse("holed");
  if (status === "feasible_target_unmet") {
    result.targets.gfa_target_m2 = 3000;
    result.feasibility.status = status;
    result.feasibility.target_assessment = {
      requested_m2: 3000, actual_m2: 2250, shortfall_m2: 750,
      status: "unmet", diagnostic_code: "TARGET_EXCEEDS_UPPER_BOUND",
    };
  }
  return result;
}

function planPaths() {
  return [...screen.getByRole("img", { name: "Site plan" }).querySelectorAll("path")]
    .map((path) => [path.getAttribute("data-layer"), path.getAttribute("d")]);
}

beforeEach(() => {
  mocks.failCanvas = false;
  mocks.scene.mockClear();
  mocks.mount.mockClear();
  mocks.unmount.mockClear();
});

describe("integrated 3D renderer states", () => {
  it.each<FeasibilityStatus>(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])(
    "preserves backend %s metrics, diagnostics and actual-building semantics in both views", async (status) => {
      const result = resultForStatus(status);
      const original = structuredClone(result);
      render(<MassingResult result={result} />);
      for (const label of ["Metrics & capacity", "Preferences & target", "Diagnostics"]) {
        const summary = screen.getByText(new RegExp(`^${label}`), { selector: "summary" });
        if (!summary.parentElement?.hasAttribute("open")) fireEvent.click(summary);
      }
      const sections = ["Actual massing", "Hard constraints and capacity", "Generated default capacity", "Preferences and target", "Diagnostics"];
      const before = sections.map((name) => screen.getByRole("region", { name }).textContent);
      const plan = planPaths();

      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByTestId("integrated-canvas");

      expect(sections.map((name) => screen.getByRole("region", { name }).textContent)).toEqual(before);
      const scene = mocks.scene.mock.lastCall?.[0].scene;
      if (result.footprint_geometry === null) {
        expect(scene.building).toBeNull();
        expect(screen.getByText(/No actual building footprint is available/)).toBeInTheDocument();
        expect(screen.getByRole("list", { name: "3D massing layers" })).not.toHaveTextContent("Actual building and footprint");
        if (status === "generation_failed") expect(result.generated_footprint_geometry).not.toBeNull();
      } else {
        expect(scene.building.floorCount).toBe(result.metrics.floor_count);
        expect(scene.building.footprint.rings).toHaveLength(result.footprint_geometry.coordinates.length);
      }
      fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
      expect(screen.queryByTestId("integrated-canvas")).not.toBeInTheDocument();
      expect(planPaths()).toEqual(plan);
      expect(result).toEqual(original);
    },
  );

  it("retains the same plan after unavailable WebGL2 and retries without changing metrics", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const suppressExpected = (event: ErrorEvent) => {
      if (event.message.includes("No WebGL2 context")) event.preventDefault();
    };
    window.addEventListener("error", suppressExpected);
    try {
      render(<MassingResult result={backendPreviewResponse("notched")} />);
      const plan = planPaths();
      const actual = screen.getByRole("region", { name: "Actual massing" }).textContent;
      mocks.failCanvas = true;
      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByText(/Interactive 3D is unavailable/);
      expect(screen.queryByTestId("integrated-canvas")).not.toBeInTheDocument();
      expect(planPaths()).toEqual(plan);
      expect(screen.getByRole("region", { name: "Actual massing" }).textContent).toBe(actual);
      mocks.failCanvas = false;
      fireEvent.click(screen.getByRole("button", { name: "Retry 3D" }));
      await screen.findByTestId("integrated-canvas");
      expect(mocks.scene.mock.lastCall?.[0].scene.buildable).toHaveLength(2);
      expect(screen.getByRole("region", { name: "Actual massing" }).textContent).toBe(actual);
    } finally {
      errors.mockRestore();
      window.removeEventListener("error", suppressExpected);
    }
  });

  it("unmounts after context loss and every return to 2D, then mounts a fresh renderer", async () => {
    render(<MassingResult result={backendPreviewResponse("holed")} />);
    fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
    await screen.findByTestId("integrated-canvas");
    fireEvent.click(screen.getByRole("button", { name: "Lose WebGL context" }));
    expect(screen.getByText(/Interactive 3D is unavailable/)).toBeInTheDocument();
    expect(screen.queryByTestId("integrated-canvas")).not.toBeInTheDocument();
    expect(mocks.unmount).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("region", { name: "Actual massing" })).getByText("2,250 m²")).toBeInTheDocument();

    for (let index = 0; index < 3; index++) {
      fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
      expect(screen.queryByText(/Interactive 3D is unavailable/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByTestId("integrated-canvas");
      fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
      expect(screen.queryByTestId("integrated-canvas")).not.toBeInTheDocument();
    }
    expect(mocks.mount).toHaveBeenCalledTimes(4);
    expect(mocks.unmount).toHaveBeenCalledTimes(4);
  });
});
