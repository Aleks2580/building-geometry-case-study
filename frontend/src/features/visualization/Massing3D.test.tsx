import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { polygonWithPositionCount } from "../../test/displayGeometryFixtures";
import { previewResponse } from "../../test/massingFixtures";
import Massing3D from "./Massing3D";
import type Massing3DScene from "./Massing3DScene";

const mocks = vi.hoisted(() => ({ failCanvas: false, scene: vi.fn() }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => {
    if (mocks.failCanvas) throw new Error("No WebGL2 context");
    return <div data-testid="canvas">{children}</div>;
  },
}));
vi.mock("./Massing3DScene", () => ({
  default: (props: ComponentProps<typeof Massing3DScene>) => {
    mocks.scene(props);
    return <button onClick={props.onContextLost}>Simulate context loss</button>;
  },
}));

describe("Massing3D presentation", () => {
  it("keeps fallback bounded when the 3D floor limit and SVG vertex limit are exceeded", () => {
    const result = previewResponse();
    result.site_geometry = polygonWithPositionCount(10_001);
    result.metrics.floor_count = 513;
    const original = structuredClone(result);
    render(<Massing3D result={result} />);
    expect(screen.getByText(/exceeds the supported 3D display/)).toBeInTheDocument();
    expect(screen.getByText(/2D plan exceeds the 10,000-vertex display limit/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(result).toEqual(original);
  });

  it("renders a standalone actual building, legend, and backend dimensions", () => {
    render(<Massing3D result={previewResponse()} />);
    const dimensions = screen.getByRole("group", { name: "Building dimensions" });
    expect(dimensions).toHaveTextContent("21 m total height");
    expect(dimensions).toHaveTextContent("6 floors · 3.5 m per floor");
    expect(screen.getByRole("list", { name: "3D massing layers" })).toHaveTextContent("Actual building and footprint");
    expect(mocks.scene.mock.lastCall?.[0].scene.building.floorCount).toBe(6);
    expect(mocks.scene.mock.lastCall?.[0].heightLabel).toBe("21 m");
  });

  it("updates the readout and height marker from the current backend result without mutating either snapshot", () => {
    const first = previewResponse();
    const second = previewResponse();
    second.hard_constraints.floor_to_floor_m = 4.25;
    second.metrics.floor_count = 3;
    second.metrics.floor_to_floor_m = 4.25;
    second.metrics.height_m = 12.75;
    second.metrics.gfa_m2 = 1938;
    const originals = structuredClone([first, second]);
    const { rerender } = render(<Massing3D result={first} />);
    rerender(<Massing3D result={second} />);
    const dimensions = screen.getByRole("group", { name: "Building dimensions" });
    expect(dimensions).toHaveTextContent("12.75 m total height");
    expect(dimensions).toHaveTextContent("3 floors · 4.25 m per floor");
    expect(dimensions).not.toHaveTextContent("21 m");
    const current = mocks.scene.mock.lastCall?.[0];
    expect(current.heightLabel).toBe("12.75 m");
    expect(current.scene.building.totalHeight / current.scene.frame.scale).toBeCloseTo(second.metrics.height_m!);
    expect([first, second]).toEqual(originals);
  });

  it("increments reset interaction without changing the backend result", () => {
    const result = previewResponse();
    const before = structuredClone(result);
    render(<Massing3D result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to fit" }));
    expect(mocks.scene.mock.lastCall?.[0].reset).toBe(1);
    expect(result).toEqual(before);
  });

  it("keeps split setback context and renders only the actual selected building", () => {
    render(<Massing3D result={backendPreviewResponse("notched")} />);
    const scene = mocks.scene.mock.lastCall?.[0].scene;
    expect(scene.buildable).toHaveLength(2);
    expect(scene.selectedBuildable).toHaveLength(1);
    expect(scene.building.floorCount).toBe(6);
  });

  it("never substitutes default generation when preferred construction failed", () => {
    const result = backendPreviewResponse("preferred_failed");
    expect(result.generated_footprint_geometry).not.toBeNull();
    render(<Massing3D result={result} />);
    expect(mocks.scene.mock.lastCall?.[0].scene.building).toBeNull();
    expect(mocks.scene.mock.lastCall?.[0].heightLabel).toBeUndefined();
    expect(screen.queryByRole("group", { name: "Building dimensions" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No actual building footprint is available");
    expect(screen.getByRole("list")).not.toHaveTextContent("Actual building and footprint");
  });

  it("replaces a previous building with diagnostic context", () => {
    const { rerender } = render(<Massing3D result={previewResponse()} />);
    rerender(<Massing3D result={backendPreviewResponse("preferred_failed")} />);
    expect(mocks.scene.mock.lastCall?.[0].scene.building).toBeNull();
    expect(mocks.scene.mock.lastCall?.[0].heightLabel).toBeUndefined();
    expect(screen.queryByRole("group", { name: "Building dimensions" })).not.toBeInTheDocument();
    expect(screen.queryByText(/6 floors/)).not.toBeInTheDocument();
  });

  it("reports inconsistent data without mounting a canvas", () => {
    const result = previewResponse();
    result.metrics.height_m = 100;
    render(<Massing3D result={result} />);
    expect(screen.getByRole("status")).toHaveTextContent("3D display input is invalid");
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Building dimensions" })).not.toBeInTheDocument();
  });

  it("rejects excessive floor counts rather than truncating them", () => {
    const result = previewResponse();
    result.metrics.floor_count = Number.MAX_SAFE_INTEGER;
    render(<Massing3D result={result} />);
    expect(screen.getByRole("status")).toHaveTextContent("exceeds the supported 3D display");
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Site plan" })).toBeInTheDocument();
  });

  it("falls back to the same SVG geometry after context loss and allows retry", () => {
    render(<Massing3D result={backendPreviewResponse("holed")} />);
    fireEvent.click(screen.getByRole("button", { name: "Simulate context loss" }));
    expect(screen.getByText(/Interactive 3D is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Site plan" }).querySelector('[data-layer="footprint"]')).not.toBeNull();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "Building dimensions" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry 3D" }));
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("catches renderer initialization failure with an explicit SVG fallback", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const expectedError = (event: ErrorEvent) => {
      if (event.message.includes("No WebGL2 context")) event.preventDefault();
    };
    window.addEventListener("error", expectedError);
    mocks.failCanvas = true;
    try {
      render(<Massing3D result={previewResponse()} />);
      expect(screen.getByText(/Interactive 3D is unavailable/)).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Site plan" })).toBeInTheDocument();
    } finally {
      mocks.failCanvas = false;
      window.removeEventListener("error", expectedError);
      consoleError.mockRestore();
    }
  });
});
