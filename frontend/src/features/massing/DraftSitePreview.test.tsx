import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PolygonGeometry } from "../../api/contracts";
import DraftSitePreview from "./DraftSitePreview";
import { createRectangleSite } from "./siteGeometry";

describe("DraftSitePreview", () => {
  it("fits the current site outline and labels it separately from a backend result", () => {
    render(<DraftSitePreview geometry={createRectangleSite(40, 20)} />);

    const image = screen.getByRole("img", { name: "Draft site preview" });
    expect(screen.getByText("Live draft site")).toBeInTheDocument();
    expect(image).toHaveAccessibleDescription(/Unvalidated site outline in metres/);
    expect(image).toHaveAccessibleDescription(/Geometry validity and massing are checked by the backend/);
    expect(image).toHaveAttribute("viewBox", "0 0 320 180");
    expect(image).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(image.querySelector("path")).toHaveAttribute("d", "M16 162 L304 162 L304 18 L16 18 L16 162 Z");
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("No building footprint is available.")).not.toBeInTheDocument();
  });

  it("preserves holes, winding, and source coordinates", () => {
    const geometry = createRectangleSite(20, 20);
    geometry.coordinates.push([[5, 5], [10, 5], [10, 10], [5, 10], [5, 5]]);
    const original = structuredClone(geometry);
    render(<DraftSitePreview geometry={geometry} />);

    const path = screen.getByRole("img", { name: "Draft site preview" }).querySelector("path");
    expect(path).toHaveAttribute("fill-rule", "evenodd");
    expect(path).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(path?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(geometry).toEqual(original);
  });

  it.each([
    null,
    { type: "Polygon", coordinates: [] },
    createRectangleSite(0, 20),
    createRectangleSite(Infinity, 20),
    { type: "Polygon", coordinates: [[[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0], [0, 20], [-Number.MAX_VALUE, 0]]] },
  ] satisfies (PolygonGeometry | null)[])("replaces a previous outline with an unavailable state for %j", (geometry) => {
    const { rerender } = render(<DraftSitePreview geometry={createRectangleSite(40, 25)} />);
    expect(screen.getByRole("img", { name: "Draft site preview" })).toBeInTheDocument();

    rerender(<DraftSitePreview geometry={geometry} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Draft site preview unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("recovers immediately and gives separate instances unique accessible references", () => {
    const { rerender } = render(<DraftSitePreview geometry={null} />);
    rerender(<><DraftSitePreview geometry={createRectangleSite(10, 10)} /><DraftSitePreview geometry={createRectangleSite(40, 20)} /></>);

    const images = screen.getAllByRole("img", { name: "Draft site preview" });
    expect(images[0].querySelector("path")).toHaveAttribute("d", "M86 164 L234 164 L234 16 L86 16 L86 164 Z");
    expect(images[0].getAttribute("aria-labelledby")).not.toEqual(images[1].getAttribute("aria-labelledby"));
    expect(screen.queryByText(/Draft site preview unavailable/)).not.toBeInTheDocument();
  });
});
