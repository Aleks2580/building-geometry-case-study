import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfigurationForm from "./ConfigurationForm";
import { initialConfigurationDraft } from "./configuration";
import type { Configuration, ConfigurationDraft } from "./configuration";

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
}

function change(name: string, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
}

function renderForm(submittedDraft?: ConfigurationDraft) {
  const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
  const onDraftChange = vi.fn<(changed: boolean) => void>();
  const view = render(
    <ConfigurationForm onSubmit={onSubmit} submittedDraft={submittedDraft} onDraftChange={onDraftChange} />,
  );
  return { onSubmit, onDraftChange, ...view };
}

describe("ConfigurationForm", () => {
  it("shows a valid initial example without submitting automatically", () => {
    const { onSubmit } = renderForm();

    expect(screen.getByRole("form", { name: "Massing configuration" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Site Polygon JSON" }))
      .toHaveValue(initialConfigurationDraft.site);
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
    expect(onSubmit.mock.calls[0][1].site).toBe(JSON.stringify(site));
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
      <ConfigurationForm onSubmit={onSubmit} submittedDraft={submittedDraft} onDraftChange={onDraftChange} />,
    );

    expect(onDraftChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveValue("3.0");
  });

  it("allows editing and replacing a pending submission", async () => {
    const onSubmit = vi.fn<(configuration: Configuration, draft: ConfigurationDraft) => void>();
    render(<ConfigurationForm onSubmit={onSubmit} isGenerating />);
    expect(screen.getByText("You can keep editing and submit again to replace the pending request."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Preview" })).toBeEnabled();
    change("Setback (m)", "4");

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].hard_constraints.setback_m).toBe(4);
  });
});
