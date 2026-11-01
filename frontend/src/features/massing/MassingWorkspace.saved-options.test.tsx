import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeasibilityStatus, OptionResponse } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { previewResponse } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import { optionKeys } from "../options/optionQueries";
import MassingWorkspace from "./MassingWorkspace";

const fetchMock = vi.fn<typeof fetch>();
const scrollIntoView = vi.fn();
let client = createQueryClient();
let requestCount = 0;
const childId = "550e8400-e29b-41d4-a716-446655440001";
const grandchildId = "550e8400-e29b-41d4-a716-446655440002";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function openRequest(option: OptionResponse) {
  requestCount += 1;
  return { optionId: option.id, requestId: `open-${requestCount}` };
}

function mount(initial?: OptionResponse) {
  const view = render(
    <QueryClientProvider client={client}>
      <MassingWorkspace openRequest={initial ? openRequest(initial) : null} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    open(option: OptionResponse) {
      view.rerender(
        <QueryClientProvider client={client}>
          <MassingWorkspace openRequest={openRequest(option)} />
        </QueryClientProvider>,
      );
    },
  };
}

function savedHeading() {
  return screen.findByRole("heading", { name: "Saved option snapshot", level: 2 });
}

function configuration() {
  return screen.getByRole("region", { name: "Saved configuration" });
}

function change(label: RegExp, value: string) {
  const input = screen.getByLabelText(label);
  const disclosure = input.closest("details");
  if (disclosure && !disclosure.open) fireEvent.click(disclosure.querySelector("summary")!);
  fireEvent.change(input, { target: { value } });
}

function generate() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
}

function assertReadsOnly() {
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
}

function diagnosticSnapshot(status: FeasibilityStatus) {
  const result = previewResponse();
  result.feasibility.status = status;
  if (status === "infeasible" || status === "generation_failed") {
    const reason = status === "infeasible" ? "EMPTY_BUILDABLE_REGION" : "FOOTPRINT_NOT_GENERATED";
    result.feasibility.reason = reason;
    result.feasibility.hard_constraints_satisfied = status === "infeasible" ? false : null;
    result.feasibility.diagnostics = [{ code: reason, severity: "error", message: "Stored diagnostic detail." }];
    result.footprint_geometry = null;
    result.floor_plate_geometry = null;
    result.generated_footprint_geometry = null;
    result.metrics = {
      ...result.metrics,
      generated_footprint_area_m2: null,
      generated_gfa_capacity_m2: null,
      footprint_area_m2: null,
      floor_count: null,
      height_m: null,
      gfa_m2: null,
      site_coverage_ratio: null,
    };
  }
  return optionResponse(result);
}

