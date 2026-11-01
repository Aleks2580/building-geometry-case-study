import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeasibilityStatus, MassingPreviewRequest, OptionResponse } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { previewRequest, previewResponse } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import SaveOption from "./SaveOption";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function component(draftChanged = false) {
  return (
    <QueryClientProvider client={client}>
      <SaveOption configuration={previewRequest()} draftChanged={draftChanged} />
    </QueryClientProvider>
  );
}

function submit() {
  fireEvent.submit(screen.getByRole("form", { name: "Save root option" }));
}

function name(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Option name (optional)" }), { target: { value } });
}

function savedResponse() {
  return Response.json(optionResponse(), { status: 201 });
}

function requestBody(index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index][1]?.body)) as Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("SaveOption", () => {
  it("waits for an explicit save and leaves an empty optional name out of the request", async () => {
    fetchMock.mockResolvedValue(Response.json(optionResponse(undefined, { name: null }), { status: 201 }));
    render(component());

    expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
    submit();

    await screen.findByText("Root option saved");
    const receipt = screen.getByRole("status");
    expect(receipt).toHaveTextContent("Root option saved");
    expect(receipt).toHaveTextContent("Unnamed option");
    expect(receipt).toHaveTextContent(optionResponse().id);
    expect(receipt).toHaveTextContent("None (root option)");
    expect(requestBody()).not.toHaveProperty("name");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/v1/options");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("trims a valid name and shows the authoritative returned name and identifier", async () => {
    const configuration = previewRequest();
    const original = structuredClone(configuration);
    const saved = optionResponse(undefined, { name: "Saved by backend" });
    fetchMock.mockResolvedValue(Response.json(saved, { status: 201 }));
    render(<QueryClientProvider client={client}>
      <SaveOption configuration={configuration} draftChanged={false} />
    </QueryClientProvider>);
    name("  Rectangle study  ");
    submit();

    await screen.findByText("Root option saved");
    const receipt = screen.getByRole("status");
    expect(requestBody()).toMatchObject({ ...configuration, name: "Rectangle study" });
    expect(receipt).toHaveTextContent("Saved by backend");
    expect(receipt).toHaveTextContent(saved.id);
    expect(configuration).toEqual(original);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    name("A later name draft");
    expect(receipt).toHaveTextContent("Saved by backend");
  });

  it.each([
    ["   ", "Enter a name or leave the field empty."],
    ["x".repeat(201), "Use 200 characters or fewer."],
    ["Invalid\u0000name", "The name cannot contain a NUL character."],
  ])("rejects an invalid supplied name without saving", async (value, message) => {
    render(component());
    name(value);
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    const input = screen.getByRole("textbox", { name: "Option name (optional)" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts 200 Unicode characters and allows correcting a name error", async () => {
    fetchMock.mockResolvedValue(savedResponse());
    render(component());
    name("x".repeat(201));
    submit();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    name("🏙".repeat(200));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    submit();

    await screen.findByText("Root option saved");
    expect(requestBody().name).toBe("🏙".repeat(200));
  });

  it("blocks both button and direct form submission when the configuration draft has changed", async () => {
    fetchMock.mockResolvedValue(savedResponse());
    const view = render(component(true));

    expect(screen.getByRole("button", { name: "Save Option" })).toBeDisabled();
    expect(screen.getByText("Generate Preview for the current draft before saving.")).toBeInTheDocument();
    submit();
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(component());
    expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
    submit();

    await screen.findByText("Root option saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate submissions and editing the submitted name while saving", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    render(component());
    name("First name");

    act(() => {
      submit();
      submit();
    });

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Option name (optional)" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving this submitted preview");
    expect(screen.getByRole("status")).toHaveTextContent("does not cancel the save");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody().name).toBe("First name");

    await act(async () => pending.resolve(savedResponse()));
    expect(await screen.findByRole("button", { name: "Save Another Root Option" })).toBeEnabled();
  });

  it("retains a saved receipt while the configuration draft changes", async () => {
    fetchMock.mockResolvedValue(savedResponse());
    const view = render(component());
    submit();
    await screen.findByText("Root option saved");

    view.rerender(component(true));

    expect(screen.getByRole("status")).toHaveTextContent(optionResponse().id);
    expect(screen.getByRole("status")).toHaveTextContent("This receipt belongs to the generated preview.");
    expect(screen.getByRole("button", { name: "Save Another Root Option" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a second root only after another explicit submission", async () => {
    const secondId = "550e8400-e29b-41d4-a716-446655440001";
    fetchMock.mockResolvedValueOnce(savedResponse())
      .mockResolvedValueOnce(Response.json(optionResponse(undefined, { id: secondId }), { status: 201 }));
    render(component());
    submit();
    await screen.findByText("Root option saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Each save creates a new option/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Another Root Option" }));

    await screen.findByText(secondId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(1)).toEqual(requestBody(0));
  });

  it("shows HTTP validation details and allows an explicit corrected submission", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: {
      code: "INVALID_REQUEST",
      message: "Request validation failed.",
      details: [{ path: "name", message: "The option name is invalid." }],
    } }, { status: 422 })).mockResolvedValueOnce(savedResponse());
    render(component());
    submit();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Save request failed");
    expect(error).toHaveTextContent("Request validation failed.");
    expect(error).toHaveTextContent("name: The option name is invalid.");
    expect(within(error).queryByText(/may have been saved/)).not.toBeInTheDocument();
    expect(screen.queryByText("Root option saved")).not.toBeInTheDocument();
    name("Corrected name");
    submit();

    await screen.findByText("Root option saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "malformed", "server"] as const)(
    "warns that the outcome is uncertain after a %s failure without retrying", async (failure) => {
      if (failure === "network") fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      else if (failure === "malformed") fetchMock.mockResolvedValue(Response.json({}, { status: 201 }));
      else fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
      render(component());
      submit();

      const error = await screen.findByRole("alert");
      expect(error).toHaveTextContent("Save outcome unknown");
      expect(error).toHaveTextContent("The option may have been saved.");
      expect(error).toHaveTextContent("may create a duplicate");
      expect(screen.queryByText("Root option saved")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
      vi.useFakeTimers();
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not cancel an accepted save or display its late receipt after unmounting", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const view = render(component());
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
    await act(async () => pending.resolve(savedResponse()));

    expect(screen.queryByText("Root option saved")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

const parentId = "550e8400-e29b-41d4-a716-446655440001";

function savedParent() {
  return optionResponse(undefined, { id: parentId, name: "Original study" });
}

function branchConfiguration(): MassingPreviewRequest {
  const result = previewResponse();
  return {
    site: result.site,
    hard_constraints: {
      ...result.hard_constraints, setback_m: 2, max_floors: 3, site_coverage_ratio: 0.5,
    },
    preferences: { preferred_floor_count: 2, preferred_footprint_area_m2: 350 },
    targets: { gfa_target_m2: 500 },
  };
}

function savedChild(overrides: Partial<OptionResponse> = {}) {
  return optionResponse(undefined, { parent_id: parentId, name: "Child study", ...overrides });
}

function branchComponent(
  draftChanged = false,
  parent = savedParent(),
  onCreateBranch?: (option: OptionResponse) => void,
) {
  return <QueryClientProvider client={client}>
    <SaveOption
      configuration={branchConfiguration()}
      draftChanged={draftChanged}
      parent={parent}
      onCreateBranch={onCreateBranch}
    />
  </QueryClientProvider>;
}

function submitBranch() {
  fireEvent.submit(screen.getByRole("form", { name: "Save branch option" }));
}

function statusChild(status: FeasibilityStatus): OptionResponse {
  const result = status === "generation_failed" ? backendPreviewResponse("preferred_failed") : previewResponse();
  result.feasibility.status = status;
  if (status === "infeasible") {
    result.hard_constraints.max_height_m = 3;
    result.footprint_geometry = null;
    result.floor_plate_geometry = null;
    result.generated_footprint_geometry = null;
    result.metrics = {
      ...result.metrics, maximum_permitted_floor_count: 0, gfa_upper_bound_m2: 0,
      footprint_area_m2: null, floor_count: null, height_m: null, gfa_m2: null,
      site_coverage_ratio: null, generated_footprint_area_m2: null, generated_gfa_capacity_m2: null,
    };
    result.feasibility.reason = "ZERO_PERMITTED_FLOORS";
    result.feasibility.hard_constraints_satisfied = false;
    result.feasibility.target_assessment.actual_m2 = null;
    result.feasibility.target_assessment.status = "not_evaluated";
    result.feasibility.diagnostics = [{
      code: "ZERO_PERMITTED_FLOORS", severity: "error", message: "No floor fits the height limit.",
    }];
  } else if (status === "feasible_target_unmet") {
    result.targets.gfa_target_m2 = 4000;
    result.feasibility.target_assessment = {
      requested_m2: 4000, actual_m2: 3876, shortfall_m2: 124,
      status: "unmet", diagnostic_code: "TARGET_EXCEEDS_UPPER_BOUND",
    };
    result.feasibility.diagnostics = [{
      code: "TARGET_EXCEEDS_UPPER_BOUND", severity: "warning", message: "The target exceeds the hard upper bound.",
    }];
  }
  return optionResponse(result, { parent_id: parentId, name: "Child study" });
}

describe("SaveOption branch saves", () => {
  it("saves only the replacement configuration after an explicit submission and shows the full child receipt", async () => {
    const parent = savedParent();
    const configuration = branchConfiguration();
    const originalParent = structuredClone(parent);
    const originalConfiguration = structuredClone(configuration);
    const child = savedChild({ name: "Saved child name" });
    fetchMock.mockResolvedValue(Response.json(child, { status: 201 }));
    render(<QueryClientProvider client={client}>
      <SaveOption configuration={configuration} draftChanged={false} parent={parent} />
    </QueryClientProvider>);

    expect(screen.getByRole("button", { name: "Save Branch" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save Option" })).not.toBeInTheDocument();
    expect(screen.getByText(/Selected parent:/)).toHaveTextContent(parent.name!);
    expect(fetchMock).not.toHaveBeenCalled();
    name("  Branch draft name  ");
    submitBranch();

    await screen.findByText("Branch saved");
    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:8000/api/v1/options/${parent.id}/branches`);
    expect(requestBody()).toEqual({
      hard_constraints: configuration.hard_constraints,
      preferences: configuration.preferences,
      targets: configuration.targets,
      name: "Branch draft name",
    });
    const receipt = screen.getByRole("status");
    expect(receipt).toHaveTextContent(child.id);
    expect(receipt).toHaveTextContent(child.parent_id!);
    expect(receipt).toHaveTextContent("Saved child name");
    expect(receipt).toHaveTextContent("feasible");
    expect(parent).toEqual(originalParent);
    expect(configuration).toEqual(originalConfiguration);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows an unnamed child and keeps its name independent of the parent", async () => {
    fetchMock.mockResolvedValue(Response.json(savedChild({ name: null }), { status: 201 }));
    render(branchComponent());
    submitBranch();

    await screen.findByText("Branch saved");
    expect(screen.getByRole("status")).toHaveTextContent("Unnamed option");
    expect(requestBody()).not.toHaveProperty("name");
    expect(screen.getByRole("textbox", { name: "Option name (optional)" })).toHaveValue("");
  });

  it.each([
    ["   ", "Enter a name or leave the field empty."],
    ["x".repeat(201), "Use 200 characters or fewer."],
    ["Invalid\u0000name", "The name cannot contain a NUL character."],
  ])("rejects an invalid child name before persistence", async (value, message) => {
    render(branchComponent());
    name(value);
    submitBranch();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("textbox", { name: "Option name (optional)" })).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"] as const)(
    "shows the saved %s status, including diagnostic snapshots",
    async (status) => {
      const child = statusChild(status);
      fetchMock.mockResolvedValue(Response.json(child, { status: 201 }));
      render(branchComponent());
      submitBranch();

      await screen.findByText("Branch saved");
      expect(screen.getByRole("status")).toHaveTextContent(status);
      expect(screen.getByRole("status")).toHaveTextContent(child.id);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("blocks stale branch previews at both the button and direct form boundary", async () => {
    fetchMock.mockResolvedValue(Response.json(savedChild(), { status: 201 }));
    const view = render(branchComponent(true));

    expect(screen.getByRole("button", { name: "Save Branch" })).toBeDisabled();
    expect(screen.getByText("Generate Preview for the current draft before saving.")).toBeInTheDocument();
    submitBranch();
    expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(branchComponent());
    submitBranch();

    await screen.findByText("Branch saved");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("blocks synchronous duplicate submissions and editing the submitted name while pending", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    render(branchComponent());
    name("First child");

    act(() => {
      submitBranch();
      submitBranch();
    });

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Option name (optional)" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving this submitted preview");
    expect(screen.queryByRole("button", { name: "Create Branch" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestBody().name).toBe("First child");

    await act(async () => pending.resolve(Response.json(savedChild(), { status: 201 })));
    expect(await screen.findByRole("button", { name: "Save Another Branch" })).toBeEnabled();
  });

  it("creates siblings under the same selected parent after separate explicit saves", async () => {
    const first = savedChild();
    const second = savedChild({ id: "550e8400-e29b-41d4-a716-446655440002", name: "Second child" });
    fetchMock.mockResolvedValueOnce(Response.json(first, { status: 201 }))
      .mockResolvedValueOnce(Response.json(second, { status: 201 }));
    render(branchComponent());
    name("First child");
    submitBranch();
    await screen.findByText("Branch saved");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText(/Each save creates a sibling/)).toBeInTheDocument();
    name("Second child");
    fireEvent.click(screen.getByRole("button", { name: "Save Another Branch" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(second.id));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://localhost:8000/api/v1/options/${parentId}/branches`,
      `http://localhost:8000/api/v1/options/${parentId}/branches`,
    ]);
    expect(requestBody(1)).toEqual({ ...requestBody(0), name: "Second child" });
    expect(screen.getByText(/Selected parent:/)).toHaveTextContent("Original study");
  });

  it("offers an explicit Create Branch action using the saved child's authoritative snapshot", async () => {
    const child = savedChild();
    const onCreateBranch = vi.fn();
    fetchMock.mockResolvedValue(Response.json(child, { status: 201 }));
    render(branchComponent(false, savedParent(), onCreateBranch));

    expect(screen.queryByRole("button", { name: "Create Branch" })).not.toBeInTheDocument();
    submitBranch();
    const createBranch = await screen.findByRole("button", { name: "Create Branch" });
    expect(createBranch).toHaveAttribute("type", "button");
    expect(onCreateBranch).not.toHaveBeenCalled();
    name("Unsaved later name");
    fireEvent.click(createBranch);

    expect(onCreateBranch).toHaveBeenCalledExactlyOnceWith(child);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent(child.name!);
  });

  it("retains the authoritative child receipt when a later configuration draft changes", async () => {
    fetchMock.mockResolvedValue(Response.json(savedChild(), { status: 201 }));
    const view = render(branchComponent());
    submitBranch();
    await screen.findByText("Branch saved");
    view.rerender(branchComponent(true));

    expect(screen.getByRole("status")).toHaveTextContent(savedChild().id);
    expect(screen.getByRole("button", { name: "Save Another Branch" })).toBeDisabled();
    submitBranch();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("explains a missing saved parent without implying an uncertain insertion", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: {
      code: "PARENT_OPTION_NOT_FOUND", message: "Parent option not found.",
      details: [{ path: "option_id", message: "No saved parent option has this identifier." }],
    } }, { status: 404 }));
    render(branchComponent());
    submitBranch();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Save request failed");
    expect(error).toHaveTextContent("option_id: No saved parent option has this identifier.");
    expect(error).toHaveTextContent("The selected parent could not be found.");
    expect(error).not.toHaveTextContent("may have been saved");
    expect(screen.getByRole("button", { name: "Save Branch" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["name", "hard_constraints", "preferences.preferred_floor_count", "targets.gfa_target_m2"])(
    "shows backend validation errors for %s and permits an explicit corrected save", async (path) => {
      fetchMock.mockResolvedValueOnce(Response.json({ error: {
        code: "INVALID_REQUEST", message: "Request validation failed.",
        details: [{ path, message: "The supplied value is invalid." }],
      } }, { status: 422 })).mockResolvedValueOnce(Response.json(savedChild(), { status: 201 }));
      render(branchComponent());
      submitBranch();

      const error = await screen.findByRole("alert");
      expect(error).toHaveTextContent(`${path}: The supplied value is invalid.`);
      expect(error).not.toHaveTextContent("may have been saved");
      name("Corrected child name");
      submitBranch();

      await screen.findByText("Branch saved");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["network", "malformed", "server"] as const)(
    "preserves an uncertain %s outcome without automatically creating another child", async (failure) => {
      if (failure === "network") fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      else if (failure === "malformed") fetchMock.mockResolvedValue(Response.json({}, { status: 201 }));
      else fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
      render(branchComponent());
      submitBranch();

      const error = await screen.findByRole("alert");
      expect(error).toHaveTextContent("Save outcome unknown");
      expect(error).toHaveTextContent("The option may have been saved.");
      expect(error).toHaveTextContent("new child of the selected parent");
      expect(error).toHaveTextContent("may create a duplicate");
      expect(screen.queryByText("Branch saved")).not.toBeInTheDocument();
      vi.useFakeTimers();
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("keeps a detached pending branch from displaying a late receipt", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const onCreateBranch = vi.fn();
    const view = render(branchComponent(false, savedParent(), onCreateBranch));
    submitBranch();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    view.unmount();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
    await act(async () => pending.resolve(Response.json(savedChild(), { status: 201 })));

    expect(screen.queryByText("Branch saved")).not.toBeInTheDocument();
    expect(onCreateBranch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
