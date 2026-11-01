import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MassingPreviewResponse, OptionResponse } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import { previewResponse } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import { optionKeys } from "../options/optionQueries";
import MassingWorkspace from "./MassingWorkspace";

const renderer = vi.hoisted(() => ({ render: vi.fn<(result: MassingPreviewResponse) => void>() }));
vi.mock("../visualization/Massing3D", () => ({
  default: ({ result }: { result: MassingPreviewResponse }) => {
    renderer.render(result);
    return <pre data-testid="3d-result">{JSON.stringify(result)}</pre>;
  },
}));

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();
let requestId = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mount(initial?: OptionResponse) {
  function workspace(option?: OptionResponse) {
    return <QueryClientProvider client={client}>
      <MassingWorkspace openRequest={option ? { optionId: option.id, requestId: `open-${++requestId}` } : null} />
    </QueryClientProvider>;
  }
  const view = render(workspace(initial));
  return { ...view, open: (option: OptionResponse) => view.rerender(workspace(option)) };
}

function generate() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
}

function change(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function setSite(result: MassingPreviewResponse) {
  fireEvent.change(screen.getByRole("combobox", { name: "Site shape" }), { target: { value: "custom" } });
  change(/Site Polygon JSON/, JSON.stringify(result.site));
  change(/Setback \(m\)/, String(result.hard_constraints.setback_m));
}

function expectSubmitted(index: number, result: MassingPreviewResponse) {
  expect(JSON.parse(String(fetchMock.mock.calls[index][1]?.body))).toEqual({
    site: result.site,
    hard_constraints: result.hard_constraints,
    preferences: result.preferences,
    targets: result.targets,
  });
}

async function show3D(result: MassingPreviewResponse) {
  fireEvent.click(screen.getByRole("button", { name: "3D" }));
  expect(JSON.parse((await screen.findByTestId("3d-result")).textContent ?? "null")).toEqual(result);
  expect(renderer.render.mock.lastCall?.[0]).toEqual(result);
}

beforeEach(() => {
  client = createQueryClient();
  requestId = 0;
  renderer.render.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

describe("MassingWorkspace integrated visualization", () => {
  it("defaults to 2D and repeatedly switches the exact submitted result without requests", async () => {
    const result = backendPreviewResponse("notched");
    fetchMock.mockResolvedValueOnce(Response.json(result));
    mount();
    setSite(result);
    generate();
    await screen.findByRole("heading", { name: "Feasible" });
    expectSubmitted(0, result);

    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Site plan" })).toBeInTheDocument();
    expect(renderer.render).not.toHaveBeenCalled();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await show3D(result);
      const cached = client.getQueriesData({ queryKey: ["massing-preview"] }).find(([, data]) => data !== undefined)?.[1];
      expect(renderer.render.mock.lastCall?.[0]).toBe(cached);
      expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
      expect(screen.getByRole("region", { name: "Actual massing" })).toHaveTextContent("6");
      fireEvent.click(screen.getByRole("button", { name: "2D" }));
      expect(screen.queryByTestId("3d-result")).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Site plan" })).toBeInTheDocument();
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps submitted 3D geometry and metrics when valid and invalid drafts remain unsent", async () => {
    const result = previewResponse();
    fetchMock.mockResolvedValueOnce(Response.json(result));
    mount();
    generate();
    await screen.findByRole("heading", { name: "Feasible" });
    await show3D(result);

    change(/Maximum floor count/, "2");
    fireEvent.change(screen.getByRole("combobox", { name: "Site shape" }), { target: { value: "custom" } });
    change(/Site Polygon JSON/, JSON.stringify(backendPreviewResponse("notched").site));
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("3d-result").textContent ?? "null")).toEqual(result);
    expect(screen.getByRole("button", { name: "Save Option" })).toBeDisabled();
    change(/Site Polygon JSON/, "{");
    generate();

    expect(await screen.findByText("Enter valid Polygon JSON.")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("3d-result").textContent ?? "null")).toEqual(result);
    expect(screen.getByText("Floor count", { selector: "dt" }).parentElement?.querySelector("dd")).toHaveTextContent("6");
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    await show3D(result);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("removes a successful 3D scene during a replacement request and after its failure", async () => {
    const pending = deferred<Response>();
    const result = backendPreviewResponse("holed");
    fetchMock.mockResolvedValueOnce(Response.json(result)).mockReturnValueOnce(pending.promise);
    mount();
    setSite(result);
    generate();
    await screen.findByRole("heading", { name: "Feasible" });
    expectSubmitted(0, result);
    await show3D(result);
    change(/Maximum floor count/, "2");
    generate();

    await screen.findByText("Generating preview…");
    expect(screen.queryByTestId("3d-result")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3D" })).not.toBeInTheDocument();
    await act(async () => pending.resolve(new Response("Unavailable", { status: 503 })));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    expect(screen.queryByTestId("3d-result")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("isolates superseded preview responses from the currently selected 3D scene", async () => {
    const old = deferred<Response>();
    const previous = backendPreviewResponse("holed");
    const current = backendPreviewResponse("preferred");
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json(current));
    mount();
    setSite(previous);
    generate();
    await screen.findByText("Generating preview…");
    expectSubmitted(0, previous);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    setSite(current);
    change(/Preferred footprint \(m²\)/, "300");
    change(/Maximum footprint \(m²\)/, "500");
    generate();
    await screen.findByRole("heading", { name: "Feasible" });
    expectSubmitted(1, current);
    await show3D(current);

    expect(signal?.aborted).toBe(true);
    await act(async () => old.resolve(Response.json(previous)));
    expect(JSON.parse(screen.getByTestId("3d-result").textContent ?? "null")).toEqual(current);
    expect(renderer.render.mock.lastCall?.[0]).toEqual(current);
    expect(screen.getByText("Footprint area", { selector: "dt" }).parentElement?.querySelector("dd")).toHaveTextContent("300 m²");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("restores root and child snapshots in 3D without regeneration or previous-option geometry", async () => {
    const root = optionResponse(previewResponse(), { name: "Saved rectangle" });
    const child = optionResponse(backendPreviewResponse("preferred_failed"), {
      id: "550e8400-e29b-41d4-a716-446655440001", parent_id: root.id, name: "Saved child diagnostic",
    });
    const originals = structuredClone([root, child]);
    expect(child.site_geometry).toEqual(root.site_geometry);
    fetchMock.mockResolvedValueOnce(Response.json(root)).mockResolvedValueOnce(Response.json(child));
    const view = mount(root);
    await screen.findByRole("heading", { name: "Saved option snapshot" });
    await show3D(root.result);

    view.open(child);
    await screen.findByText(child.name!);
    expect(screen.queryByTestId("3d-result")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Site plan" }).querySelector('[data-layer="footprint"]')).toBeNull();
    await show3D(child.result);
    expect(renderer.render.mock.lastCall?.[0]).toBe(client.getQueryData<OptionResponse>(optionKeys.detail(child.id))?.result);
    expect(screen.getByRole("heading", { name: "Generation failed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Option" })).not.toBeInTheDocument();

    view.open(root);
    await screen.findByText(root.name!);
    expect(screen.queryByTestId("3d-result")).not.toBeInTheDocument();
    await show3D(root.result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
    expect([root, child]).toEqual(originals);
    expect(client.getQueryData(optionKeys.detail(child.id))).toEqual(originals[1]);
  });

  it("renders a branch preview response while retaining its inherited site and immutable parent", async () => {
    const result = backendPreviewResponse("preferred");
    const parent = optionResponse(previewResponse(), { name: "Immutable parent" });
    const original = structuredClone(parent);
    fetchMock.mockResolvedValueOnce(Response.json(parent)).mockResolvedValueOnce(Response.json(result));
    mount(parent);
    await screen.findByRole("heading", { name: "Saved option snapshot" });
    await show3D(parent.result);
    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));
    expect(screen.getByRole("group", { name: "Inherited site (read-only)" })).toBeInTheDocument();
    expect(screen.queryByTestId("3d-result")).not.toBeInTheDocument();
    change(/Preferred footprint \(m²\)/, "300");
    change(/Maximum footprint \(m²\)/, "500");
    generate();
    await screen.findByRole("button", { name: "Save Branch" });
    await show3D(result);

    expectSubmitted(1, result);
    expect(result.site).toEqual(parent.site_geometry);
    expect(screen.getByRole("region", { name: "Option creation context" })).toHaveTextContent(parent.id);
    expect(screen.getByRole("button", { name: "Save Branch" })).toBeEnabled();
    expect(client.getQueryData(optionKeys.detail(parent.id))).toEqual(original);
    expect(parent).toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
