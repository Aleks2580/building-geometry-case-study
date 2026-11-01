import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import ConfigurationForm from "./ConfigurationForm";
import WorkspaceActionBar from "../WorkspaceActionBar";
import { configurationDraftFromOption, initialConfigurationDraft } from "./configuration";
import type { Configuration, ConfigurationDraft } from "./configuration";
import { optionResponse } from "../../../test/optionFixtures";

function ConfigurationFormWithActions({ isGenerating = false, ...props }: ComponentProps<typeof ConfigurationForm> & { isGenerating?: boolean }) {
  return <>
    <ConfigurationForm {...props} id="configuration-test" />
    <WorkspaceActionBar mode="edit" formId="configuration-test" isGenerating={isGenerating} onNewDesign={vi.fn()} />
  </>;
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
}

function revealOptional(name: string) {
  const title = name.startsWith("Preferred") ? "Design preferences" : name.startsWith("GFA target") ? "GFA target" : null;
  if (!title) return;
  const summary = screen.getByText(title, { selector: "summary strong" });
  if (!summary.closest("details")?.open) fireEvent.click(summary);
}

function change(name: string, value: string) {
  revealOptional(name);
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
}

const shapeLabels = { rectangle: "Rectangle / Square", "l-shaped": "L-shaped", notched: "Notched example", custom: "Custom polygon" };

function selectShape(kind: "rectangle" | "l-shaped" | "notched" | "custom") {
  fireEvent.click(screen.getByRole("button", { name: shapeLabels[kind] }));
  if (kind === "custom") fireEvent.click(screen.getByRole("button", { name: "Advanced JSON" }));
}

function draftOutline(name = "Draft site preview") {
  return screen.getByRole("img", { name }).querySelector("path")?.getAttribute("d") ?? "";
}

function renderForm(submittedDraft?: ConfigurationDraft) {
  const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
  const onDraftChange = vi.fn<(changed: boolean) => void>();
  const view = render(
    <ConfigurationFormWithActions onSubmit={onSubmit} submittedDraft={submittedDraft} onDraftChange={onDraftChange} />,
  );
  return { onSubmit, onDraftChange, ...view };
}

