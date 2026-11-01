import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MassingPreviewResponse } from "../../api/contracts";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { previewResponse } from "../../test/massingFixtures";
import MassingVisualization from "./MassingVisualization";

const viewer = vi.hoisted(() => {
  let finishLoading!: () => void;
  const loading = new Promise<void>((resolve) => { finishLoading = resolve; });
  return { loading, finishLoading, loaded: vi.fn(), render: vi.fn(), mount: vi.fn(), unmount: vi.fn() };
});

vi.mock("./Massing3D", async () => {
  viewer.loaded();
  await viewer.loading;
  return { default: function TestViewer({ result }: { result: MassingPreviewResponse }) {
    viewer.render(result);
    useEffect(() => {
      viewer.mount();
      return () => { viewer.unmount(); };
    }, []);
    return <div data-testid="3d-view">{result.feasibility.status}</div>;
  } };
});

describe("MassingVisualization", () => {
  it("starts in 2D without loading 3D and announces loading only after explicit selection", async () => {
    const result = backendPreviewResponse("holed");
    render(<MassingVisualization result={result} />);
    expect(viewer.loaded).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Site plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2D Plan" })).toHaveAttribute("aria-pressed", "true");
    const threeD = screen.getByRole("button", { name: "3D Massing" });
    expect(threeD).toHaveAttribute("type", "button");
    expect(screen.getByRole("group", { name: "Visualization view" })).toContainElement(threeD);
    fireEvent.click(threeD);
    expect(screen.getByRole("status")).toHaveTextContent("Loading 3D visualization");
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    // The pending import may complete after the user returns to 2D; it must not mount a scene.
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    await act(async () => { viewer.finishLoading(); await viewer.loading; });
    expect(viewer.mount).not.toHaveBeenCalled();
    fireEvent.click(threeD);
    await screen.findByTestId("3d-view");
    expect(viewer.render.mock.lastCall?.[0]).toBe(result);
    expect(threeD).toHaveAttribute("aria-pressed", "true");
  });

  it("unmounts the renderer on every return to 2D and forwards replacement data unchanged", async () => {
    const first = previewResponse();
    const replacement = backendPreviewResponse("notched");
    const original = structuredClone(replacement);
    const { rerender } = render(<MassingVisualization result={first} />);
    const mounted = viewer.mount.mock.calls.length;
    const unmounted = viewer.unmount.mock.calls.length;
    for (let index = 0; index < 4; index++) {
      fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
      await screen.findByTestId("3d-view");
      fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
      expect(screen.queryByTestId("3d-view")).not.toBeInTheDocument();
    }
    expect(viewer.mount.mock.calls.length - mounted).toBe(4);
    expect(viewer.unmount.mock.calls.length - unmounted).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
    await screen.findByTestId("3d-view");
    rerender(<MassingVisualization result={replacement} />);
    expect(viewer.render.mock.lastCall?.[0]).toBe(replacement);
    expect(screen.getByRole("button", { name: "3D Massing" })).toHaveAttribute("aria-pressed", "true");
    expect(replacement).toEqual(original);
  });
});
