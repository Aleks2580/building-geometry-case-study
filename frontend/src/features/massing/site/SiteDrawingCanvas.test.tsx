import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { polygonWithPositionCount } from "../../../test/displayGeometryFixtures";
import { defaultDrawingExtent } from "./siteDrawing";
import SiteDrawingCanvas from "./SiteDrawingCanvas";

describe("SiteDrawingCanvas display budget", () => {
  it.each([true, false])("bounds paths and drag handles while drawing=%s", (drawing) => {
    const geometry = polygonWithPositionCount(5_002);
    const { container, rerender } = render(<SiteDrawingCanvas geometry={geometry}
      points={geometry.coordinates[0].slice(0, -1)} drawing={drawing} selectedIndex={null} extent={defaultDrawingExtent}
      onPlace={vi.fn()} onSelect={vi.fn()} onFinish={vi.fn()} onMoveStart={vi.fn()} onMove={vi.fn()}
      onMoveEnd={vi.fn()} onMoveCancel={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Use Advanced JSON or the point controls");
    expect(container.querySelectorAll("svg, [data-handle]")).toHaveLength(0);
    rerender(<SiteDrawingCanvas geometry={null} points={[]} drawing selectedIndex={null} extent={defaultDrawingExtent}
      onPlace={vi.fn()} onSelect={vi.fn()} onFinish={vi.fn()} onMoveStart={vi.fn()} onMove={vi.fn()}
      onMoveEnd={vi.fn()} onMoveCancel={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Site polygon drawing area" })).toBeInTheDocument();
  });
});
