import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PolygonGeometry } from "../../../api/contracts";
import CustomSiteEditor from "./CustomSiteEditor";
import type { SitePosition } from "./siteDrawing";

const polygonWithHole: PolygonGeometry = {
  type: "Polygon",
  coordinates: [
    [[-0.1234567890123, 0], [40, 0], [40, 30.1234567890123], [-0.1234567890123, 30.1234567890123], [-0.1234567890123, 0]],
    [[5, 5], [10.1234567890123, 5], [10.1234567890123, 10], [5, 10], [5, 5]],
  ],
};
const square: PolygonGeometry = { type: "Polygon", coordinates: [[[5, 5], [45, 5], [45, 45], [5, 45], [5, 5]]] };

function renderEditor(initialValue = "", error?: string) {
  const onChange = vi.fn<(json: string) => void>();
  const onSubmit = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <CustomSiteEditor value={value} error={error}
        onChange={(json) => { onChange(json); setValue(json); }}
        jsonField={{ name: "site.json", onChange: vi.fn(), onBlur: vi.fn(), ref: vi.fn() }} />
      <output aria-label="Controlled site JSON">{value}</output>
    </form>;
  }
  return { ...render(<Harness />), onChange, onSubmit };
}

function drawingArea() {
  return screen.getByRole("img", { name: "Site polygon drawing area" });
}

function currentJson(): string {
  return screen.getByLabelText("Controlled site JSON").textContent ?? "";
}

