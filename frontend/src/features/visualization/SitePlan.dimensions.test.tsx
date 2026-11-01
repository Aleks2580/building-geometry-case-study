import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PolygonGeometry } from "../../api/contracts";
import { previewResponse } from "../../test/massingFixtures";
import SitePlan from "./SitePlan";

function polygon(ring: PolygonGeometry["coordinates"][number], ...holes: PolygonGeometry["coordinates"]): PolygonGeometry {
  return { type: "Polygon", coordinates: [ring, ...holes] };
}

function plan() {
  return screen.getByRole("img", { name: "Site plan" });
}

function paths() {
  return [...plan().querySelectorAll("path[data-layer]")].map((path) => [path.getAttribute("data-layer"), path.getAttribute("d")]);
}

function toggle() {
  fireEvent.click(screen.getByRole("checkbox", { name: "Show dimensions" }));
}

function select(id: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Measure edge" }), { target: { value: id } });
}

function measurement() {
  const element = plan().closest("figure")?.querySelector("figcaption [aria-live='polite']");
  if (!element) throw new Error("Missing selected measurement readout.");
  return element;
}

function showAll() {
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
}

function overviewValues() {
  return new Map([...plan().querySelectorAll("[data-overview-dimension]")].map((label) => [
    label.getAttribute("data-overview-dimension"), label.querySelector("text")?.textContent,
  ]));
}

