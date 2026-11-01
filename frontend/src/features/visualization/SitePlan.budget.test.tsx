import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MultiPolygonGeometry } from "../../api/contracts";
import { polygonWithPositionCount } from "../../test/displayGeometryFixtures";
import { previewResponse } from "../../test/massingFixtures";
import * as dimensions from "./dimensionAnnotations";
import SitePlan from "./SitePlan";
import * as svg from "./svgGeometry";

afterEach(() => vi.restoreAllMocks());

describe("SVG display budgets", () => {
  it("counts closing positions, every hole/component, and repeated layers", () => {
    const polygon = polygonWithPositionCount(5);
    polygon.coordinates.push(polygonWithPositionCount(4).coordinates[0]);
    const multi: MultiPolygonGeometry = {
      type: "MultiPolygon", coordinates: [polygon.coordinates, polygonWithPositionCount(6).coordinates],
    };
    expect(svg.countSvgVertices(polygon, multi, null, undefined, polygon)).toBe(33);
    expect(dimensions.countDimensionEdges(polygon, polygon)).toBe(14);
  });

  it.each([9_999, 10_000])("renders all %s positions without truncation", (count) => {
    render(<SitePlan siteGeometry={polygonWithPositionCount(count)} />);
    const path = screen.getByRole("img", { name: "Site plan" }).querySelector("path");
    expect(path?.getAttribute("d")?.match(/[ML]/g)).toHaveLength(count);
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).toBeDisabled();
  });

  it("checks the sum of all layers before bounds, paths, or measurements", () => {
    const bounds = vi.spyOn(svg, "geometryBounds");
    const path = vi.spyOn(svg, "geometryPath");
    const measure = vi.spyOn(dimensions, "measureGeometryEdges");
    const result = previewResponse();
    const { rerender } = render(<SitePlan siteGeometry={polygonWithPositionCount(9_986)}
      buildableGeometry={result.buildable_geometry} selectedBuildableGeometry={result.selected_buildable_geometry}
      footprintGeometry={result.footprint_geometry} />);
    expect(screen.getByRole("status")).toHaveTextContent("2D plan exceeds the 10,000-vertex display limit");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(bounds).not.toHaveBeenCalled();
    expect(path).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    rerender(<SitePlan siteGeometry={result.site_geometry} />);
    expect(screen.getByRole("img", { name: "Site plan" })).toBeInTheDocument();
  });

  it("allows all 250 measured edges, then disables dimensions before measurement/layout", () => {
    const measure = vi.spyOn(dimensions, "measureGeometryEdges");
    const layout = vi.spyOn(dimensions, "layoutAllDimensions");
    const footprint = polygonWithPositionCount(5);
    const { rerender } = render(<SitePlan siteGeometry={polygonWithPositionCount(247)} footprintGeometry={footprint} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show dimensions" }));
    expect(screen.getByRole("combobox", { name: "Measure edge" }).querySelectorAll("option")).toHaveLength(250);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(layout).toHaveBeenCalledOnce();
    measure.mockClear();
    layout.mockClear();

    rerender(<SitePlan siteGeometry={polygonWithPositionCount(248)} footprintGeometry={footprint} />);
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).toHaveAccessibleDescription(/250-edge display limit/);
    expect(screen.getByRole("img", { name: "Site plan" }).querySelectorAll("path")).toHaveLength(2);
    expect(screen.queryByRole("combobox", { name: "Measure edge" })).not.toBeInTheDocument();
    expect(screen.getByRole("img").querySelector("[data-dimension-overview]")).toBeNull();
    expect(measure).not.toHaveBeenCalled();
    expect(layout).not.toHaveBeenCalled();
  });
});