describe("ConfigurationForm", () => {
  it("initializes branch fields from the saved snapshot and exposes its inherited site without editing controls", async () => {
    const saved = optionResponse();
    saved.hard_constraints = {
      setback_m: 0, floor_to_floor_m: 3.25, max_height_m: 18,
      max_floors: null, site_coverage_ratio: 0.5, max_footprint_m2: 400,
    };
    saved.preferences = { preferred_floor_count: 3, preferred_footprint_area_m2: 350 };
    saved.targets = { gfa_target_m2: 0 };
    const original = structuredClone(saved);
    const initialDraft = configurationDraftFromOption(saved);
    const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
    const onDraftChange = vi.fn();
    render(<ConfigurationFormWithActions
      initialDraft={initialDraft}
      inheritedSite={saved.site_geometry}
      submittedDraft={structuredClone(initialDraft)}
      onSubmit={onSubmit}
      onDraftChange={onDraftChange}
    />);

    expect(screen.getByRole("heading", { name: "Shape your branch" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Inherited site (read-only)" })).toBeInTheDocument();
    expect(screen.getByText(/site is inherited and cannot be changed/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Inherited site preview" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Site shape" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Site Polygon JSON" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Width (m)" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "Floor-to-floor height (m)" })).toHaveValue("3.25");
    expect(screen.getByRole("textbox", { name: "Maximum height (m) (optional)" })).toHaveValue("18");
    expect(screen.getByRole("textbox", { name: "Maximum floor count (optional)" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Site coverage ratio (optional)" })).toHaveValue("0.5");
    expect(screen.getByRole("textbox", { name: "Maximum footprint (m²) (optional)" })).toHaveValue("400");
    expect(screen.getByRole("textbox", { name: "Preferred floor count (optional)" })).toHaveValue("3");
    expect(screen.getByRole("textbox", { name: "Preferred footprint (m²) (optional)" })).toHaveValue("350");
    expect(screen.getByRole("textbox", { name: "GFA target (m²) (optional)" })).toHaveValue("0");
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
    const siteOutline = draftOutline("Inherited site preview");
    change("Maximum height (m) (optional)", "14");
    change("Preferred floor count (optional)", "2");
    change("GFA target (m²) (optional)", "600");
    expect(onDraftChange).toHaveBeenLastCalledWith(true);

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toEqual({
      site: saved.site_geometry,
      hard_constraints: { ...saved.hard_constraints, max_height_m: 14 },
      preferences: { ...saved.preferences, preferred_floor_count: 2 },
      targets: { gfa_target_m2: 600 },
    });
    expect(draftOutline("Inherited site preview")).toBe(siteOutline);
    expect(saved).toEqual(original);
    expect(initialDraft.hard_constraints.max_height_m).toBe("18");
  });

  it("uses the inherited site for validation and submission even when the supplied draft site is unrelated or invalid", async () => {
    const saved = optionResponse();
    const initialDraft = configurationDraftFromOption(saved);
    initialDraft.site = { kind: "custom", json: "invalid draft geometry" };
    const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
    render(<ConfigurationFormWithActions initialDraft={initialDraft} inheritedSite={saved.site_geometry} onSubmit={onSubmit} />);

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].site).toEqual(saved.site_geometry);
    expect(onSubmit.mock.calls[0][1].site).toEqual({ kind: "custom", json: JSON.stringify(saved.site_geometry) });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(initialDraft.site).toEqual({ kind: "custom", json: "invalid draft geometry" });
  });

  it("focuses the first branch input on entry and focuses an accessible invalid field on form submission", async () => {
    const saved = optionResponse();
    const onSubmit = vi.fn();
    render(<ConfigurationFormWithActions
      initialDraft={configurationDraftFromOption(saved)}
      inheritedSite={saved.site_geometry}
      focusOnMount
      onSubmit={onSubmit}
    />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveFocus());
    revealOptional("Preferred floor count (optional)");
    const invalid = screen.getByRole("textbox", { name: "Preferred floor count (optional)" });
    change("Preferred floor count (optional)", "invalid");
    const preferences = screen.getByText("Design preferences", { selector: "summary strong" });
    fireEvent.click(preferences);
    expect(preferences.closest("details")).not.toHaveAttribute("open");

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a finite decimal number or leave blank.");
    await waitFor(() => expect(invalid).toHaveFocus());
    expect(preferences.closest("details")).toHaveAttribute("open");
    expect(invalid).toHaveAttribute("aria-invalid", "true");
    expect(invalid).toHaveAccessibleDescription(/Enter a finite decimal number or leave blank/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a valid initial example without submitting automatically", () => {
    const { onSubmit } = renderForm();

    expect(screen.getByRole("form", { name: "Massing configuration" })).toBeInTheDocument();
    const presets = within(screen.getByRole("group", { name: "Site shape" }));
    expect(presets.getByRole("button", { name: "Rectangle / Square" })).toHaveAttribute("aria-pressed", "true");
    expect(presets.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Rectangle / Square", "L-shaped", "Notched example", "Custom polygon",
    ]);
    expect(screen.getByRole("group", { name: "Site outline" })).toBeInTheDocument();
    expect(screen.getByText("Design preferences", { selector: "summary strong" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("GFA target", { selector: "summary strong" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toHaveValue("40");
    expect(screen.getByRole("textbox", { name: "Length (m)" })).toHaveValue("25");
    expect(screen.queryByRole("textbox", { name: "Site Polygon JSON" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveValue("3");
    expect(screen.getByRole("textbox", { name: "Floor-to-floor height (m)" })).toHaveValue("3.5");
    expect(screen.getByRole("textbox", { name: "Maximum floor count (optional)" })).toHaveValue("6");
    for (const name of [
      "Maximum height (m) (optional)",
      "Site coverage ratio (optional)",
      "Maximum footprint (m²) (optional)",
      "Preferred floor count (optional)",
      "Preferred footprint (m²) (optional)",
      "GFA target (m²) (optional)",
    ]) {
      revealOptional(name);
      expect(screen.getByRole("textbox", { name })).toHaveValue("");
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits parsed numbers and null optional inputs while preserving the raw draft", async () => {
    const { onSubmit } = renderForm();

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      site: {
        type: "Polygon",
        coordinates: [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]],
      },
      hard_constraints: {
        setback_m: 3,
        floor_to_floor_m: 3.5,
        max_height_m: null,
        max_floors: 6,
        site_coverage_ratio: null,
        max_footprint_m2: null,
      },
      preferences: { preferred_floor_count: null, preferred_footprint_area_m2: null },
      targets: { gfa_target_m2: null },
    }, initialConfigurationDraft);
  });

  it("shows the live draft rectangle and updates its proportions while editing without submitting", () => {
    const { onSubmit } = renderForm();
    expect(screen.getByText("Live draft site")).toBeInTheDocument();
    expect(screen.getByText(/Generate Preview to check feasibility\./)).toBeInTheDocument();
    const initialPath = draftOutline();
    const initialPositions = [...initialPath.matchAll(/[ML]([^ ]+) ([^ ]+)/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);
    expect(initialPositions).toHaveLength(5);
    expect(Math.abs((initialPositions[1][0] - initialPositions[0][0])
      / (initialPositions[2][1] - initialPositions[1][1]))).toBeCloseTo(40 / 25);

    change("Width (m)", "50");
    change("Length (m)", "12.5");

    const changedPath = draftOutline();
    const changedPositions = [...changedPath.matchAll(/[ML]([^ ]+) ([^ ]+)/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);
    expect(changedPath).not.toBe(initialPath);
    expect(Math.abs((changedPositions[1][0] - changedPositions[0][0])
      / (changedPositions[2][1] - changedPositions[1][1]))).toBeCloseTo(4);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("updates the live outline for examples and edited Custom holes without submitting", () => {
    const { onSubmit } = renderForm();
    const rectanglePath = draftOutline();

    selectShape("l-shaped");
    const lShapedPath = draftOutline();
    expect(lShapedPath).not.toBe(rectanglePath);
    expect(lShapedPath.match(/L/g)).toHaveLength(6);
    selectShape("notched");
    const notchedPath = draftOutline();
    expect(notchedPath).not.toBe(lShapedPath);
    expect(notchedPath.match(/L/g)).toHaveLength(8);
    selectShape("custom");
    expect(draftOutline()).toBe(notchedPath);
    change("Site Polygon JSON", JSON.stringify({
      type: "Polygon",
      coordinates: [
        [[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]],
        [[5, 5], [10, 5], [10, 10], [5, 10], [5, 5]],
      ],
    }));

    expect(draftOutline()).not.toBe(notchedPath);
    expect(draftOutline().match(/M/g)).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Draft site preview" }).querySelector("path"))
      .toHaveAttribute("fill-rule", "evenodd");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["Width (m)", ""], ["Length (m)", "0"], ["Width (m)", "Infinity"],
    ["Site Polygon JSON", "{"],
    ["Site Polygon JSON", JSON.stringify({ type: "Polygon", coordinates: [] })],
    ["Site Polygon JSON", JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [40, 0], [40, 25], [0, 25]]] })],
  ])("removes the live outline immediately for invalid %s=%j", (name, value) => {
    const { onSubmit } = renderForm();
    if (name === "Site Polygon JSON") selectShape("custom");
    expect(screen.getByRole("img", { name: "Draft site preview" })).toBeInTheDocument();

    change(name, value);

    expect(screen.queryByRole("img", { name: "Draft site preview" })).not.toBeInTheDocument();
    expect(screen.getByText("Draft site preview unavailable. Enter valid site dimensions or Polygon JSON."))
      .toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("retains a valid live outline when an unrelated constraint is invalid", async () => {
    const { onSubmit } = renderForm();
    const outline = draftOutline();
    change("Setback (m)", "invalid");

    fireEvent.blur(screen.getByRole("textbox", { name: "Setback (m)" }));

    await screen.findByRole("alert");
    expect(draftOutline()).toBe(outline);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits decimal rectangle dimensions as the current closed Polygon", async () => {
    const { onSubmit } = renderForm();
    change("Width (m)", "42.75");
    change("Length (m)", ".125");

    expect(onSubmit).not.toHaveBeenCalled();
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].site).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0], [42.75, 0], [42.75, 0.125], [0, 0.125], [0, 0]]],
    });
    expect(onSubmit.mock.calls[0][1].site).toEqual({ kind: "rectangle", width: "42.75", length: ".125" });
  });

  it.each(["Width (m)", "Length (m)"])("labels %s as a required decimal input", (name) => {
    renderForm();
    const input = screen.getByRole("textbox", { name });

    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAccessibleDescription(/Greater than zero/);
  });

  it.each([
    ["Width (m)", ""], ["Width (m)", "0"], ["Width (m)", "-2"],
    ["Width (m)", "word"], ["Width (m)", "Infinity"], ["Width (m)", "1e999"],
    ["Length (m)", "  "], ["Length (m)", "0"], ["Length (m)", "-2"],
    ["Length (m)", "word"], ["Length (m)", "NaN"], ["Length (m)", "1e999"],
  ])("blocks submission with an accessible error for %s=%j", async (name, value) => {
    const { onSubmit } = renderForm();
    const input = screen.getByRole("textbox", { name });
    change(name, value);
    fireEvent.blur(input);

    const error = await screen.findByRole("alert");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(new RegExp(error.textContent ?? ""));
    submit();

    await waitFor(() => expect(input).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("never resubmits a previous valid Polygon after a rectangle dimension becomes invalid", async () => {
    const { onSubmit } = renderForm();
    change("Width (m)", "42");
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    change("Width (m)", "");

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a number.");
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].site.coordinates[0][1]).toEqual([42, 0]);
    expect(onSubmit.mock.calls[0][1].site).toEqual({ kind: "rectangle", width: "42", length: "25" });
  });

  it.each([
    ["l-shaped", [[0, 0], [40, 0], [40, 15], [20, 15], [20, 30], [0, 30], [0, 0]]],
    ["notched", [[0, 0], [50, 0], [50, 20], [30, 20], [30, 6], [20, 6], [20, 20], [0, 20], [0, 0]]],
  ] as const)("submits the exact closed %s example only after an explicit action", async (kind, ring) => {
    const { onSubmit } = renderForm();
    selectShape(kind);

    expect(screen.getByRole("button", { name: shapeLabels[kind] })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("textbox", { name: "Width (m)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Site Polygon JSON" })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].site).toEqual({ type: "Polygon", coordinates: [ring] });
    expect(onSubmit.mock.calls[0][1].site).toEqual({ kind });
  });

  it("seeds Custom from the active rectangle and deliberately replaces it when selecting another shape", async () => {
    const { onSubmit } = renderForm();
    change("Width (m)", "12.5");
    change("Length (m)", "8.25");
    selectShape("custom");
    const rectangle = {
      type: "Polygon",
      coordinates: [[[0, 0], [12.5, 0], [12.5, 8.25], [0, 8.25], [0, 0]]],
    };
    expect(JSON.parse(String((screen.getByRole("textbox", { name: "Site Polygon JSON" }) as HTMLTextAreaElement).value)))
      .toEqual(rectangle);
    change("Site Polygon JSON", "{");
    submit();
    await screen.findByRole("alert");

    selectShape("notched");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    selectShape("custom");
    const custom = screen.getByRole("textbox", { name: "Site Polygon JSON" }) as HTMLTextAreaElement;
    expect(JSON.parse(custom.value)).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0], [50, 0], [50, 20], [30, 20], [30, 6], [20, 6], [20, 20], [0, 20], [0, 0]]],
    });
    selectShape("rectangle");

    expect(screen.getByRole("textbox", { name: "Width (m)" })).toHaveValue("40");
    expect(screen.getByRole("textbox", { name: "Length (m)" })).toHaveValue("25");
    expect(onSubmit).not.toHaveBeenCalled();
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][1].site).toEqual(initialConfigurationDraft.site);
  });

  it("starts Custom empty after invalid rectangle dimensions instead of restoring an older Polygon", async () => {
    const { onSubmit } = renderForm();
    change("Width (m)", "35");
    change("Length (m)", "invalid");

    selectShape("custom");

    expect(screen.getByRole("textbox", { name: "Site Polygon JSON" })).toHaveValue("");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter valid Polygon JSON.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps unrelated fields and errors when site types change, then submits only API configuration", async () => {
    const { onSubmit } = renderForm();
    change("Setback (m)", "");
    change("Preferred floor count (optional)", "2");
    change("Preferred footprint (m²) (optional)", "100");
    change("GFA target (m²) (optional)", "500");
    change("Width (m)", "");
    submit();
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));

    selectShape("l-shaped");

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "Preferred floor count (optional)" })).toHaveValue("2");
    expect(screen.getByRole("textbox", { name: "Preferred footprint (m²) (optional)" })).toHaveValue("100");
    expect(screen.getByRole("textbox", { name: "GFA target (m²) (optional)" })).toHaveValue("500");
    selectShape("custom");
    selectShape("notched");
    change("Setback (m)", "1.5");
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const configuration = onSubmit.mock.calls[0][0];
    expect(Object.keys(configuration)).toEqual(["site", "hard_constraints", "preferences", "targets"]);
    expect(Object.keys(configuration.site)).toEqual(["type", "coordinates"]);
    expect(configuration.hard_constraints).toMatchObject({ setback_m: 1.5, max_floors: 6 });
    expect(configuration.preferences).toEqual({ preferred_floor_count: 2, preferred_footprint_area_m2: 100 });
    expect(configuration.targets).toEqual({ gfa_target_m2: 500 });
  });

  it("keeps the submitted draft stable while editing continues", async () => {
    const { onSubmit } = renderForm();
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    change("Setback (m)", "4");
    change("GFA target (m²) (optional)", "1000");

    expect(onSubmit.mock.calls[0][1]).toEqual(initialConfigurationDraft);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("submits editable optional constraints, preferences, and target as numbers", async () => {
    const { onSubmit } = renderForm();
    change("Maximum height (m) (optional)", "24");
    change("Site coverage ratio (optional)", ".6");
    change("Maximum footprint (m²) (optional)", "500");
    change("Preferred floor count (optional)", "2");
    change("Preferred footprint (m²) (optional)", "350");
    change("GFA target (m²) (optional)", "1e3");
    fireEvent.click(screen.getByText("Design preferences", { selector: "summary strong" }));
    fireEvent.click(screen.getByText("GFA target", { selector: "summary strong" }));

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      hard_constraints: {
        max_height_m: 24,
        site_coverage_ratio: 0.6,
        max_footprint_m2: 500,
      },
      preferences: { preferred_floor_count: 2, preferred_footprint_area_m2: 350 },
      targets: { gfa_target_m2: 1000 },
    });
    expect(onSubmit.mock.calls[0][1].targets.gfa_target_m2).toBe("1e3");
  });

  it("preserves zero setback and GFA target values", async () => {
    const { onSubmit } = renderForm();
    change("Setback (m)", "0");
    change("GFA target (m²) (optional)", "0");

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      hard_constraints: { setback_m: 0 },
      targets: { gfa_target_m2: 0 },
    });
  });

  it("turns a cleared optional value back into null", async () => {
    const { onSubmit } = renderForm();
    change("GFA target (m²) (optional)", "0");
    change("GFA target (m²) (optional)", "");

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].targets.gfa_target_m2).toBeNull();
  });

  it("associates required validation errors with their input and prevents submission", async () => {
    const { onSubmit } = renderForm();
    const input = screen.getByRole("textbox", { name: "Setback (m)" });
    change("Setback (m)", "");

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a number.");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Zero or greater. Enter a number.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates numeric input on blur with accessible inline errors", async () => {
    const { onSubmit } = renderForm();
    const input = screen.getByRole("textbox", { name: "Floor-to-floor height (m)" });
    change("Floor-to-floor height (m)", "three");

    fireEvent.blur(input);

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a finite decimal number.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Enter a finite decimal number/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the missing-height-or-floor error beside maximum floor count", async () => {
    const { onSubmit } = renderForm();
    change("Maximum floor count (optional)", "");

    submit();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Enter a maximum height or maximum floor count (or both).");
    const input = screen.getByRole("textbox", { name: "Maximum floor count (optional)" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Enter a maximum height or maximum floor count/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["{", "Enter valid Polygon JSON."],
    [JSON.stringify({ type: "Polygon", coordinates: [] }), "Enter a Polygon object"],
    [JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10]]] }), "Close ring 1"],
  ])("shows an accessible site error for malformed geometry %s", async (site, message) => {
    const { onSubmit } = renderForm();
    selectShape("custom");
    change("Site Polygon JSON", site);

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    const input = screen.getByRole("textbox", { name: "Site Polygon JSON" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(new RegExp(message));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits an edited Polygon with a hole without dropping interior coordinates", async () => {
    const { onSubmit } = renderForm();
    selectShape("custom");
    const site = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]],
        [[5, 5], [5, 10], [10, 10], [10, 5], [5, 5]],
      ],
    };
    change("Site Polygon JSON", JSON.stringify(site));

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].site).toEqual(site);
    expect(onSubmit.mock.calls[0][1].site).toEqual({ kind: "custom", json: JSON.stringify(site) });
  });

  it("reports changes since the submitted draft and clears them when edits are reverted", () => {
    const { onDraftChange } = renderForm(structuredClone(initialConfigurationDraft));
    expect(onDraftChange).toHaveBeenLastCalledWith(false);

    change("Setback (m)", "4");

    expect(onDraftChange).toHaveBeenLastCalledWith(true);

    change("Setback (m)", "3");

    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });

  it("compares the raw draft and recognizes the next submitted draft without resetting edits", () => {
    const { onSubmit, onDraftChange, rerender } = renderForm(structuredClone(initialConfigurationDraft));
    change("Setback (m)", "3.0");
    expect(onDraftChange).toHaveBeenLastCalledWith(true);
    const submittedDraft = structuredClone(initialConfigurationDraft);
    submittedDraft.hard_constraints.setback_m = "3.0";

    rerender(
      <ConfigurationFormWithActions onSubmit={onSubmit} submittedDraft={submittedDraft} onDraftChange={onDraftChange} />,
    );

    expect(onDraftChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveValue("3.0");
  });

  it("allows editing and replacing a pending submission", async () => {
    const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
    render(<ConfigurationFormWithActions onSubmit={onSubmit} isGenerating />);
    expect(screen.getByText("Keep editing or submit again to update the preview."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Preview" })).toBeEnabled();
    change("Setback (m)", "4");

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].hard_constraints.setback_m).toBe(4);
  });
});
