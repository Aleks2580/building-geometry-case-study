import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MassingPreviewResponse, PolygonGeometry } from "../../api/contracts";
import { previewResponse } from "../../test/massingFixtures";
import SitePlan from "./SitePlan";

function rectangle(minX: number, minY: number, maxX: number, maxY: number): PolygonGeometry {
  return {
    type: "Polygon",
    coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
  };
}

function geometryProps(result: MassingPreviewResponse) {
  return {
    siteGeometry: result.site_geometry,
    buildableGeometry: result.buildable_geometry,
    selectedBuildableGeometry: result.selected_buildable_geometry,
    footprintGeometry: result.footprint_geometry,
  };
}

function layer(svg: Element, key: string) {
  const path = svg.querySelector(`path[data-layer="${key}"]`);
  if (path === null) throw new Error(`Missing geometry layer: ${key}`);
  return path;
}

describe("SitePlan", () => {
  it("renders four identified backend layers in order without a provider", () => {
    const result = previewResponse();
    result.footprint_geometry = rectangle(10, 5, 30, 20);
    render(<SitePlan {...geometryProps(result)} width={120} height={100} padding={10} />);

    const svg = screen.getByRole("img", { name: "Site plan" });
    expect(svg).toHaveAccessibleDescription(/Plan view of backend geometry in metres/);
    expect(svg).toHaveAccessibleDescription(/Larger y coordinates point upward/);
    expect(svg).toHaveAttribute("viewBox", "0 0 120 100");
    expect(svg).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    const paths = [...svg.querySelectorAll("path")];
    expect(paths.map((path) => path.getAttribute("data-layer"))).toEqual([
      "site", "buildable", "selected-buildable", "footprint",
    ]);
    expect(new Set(paths.map((path) => path.getAttribute("class"))).size).toBe(4);
    for (const path of paths) {
      expect(path).toHaveAttribute("fill-rule", "evenodd");
      expect(path).toHaveAttribute("vector-effect", "non-scaling-stroke");
      expect(path).toHaveAttribute("aria-label");
    }
    expect(layer(svg, "site")).toHaveAttribute("d", "M10 81.25 L110 81.25 L110 18.75 L10 18.75 L10 81.25 Z");
    expect(layer(svg, "buildable")).toHaveAttribute("d", "M17.5 73.75 L102.5 73.75 L102.5 26.25 L17.5 26.25 L17.5 73.75 Z");
    expect(layer(svg, "footprint")).toHaveAttribute("d", "M35 68.75 L85 68.75 L85 31.25 L35 31.25 L35 68.75 Z");
    const legend = screen.getByRole("list", { name: "Site plan layers" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Original site boundary", "Complete buildable region", "Selected buildable component", "Actual building footprint",
    ]);
  });

  it("keeps every split setback component separate from selection and the building", () => {
    const selected = rectangle(3, 3, 18, 22);
    const discarded = rectangle(25, 3, 37, 22);
    render(<SitePlan
      siteGeometry={previewResponse().site_geometry}
      buildableGeometry={{ type: "MultiPolygon", coordinates: [selected.coordinates, discarded.coordinates] }}
      selectedBuildableGeometry={selected}
      footprintGeometry={rectangle(5, 5, 16, 20)}
      width={120} height={100} padding={10}
    />);

    const svg = screen.getByRole("img");
    const completePath = layer(svg, "buildable").getAttribute("d");
    expect(completePath).toBe("M17.5 73.75 L55 73.75 L55 26.25 L17.5 26.25 L17.5 73.75 Z M72.5 73.75 L102.5 73.75 L102.5 26.25 L72.5 26.25 L72.5 73.75 Z");
    expect(layer(svg, "selected-buildable")).toHaveAttribute("d", "M17.5 73.75 L55 73.75 L55 26.25 L17.5 26.25 L17.5 73.75 Z");
    expect(layer(svg, "footprint")).toHaveAttribute("d", "M22.5 68.75 L50 68.75 L50 31.25 L22.5 31.25 L22.5 68.75 Z");
  });

  it("preserves holes in every layer even when rings share winding", () => {
    const site = rectangle(0, 0, 40, 40);
    site.coordinates.push(rectangle(8, 8, 12, 12).coordinates[0]);
    const buildable = rectangle(3, 3, 37, 37);
    buildable.coordinates.push(rectangle(6, 6, 14, 14).coordinates[0]);
    const footprint = rectangle(5, 5, 35, 35);
    footprint.coordinates.push(rectangle(6, 6, 14, 14).coordinates[0]);
    render(<SitePlan
      siteGeometry={site}
      buildableGeometry={buildable}
      selectedBuildableGeometry={buildable}
      footprintGeometry={footprint}
      width={240} height={240} padding={20}
    />);

    const svg = screen.getByRole("img");
    for (const path of svg.querySelectorAll("path")) {
      expect(path.getAttribute("d")?.match(/M/g)).toHaveLength(2);
      expect(path.getAttribute("d")?.match(/Z/g)).toHaveLength(2);
      expect(path).toHaveAttribute("fill-rule", "evenodd");
    }
    expect(layer(svg, "site").getAttribute("d")).toContain("M60 180 L80 180 L80 160 L60 160 L60 180 Z");
    expect(layer(svg, "footprint").getAttribute("d")).toContain("M50 190 L90 190 L90 150 L50 150 L50 190 Z");
  });

  it.each([
    [240, 100, "M56 90 L184 90 L184 10 L56 10 L56 90 Z"],
    [100, 240, "M10 145 L90 145 L90 95 L10 95 L10 145 Z"],
  ])("fits an aspect-preserving frame at %i × %i", (width, height, expectedPath) => {
    render(<SitePlan siteGeometry={previewResponse().site_geometry} width={width} height={height} padding={10} />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("viewBox", `0 0 ${width} ${height}`);
    expect(layer(svg, "site")).toHaveAttribute("d", expectedPath);
  });

  it("uses a default logical viewport and padding", () => {
    render(<SitePlan siteGeometry={rectangle(0, 0, 40, 40)} />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("viewBox", "0 0 640 400");
    expect(svg).toHaveAttribute("width", "640");
    expect(svg).toHaveAttribute("height", "400");
    expect(layer(svg, "site")).toHaveAttribute("d", "M144 376 L496 376 L496 24 L144 24 L144 376 Z");
  });

  it.each([
    { buildableGeometry: null, selectedBuildableGeometry: null, footprintGeometry: null },
    { buildableGeometry: { type: "MultiPolygon", coordinates: [] }, selectedBuildableGeometry: { type: "Polygon", coordinates: [] }, footprintGeometry: { type: "Polygon", coordinates: [[]] } },
    {},
  ] satisfies Partial<ReturnType<typeof geometryProps>>[])("renders the site with unavailable optional layers: %j", (optional) => {
    render(<SitePlan siteGeometry={previewResponse().site_geometry} {...optional} />);
    const svg = screen.getByRole("img");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(layer(svg, "site")).toBeInTheDocument();
    expect(svg).toHaveAccessibleDescription(/No building footprint is available/);
    expect(screen.getByText("No building footprint is available.", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Actual building footprint", { selector: "li" })).not.toBeInTheDocument();
  });

  it("retains setback context without substituting known default-generation geometry", () => {
    const result = previewResponse();
    result.footprint_geometry = null;
    expect(result.generated_footprint_geometry).not.toBeNull();
    render(<SitePlan {...geometryProps(result)} />);
    const svg = screen.getByRole("img");
    expect(svg.querySelectorAll("path")).toHaveLength(3);
    expect(layer(svg, "buildable")).toBeInTheDocument();
    expect(layer(svg, "selected-buildable")).toBeInTheDocument();
    expect(svg.querySelector('[data-layer="footprint"]')).toBeNull();
  });

  it("never promotes an unselected complete setback to a building", () => {
    const result = previewResponse();
    render(<SitePlan siteGeometry={result.site_geometry} buildableGeometry={result.buildable_geometry} />);
    const svg = screen.getByRole("img");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(svg.querySelector('[data-layer="selected-buildable"]')).toBeNull();
    expect(svg.querySelector('[data-layer="footprint"]')).toBeNull();
  });

  it("does not refit or mutate geometry when optional layers change", () => {
    const result = previewResponse();
    const original = structuredClone(result);
    for (const geometry of [result.site_geometry, result.buildable_geometry, result.footprint_geometry]) {
      if (geometry?.type !== "Polygon") continue;
      for (const ring of geometry.coordinates) {
        ring.forEach(Object.freeze);
        Object.freeze(ring);
      }
      Object.freeze(geometry.coordinates);
      Object.freeze(geometry);
    }
    const { rerender } = render(<SitePlan {...geometryProps(result)} />);
    const before = [...screen.getByRole("img").querySelectorAll("path")].map((path) => path.getAttribute("d"));
    rerender(<SitePlan {...geometryProps(result)} />);
    expect([...screen.getByRole("img").querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual(before);
    rerender(<SitePlan siteGeometry={result.site_geometry} />);
    expect(layer(screen.getByRole("img"), "site")).toHaveAttribute("d", before[0]);
    expect(result).toEqual(original);
  });

  it("keeps title and description references unique across instances", () => {
    const site = previewResponse().site_geometry;
    render(<><SitePlan siteGeometry={site} /><SitePlan siteGeometry={site} /></>);
    const images = screen.getAllByRole("img", { name: "Site plan" });
    expect(images[0].getAttribute("aria-labelledby")).not.toBe(images[1].getAttribute("aria-labelledby"));
    expect(images[0].getAttribute("aria-describedby")).not.toBe(images[1].getAttribute("aria-describedby"));
    for (const image of images) {
      expect(image).toHaveAccessibleName("Site plan");
      expect(image).toHaveAccessibleDescription(/No building footprint is available/);
    }
  });

  it("keeps an empty site frame unavailable rather than fitting a result layer", () => {
    const result = previewResponse();
    render(<SitePlan {...geometryProps(result)} siteGeometry={{ type: "Polygon", coordinates: [] }} />);
    const svg = screen.getByRole("img");
    expect(svg.querySelectorAll("path")).toHaveLength(0);
    expect(svg).toHaveAccessibleDescription(/Site geometry cannot be displayed/);
    expect(screen.getByText("Site geometry cannot be displayed.", { selector: "p" })).toBeInTheDocument();
  });
});
