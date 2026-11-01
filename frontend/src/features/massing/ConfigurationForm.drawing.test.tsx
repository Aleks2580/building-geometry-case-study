import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfigurationForm from "./ConfigurationForm";
import type { Configuration, ConfigurationDraft } from "./configuration";
import { configurationDraftFromOption } from "./configuration";
import { optionResponse } from "../../test/optionFixtures";

function custom() {
  fireEvent.change(screen.getByRole("combobox", { name: "Site shape" }), { target: { value: "custom" } });
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function addPoint(x: string, y: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "X (m)" }), { target: { value: x } });
  fireEvent.change(screen.getByRole("textbox", { name: "Y (m)" }), { target: { value: y } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Y (m)" }), { key: "Enter" });
}

describe("ConfigurationForm polygon drawing", () => {
  it("submits a closed concave ring from exact keyboard coordinates through the existing draft", async () => {
    const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
    render(<ConfigurationForm onSubmit={onSubmit} />);
    custom();
    expect(screen.getByRole("button", { name: "Draw polygon" })).toHaveAttribute("aria-pressed", "true");
    click("Replace polygon and draw");
    const points: [string, string][] = [["0", "0"], ["40.12500000001", "0"], ["40.12500000001", "15"], ["20", "15"], ["20", "30"], ["0", "30"]];
    points.forEach(([x, y]) => addPoint(x, y));
    expect(onSubmit).not.toHaveBeenCalled();
    click("Finish Polygon");
    click("Generate Preview");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const site = { type: "Polygon", coordinates: [[...points.map(([x, y]) => [Number(x), Number(y)]), [0, 0]]] };
    expect(onSubmit.mock.calls[0][0].site).toEqual(site);
    expect(onSubmit.mock.calls[0][1].site).toEqual({ kind: "custom", json: JSON.stringify(site) });
  });

  it("invalidates the previous Polygon immediately and blocks every unfinished replacement", async () => {
    const onSubmit = vi.fn();
    const onDirtyChange = vi.fn();
    render(<ConfigurationForm onSubmit={onSubmit} onDirtyChange={onDirtyChange} />);
    custom();
    click("Generate Preview");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const savedDraft = structuredClone(onSubmit.mock.calls[0][1]);
    click("Replace polygon and draw");
    expect(screen.queryByRole("img", { name: "Draft site preview" })).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    for (const point of [["0", "0"], ["20", "0"], ["20", "20"]]) {
      addPoint(point[0], point[1]);
      fireEvent.submit(screen.getByRole("form", { name: "Massing configuration" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Finish the polygon before generating a preview.");
      expect(onSubmit).toHaveBeenCalledOnce();
    }
    click("Finish Polygon");
    click("Generate Preview");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0][1]).toEqual(savedDraft);
    expect(onSubmit.mock.calls[1][0].site.coordinates[0]).toEqual([[0, 0], [20, 0], [20, 20], [0, 0]]);
  });

  it("preserves exact JSON and interior holes across modes and only removes them on explicit replacement", async () => {
    const onSubmit = vi.fn();
    render(<ConfigurationForm onSubmit={onSubmit} />);
    custom();
    click("Advanced JSON");
    const json = '{ "type": "Polygon", "coordinates": [[[0,0],[40.000000000001,0],[40,25],[0,25],[0,0]],[[5,5],[10,5],[10,10],[5,10],[5,5]]] }';
    fireEvent.change(screen.getByRole("textbox", { name: "Site Polygon JSON" }), { target: { value: json } });
    click("Draw polygon");
    expect(screen.getByText(/1 interior holes are preserved/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Site polygon drawing area" }).querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    click("Advanced JSON");
    expect(screen.getByRole("textbox", { name: "Site Polygon JSON" })).toHaveValue(json);
    click("Generate Preview");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].site).toEqual(JSON.parse(json));
    expect(onSubmit.mock.calls[0][1].site.json).toBe(json);
    click("Draw polygon");
    click("Replace polygon and draw");
    click("Advanced JSON");
    expect(screen.getByRole("textbox", { name: "Site Polygon JSON" })).toHaveValue("");
  });

  it("keeps all drawing and JSON editing controls absent from inherited branch sites", () => {
    const option = optionResponse();
    render(<ConfigurationForm initialDraft={configurationDraftFromOption(option)} inheritedSite={option.site_geometry} onSubmit={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Inherited site preview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draw polygon" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Advanced JSON" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site polygon drawing area" })).not.toBeInTheDocument();
  });

  it("preserves a structurally complete self-intersection for backend validation without repairing its points", async () => {
    const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
    render(<ConfigurationForm onSubmit={onSubmit} />);
    custom();
    click("Replace polygon and draw");
    const points: [string, string][] = [["0", "0"], ["20", "20"], ["0", "20"], ["20", "0"]];
    points.forEach(([x, y]) => addPoint(x, y));
    click("Finish Polygon");
    click("Generate Preview");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].site.coordinates[0]).toEqual([[0, 0], [20, 20], [0, 20], [20, 0], [0, 0]]);
  });
});
