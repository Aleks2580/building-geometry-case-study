import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
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
  it("renders a standalone actual building, legend, and backend dimensions", () => {
    render(<Massing3D result={previewResponse()} />);
    expect(screen.getByText("6 floors · 3.5 m per floor · 21 m total height.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "3D massing layers" })).toHaveTextContent("Actual building and footprint");
    expect(mocks.scene.mock.lastCall?.[0].scene.building.floorCount).toBe(6);
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
    expect(screen.getByRole("status")).toHaveTextContent("No actual building footprint is available");
    expect(screen.getByRole("list")).not.toHaveTextContent("Actual building and footprint");
  });

  it("replaces a previous building with diagnostic context", () => {
    const { rerender } = render(<Massing3D result={previewResponse()} />);
    rerender(<Massing3D result={backendPreviewResponse("preferred_failed")} />);
    expect(mocks.scene.mock.lastCall?.[0].scene.building).toBeNull();
    expect(screen.queryByText(/6 floors/)).not.toBeInTheDocument();
  });

  it("reports inconsistent data without mounting a canvas", () => {
    const result = previewResponse();
    result.metrics.height_m = 100;
    render(<Massing3D result={result} />);
    expect(screen.getByRole("status")).toHaveTextContent("3D display input is invalid");
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
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