function currentGeometry(): PolygonGeometry {
  return JSON.parse(currentJson()) as PolygonGeometry;
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function enterCoordinates([x, y]: SitePosition) {
  fireEvent.change(screen.getByRole("textbox", { name: "X (m)" }), { target: { value: String(x) } });
  fireEvent.change(screen.getByRole("textbox", { name: "Y (m)" }), { target: { value: String(y) } });
}

function enterPoint(point: SitePosition, enter = false) {
  enterCoordinates(point);
  if (enter) fireEvent.keyDown(screen.getByRole("textbox", { name: "Y (m)" }), { key: "Enter" });
  else click("Add point");
}

function selectPoint(index: number) {
  fireEvent.change(screen.getByRole("combobox", { name: "Selected point" }), { target: { value: String(index) } });
}

function mockDrawingRect(width = 400, height = width) {
  vi.spyOn(drawingArea(), "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, width, height));
}

function pointerTap(x: number, y: number, pointerType = "mouse") {
  fireEvent.pointerDown(drawingArea(), { clientX: x, clientY: y, button: 0, pointerType, isPrimary: true, pointerId: 1 });
  fireEvent.pointerUp(drawingArea(), { clientX: x, clientY: y, button: 0, pointerType, isPrimary: true, pointerId: 1 });
}

function clientPoint([x, y]: SitePosition, width = 400, span = 60): SitePosition {
  return [10 + width * (40 + x * 320 / span) / 400, 20 + width * (360 - y * 320 / span) / 400];
}

function startTriangle() {
  click("Start drawing");
  for (const point of [[5, 5], [45, 5], [45, 25]] satisfies SitePosition[]) enterPoint(point);
}

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerType: string;
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

describe("CustomSiteEditor", () => {
  it("finishes exact concave coordinates explicitly without submitting the containing form", () => {
    const { onSubmit } = renderEditor();
    expect(screen.getByRole("button", { name: "Draw polygon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Grid: 10 m per cell/)).toBeInTheDocument();
    click("Start drawing");
    expect(drawingArea()).toHaveAccessibleDescription(/Click or tap to add points/);
    const points: SitePosition[] = [[0.1234567890123, -5.1234567890123], [40, -5], [40, 15], [20, 15], [20, 30], [0, 30]];
    for (const point of points) enterPoint(point, true);
    expect(currentJson()).toBe("");
    expect(screen.getByText(/Drawing unfinished: 6 points/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    click("Finish Polygon");
    expect(currentGeometry()).toEqual({ type: "Polygon", coordinates: [[...points, points[0]]] });
    expect(screen.getByText(/Polygon finished\. Generate Preview/)).toBeInTheDocument();
    expect(screen.getByText("Polygon ready · 6 points")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "X (m)" })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires explicit replacement and can undo it with holes and exact JSON restored", () => {
    const json = JSON.stringify(polygonWithHole, null, 2);
    const { onChange } = renderEditor(json);
    expect(currentJson()).toBe(json);
    expect(screen.getByText(/1 interior holes are preserved/)).toBeInTheDocument();
    expect(drawingArea().querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    mockDrawingRect();
    pointerTap(200, 200);
    expect(onChange).not.toHaveBeenCalled();
    click("Replace polygon and draw");
    expect(currentJson()).toBe("");
    expect(drawingArea().querySelector("path")).toBeNull();
    expect(screen.getByText(/Drawing unfinished: 0 points/)).toBeInTheDocument();
    click("Undo");
    expect(currentJson()).toBe(json);
    expect(screen.getByText(/1 interior holes are preserved/)).toBeInTheDocument();
  });

  it("undoes placement, finish, and clearing while unfinished output stays invalid", () => {
    renderEditor();
    click("Start drawing");
    for (const point of [[0, 0], [40, 0], [40, 30]] satisfies SitePosition[]) enterPoint(point);
    click("Undo");
    expect(screen.getByText(/Drawing unfinished: 2 points/)).toBeInTheDocument();
    expect(drawingArea().querySelectorAll("[data-vertex]")).toHaveLength(2);
    click("Finish Polygon");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least three distinct points/);
    expect(currentJson()).toBe("");
    enterPoint([0, 30]);
    click("Finish Polygon");
    expect(currentGeometry().coordinates[0]).toEqual([[0, 0], [40, 0], [0, 30], [0, 0]]);
    click("Undo");
    expect(currentJson()).toBe("");
    expect(screen.getByText(/Drawing unfinished: 3 points/)).toBeInTheDocument();
    click("Clear and restart");
    expect(screen.getByText(/Drawing unfinished: 0 points/)).toBeInTheDocument();
    click("Undo");
    expect(screen.getByText(/Drawing unfinished: 3 points/)).toBeInTheDocument();
    expect(currentJson()).toBe("");
  });

  it("rejects invalid and duplicate point entry without adding terminal duplicates", () => {
    renderEditor();
    click("Start drawing");
    fireEvent.change(screen.getByRole("textbox", { name: "X (m)" }), { target: { value: "Infinity" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Y (m)" }), { target: { value: "0" } });
    click("Add point");
    expect(screen.getByRole("alert")).toHaveTextContent(/finite decimal X and Y/);
    enterPoint([0, 0]);
    enterPoint([0, 0]);
    expect(screen.getByRole("alert")).toHaveTextContent(/point already exists/);
    enterPoint([40, 0]);
    enterPoint([0, 0]);
    expect(screen.getByRole("alert")).toHaveTextContent(/Use Finish Polygon/);
    enterPoint([0, 30]);
    click("Finish Polygon");
    expect(currentGeometry().coordinates[0]).toEqual([[0, 0], [40, 0], [0, 30], [0, 0]]);
  });

  it.each(["mouse", "touch"])("closes by clicking near the first vertex with %s without requiring an exact hit", (pointerType) => {
    const { onSubmit } = renderEditor();
    startTriangle();
    mockDrawingRect();
    const [x, y] = clientPoint([5, 5]);
    pointerTap(x + 12, y, pointerType);
    expect(currentGeometry().coordinates[0]).toEqual([[5, 5], [45, 5], [45, 25], [5, 5]]);
    expect(drawingArea().querySelectorAll("[data-vertex]")).toHaveLength(3);
    expect(screen.queryByTestId("next-segment")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("selects the first point without finishing an insufficient outline", () => {
    renderEditor();
    click("Start drawing");
    enterPoint([5, 5]);
    enterPoint([45, 5]);
    mockDrawingRect();
    pointerTap(...clientPoint([5, 5]));
    expect(currentJson()).toBe("");
    expect(screen.getByRole("combobox", { name: "Selected point" })).toHaveValue("0");
    expect(screen.getByText(/Drawing unfinished: 2 points/)).toBeInTheDocument();
    click("Finish Polygon");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least three distinct points/);
  });

  it("finishes with Enter on the surface while Enter in point inputs only adds or updates a point", () => {
    const { onSubmit } = renderEditor();
    click("Start drawing");
    for (const point of [[5, 5], [45, 5], [45, 25]] satisfies SitePosition[]) enterPoint(point, true);
    expect(currentJson()).toBe("");
    drawingArea().focus();
    expect(drawingArea()).toHaveFocus();
    fireEvent.keyDown(drawingArea(), { key: "Enter" });
    expect(currentGeometry().coordinates[0]).toHaveLength(4);
    selectPoint(1);
    enterCoordinates([44.1234567890123, 5]);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "X (m)" }), { key: "Enter" });
    expect(currentGeometry().coordinates[0][1]).toEqual([44.1234567890123, 5]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["leave", "cancel", "blur", "wheel", "scroll"])("removes the temporary segment after %s", (action) => {
    renderEditor();
    startTriangle();
    mockDrawingRect();
    fireEvent.pointerMove(drawingArea(), { clientX: 200, clientY: 200 });
    expect(screen.getByTestId("next-segment")).toBeInTheDocument();
    if (action === "leave") fireEvent.pointerLeave(drawingArea());
    else if (action === "cancel") fireEvent.pointerCancel(drawingArea());
    else if (action === "blur") fireEvent.blur(drawingArea());
    else if (action === "wheel") fireEvent.wheel(drawingArea(), { deltaY: 100 });
    else fireEvent.scroll(window);
    expect(screen.queryByTestId("next-segment")).not.toBeInTheDocument();
    expect(currentJson()).toBe("");
    expect(screen.getByText(/Drawing unfinished: 3 points/)).toBeInTheDocument();
  });

  it("clears the guide when moving toward Finish Polygon or switching modes", () => {
    renderEditor();
    startTriangle();
    mockDrawingRect();
    fireEvent.pointerMove(drawingArea(), { clientX: 200, clientY: 200 });
    expect(screen.getByTestId("next-segment")).toBeInTheDocument();
    fireEvent.pointerMove(drawingArea(), { clientX: 200, clientY: 440 });
    expect(screen.queryByTestId("next-segment")).not.toBeInTheDocument();
    fireEvent.pointerMove(drawingArea(), { clientX: 200, clientY: 200 });
    click("Advanced JSON");
    click("Draw polygon");
    expect(screen.queryByTestId("next-segment")).not.toBeInTheDocument();
    click("Finish Polygon");
    expect(screen.queryByTestId("next-segment")).not.toBeInTheDocument();
  });

  it("does not add points during scrolling, canceled gestures, margin taps, or secondary input", () => {
    renderEditor();
    click("Start drawing");
    mockDrawingRect();
    fireEvent.pointerDown(drawingArea(), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(drawingArea(), { clientX: 100, clientY: 180, button: 0 });
    fireEvent.pointerDown(drawingArea(), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerCancel(drawingArea());
    fireEvent.pointerUp(drawingArea(), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerDown(drawingArea(), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerLeave(drawingArea());
    fireEvent.pointerUp(drawingArea(), { clientX: 100, clientY: 100, button: 0 });
    pointerTap(20, 30);
    fireEvent.pointerDown(drawingArea(), { clientX: 200, clientY: 200, button: 2 });
    fireEvent.pointerUp(drawingArea(), { clientX: 200, clientY: 200, button: 2 });
    expect(screen.getByText(/Drawing unfinished: 0 points/)).toBeInTheDocument();
    expect(drawingArea().querySelectorAll("[data-vertex]")).toHaveLength(0);
  });

  it.each([390, 320])("places touch points in metres at %s px and shows no mouse-only temporary segment", (width) => {
    renderEditor();
    click("Start drawing");
    mockDrawingRect(width);
    for (const point of [[5, 5], [35, 5], [35, 35]] satisfies SitePosition[]) pointerTap(...clientPoint(point, width), "touch");
    fireEvent.pointerMove(drawingArea(), { clientX: 200, clientY: 200, pointerType: "touch" });
    expect(screen.queryByTestId("next-segment")).not.toBeInTheDocument();
    click("Finish Polygon");
    const ring = currentGeometry().coordinates[0];
    for (const [index, point] of ([[5, 5], [35, 5], [35, 35]] satisfies SitePosition[]).entries()) {
      expect(ring[index][0]).toBeCloseTo(point[0], 10);
      expect(ring[index][1]).toBeCloseTo(point[1], 10);
    }
    expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it("edits a selected finished point exactly, preserves holes and closure, and restores original JSON with Undo", () => {
    const json = JSON.stringify(polygonWithHole, null, 3);
    renderEditor(json);
    selectPoint(0);
    expect(screen.getByRole("textbox", { name: "X (m)" })).toHaveValue("-0.1234567890123");
    enterCoordinates([-0.2345678901234, 0.3456789012345]);
    click("Update point");
    const updated = currentGeometry();
    expect(updated.coordinates[0][0]).toEqual([-0.2345678901234, 0.3456789012345]);
    expect(updated.coordinates[0][updated.coordinates[0].length - 1]).toEqual(updated.coordinates[0][0]);
    expect(updated.coordinates[1]).toEqual(polygonWithHole.coordinates[1]);
    expect(polygonWithHole.coordinates[0][0]).toEqual([-0.1234567890123, 0]);
    click("Undo");
    expect(currentJson()).toBe(json);
  });

  it("deletes selected points while preserving the finished minimum and can undo deletion", () => {
    renderEditor(JSON.stringify(square));
    selectPoint(1);
    click("Delete point");
    expect(currentGeometry().coordinates[0]).toEqual([[5, 5], [45, 45], [5, 45], [5, 5]]);
    selectPoint(1);
    expect(screen.getByRole("button", { name: "Delete point" })).toBeDisabled();
    click("Undo");
    expect(currentGeometry()).toEqual(square);
    expect(screen.getByRole("button", { name: "Delete point" })).toBeEnabled();
  });

  it("allows exact correction and deletion of unfinished points before continuing the outline", () => {
    renderEditor();
    startTriangle();
    selectPoint(1);
    enterCoordinates([40.1234567890123, 5]);
    click("Update point");
    expect(currentJson()).toBe("");
    click("Delete point");
    expect(screen.getByText(/Drawing unfinished: 2 points/)).toBeInTheDocument();
    click("Undo");
    expect(screen.getByRole("textbox", { name: "X (m)" })).toHaveValue("40.1234567890123");
    click("Continue drawing");
    enterPoint([5, 25]);
    click("Finish Polygon");
    expect(currentGeometry().coordinates[0]).toEqual([[5, 5], [40.1234567890123, 5], [45, 25], [5, 25], [5, 5]]);
  });

  it("rejects duplicate finished edits but leaves self-intersections for backend validation", () => {
    renderEditor(JSON.stringify(square));
    selectPoint(1);
    enterCoordinates([5, 5]);
    click("Update point");
    expect(screen.getByRole("alert")).toHaveTextContent(/different position/);
    expect(currentGeometry()).toEqual(square);
    enterCoordinates([30, 50]);
    click("Update point");
    expect(currentGeometry().coordinates[0][1]).toEqual([30, 50]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["mouse", "touch"])("updates the authoritative geometry during a %s drag and undoes the whole drag once", (pointerType) => {
    renderEditor(JSON.stringify(square));
    mockDrawingRect();
    const start = clientPoint([45, 5]);
    const middle = clientPoint([40, 10]);
    const end = clientPoint([35, 15]);
    fireEvent.pointerDown(drawingArea(), { clientX: start[0], clientY: start[1], button: 0, pointerType });
    fireEvent.pointerMove(drawingArea(), { clientX: middle[0], clientY: middle[1], pointerType });
    expect(currentGeometry().coordinates[0][1][0]).toBeCloseTo(40, 10);
    expect(currentGeometry().coordinates[0][1][1]).toBeCloseTo(10, 10);
    fireEvent.pointerMove(drawingArea(), { clientX: end[0], clientY: end[1], pointerType });
    fireEvent.pointerUp(drawingArea(), { clientX: end[0], clientY: end[1], button: 0, pointerType });
    expect(currentGeometry().coordinates[0][1][0]).toBeCloseTo(35, 10);
    expect(currentGeometry().coordinates[0][1][1]).toBeCloseTo(15, 10);
    click("Undo");
    expect(currentGeometry()).toEqual(square);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("cancels an active vertex drag without adding an undo operation or retaining partial coordinates", () => {
    const json = JSON.stringify(square, null, 2);
    renderEditor(json);
    mockDrawingRect();
    const start = clientPoint([45, 5]);
    const end = clientPoint([35, 15]);
    fireEvent.pointerDown(drawingArea(), { clientX: start[0], clientY: start[1], button: 0 });
    fireEvent.pointerMove(drawingArea(), { clientX: end[0], clientY: end[1] });
    expect(currentGeometry().coordinates[0][1][0]).toBeCloseTo(35, 10);
    expect(currentGeometry().coordinates[0][1][1]).toBeCloseTo(15, 10);
    fireEvent.pointerCancel(drawingArea());
    expect(currentJson()).toBe(json);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("routes touch handle gestures through the canvas container and captures vertices without capturing empty-canvas scrolling", () => {
    const json = JSON.stringify(square, null, 2);
    renderEditor(json);
    mockDrawingRect(390);
    const container = drawingArea().parentElement!;
    const captured = new Set<number>();
    const capture = vi.fn((pointerId: number) => { captured.add(pointerId); });
    const release = vi.fn((pointerId: number) => { captured.delete(pointerId); });
    Object.defineProperties(container, {
      setPointerCapture: { value: capture },
      hasPointerCapture: { value: (pointerId: number) => captured.has(pointerId) },
      releasePointerCapture: { value: release },
    });
    const blank = clientPoint([25, 25], 390);
    fireEvent.pointerDown(drawingArea(), { clientX: blank[0], clientY: blank[1], button: 0, pointerType: "touch", pointerId: 6 });
    expect(capture).not.toHaveBeenCalled();
    fireEvent.pointerCancel(container, { pointerType: "touch", pointerId: 6 });
    const handle = container.querySelector<HTMLElement>("[data-handle='1']")!;
    const start = clientPoint([45, 5], 390);
    const end = clientPoint([35, 15], 390);
    fireEvent.pointerDown(handle, { clientX: start[0], clientY: start[1], button: 0, pointerType: "touch", pointerId: 7 });
    expect(capture).toHaveBeenCalledExactlyOnceWith(7);
    fireEvent.pointerMove(container, { clientX: end[0], clientY: end[1], pointerType: "touch", pointerId: 7 });
    expect(currentGeometry().coordinates[0][1][0]).toBeCloseTo(35, 10);
    expect(currentGeometry().coordinates[0][1][1]).toBeCloseTo(15, 10);
    fireEvent.pointerCancel(container, { pointerType: "touch", pointerId: 7 });
    expect(release).toHaveBeenCalledExactlyOnceWith(7);
    expect(currentJson()).toBe(json);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it.each([[20, 0], [20, 20]])("finishes from the starting-point handle offset [%s, %s] instead of adding a nearby terminal point", (offsetX, offsetY) => {
    renderEditor();
    startTriangle();
    mockDrawingRect();
    const container = drawingArea().parentElement!;
    const handle = container.querySelector<HTMLElement>("[data-handle='0']")!;
    const [x, y] = clientPoint([5, 5]);
    fireEvent.pointerDown(handle, { clientX: x + offsetX, clientY: y + offsetY, button: 0, pointerId: 2 });
    fireEvent.pointerUp(container, { clientX: x + offsetX, clientY: y + offsetY, button: 0, pointerId: 2 });
    expect(currentGeometry().coordinates[0]).toEqual([[5, 5], [45, 5], [45, 25], [5, 5]]);
  });

  it("preserves precision and holes through modes and clears visual history only when JSON changes", () => {
    const json = JSON.stringify(polygonWithHole, null, 3);
    const { onChange } = renderEditor(json);
    click("Advanced JSON");
    expect(screen.getByRole("textbox", { name: "Site Polygon JSON" })).toHaveValue(json);
    click("Draw polygon");
    expect(currentJson()).toBe(json);
    expect(onChange).not.toHaveBeenCalled();
    selectPoint(1);
    enterCoordinates([39, 0]);
    click("Update point");
    click("Advanced JSON");
    fireEvent.change(screen.getByRole("textbox", { name: "Site Polygon JSON" }), { target: { value: json } });
    click("Draw polygon");
    expect(currentJson()).toBe(json);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("retains unfinished points across modes and reports their replacement by JSON editing", () => {
    renderEditor();
    startTriangle();
    click("Advanced JSON");
    expect(screen.getByText(/unfinished drawing is kept in Draw polygon/)).toBeInTheDocument();
    click("Draw polygon");
    expect(screen.getByText(/Drawing unfinished: 3 points/)).toBeInTheDocument();
    click("Advanced JSON");
    fireEvent.change(screen.getByRole("textbox", { name: "Site Polygon JSON" }), { target: { value: JSON.stringify(polygonWithHole) } });
    click("Draw polygon");
    expect(screen.queryByText(/Drawing unfinished/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 interior holes are preserved/)).toBeInTheDocument();
    expect(currentGeometry()).toEqual(polygonWithHole);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it.each([
    { name: "120 by 80 metre rectangle", points: [[0, 0], [120, 0], [120, 80], [0, 80]], scale: "200" },
    { name: "250 by 150 metre irregular site", points: [[0, 0], [250, 0], [230, 90], [120, 150], [0, 120]], scale: "500" },
    { name: "small site", points: [[0.123, 0.123], [0.523, 0.123], [0.523, 0.423]], scale: "50" },
  ] satisfies { name: string; points: SitePosition[]; scale: string }[])("fits a $name before completion and preserves coordinates through scale changes", ({ points, scale }) => {
    const { onSubmit } = renderEditor();
    click("Start drawing");
    for (const point of points) enterPoint(point);
    click("Fit Drawing");
    expect(screen.queryByText(/Some points are outside this view/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "View scale" }), { target: { value: scale } });
    click("Finish Polygon");
    const expected = { type: "Polygon", coordinates: [[...points, points[0]]] };
    expect(currentGeometry()).toEqual(expected);
    const json = currentJson();
    click("Fit Drawing");
    fireEvent.change(screen.getByRole("combobox", { name: "View scale" }), { target: { value: "100" } });
    expect(currentJson()).toBe(json);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows custom range controls and changes the view without rewriting closed JSON", () => {
    const json = JSON.stringify(polygonWithHole);
    const { onChange, onSubmit } = renderEditor(json);
    const originalOutline = drawingArea().querySelector("path")?.getAttribute("d");
    fireEvent.click(screen.getByText("Custom view range"));
    fireEvent.change(screen.getByRole("textbox", { name: "View minimum X (m)" }), { target: { value: "-100" } });
    fireEvent.change(screen.getByRole("textbox", { name: "View minimum Y (m)" }), { target: { value: "-50" } });
    fireEvent.change(screen.getByRole("textbox", { name: "View span (m)" }), { target: { value: "300" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "View span (m)" }), { key: "Enter" });
    expect(screen.getByText(/Visible: 300 × 300 m/)).toBeInTheDocument();
    expect(drawingArea().querySelector("path")?.getAttribute("d")).not.toBe(originalOutline);
    click("Fit Drawing");
    expect(currentJson()).toBe(json);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses an explicit grid origin and distinct labels for a small site at a large coordinate offset", () => {
    const geometry: PolygonGeometry = {
      type: "Polygon", coordinates: [[[1_000_000, 2_000_000], [1_000_000.4, 2_000_000], [1_000_000.4, 2_000_000.3], [1_000_000, 2_000_000]]],
    };
    const json = JSON.stringify(geometry, null, 2);
    const { onChange } = renderEditor(json);
    click("Fit Drawing");
    expect(screen.getByText(/Grid origin: X .* m · Y .* m\. Labels show distances from this origin\./)).toBeInTheDocument();
    const labels = [...drawingArea().querySelectorAll("text")].map((element) => element.textContent);
    expect(new Set(labels).size).toBeGreaterThan(2);
    expect(currentJson()).toBe(json);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects an unusable range until corrected without mutating the scale", () => {
    renderEditor();
    fireEvent.click(screen.getByText("Custom view range"));
    const span = screen.getByRole("textbox", { name: "View span (m)" });
    fireEvent.change(span, { target: { value: "0" } });
    click("Apply range");
    expect(screen.getByRole("alert")).toHaveTextContent(/positive span/);
    expect(screen.getByText(/Visible: 60 × 60 m/)).toBeInTheDocument();
    fireEvent.change(span, { target: { value: "12" } });
    click("Apply range");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/Visible: 12 × 12 m/)).toBeInTheDocument();
  });

  it("shows validation feedback and focuses the visual editor for correction", () => {
    const { container } = renderEditor("", "Enter valid Polygon JSON.");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter valid Polygon JSON.");
    expect(container.querySelector("[tabindex='-1']")).toHaveFocus();
    click("Start drawing");
    expect(screen.getByRole("alert")).toHaveTextContent("Finish the polygon before generating a preview.");
    click("Advanced JSON");
    const textarea = screen.getByRole("textbox", { name: "Site Polygon JSON" });
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAccessibleDescription(/Finish the polygon before generating a preview/);
  });
});