beforeEach(() => {
  client = createQueryClient();
  requestCount = 0;
  fetchMock.mockReset();
  scrollIntoView.mockReset();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

describe("MassingWorkspace saved snapshots", () => {
  it.each(["root", "child"] as const)("inspects stored dimensions for a restored %s without recomputation or snapshot changes", async (kind) => {
    const saved = optionResponse(backendPreviewResponse("holed"), {
      id: kind === "child" ? childId : optionResponse().id,
      parent_id: kind === "child" ? optionResponse().id : null,
      name: `Stored ${kind} courtyard`,
    });
    const original = structuredClone(saved);
    fetchMock.mockResolvedValueOnce(Response.json(saved));
    mount(saved);
    await savedHeading();
    const svg = screen.getByRole("img", { name: "Site plan" });
    const beforePaths = [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d"));
    const beforeMetrics = screen.getByRole("region", { name: "Actual massing" }).textContent;
    expect(screen.getByRole("checkbox", { name: "Show dimensions" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show dimensions" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Measure edge" }), { target: { value: "site-1-0" } });
    expect(svg.closest("figure")?.querySelector("figcaption [aria-live='polite']")).toHaveTextContent("Site hole 1 · edge 1: 5 m");
    fireEvent.change(screen.getByRole("combobox", { name: "Measure edge" }), { target: { value: "footprint-1-0" } });
    expect(svg.closest("figure")?.querySelector("figcaption [aria-live='polite']")).toHaveTextContent("Footprint hole 1 · edge 1: 5 m");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(svg.querySelectorAll("[data-overview-dimension]")).toHaveLength(16);
    expect(svg.querySelector("[data-overview-dimension='site-1-0'] text")).toHaveTextContent("5 m");
    expect(svg.querySelector("[data-overview-dimension='footprint-1-0'] text")).toHaveTextContent("5 m");
    expect(screen.getByText(/16 of 16 edge dimensions shown/)).toBeInTheDocument();
    expect([...svg.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual(beforePaths);
    expect(screen.getByRole("region", { name: "Actual massing" }).textContent).toBe(beforeMetrics);
    expect(screen.queryByRole("button", { name: "Generate Preview" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    assertReadsOnly();
    expect(client.getQueryData(optionKeys.detail(saved.id))).toEqual(original);
    expect(saved).toEqual(original);
  });

  it("opens a complete root snapshot without computation and preserves stored geometry, inputs and result", async () => {
    const result = backendPreviewResponse("holed");
    const saved = optionResponse(result, { name: "Persisted courtyard" });
    const original = structuredClone(saved);
    fetchMock.mockResolvedValue(Response.json(saved));

    mount(saved);

    const heading = await savedHeading();
    expect(screen.getByRole("heading", { name: "Saved snapshot result" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Massing configuration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Massing preview" })).not.toBeInTheDocument();
    expect(screen.getByText("Persisted courtyard")).toBeInTheDocument();
    expect(screen.getByText(saved.id)).toBeInTheDocument();
    for (const [label, expected] of [
      ["Setback (m)", "0"], ["Floor-to-floor height (m)", "3.5"],
      ["Maximum height (m)", "Not set"], ["Maximum floor count", "6"],
      ["Site coverage ratio", "Not set"], ["Maximum footprint (m²)", "Not set"],
      ["Preferred floor count", "Not set"], ["Preferred footprint (m²)", "Not set"],
      ["GFA target (m²)", "Not set"],
    ]) {
      expect(within(configuration()).getByText(label, { selector: "dt" }).parentElement?.querySelector("dd"))
        .toHaveTextContent(expected);
    }
    const actual = screen.getByRole("region", { name: "Actual massing" });
    expect(within(actual).getByText("GFA", { selector: "dt" }).parentElement?.querySelector("dd"))
      .toHaveTextContent("2,250 m²");
    const site = configuration().querySelector("pre");
    expect(JSON.parse(site?.textContent ?? "null")).toEqual(saved.site_geometry);
    const plan = screen.getByRole("img", { name: "Site plan" });
    const sitePath = plan.querySelector('[data-layer="site"]');
    expect(sitePath?.getAttribute("d")?.match(/M/g)).toHaveLength(saved.site_geometry.coordinates.length);
    expect(plan.querySelector('[data-layer="footprint"]')).toBeInTheDocument();
    expect(client.getQueryData(optionKeys.detail(saved.id))).toEqual(saved);
    await waitFor(() => expect(heading).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `http://localhost:8000/api/v1/options/${saved.id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    assertReadsOnly();
    expect(saved).toEqual(original);
  });

  it("restores a persisted nested child and creates a separate grandchild using its exact site and parent ID", async () => {
    const result = backendPreviewResponse("holed");
    result.hard_constraints.max_height_m = 18;
    result.hard_constraints.max_floors = 5;
    result.preferences.preferred_floor_count = 2;
    result.preferences.preferred_footprint_area_m2 = 300;
    result.targets.gfa_target_m2 = 500;
    const saved = optionResponse(result, { id: childId, parent_id: optionResponse().id, name: "Nested saved child" });
    const original = structuredClone(saved);
    const grandchild = optionResponse(result, { id: grandchildId, parent_id: saved.id, name: "New grandchild" });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method !== "POST") return Response.json(saved);
      return url.endsWith("/preview") ? Response.json(result) : Response.json(grandchild, { status: 201 });
    });
    mount(saved);
    await savedHeading();

    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));

    expect(screen.getByRole("region", { name: "Option creation context" })).toHaveTextContent(saved.id);
    expect(screen.getByRole("group", { name: "Inherited site (read-only)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rectangle / Square" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Site Polygon JSON/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Maximum height \(m\)/)).toHaveValue("18");
    expect(screen.getByLabelText(/Maximum floor count/)).toHaveValue("5");
    expect(screen.getByLabelText(/Preferred floor count/)).toHaveValue("2");
    expect(screen.getByLabelText(/Preferred footprint/)).toHaveValue("300");
    expect(screen.getByLabelText(/GFA target \(m²\)/)).toHaveValue("500");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    await screen.findByText("Branch saved");

    const previewCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/preview"));
    expect(JSON.parse(String(previewCall?.[1]?.body))).toEqual({
      site: saved.site_geometry,
      hard_constraints: saved.hard_constraints,
      preferences: saved.preferences,
      targets: saved.targets,
    });
    const branchCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/branches"));
    expect(branchCall?.[0]).toBe(`http://localhost:8000/api/v1/options/${saved.id}/branches`);
    expect(JSON.parse(String(branchCall?.[1]?.body))).toEqual({
      hard_constraints: saved.hard_constraints, preferences: saved.preferences, targets: saved.targets,
    });
    expect(screen.getByText(grandchild.id)).toBeInTheDocument();
    expect(client.getQueryData(optionKeys.detail(saved.id))).toEqual(original);
    expect(saved).toEqual(original);
  });

  it.each([
    ["feasible", "Feasible"],
    ["feasible_target_unmet", "Feasible — GFA target unmet"],
    ["infeasible", "Infeasible"],
    ["generation_failed", "Generation failed"],
  ] as const)("renders stored %s status and nullable actual results without substituting geometry", async (status, title) => {
    const saved = diagnosticSnapshot(status);
    fetchMock.mockResolvedValue(Response.json(saved));
    mount(saved);
    await savedHeading();

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    if (status === "infeasible" || status === "generation_failed") {
      expect(screen.getByText("Stored diagnostic detail.")).toBeInTheDocument();
      const actual = screen.getByRole("region", { name: "Actual massing" });
      for (const label of ["Footprint", "GFA", "Floors", "Height"]) {
        expect(within(actual).getByText(label, { selector: "dt" }).nextElementSibling).toHaveTextContent("Not available");
      }
      expect(within(screen.getByRole("complementary", { name: "Option details" })).getByText("Site coverage", { selector: "dt" }).nextElementSibling)
        .toHaveTextContent("Not available");
      expect(screen.getByRole("img", { name: "Site plan" }).querySelector('[data-layer="footprint"]')).not.toBeInTheDocument();
    }
    expect(client.getQueryData(optionKeys.detail(saved.id))).toEqual(saved);
    assertReadsOnly();
  });

  it.each(["57", "invalid"])("protects a pre-preview %s draft and supports declining or accepting replacement", async (width) => {
    const saved = optionResponse();
    fetchMock.mockResolvedValue(Response.json(saved));
    const view = mount();
    change(/Width \(m\)/, width);

    view.open(saved);

    await screen.findByRole("button", { name: "Keep Editing" });
    expect(screen.getByRole("region", { name: "Replace workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Editing" })).toHaveFocus();
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue(width);
    expect(screen.queryByRole("heading", { name: "Saved option snapshot" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue(width);
    expect(screen.queryByRole("button", { name: "Discard Draft and Open" })).not.toBeInTheDocument();

    view.open(saved);
    fireEvent.click(await screen.findByRole("button", { name: "Discard Draft and Open" }));

    await savedHeading();
    expect(screen.queryByLabelText(/Width \(m\)/)).not.toBeInTheDocument();
    assertReadsOnly();
  });

  it.each([false, true])("protects a generated default preview with unsaved name=%s", async (named) => {
    const saved = optionResponse();
    fetchMock.mockImplementation(async (_input, init) => Response.json(init?.method === "POST" ? previewResponse() : saved));
    const view = mount();
    generate();
    await screen.findByRole("button", { name: "Save Option" });
    if (named) change(/Option name/, "Unsaved study name");

    view.open(saved);

    fireEvent.click(await screen.findByRole("button", { name: "Keep Editing" }));
    expect(screen.getByLabelText(/Option name/)).toHaveValue(named ? "Unsaved study name" : "");
    expect(screen.getByRole("heading", { name: "Massing preview" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("protects edits made while the saved snapshot is loading", async () => {
    const saved = optionResponse();
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    mount(saved);
    expect(screen.getByText("Loading saved option…")).toHaveAttribute("role", "status");
    change(/Width \(m\)/, "61");

    await act(async () => pending.resolve(Response.json(saved)));

    fireEvent.click(await screen.findByRole("button", { name: "Keep Editing" }));
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue("61");
    expect(screen.queryByRole("heading", { name: "Saved option snapshot" })).not.toBeInTheDocument();
    assertReadsOnly();
  });

  it("protects an edit batched with a cached saved-option opening", async () => {
    const saved = optionResponse();
    client.setQueryData(optionKeys.detail(saved.id), saved);
    const view = mount();

    act(() => {
      change(/Width \(m\)/, "66");
      view.open(saved);
    });

    await screen.findByRole("button", { name: "Keep Editing" });
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue("66");
    expect(screen.queryByRole("heading", { name: "Saved option snapshot" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("protects an edit batched with completion of an in-flight opening", async () => {
    const saved = optionResponse();
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    mount(saved);

    await act(async () => {
      change(/Width \(m\)/, "67");
      pending.resolve(Response.json(saved));
    });

    await screen.findByRole("button", { name: "Keep Editing" });
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue("67");
    expect(screen.queryByRole("heading", { name: "Saved option snapshot" })).not.toBeInTheDocument();
    assertReadsOnly();
  });

  it.each(["late success", "late failure"])("isolates %s when a newer saved option was opened", async (outcome) => {
    const first = optionResponse();
    const second = optionResponse(undefined, { id: childId, name: "Latest selection" });
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(Response.json(second));
    const view = mount(first);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;

    view.open(second);
    await savedHeading();
    expect(screen.getByText("Latest selection")).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      if (outcome === "late success") pending.resolve(Response.json(first));
      else pending.reject(new TypeError("Old request failed"));
    });

    expect(screen.getByText("Latest selection")).toBeInTheDocument();
    expect(screen.queryByText(first.id)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Could not open saved option" })).not.toBeInTheDocument();
    assertReadsOnly();
  });

  it("cancels a pending opening without replacing the current editor when its late response arrives", async () => {
    const saved = optionResponse();
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    mount(saved);
    await screen.findByRole("button", { name: "Cancel opening" });
    const signal = fetchMock.mock.calls[0][1]?.signal;
    change(/Width \(m\)/, "63");

    fireEvent.click(screen.getByRole("button", { name: "Cancel opening" }));
    await act(async () => pending.resolve(Response.json(saved)));

    expect(signal?.aborted).toBe(true);
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue("63");
    expect(screen.queryByRole("heading", { name: "Saved option snapshot" })).not.toBeInTheDocument();
    assertReadsOnly();
  });

  it("keeps an explicitly started branch when a superseded saved-option opening later completes", async () => {
    const first = optionResponse(undefined, { name: "Active saved parent" });
    const second = optionResponse(undefined, { id: childId, name: "Superseded opening" });
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(first)).mockReturnValueOnce(pending.promise);
    const view = mount(first);
    await savedHeading();
    view.open(second);
    await screen.findByText("Loading saved option…");
    const signal = fetchMock.mock.calls[1][1]?.signal;

    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));
    await screen.findByRole("heading", { name: "Branch from saved option" });
    change(/Setback \(m\)/, "2");
    await act(async () => pending.resolve(Response.json(second)));

    expect(screen.getByRole("region", { name: "Option creation context" })).toHaveTextContent(first.id);
    expect(screen.getByLabelText(/Setback \(m\)/)).toHaveValue("2");
    expect(screen.queryByRole("heading", { name: "Saved option snapshot" })).not.toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    assertReadsOnly();
  });

  it("requires a fresh confirmation for the latest opening when another option replaces an earlier pending confirmation", async () => {
    const first = optionResponse(undefined, { name: "Earlier selection" });
    const second = optionResponse(undefined, { id: childId, name: "Latest selection" });
    fetchMock.mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second));
    const view = mount();
    change(/Width \(m\)/, "64");
    view.open(first);
    await screen.findByRole("button", { name: "Discard Draft and Open" });

    view.open(second);
    fireEvent.click(await screen.findByRole("button", { name: "Discard Draft and Open" }));

    await savedHeading();
    expect(screen.getByText("Latest selection")).toBeInTheDocument();
    expect(screen.queryByText("Earlier selection")).not.toBeInTheDocument();
    assertReadsOnly();
  });

  it.each([
    ["404", () => Response.json({ error: { code: "OPTION_NOT_FOUND", message: "Option not found.", details: [{ path: "option_id", message: "Unknown saved option." }] } }, { status: 404 })],
    ["malformed snapshot", () => Response.json({ ...optionResponse(), result: {} })],
    ["wrong identity", () => Response.json(optionResponse(undefined, { id: childId }))],
  ])("preserves an invalid draft after a %s response and supports an explicit retry", async (_kind, response) => {
    const saved = optionResponse();
    fetchMock.mockImplementationOnce(async () => response()).mockResolvedValueOnce(Response.json(saved));
    const view = mount();
    change(/Width \(m\)/, "invalid");
    view.open(saved);

    await screen.findByRole("heading", { name: "Could not open saved option" });
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue("invalid");
    expect(screen.queryByRole("heading", { name: "Saved option snapshot" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry opening option" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard Draft and Open" }));

    await savedHeading();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    assertReadsOnly();
  });

  it("switches saved options through their detail caches without retaining another snapshot's configuration", async () => {
    const first = optionResponse(undefined, { name: "First snapshot" });
    const second = optionResponse(backendPreviewResponse("holed"), { id: childId, name: "Second snapshot" });
    fetchMock.mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second));
    const view = mount(first);
    await savedHeading();

    view.open(second);
    await screen.findByText("Second snapshot");
    expect(JSON.parse(configuration().querySelector("pre")?.textContent ?? "null")).toEqual(second.site_geometry);
    view.open({ ...first, id: first.id.toUpperCase() });
    await screen.findByText("First snapshot");

    expect(screen.queryByText("Second snapshot")).not.toBeInTheDocument();
    expect(JSON.parse(configuration().querySelector("pre")?.textContent ?? "null")).toEqual(first.site_geometry);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(optionKeys.detail(second.id))).toEqual(second);
    assertReadsOnly();
  });

  it("does not let an old pending save receipt replace an explicitly opened saved snapshot", async () => {
    const saved = optionResponse(undefined, { id: childId, name: "Opened persisted snapshot" });
    const pendingSave = deferred<Response>();
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method !== "POST") return Response.json(saved);
      return String(input).endsWith("/preview") ? Response.json(previewResponse()) : pendingSave.promise;
    });
    const view = mount();
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Option" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    view.open(saved);
    fireEvent.click(await screen.findByRole("button", { name: "Discard Draft and Open" }));
    await savedHeading();

    await act(async () => pendingSave.resolve(Response.json(optionResponse(), { status: 201 })));

    expect(screen.getByText("Opened persisted snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Root option saved")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Massing configuration" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
});
