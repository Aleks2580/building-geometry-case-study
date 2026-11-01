import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MassingWorkspace from "./MassingWorkspace";
import type { FeasibilityStatus, MassingPreviewResponse } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { previewResponse } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import { createViewportTransform, geometryBounds, geometryPath } from "../visualization/svgGeometry";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

function renderWorkspace() {
  return render(<QueryClientProvider client={client}><MassingWorkspace /></QueryClientProvider>);
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
}

function change(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function selectShape(kind: "rectangle" | "l-shaped" | "notched" | "custom") {
  fireEvent.change(screen.getByRole("combobox", { name: "Site shape" }), { target: { value: kind } });
  if (kind === "custom") fireEvent.click(screen.getByRole("button", { name: "Advanced JSON" }));
}

function metric(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.parentElement?.querySelector("dd");
}

function planPaths() {
  return [...screen.getByRole("img", { name: "Site plan" }).querySelectorAll("path")]
    .map((path) => [path.getAttribute("data-layer"), path.getAttribute("d")]);
}

function draftOutline() {
  return screen.getByRole("img", { name: "Draft site preview" }).querySelector("path")?.getAttribute("d") ?? "";
}

function expectPlanGeometry(result: MassingPreviewResponse) {
  const bounds = geometryBounds(result.site_geometry);
  if (bounds === null) throw new Error("Expected a displayable site fixture.");
  const transform = createViewportTransform(bounds, { width: 640, height: 400, padding: 24 });
  if (transform === null) throw new Error("Expected a valid display frame.");
  const layers: [string, MassingPreviewResponse["buildable_geometry"]][] = [
    ["site", result.site_geometry],
    ["buildable", result.buildable_geometry],
    ["selected-buildable", result.selected_buildable_geometry],
    ["footprint", result.footprint_geometry],
  ];
  expect(planPaths()).toEqual(layers.flatMap(([key, geometry]) => (
    geometry === null ? [] : [[key, geometryPath(geometry, transform)]]
  )));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("MassingWorkspace", () => {
  it("saves the submitted configuration and keeps the backend-recomputed snapshot separate from the preview", async () => {
    const preview = previewResponse();
    const recomputed = previewResponse();
    recomputed.metrics.gfa_m2 = 1292;
    recomputed.metrics.floor_count = 2;
    recomputed.metrics.height_m = 7;
    const saved = optionResponse(recomputed, { name: "Server-normalized study" });
    fetchMock.mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json(saved, { status: 201 }));
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const paths = planPaths();
    change(/Option name/, "  Rectangle study  ");

    fireEvent.click(screen.getByRole("button", { name: "Save Option" }));

    expect(await screen.findByText(saved.id)).toBeInTheDocument();
    expect(screen.getByText(saved.name!)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("http://localhost:8000/api/v1/options");
    expect(JSON.parse(String(options?.body))).toEqual({
      ...JSON.parse(String(fetchMock.mock.calls[0][1]?.body)), name: "Rectangle study",
    });
    expect(metric("GFA")).toHaveTextContent("3,876 m²");
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(planPaths()).toEqual(paths);
    expect(client.getMutationCache().getAll()[0].state.data).toEqual(saved);
    expect(client.getQueriesData({ queryKey: ["massing-preview"] }).map(([, data]) => data)).toContainEqual(preview);
  });

  it("blocks saves for changed and invalid drafts until they are generated, and supports restoring the submitted draft", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockResolvedValueOnce(Response.json(backendPreviewResponse("notched")))
      .mockResolvedValueOnce(Response.json(optionResponse(backendPreviewResponse("notched")), { status: 201 }));
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    const save = screen.getByRole("button", { name: "Save Option" });
    for (const width of ["41", "", "invalid", "40.0"]) {
      change(/Width \(m\)/, width);
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
    change(/Width \(m\)/, "invalid");
    submit();
    expect(await screen.findByText("Enter a finite decimal number.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    change(/Width \(m\)/, "40");
    expect(save).toBeEnabled();
    selectShape("notched");
    expect(save).toBeDisabled();
    submit();
    await waitFor(() => expectPlanGeometry(backendPreviewResponse("notched")));
    fireEvent.click(screen.getByRole("button", { name: "Save Option" }));

    await screen.findByText(optionResponse().id);
    const submitted = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual(submitted);
    expect(submitted.site).toEqual(backendPreviewResponse("notched").site);
  });

  it("cannot save an earlier input when a successful pending preview arrives after invalid edits", async () => {
    const preview = deferred<Response>();
    fetchMock.mockReturnValue(preview.promise);
    renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    change(/Width \(m\)/, "invalid");
    await act(async () => preview.resolve(Response.json(previewResponse())));

    expect(await screen.findByRole("button", { name: "Save Option" })).toBeDisabled();
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a pending save tied to its submitted input when the draft is edited", async () => {
    const save = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse())).mockReturnValueOnce(save.promise);
    renderWorkspace();
    submit();
    await screen.findByRole("button", { name: "Save Option" });
    fireEvent.click(screen.getByRole("button", { name: "Save Option" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    change(/Width \(m\)/, "45");
    await act(async () => save.resolve(Response.json(optionResponse(), { status: 201 })));

    expect(await screen.findByText(optionResponse().id)).toBeInTheDocument();
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).site).toEqual(previewResponse().site);
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
    expectPlanGeometry(previewResponse());
  });

  it.each(["success", "failure"])("does not associate a late save %s with a newer preview attempt", async (outcome) => {
    const firstSave = deferred<Response>();
    const nextPreview = deferred<Response>();
    const oldSaved = optionResponse();
    const nextSaved = optionResponse(previewResponse(), { id: "550e8400-e29b-41d4-a716-446655440001", name: "New study" });
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(nextPreview.promise)
      .mockResolvedValueOnce(Response.json(nextSaved, { status: 201 }));
    renderWorkspace();
    submit();
    await screen.findByRole("button", { name: "Save Option" });
    change(/Option name/, "Old study");
    fireEvent.click(screen.getByRole("button", { name: "Save Option" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    submit();
    await screen.findByText("Generating preview…");
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    await act(async () => nextPreview.resolve(Response.json(previewResponse())));
    const nextSave = await screen.findByRole("button", { name: "Save Option" });
    expect(screen.getByLabelText(/Option name/)).toHaveValue("");
    expect(nextSave).toBeEnabled();
    fireEvent.click(nextSave);
    await screen.findByText(nextSaved.id);

    await act(async () => {
      if (outcome === "success") firstSave.resolve(Response.json(oldSaved, { status: 201 }));
      else firstSave.reject(new TypeError("Old save lost its response"));
    });

    expect(screen.getByText(nextSaved.id)).toBeInTheDocument();
    expect(screen.queryByText(oldSaved.id)).not.toBeInTheDocument();
    expect(screen.queryByText("Old study")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expectPlanGeometry(previewResponse());
  });

  it("does not restore a save receipt after the workspace remounts with the same query cache", async () => {
    const pendingSave = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockReturnValueOnce(pendingSave.promise)
      .mockResolvedValueOnce(Response.json(previewResponse()));
    const first = renderWorkspace();
    submit();
    await screen.findByRole("button", { name: "Save Option" });
    fireEvent.click(screen.getByRole("button", { name: "Save Option" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1]?.signal).toBeUndefined();
    first.unmount();
    renderWorkspace();
    submit();
    await screen.findByRole("button", { name: "Save Option" });
    await act(async () => pendingSave.resolve(Response.json(optionResponse(), { status: 201 })));

    expect(screen.queryByText(optionResponse().id)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits for an explicit action, then submits the initial configuration and displays backend metrics", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderWorkspace();

    expect(screen.getByText(/No preview yet/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Draft site preview" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    submit();
    expect(await screen.findByText("Generating preview…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Massing preview" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("Footprint area", { selector: "dt" })).not.toBeInTheDocument();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/massing/preview");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      site: {
        type: "Polygon",
        coordinates: [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]],
      },
      hard_constraints: { setback_m: 3, floor_to_floor_m: 3.5, max_floors: 6, max_height_m: null },
      preferences: { preferred_floor_count: null, preferred_footprint_area_m2: null },
      targets: { gfa_target_m2: null },
    });
    await act(async () => pending.resolve(Response.json(previewResponse())));

    expect(await screen.findByRole("heading", { name: "Feasible" })).toBeInTheDocument();
    expect(metric("Footprint area")).toHaveTextContent("646 m²");
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(metric("Height")).toHaveTextContent("21 m");
    expect(metric("GFA")).toHaveTextContent("3,876 m²");
    expect(screen.queryByText("Generating preview…")).not.toBeInTheDocument();
    expectPlanGeometry(previewResponse());
    const plan = screen.getByRole("img", { name: "Site plan" });
    expect(plan).toHaveAccessibleDescription(/Plan view of backend geometry in metres/);
    expect(plan).toHaveAttribute("viewBox", "0 0 640 400");
    expect(plan).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(plan.compareDocumentPosition(screen.getByText("Footprint area", { selector: "dt" })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("region", { name: "Massing preview" })).toHaveAttribute("aria-busy", "false");
    expect(within(screen.getByRole("list", { name: "Site plan layers" })).getAllByRole("listitem"))
      .toHaveLength(4);
  });

  it.each([
    ["feasible", "Feasible", false],
    ["feasible_target_unmet", "Feasible — GFA target unmet", false],
    ["infeasible", "Infeasible", true],
    ["generation_failed", "Generation failed", true],
  ] satisfies [FeasibilityStatus, string, boolean][])(
    "displays the %s domain status without a request error", async (status, title, emptyMetrics) => {
      const result = previewResponse();
      result.feasibility.status = status;
      if (emptyMetrics) {
        result.generated_footprint_geometry = null;
        result.footprint_geometry = null;
        result.floor_plate_geometry = null;
        result.metrics.generated_footprint_area_m2 = null;
        result.metrics.generated_gfa_capacity_m2 = null;
        result.metrics.footprint_area_m2 = null;
        result.metrics.floor_count = null;
        result.metrics.height_m = null;
        result.metrics.gfa_m2 = null;
        result.metrics.site_coverage_ratio = null;
        result.feasibility.hard_constraints_satisfied = status === "infeasible" ? false : null;
        result.feasibility.reason = status === "infeasible" ? "ZERO_PERMITTED_FLOORS" : "FOOTPRINT_NOT_GENERATED";
        result.feasibility.target_assessment.actual_m2 = null;
        if (status === "infeasible") {
          result.hard_constraints.max_height_m = 1;
          result.metrics.maximum_permitted_floor_count = 0;
          result.metrics.gfa_upper_bound_m2 = 0;
        }
      }
      if (status === "feasible_target_unmet") {
        result.targets.gfa_target_m2 = 4000;
        result.feasibility.target_assessment = {
          requested_m2: 4000, actual_m2: 3876, shortfall_m2: 124,
          status: "unmet", diagnostic_code: "TARGET_EXCEEDS_UPPER_BOUND",
        };
      }
      fetchMock.mockResolvedValue(Response.json(result));
      renderWorkspace();
      submit();

      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
      expectPlanGeometry(result);
      expect(screen.getByRole("img", { name: "Site plan" }).querySelectorAll("path"))
        .toHaveLength(emptyMetrics ? 3 : 4);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(metric("Hard constraints satisfied")).toHaveTextContent(
        status === "generation_failed" ? "Unknown" : status === "infeasible" ? "False" : "True",
      );
      if (emptyMetrics) {
        expect(screen.getByText("No building footprint is available.", { selector: "p" })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Site plan" }))
          .toHaveAccessibleDescription(/No building footprint is available/);
        for (const label of ["Footprint area", "Floor count", "Height", "GFA", "Site coverage ratio"]) {
          expect(metric(label)).toHaveTextContent("Not available");
        }
      }
    },
  );

  it("shows backend validation details, including coordinate and section paths", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: {
      code: "INVALID_SITE_GEOMETRY",
      message: "Request validation failed.",
      details: [
        { path: "site.coordinates[0]", message: "Ring self-intersection." },
        { path: "preferences", message: "Preference exceeds permitted floor count." },
      ],
    } }, { status: 422 }));
    renderWorkspace();
    submit();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Request validation failed.");
    expect(error).toHaveTextContent("site.coordinates[0]: Ring self-intersection.");
    expect(error).toHaveTextContent("preferences: Preference exceeds permitted floor count.");
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });

  it("does not display small positive backend metrics as zero", async () => {
    const result = previewResponse();
    result.metrics.footprint_area_m2 = 0.001;
    result.metrics.gfa_m2 = 0.006;
    fetchMock.mockResolvedValue(Response.json(result));
    renderWorkspace();
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expect(metric("Footprint area")).toHaveTextContent("<0.01 m²");
    expect(metric("GFA")).toHaveTextContent("<0.01 m²");
  });

  it("shows a network error and retries only on the next explicit submission", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json(previewResponse()));
    renderWorkspace();
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the massing API.");
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    submit();
    expect(await screen.findByRole("heading", { name: "Feasible" })).toBeInTheDocument();
    expectPlanGeometry(previewResponse());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows malformed successful responses as request failures", async () => {
    fetchMock.mockResolvedValue(Response.json({ metrics: {} }));
    renderWorkspace();
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid massing preview response.");
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
  });

  it("keeps edits separate from the displayed result, including invalid drafts and restoring submitted values", async () => {
    fetchMock.mockResolvedValue(Response.json(previewResponse()));
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    const submittedPaths = planPaths();
    change(/Maximum floor count/, "2");
    selectShape("custom");
    change(/Site Polygon JSON/, JSON.stringify(backendPreviewResponse("notched").site));

    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(planPaths()).toEqual(submittedPaths);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    change(/Site Polygon JSON/, "{");
    submit();
    expect(await screen.findByText("Enter valid Polygon JSON.")).toBeInTheDocument();
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(planPaths()).toEqual(submittedPaths);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    selectShape("rectangle");
    change(/Maximum floor count/, "6");
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
    expect(planPaths()).toEqual(submittedPaths);
  });

  it("keeps displayed geometry and metrics while editing dimensions and switching site types without requests", async () => {
    const rectangle = previewResponse();
    const notched = backendPreviewResponse("notched");
    fetchMock.mockResolvedValueOnce(Response.json(rectangle))
      .mockResolvedValueOnce(Response.json(notched))
      .mockResolvedValueOnce(Response.json(rectangle));
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    const rectanglePaths = planPaths();
    const rectangleDraftPath = draftOutline();

    change(/Width \(m\)/, "45.25");
    expect(draftOutline()).not.toBe(rectangleDraftPath);
    expect(planPaths()).toEqual(rectanglePaths);
    change(/Length \(m\)/, "");
    expect(screen.queryByRole("img", { name: "Draft site preview" })).not.toBeInTheDocument();
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a number.");
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(planPaths()).toEqual(rectanglePaths);
    expect(metric("Footprint area")).toHaveTextContent("646 m²");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const exampleDraftPaths: string[] = [];
    for (const kind of ["l-shaped", "notched", "custom"] as const) {
      selectShape(kind);
      exampleDraftPaths.push(draftOutline());
      expect(planPaths()).toEqual(rectanglePaths);
      expect(metric("GFA")).toHaveTextContent("3,876 m²");
      expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(exampleDraftPaths[0]).not.toBe(rectangleDraftPath);
    expect(exampleDraftPaths[1]).not.toBe(exampleDraftPaths[0]);
    expect(exampleDraftPaths[2]).toBe(exampleDraftPaths[1]);
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(request.site).toEqual(notched.site);
    expect(Object.keys(request)).toEqual(["site", "hard_constraints", "preferences", "targets"]);
    expect(Object.keys(request.site)).toEqual(["type", "coordinates"]);
    await waitFor(() => expectPlanGeometry(notched));
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
    const notchedPaths = planPaths();

    selectShape("rectangle");

    expect(draftOutline()).toBe(rectangleDraftPath);
    expect(planPaths()).toEqual(notchedPaths);
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).site).toEqual(rectangle.site);
    await waitFor(() => expectPlanGeometry(rectangle));
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
  });

  it("tracks raw rectangle dimensions and selection when restoring the submitted draft", async () => {
    fetchMock.mockResolvedValue(Response.json(previewResponse()));
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });

    change(/Width \(m\)/, "40.0");
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    change(/Width \(m\)/, "40");
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
    selectShape("custom");
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    selectShape("rectangle");
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expectPlanGeometry(previewResponse());
  });

  it("keeps a pending rectangle request active when an invalid dimension blocks a replacement", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    change(/Width \(m\)/, "invalid");
    expect(screen.queryByRole("img", { name: "Draft site preview" })).not.toBeInTheDocument();

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a finite decimal number.");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    await act(async () => pending.resolve(Response.json(previewResponse())));
    await screen.findByRole("heading", { name: "Feasible" });
    expectPlanGeometry(previewResponse());
    expect(screen.queryByRole("img", { name: "Draft site preview" })).not.toBeInTheDocument();
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
  });

  it("does not let edits during a request mutate its submitted inputs or its response", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    change(/Maximum floor count/, "2");
    selectShape("l-shaped");
    const lShapedDraftPath = draftOutline();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).site).toEqual(previewResponse().site);
    await act(async () => pending.resolve(Response.json(previewResponse())));

    await screen.findByRole("heading", { name: "Feasible" });
    expectPlanGeometry(previewResponse());
    expect(draftOutline()).toBe(lShapedDraftPath);
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(screen.getByLabelText(/Maximum floor count/)).toHaveValue("2");
    expect(screen.getByRole("combobox", { name: "Site shape" })).toHaveValue("l-shaped");
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels superseded requests and ignores late responses even when fetch ignores the signal", async () => {
    const first = deferred<Response>();
    const oldResult = backendPreviewResponse("notched");
    oldResult.feasibility.diagnostics = [{
      code: "BUILDABLE_REGION_SPLIT", severity: "warning", message: "Old split-region warning.",
    }];
    const second = previewResponse();
    second.metrics.floor_count = 2;
    second.metrics.height_m = 7;
    second.metrics.gfa_m2 = 1292;
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(Response.json(second));
    renderWorkspace();
    selectShape("notched");
    submit();
    await screen.findByText("Generating preview…");
    const firstSignal = fetchMock.mock.calls[0][1]?.signal;
    selectShape("rectangle");
    change(/Maximum floor count/, "2");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(false);
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expect(firstSignal?.aborted).toBe(true);
    expect(metric("Floor count")).toHaveTextContent("2");
    expectPlanGeometry(second);
    const currentPaths = planPaths();
    await act(async () => first.resolve(Response.json(oldResult)));
    expect(metric("Floor count")).toHaveTextContent("2");
    expect(metric("GFA")).toHaveTextContent("1,292 m²");
    expectPlanGeometry(second);
    expect(planPaths()).toEqual(currentPaths);
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Old split-region warning.")).not.toBeInTheDocument();
    expect(screen.getByText("No diagnostics reported.")).toBeInTheDocument();
  });

  it("ignores a late rejection from a superseded request", async () => {
    const first = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(Response.json(previewResponse()));
    renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    await act(async () => first.reject(new TypeError("Old request failed")));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(metric("Floor count")).toHaveTextContent("6");
    expectPlanGeometry(previewResponse());
  });

  it("keeps the active request error when a superseded request later returns successful geometry", async () => {
    const first = deferred<Response>();
    const oldResult = backendPreviewResponse("notched");
    fetchMock.mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    renderWorkspace();
    selectShape("notched");
    submit();
    await screen.findByText("Generating preview…");
    const firstSignal = fetchMock.mock.calls[0][1]?.signal;
    selectShape("rectangle");
    submit();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("HTTP 503");
    expect(firstSignal?.aborted).toBe(true);
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("Footprint area", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diagnostics" })).not.toBeInTheDocument();
    await act(async () => first.resolve(Response.json(oldResult)));

    expect(screen.getByRole("alert")).toBe(error);
    expect(error).toHaveTextContent("HTTP 503");
    expect(screen.queryByRole("heading", { name: "Feasible" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("Footprint area", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByText(oldResult.feasibility.diagnostics[0].message)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels the pending request when the workspace unmounts", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const view = renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    view.unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("makes a new request after remounting with the same Query cache and inputs", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(previewResponse())));
    const first = renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    first.unmount();
    renderWorkspace();
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["http", "network"])("clears previous plan, metrics, and diagnostics during a new request and after its %s error", async (failure) => {
    const pending = deferred<Response>();
    const previous = previewResponse();
    previous.targets.gfa_target_m2 = 4000;
    previous.feasibility.status = "feasible_target_unmet";
    previous.feasibility.target_assessment = {
      requested_m2: 4000, actual_m2: 3876, shortfall_m2: 124,
      status: "unmet", diagnostic_code: "TARGET_EXCEEDS_UPPER_BOUND",
    };
    previous.feasibility.diagnostics = [{
      code: "TARGET_EXCEEDS_UPPER_BOUND", severity: "warning", message: "Previous target exceeds the hard GFA bound.",
    }];
    fetchMock.mockResolvedValueOnce(Response.json(previous)).mockReturnValueOnce(pending.promise);
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible — GFA target unmet" });
    expect(screen.getByText("Previous target exceeds the hard GFA bound.")).toBeInTheDocument();
    expectPlanGeometry(previous);
    change(/Maximum floor count/, "2");
    submit();
    await screen.findByText("Generating preview…");

    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("Footprint area", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Site and setback" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Generated default capacity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Preferences and target" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByText("Previous target exceeds the hard GFA bound.")).not.toBeInTheDocument();
    await act(async () => {
      if (failure === "http") pending.resolve(new Response("Unavailable", { status: 503 }));
      else pending.reject(new TypeError("Failed to fetch"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      failure === "http" ? "HTTP 503" : "Unable to reach the massing API.",
    );
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("Footprint area", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hard constraints and capacity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Preferences and target" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByText("Previous target exceeds the hard GFA bound.")).not.toBeInTheDocument();
  });

  it("submits zero targets and Polygon holes through the real API client", async () => {
    fetchMock.mockResolvedValue(Response.json(previewResponse()));
    renderWorkspace();
    selectShape("custom");
    const site = previewResponse().site;
    site.coordinates.push([[10, 10], [15, 10], [15, 15], [10, 15], [10, 10]]);
    change(/Site Polygon JSON/, JSON.stringify(site));
    change(/Setback \(m\)/, "0");
    change(/GFA target \(m²\)/, "0");
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      site, hard_constraints: { setback_m: 0 }, targets: { gfa_target_m2: 0 },
    });
    await screen.findByRole("heading", { name: "Feasible" });
    expect(within(screen.getByRole("form", { name: "Massing configuration" })).queryByRole("alert"))
      .not.toBeInTheDocument();
  });

  it("renders the actual preferred footprint separately from generated default capacity", async () => {
    const result = backendPreviewResponse("preferred");
    fetchMock.mockResolvedValue(Response.json(result));
    renderWorkspace();
    change(/Maximum footprint \(m²\)/, String(result.hard_constraints.max_footprint_m2));
    change(/Preferred footprint \(m²\)/, String(result.preferences.preferred_footprint_area_m2));
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expectPlanGeometry(result);
    expect(metric("Footprint area")).toHaveTextContent("300 m²");
    expect(result.footprint_geometry).not.toEqual(result.generated_footprint_geometry);
    const paths = planPaths();
    expect(new Set(paths.map(([, path]) => path)).size).toBe(3);
    expect(screen.getByRole("region", { name: "Generated default capacity" })).toHaveTextContent("500 m²");
  });

  it("retains site and setback context without substituting generated geometry for a missing actual footprint", async () => {
    const result = backendPreviewResponse("preferred_failed");
    expect(result.generated_footprint_geometry).not.toBeNull();
    expect(result.footprint_geometry).toBeNull();
    fetchMock.mockResolvedValue(Response.json(result));
    renderWorkspace();
    change(/Preferred footprint \(m²\)/, String(result.preferences.preferred_footprint_area_m2));
    submit();

    await screen.findByRole("heading", { name: "Generation failed" });
    expectPlanGeometry(result);
    expect(planPaths().map(([key]) => key)).toEqual(["site", "buildable", "selected-buildable"]);
    expect(screen.getByText("No building footprint is available.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Site plan" }))
      .toHaveAccessibleDescription(/No building footprint is available/);
    expect(screen.queryByText("Actual building footprint", { selector: "li" })).not.toBeInTheDocument();
    expect(metric("Footprint area")).toHaveTextContent("Not available");
    expect(screen.getByRole("region", { name: "Generated default capacity" })).toHaveTextContent("646 m²");
  });

  it.each([
    ["holed", [2, 2, 2, 2]],
    ["notched", [1, 2, 1, 1]],
  ] as const)("renders every ring and component from the backend %s response", async (name, subpathCounts) => {
    const result = backendPreviewResponse(name);
    fetchMock.mockResolvedValue(Response.json(result));
    renderWorkspace();
    selectShape("custom");
    change(/Site Polygon JSON/, JSON.stringify(result.site));
    change(/Setback \(m\)/, String(result.hard_constraints.setback_m));
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expectPlanGeometry(result);
    const paths = screen.getByRole("img", { name: "Site plan" }).querySelectorAll("path");
    expect([...paths].map((path) => path.getAttribute("d")?.match(/M/g)?.length)).toEqual(subpathCounts);
    for (const path of paths) {
      expect(path).toHaveAttribute("fill-rule", "evenodd");
      expect(path).toHaveAttribute("vector-effect", "non-scaling-stroke");
    }
    expect(within(screen.getByRole("list", { name: "Site plan layers" })).getAllByRole("listitem")
      .map((item) => item.textContent)).toEqual([
      "Original site boundary", "Complete buildable region", "Selected buildable component", "Actual building footprint",
    ]);
  });
});
