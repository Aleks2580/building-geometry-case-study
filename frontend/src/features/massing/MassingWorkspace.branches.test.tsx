import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionResponse } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { previewResponse } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import MassingWorkspace from "./MassingWorkspace";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();
const childId = "550e8400-e29b-41d4-a716-446655440001";

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

function renderWorkspace() {
  return render(<QueryClientProvider client={client}><MassingWorkspace /></QueryClientProvider>);
}

function generate() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
}

function change(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function body(index: number): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index][1]?.body)) as Record<string, unknown>;
}

function context() {
  return screen.getByRole("region", { name: "Option creation context" });
}

function confirmReplacement() {
  const confirmation = within(screen.getByRole("region", { name: "Replace workspace" }));
  fireEvent.click(confirmation.getByRole("button", { name: "Discard Draft and Continue" }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function saveRoot(parent: OptionResponse = optionResponse()) {
  fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
    .mockResolvedValueOnce(Response.json(parent, { status: 201 }));
  generate();
  fireEvent.click(await screen.findByRole("button", { name: "Save Option" }));
  await screen.findByText("Root option saved");
}

async function enterBranch(parent: OptionResponse = optionResponse()) {
  await saveRoot(parent);
  fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));
  confirmReplacement();
  expect(context()).toHaveTextContent(parent.id);
}

describe("MassingWorkspace branching", () => {
  it("restores the authoritative branch configuration after explicitly discarding invalid edits", async () => {
    const savedResult = backendPreviewResponse("holed");
    savedResult.hard_constraints.setback_m = 2;
    savedResult.preferences.preferred_floor_count = 2;
    savedResult.preferences.preferred_footprint_area_m2 = 300;
    savedResult.targets.gfa_target_m2 = 500;
    const parent = optionResponse(savedResult, { name: "Saved holed parent" });
    const original = structuredClone(parent);
    renderWorkspace();
    await saveRoot(parent);
    change(/Width \(m\)/, "invalid");
    change(/Setback \(m\)/, "99");
    change(/Preferred floor count/, "4");
    change(/GFA target \(m²\)/, "9999");

    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));
    expect(context()).toHaveTextContent("New root option");
    expect(screen.getByLabelText(/Width \(m\)/)).toHaveValue("invalid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    confirmReplacement();

    expect(context()).toHaveTextContent("Saved holed parent");
    expect(context()).toHaveTextContent(parent.id);
    expect(screen.getByLabelText(/Setback \(m\)/)).toHaveValue("2");
    expect(screen.getByLabelText(/Preferred floor count/)).toHaveValue("2");
    expect(screen.getByLabelText(/Preferred footprint/)).toHaveValue("300");
    expect(screen.getByLabelText(/GFA target \(m²\)/)).toHaveValue("500");
    await waitFor(() => expect(screen.getByLabelText(/Setback \(m\)/)).toHaveFocus());
    expect(screen.getByRole("group", { name: "Inherited site (read-only)" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Site shape" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Site Polygon JSON/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(Response.json(savedResult));
    generate();
    await screen.findByRole("button", { name: "Save Branch" });
    expect(body(2)).toEqual({
      site: parent.site_geometry,
      hard_constraints: parent.hard_constraints,
      preferences: parent.preferences,
      targets: parent.targets,
    });
    expect(parent).toEqual(original);
  });

  it("keeps the selected parent across previews and creates multiple siblings with replacement inputs", async () => {
    const parent = optionResponse();
    const original = structuredClone(parent);
    const child = optionResponse(undefined, { id: childId, parent_id: parent.id, name: "First child" });
    const sibling = { ...child, id: "550e8400-e29b-41d4-a716-446655440002", name: null };
    renderWorkspace();
    await enterBranch(parent);
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockResolvedValueOnce(Response.json(child, { status: 201 }))
      .mockResolvedValueOnce(Response.json(previewResponse()))
      .mockResolvedValueOnce(Response.json(sibling, { status: 201 }));
    change(/Setback \(m\)/, "2");
    change(/Preferred floor count/, "3");
    change(/GFA target \(m²\)/, "1500");
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    await screen.findByText("Branch saved");
    expect(context()).toHaveTextContent(parent.id);
    expect(context()).not.toHaveTextContent(child.id);
    change(/Setback \(m\)/, "1");
    change(/Preferred floor count/, "4");
    change(/GFA target \(m²\)/, "2000");
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    await screen.findByText(sibling.id);

    for (const index of [3, 5]) {
      expect(fetchMock.mock.calls[index][0]).toBe(`http://localhost:8000/api/v1/options/${parent.id}/branches`);
      expect(body(index)).not.toHaveProperty("site");
      expect(body(index)).not.toHaveProperty("parent_id");
      expect(body(index)).toEqual({
        hard_constraints: body(index - 1).hard_constraints,
        preferences: body(index - 1).preferences,
        targets: body(index - 1).targets,
      });
    }
    expect(body(3)).toMatchObject({ hard_constraints: { setback_m: 2 }, preferences: { preferred_floor_count: 3 }, targets: { gfa_target_m2: 1500 } });
    expect(body(5)).toMatchObject({ hard_constraints: { setback_m: 1 }, preferences: { preferred_floor_count: 4 }, targets: { gfa_target_m2: 2000 } });
    expect(fetchMock.mock.calls.filter(([url]) => url === "http://localhost:8000/api/v1/options")).toHaveLength(1);
    expect(context()).toHaveTextContent(parent.id);
    expect(parent).toEqual(original);
  });

  it("requires an explicit child receipt action before selecting that child as the next parent", async () => {
    const parent = optionResponse();
    const childResult = previewResponse();
    childResult.hard_constraints.setback_m = 1;
    const child = optionResponse(childResult, { id: childId, parent_id: parent.id, name: "Saved child" });
    renderWorkspace();
    await enterBranch(parent);
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockResolvedValueOnce(Response.json(child, { status: 201 }))
      .mockResolvedValueOnce(Response.json(childResult));
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    await screen.findByText("Branch saved");
    expect(context()).toHaveTextContent(parent.id);
    change(/Setback \(m\)/, "88");

    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));
    confirmReplacement();

    expect(context()).toHaveTextContent(child.id);
    expect(context()).toHaveTextContent("Saved child");
    expect(screen.getByLabelText(/Setback \(m\)/)).toHaveValue("1");
    expect(screen.queryByRole("button", { name: "Save Branch" })).not.toBeInTheDocument();
    generate();
    await screen.findByRole("button", { name: "Save Branch" });
    expect(body(4).site).toEqual(child.site_geometry);
  });

  it("blocks changed and invalid drafts even when an earlier successful preview arrives", async () => {
    const pending = deferred<Response>();
    renderWorkspace();
    await enterBranch();
    fetchMock.mockReturnValueOnce(pending.promise);
    generate();
    await screen.findByText("Generating preview…");
    change(/Setback \(m\)/, "invalid");
    await act(async () => pending.resolve(Response.json(previewResponse())));
    expect(await screen.findByRole("button", { name: "Save Branch" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Save branch option" }));
    generate();
    expect(await screen.findByText("Enter a finite decimal number.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [label, value] of [[/Setback \(m\)/, "3.0"], [/Preferred floor count/, "2"], [/GFA target \(m²\)/, "0"]] as const) {
      change(label, value);
      expect(screen.getByRole("button", { name: "Save Branch" })).toBeDisabled();
    }
  });

  it("preserves parent selection and drafts after a failed preview and allows explicit retry", async () => {
    const parent = optionResponse();
    renderWorkspace();
    await enterBranch(parent);
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "INVALID_PREFERENCE", message: "Review preference.", details: [] } }, { status: 422 }))
      .mockResolvedValueOnce(Response.json(previewResponse()));
    change(/Preferred floor count/, "2");
    generate();
    await screen.findByRole("alert");
    expect(context()).toHaveTextContent(parent.id);
    expect(screen.getByLabelText(/Preferred floor count/)).toHaveValue("2");
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    generate();
    await screen.findByRole("button", { name: "Save Branch" });
    expect(context()).toHaveTextContent(parent.id);
    expect(body(3)).toEqual(body(2));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("ignores out-of-order branch previews and saves only the active attempt", async () => {
    const parent = optionResponse();
    const old = deferred<Response>();
    const latest = deferred<Response>();
    renderWorkspace();
    await enterBranch(parent);
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    change(/Setback \(m\)/, "2");
    generate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    change(/Setback \(m\)/, "1");
    generate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const result = previewResponse();
    result.metrics.gfa_m2 = 100;
    await act(async () => latest.resolve(Response.json(result)));
    await screen.findByRole("button", { name: "Save Branch" });
    await act(async () => old.resolve(Response.json(previewResponse())));
    expect(screen.getByText("100 m²", { selector: "dd" })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(Response.json(optionResponse(result, { id: childId, parent_id: parent.id }), { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "Save Branch" }));
    await screen.findByText("Branch saved");
    expect(body(4)).toMatchObject({ hard_constraints: { setback_m: 1 } });
    expect(context()).toHaveTextContent(parent.id);
  });

  it.each(["success", "failure"])("detaches a late branch save %s from a newer preview", async (outcome) => {
    const pending = deferred<Response>();
    renderWorkspace();
    await enterBranch();
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse())).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json(previewResponse()));
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    change(/Setback \(m\)/, "2");
    generate();
    await screen.findByRole("button", { name: "Save Branch" });
    await act(async () => {
      if (outcome === "success") pending.resolve(Response.json(optionResponse(undefined, { id: childId, parent_id: optionResponse().id }), { status: 201 }));
      else pending.reject(new TypeError("Failed to fetch"));
    });
    expect(screen.queryByText("Branch saved")).not.toBeInTheDocument();
    expect(screen.queryByText(childId)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(context()).toHaveTextContent(optionResponse().id);
  });

  it("never displays a saved response in place of the branch preview", async () => {
    const recomputed = previewResponse();
    recomputed.metrics.gfa_m2 = 100;
    renderWorkspace();
    await enterBranch();
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockResolvedValueOnce(Response.json(optionResponse(recomputed, { id: childId, parent_id: optionResponse().id }), { status: 201 }));
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    await screen.findByText("Branch saved");
    expect(screen.getByText("GFA", { selector: "dt" }).parentElement?.querySelector("dd")).toHaveTextContent("3,876 m²");
    expect(screen.queryByText("100 m²", { selector: "dd" })).not.toBeInTheDocument();
  });

  it("starts a new root explicitly and isolates late responses from the old parent", async () => {
    const pending = deferred<Response>();
    renderWorkspace();
    await enterBranch();
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse())).mockReturnValueOnce(pending.promise);
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole("button", { name: "Start New Root" }));
    confirmReplacement();

    expect(context()).toHaveTextContent("New root option");
    expect(context()).not.toHaveTextContent(optionResponse().id);
    expect(screen.getByRole("combobox", { name: "Site shape" })).toHaveValue("rectangle");
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
    await act(async () => pending.resolve(Response.json(optionResponse(undefined, { id: childId, parent_id: optionResponse().id }), { status: 201 })));
    expect(screen.queryByText(childId)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()));
    generate();
    expect(await screen.findByRole("button", { name: "Save Option" })).toBeInTheDocument();
  });

  it("does not fall back to a root save when the selected parent is missing", async () => {
    renderWorkspace();
    await enterBranch();
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockResolvedValueOnce(Response.json({ error: { code: "PARENT_OPTION_NOT_FOUND", message: "Parent option not found.", details: [{ path: "option_id", message: "Unknown parent." }] } }, { status: 404 }));
    generate();
    fireEvent.click(await screen.findByRole("button", { name: "Save Branch" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("selected parent could not be found");
    expect(within(context()).getByText(optionResponse().id)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Option" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "http://localhost:8000/api/v1/options")).toHaveLength(1);
  });
});