describe("SitePlan dimension inspection", () => {
  it("starts hidden with a focusable labeled checkbox and preserves every geometry layer when toggled", () => {
    const result = previewResponse();
    const original = structuredClone(result);
    const onSubmit = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<form onSubmit={onSubmit}><SitePlan siteGeometry={result.site_geometry}
      buildableGeometry={result.buildable_geometry} selectedBuildableGeometry={result.selected_buildable_geometry}
      footprintGeometry={result.footprint_geometry} /></form>);
    const checkbox = screen.getByRole("checkbox", { name: "Show dimensions" });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeEnabled();
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    expect(screen.queryByRole("combobox", { name: "Measure edge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
    expect(plan().querySelector("[data-dimensions]")).toBeNull();
    const before = paths();
    const viewBox = plan().getAttribute("viewBox");
    toggle();
    expect(checkbox).toBeChecked();
    expect(screen.getByRole("button", { name: "Selected edge" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show all" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("combobox", { name: "Measure edge" })).toHaveAccessibleDescription(/Showing one edge at a time/);
    expect(measurement()).toHaveTextContent("Site boundary · edge 1: 40 m");
    expect(plan()).toHaveAccessibleDescription(/Selected measurement: Site boundary · edge 1, 40 m/);
    expect(plan().querySelectorAll("[data-dimensions]")).toHaveLength(1);
    expect(paths()).toEqual(before);
    expect(plan()).toHaveAttribute("viewBox", viewBox);
    toggle();
    expect(plan().querySelector("[data-dimensions]")).toBeNull();
    expect(paths()).toEqual(before);
    expect(result).toEqual(original);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows every exterior and hole measurement at once and selects labels without submitting or requesting data", () => {
    const site = polygon([[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]],
      [[2, 2], [5, 2], [5, 6], [2, 6], [2, 2]]);
    const footprint = polygon([[5, 5], [35, 5], [5, 35], [5, 5]],
      [[8, 8], [11, 8], [8, 12], [8, 8]]);
    const original = structuredClone({ site, footprint });
    const fetch = vi.fn();
    const onSubmit = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<form onSubmit={onSubmit}><SitePlan siteGeometry={site} footprintGeometry={footprint} /></form>);
    const before = paths();
    const viewBox = plan().getAttribute("viewBox");
    toggle();
    const modes = screen.getByRole("group", { name: "Dimension display" });
    const allButton = within(modes).getByRole("button", { name: "Show all" });
    allButton.focus();
    expect(allButton).toHaveFocus();
    expect(allButton).toHaveAttribute("type", "button");
    showAll();
    expect(allButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Selected edge" })).toHaveAttribute("aria-pressed", "false");
    expect(overviewValues()).toEqual(new Map([
      ["site-0-0", "40 m"], ["site-0-1", "40 m"], ["site-0-2", "40 m"], ["site-0-3", "40 m"],
      ["site-1-0", "3 m"], ["site-1-1", "4 m"], ["site-1-2", "3 m"], ["site-1-3", "4 m"],
      ["footprint-0-0", "30 m"], ["footprint-0-1", "42.43 m"], ["footprint-0-2", "30 m"],
      ["footprint-1-0", "3 m"], ["footprint-1-1", "5 m"], ["footprint-1-2", "4 m"],
    ]));
    expect(plan().querySelectorAll("[data-dimensions] text")).toHaveLength(0);
    expect(plan().querySelectorAll("[data-overview-dimension] text")).toHaveLength(14);
    expect(screen.getByText(/14 of 14 edge dimensions shown/)).toBeInTheDocument();
    const diagonal = plan().querySelector("[data-overview-dimension='footprint-0-1']")!;
    expect(diagonal.querySelector("title")).toHaveTextContent("Building footprint · edge 2 — 42.43 m");
    fireEvent.click(diagonal);
    expect(diagonal).toHaveAttribute("data-selected", "true");
    expect(plan().querySelectorAll("[data-overview-dimension][data-selected='true']")).toHaveLength(1);
    expect(measurement()).toHaveTextContent("Building footprint · edge 2: 42.43 m");
    expect(screen.getByRole("combobox", { name: "Measure edge" })).toHaveValue("footprint-0-1");
    expect(paths()).toEqual(before);
    expect(plan()).toHaveAttribute("viewBox", viewBox);
    expect({ site, footprint }).toEqual(original);
    fireEvent.click(screen.getByRole("button", { name: "Selected edge" }));
    expect(plan().querySelectorAll("[data-overview-dimension]")).toHaveLength(0);
    expect(plan().querySelectorAll("[data-dimensions] text")).toHaveLength(1);
    expect(measurement()).toHaveTextContent("Building footprint · edge 2: 42.43 m");
    expect(fetch).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("updates every overview label from current geometry and removes missing footprint and hole labels", () => {
    const site = previewResponse().site_geometry;
    const first = polygon([[3, 3], [37, 3], [37, 22], [3, 22], [3, 3]],
      [[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]);
    const second = polygon([[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]);
    const view = render(<SitePlan siteGeometry={site} footprintGeometry={first} />);
    toggle();
    showAll();
    select("footprint-1-0");
    expect(overviewValues().size).toBe(12);
    expect(overviewValues().get("footprint-0-0")).toBe("34 m");
    expect(overviewValues().get("footprint-1-0")).toBe("2 m");
    view.rerender(<SitePlan siteGeometry={site} footprintGeometry={second} />);
    expect(screen.getByRole("button", { name: "Show all" })).toHaveAttribute("aria-pressed", "true");
    expect(overviewValues().size).toBe(8);
    expect(overviewValues().get("footprint-0-0")).toBe("10 m");
    expect(overviewValues().has("footprint-1-0")).toBe(false);
    expect(measurement()).toHaveTextContent("Site boundary · edge 1: 40 m");
    view.rerender(<SitePlan siteGeometry={site} footprintGeometry={null} />);
    expect(overviewValues().size).toBe(4);
    expect([...overviewValues().keys()].every((id) => id?.startsWith("site-"))).toBe(true);
    expect(screen.getByText(/4 of 4 edge dimensions shown/)).toBeInTheDocument();
    toggle();
    expect(plan().querySelectorAll("[data-overview-dimension]")).toHaveLength(0);
  });

  it("offers enlargement even for an uncrowded overview and always grows beyond the fitted width", () => {
    render(<SitePlan siteGeometry={previewResponse().site_geometry} />);
    vi.spyOn(plan(), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 625));
    vi.spyOn(plan().parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 625));
    const before = paths();
    toggle();
    showAll();
    expect(screen.queryByText(/Labels are crowded/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enlarge plan" }));
    expect(Number(plan().style.width.replace("px", ""))).toBeGreaterThanOrEqual(1500);
    expect(overviewValues().size).toBe(4);
    expect(paths()).toEqual(before);
  });

  it("keeps crowded geometry complete and offers a keyboard-focusable enlarged plan without refitting source paths", () => {
    const ring: PolygonGeometry["coordinates"][number] = Array.from({ length: 100 }, (_, index) => {
      const angle = index * Math.PI / 50;
      return [50 + Math.cos(angle) * 40, 50 + Math.sin(angle) * 40];
    });
    ring.push([...ring[0]]);
    const original = structuredClone(ring);
    render(<SitePlan siteGeometry={polygon(ring)} />);
    vi.spyOn(plan(), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 248, 155));
    vi.spyOn(plan().parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 248, 155));
    const before = paths();
    const viewBox = plan().getAttribute("viewBox");
    toggle();
    showAll();
    expect(overviewValues().size).toBe(100);
    expect(screen.getByText(/100 of 100 edge dimensions shown/)).toBeInTheDocument();
    expect(screen.getByText(/Labels are crowded at this size/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enlarge plan" }));
    const scrollRegion = screen.getByRole("region", { name: "Scrollable dimension plan" });
    scrollRegion.focus();
    expect(scrollRegion).toHaveFocus();
    const renderedWidth = Number(plan().style.width.replace("px", ""));
    expect(renderedWidth).toBeGreaterThanOrEqual(640);
    for (const text of plan().querySelectorAll("[data-overview-dimension] text")) {
      expect(Number(text.getAttribute("font-size")) * renderedWidth / 640).toBeCloseTo(10);
    }
    expect(overviewValues().size).toBe(100);
    expect(paths()).toEqual(before);
    expect(plan()).toHaveAttribute("viewBox", viewBox);
    fireEvent.click(screen.getByRole("button", { name: "Fit plan" }));
    expect(screen.queryByRole("region", { name: "Scrollable dimension plan" })).not.toBeInTheDocument();
    expect(plan().style.width).toBe("");
    expect(overviewValues().size).toBe(100);
    expect(paths()).toEqual(before);
    expect(ring).toEqual(original);
  });

  it.each([390, 320])("shows compact bounded 10 px overview labels at %s px without shrinking measurements to zero", (clientWidth) => {
    let callback: ResizeObserverCallback = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(onResize: ResizeObserverCallback) { callback = onResize; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
    render(<SitePlan siteGeometry={polygon([[0, 0], [0.000001, 0], [40, 0], [40, 20], [0, 20], [0, 0]])} />);
    vi.spyOn(plan(), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, clientWidth, clientWidth * 400 / 640));
    toggle();
    showAll();
    act(() => callback([], {} as ResizeObserver));
    expect(overviewValues().size).toBe(5);
    expect(overviewValues().get("site-0-0")).toBe("1.00e-6 m");
    for (const text of plan().querySelectorAll("[data-overview-dimension] text")) {
      expect(Number(text.getAttribute("font-size")) * clientWidth / 640).toBeCloseTo(10);
      expect(text).not.toHaveAttribute("transform");
    }
    for (const label of plan().querySelectorAll("[data-overview-dimension] rect")) {
      const x = Number(label.getAttribute("x")), y = Number(label.getAttribute("y"));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + Number(label.getAttribute("width"))).toBeLessThanOrEqual(640);
      expect(y + Number(label.getAttribute("height"))).toBeLessThanOrEqual(400);
    }
  });

  it("identifies exterior and hole edges independently for site and actual footprint", () => {
    const site = polygon([[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]],
      [[2, 2], [5, 2], [5, 6], [2, 6], [2, 2]]);
    const footprint = polygon([[5, 5], [35, 5], [5, 35], [5, 5]],
      [[8, 8], [11, 8], [8, 12], [8, 8]]);
    const original = structuredClone({ site, footprint });
    render(<SitePlan siteGeometry={site} footprintGeometry={footprint} />);
    toggle();
    const selector = screen.getByRole("combobox", { name: "Measure edge" });
    expect(within(selector).getAllByRole("option")).toHaveLength(14);
    expect([...selector.querySelectorAll("optgroup")].map((group) => group.label)).toEqual([
      "Site boundary", "Site hole 1", "Building footprint", "Footprint hole 1",
    ]);
    select("site-1-0");
    expect(measurement()).toHaveTextContent("Site hole 1 · edge 1: 3 m");
    expect(plan().querySelector("[data-dimension-edge]")).toHaveAttribute("data-dimension-edge", "site-1-0");
    select("footprint-0-1");
    expect(measurement()).toHaveTextContent("Building footprint · edge 2: 42.43 m");
    select("footprint-1-1");
    expect(measurement()).toHaveTextContent("Footprint hole 1 · edge 2: 5 m");
    expect([...plan().querySelectorAll("path[data-layer]")].every((path) => path.getAttribute("fill-rule") === "evenodd")).toBe(true);
    expect({ site, footprint }).toEqual(original);
  });

  it("updates a retained edge from the current snapshot and falls back when a footprint or hole disappears", () => {
    const site = previewResponse().site_geometry;
    const first = polygon([[3, 3], [37, 3], [37, 22], [3, 22], [3, 3]],
      [[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]);
    const second = polygon([[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]);
    const view = render(<SitePlan siteGeometry={site} footprintGeometry={first} />);
    toggle();
    select("footprint-0-0");
    expect(measurement()).toHaveTextContent("Building footprint · edge 1: 34 m");
    view.rerender(<SitePlan siteGeometry={site} footprintGeometry={second} />);
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).toBeChecked();
    expect(measurement()).toHaveTextContent("Building footprint · edge 1: 10 m");
    view.rerender(<SitePlan siteGeometry={site} footprintGeometry={first} />);
    select("footprint-1-0");
    view.rerender(<SitePlan siteGeometry={site} footprintGeometry={second} />);
    expect(measurement()).toHaveTextContent("Site boundary · edge 1: 40 m");
    expect(screen.getByRole("combobox", { name: "Measure edge" })).toHaveValue("site-0-0");
    view.rerender(<SitePlan siteGeometry={site} footprintGeometry={null} />);
    expect(screen.queryByRole("option", { name: /Building footprint|Footprint hole/ })).not.toBeInTheDocument();
    expect(measurement()).toHaveTextContent("Site boundary · edge 1: 40 m");
    expect(screen.getByText("No building footprint is available.")).toBeInTheDocument();
  });

  it("keeps every complex and short edge inspectable while showing a single annotation", () => {
    const ring: PolygonGeometry["coordinates"][number] = Array.from({ length: 100 }, (_, index) => {
      const angle = index * Math.PI / 50;
      return [50 + Math.cos(angle) * 40, 50 + Math.sin(angle) * 40];
    });
    ring.push([...ring[0]]);
    render(<SitePlan siteGeometry={polygon(ring)} />);
    toggle();
    expect(within(screen.getByRole("combobox", { name: "Measure edge" })).getAllByRole("option")).toHaveLength(100);
    select("site-0-99");
    expect(measurement()).toHaveTextContent("Site boundary · edge 100");
    expect(plan().querySelectorAll("[data-dimensions]")).toHaveLength(1);
    expect(plan().querySelectorAll("[data-dimensions] text")).toHaveLength(1);
    expect(plan().querySelector("[data-dimension-edge]")).toHaveAttribute("data-dimension-edge", "site-0-99");
  });

  it("does not round a short nonzero backend edge to zero", () => {
    render(<SitePlan siteGeometry={polygon([[0, 0], [0.000001, 0], [40, 0], [40, 20], [0, 20], [0, 0]])} />);
    toggle();
    expect(measurement()).toHaveTextContent("Site boundary · edge 1: 1.00e-6 m");
    expect(plan().querySelector("[data-dimensions] text")).toHaveTextContent("1.00e-6 m");
    expect(plan().querySelector("[data-dimension-edge]")).toHaveAttribute("data-dimension-edge", "site-0-0");
  });

  it.each([390, 320])("keeps responsive annotation text readable and bounded at %s px", (clientWidth) => {
    let callback: ResizeObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(onResize: ResizeObserverCallback) { callback = onResize; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const view = render(<SitePlan siteGeometry={previewResponse().site_geometry} />);
    const rectangle = new DOMRect(0, 0, clientWidth, clientWidth * 400 / 640);
    vi.spyOn(plan(), "getBoundingClientRect").mockReturnValue(rectangle);
    toggle();
    act(() => callback([], {} as ResizeObserver));
    const text = plan().querySelector("[data-dimensions] text");
    expect(Number(text?.getAttribute("font-size")) * clientWidth / 640).toBeCloseTo(12);
    expect(text).not.toHaveAttribute("transform");
    const label = plan().querySelector("[data-dimensions] rect")!;
    const x = Number(label.getAttribute("x"));
    const y = Number(label.getAttribute("y"));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + Number(label.getAttribute("width"))).toBeLessThanOrEqual(640);
    expect(y + Number(label.getAttribute("height"))).toBeLessThanOrEqual(400);
    toggle();
    expect(disconnect).toHaveBeenCalledOnce();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("retains an accessible measurement when a display is too small for the SVG label", () => {
    render(<SitePlan siteGeometry={previewResponse().site_geometry} width={40} height={40} padding={1} />);
    toggle();
    expect(measurement()).toHaveTextContent("Site boundary · edge 1: 40 m");
    expect(plan().querySelector("[data-dimensions]")).toBeNull();
    expect(screen.getByText(/cannot be annotated at the current display size/)).toBeInTheDocument();
  });

  it("disables annotation selection for an unavailable site frame", () => {
    render(<SitePlan siteGeometry={{ type: "Polygon", coordinates: [] }} />);
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Measure edge" })).not.toBeInTheDocument();
    expect(plan().querySelector("[data-dimensions]")).toBeNull();
  });
});
