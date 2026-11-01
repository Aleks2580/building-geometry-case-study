import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MassingPreviewResponse, OptionComparisonResponse, OptionResponse } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { optionComparisonResponse } from "../../test/comparisonFixtures";
import { previewResponse } from "../../test/massingFixtures";
import MassingWorkspace from "../massing/MassingWorkspace";
import { optionKeys } from "../options/optionQueries";
import OptionComparison from "./OptionComparison";

const renderer = vi.hoisted(() => ({ render: vi.fn(), mount: vi.fn(), unmount: vi.fn() }));
vi.mock("../visualization/Massing3D", () => ({
  default: function TestRenderer({ result }: { result: MassingPreviewResponse }) {
    renderer.render(result);
    useEffect(() => {
      renderer.mount();
      return () => { renderer.unmount(); };
    }, []);
    return <pre data-testid="comparison-3d-result">{JSON.stringify(result)}</pre>;
  },
}));

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

type Relationship = "parent-child" | "cross-root" | "nested" | "siblings";

function comparisonFor(relationship: Relationship, offset = 0) {
  const response = optionComparisonResponse();
  const [left, right] = response.options;
  left.id = `550e8400-e29b-41d4-a716-44665544000${offset}`;
  right.id = `550e8400-e29b-41d4-a716-44665544000${offset + 1}`;
  left.name = `${relationship} six-floor option`;
  right.name = `${relationship} four-floor option`;
  const ancestorId = "550e8400-e29b-41d4-a716-446655440009";
  left.parent_id = relationship === "nested" || relationship === "siblings" ? ancestorId : null;
  right.parent_id = relationship === "cross-root" ? null : relationship === "siblings" ? ancestorId : left.id;
  return response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mount(response: OptionComparisonResponse, includeWorkspace = false) {
  function component(left: OptionResponse | null, right: OptionResponse | null) {
    return <QueryClientProvider client={client}>
      {includeWorkspace && <MassingWorkspace />}
      <OptionComparison
        // SavedOptionsExplorer uses this boundary to detach a submitted pair immediately.
        key={`${left?.id.toLowerCase() ?? ""}:${right?.id.toLowerCase() ?? ""}`}
        left={left} right={right} onClear={() => {}}
      />
    </QueryClientProvider>;
  }
  const view = render(component(...response.options));
  return {
    ...view,
    select: (next: OptionComparisonResponse) => view.rerender(component(...next.options)),
  };
}

function compare() {
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
}

function results() {
  const region = screen.getByRole("region", { name: "Saved option comparison" });
  for (const label of ["Saved snapshot details", "Inputs and capacity", "Feasibility and diagnostics"]) {
    const summary = within(region).getByText(label, { selector: "summary" });
    if (!summary.parentElement?.hasAttribute("open")) fireEvent.click(summary);
  }
  return region;
}

function displayedResult() {
  return JSON.parse(screen.getByTestId("comparison-3d-result").textContent ?? "null");
}

async function show3D(result: MassingPreviewResponse) {
  fireEvent.click(within(results()).getByRole("button", { name: "3D Massing" }));
  await screen.findByTestId("comparison-3d-result");
  expect(displayedResult()).toEqual(result);
}

function cachedComparison(response: OptionComparisonResponse) {
  return client.getQueryData<OptionComparisonResponse>(optionKeys.comparison(response.options[0].id, response.options[1].id));
}

function expectOrderedRequest(index: number, response: OptionComparisonResponse) {
  expect(fetchMock.mock.calls[index][0]).toBe("http://localhost:8000/api/v1/options/compare");
  expect(JSON.parse(String(fetchMock.mock.calls[index][1]?.body))).toEqual({
    option_ids: response.options.map((option) => option.id),
  });
}

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  renderer.render.mockClear();
  renderer.mount.mockClear();
  renderer.unmount.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

describe("OptionComparison integrated visualization", () => {
  it.each<Relationship>(["parent-child", "cross-root", "nested", "siblings"])(
    "keeps the ordered %s snapshots and backend metrics while switching sides in 3D", async (relationship) => {
      const response = comparisonFor(relationship);
      const original = structuredClone(response);
      fetchMock.mockResolvedValueOnce(Response.json(response));
      const view = mount(response);
      compare();
      await screen.findByRole("heading", { name: "Saved option comparison" });
      expectOrderedRequest(0, response);
      expect(screen.getByRole("radio", { name: "Option 1 plan" })).toBeChecked();
      expect(within(results()).getByRole("button", { name: "2D Plan" })).toHaveAttribute("aria-pressed", "true");
      const metrics = within(results()).getByRole("region", { name: "Actual massing" }).textContent;
      await show3D(response.options[0].result);
      expect(renderer.render.mock.lastCall?.[0]).toBe(cachedComparison(response)?.options[0].result);

      for (const side of [1, 0, 1] as const) {
        fireEvent.click(screen.getByRole("radio", { name: side === 0 ? "Option 1 plan" : "Option 2 plan" }));
        expect(displayedResult()).toEqual(response.options[side].result);
        expect(renderer.render.mock.lastCall?.[0]).toBe(cachedComparison(response)?.options[side].result);
        expect(within(results()).getByRole("button", { name: "3D Massing" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getAllByTestId("comparison-3d-result")).toHaveLength(1);
        expect(within(results()).getByRole("region", { name: "Actual massing" })).toHaveTextContent(metrics!);
      }
      expect(within(results()).getByRole("group", { name: "GFA" })).toHaveTextContent("-1,292 m²");
      expect(within(results()).getByRole("group", { name: "Maximum height" })).toHaveTextContent("Not available");
      for (let cycle = 0; cycle < 3; cycle += 1) {
        fireEvent.click(within(results()).getByRole("button", { name: "2D Plan" }));
        expect(screen.queryByTestId("comparison-3d-result")).not.toBeInTheDocument();
        expect(renderer.unmount).toHaveBeenCalledTimes(renderer.mount.mock.calls.length);
        await show3D(response.options[1].result);
      }
      view.unmount();
      expect(renderer.unmount).toHaveBeenCalledTimes(renderer.mount.mock.calls.length);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(response).toEqual(original);
      expect(cachedComparison(response)).toEqual(original);
    },
  );

  it("clears the old scene when pairs change and isolates a superseded comparison response", async () => {
    const first = comparisonFor("parent-child");
    const pendingPair = comparisonFor("siblings", 2);
    const latest = comparisonFor("nested", 4);
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(first)).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json(latest));
    const view = mount(first);
    compare();
    await screen.findByRole("heading", { name: "Saved option comparison" });
    await show3D(first.options[0].result);

    view.select(pendingPair);
    expect(screen.queryByTestId("comparison-3d-result")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Saved option comparison" })).not.toBeInTheDocument();
    expect(screen.getByText(/No submitted comparison/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    compare();
    await screen.findByText("Loading saved option comparison…");
    const signal = fetchMock.mock.calls[1][1]?.signal;
    view.select(latest);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId("comparison-3d-result")).not.toBeInTheDocument();
    compare();
    await screen.findByRole("heading", { name: `Option 1: ${latest.options[0].name}` });
    await show3D(latest.options[0].result);
    fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
    expect(displayedResult()).toEqual(latest.options[1].result);
    const displayedIdentity = within(results()).getByText(/Displaying Option 2:/).textContent;

    await act(async () => pending.resolve(Response.json(pendingPair)));

    expect(within(results()).getByText(/Displaying Option 2:/)).toHaveTextContent(displayedIdentity!);
    expect(renderer.render.mock.lastCall?.[0]).toBe(cachedComparison(latest)?.options[1].result);
    expect(within(results()).getByRole("button", { name: "3D Massing" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    [first, pendingPair, latest].forEach((response, index) => expectOrderedRequest(index, response));
  });

  it("cancels a pending replacement without restoring a previous 3D scene and permits explicit retry", async () => {
    const first = comparisonFor("cross-root");
    const next = comparisonFor("siblings", 2);
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(first)).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json(next));
    const view = mount(first);
    compare();
    await screen.findByRole("heading", { name: "Saved option comparison" });
    await show3D(first.options[0].result);
    view.select(next);
    compare();
    await screen.findByText("Loading saved option comparison…");
    const signal = fetchMock.mock.calls[1][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "Cancel comparison" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId("comparison-3d-result")).not.toBeInTheDocument();
    expect(renderer.unmount).toHaveBeenCalledTimes(renderer.mount.mock.calls.length);

    await act(async () => pending.resolve(Response.json(next)));
    expect(screen.getByText(/No submitted comparison/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Saved option comparison" })).not.toBeInTheDocument();
    compare();
    await screen.findByRole("heading", { name: "Saved option comparison" });
    expect(within(results()).getByRole("button", { name: "2D Plan" })).toHaveAttribute("aria-pressed", "true");
    await show3D(next.options[0].result);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves the workspace draft, name, preview and Query data throughout comparison 3D changes", async () => {
    const first = comparisonFor("parent-child");
    const next = comparisonFor("nested", 2);
    const preview = previewResponse();
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/preview")) return Response.json(preview);
      const ids = JSON.parse(String(init?.body)).option_ids;
      return Response.json(ids[0] === first.options[0].id ? first : next);
    });
    const view = mount(first, true);
    fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
    await screen.findByRole("heading", { name: "Feasible" });
    const workspace = screen.getByRole("region", { name: "Massing preview" });
    const plan = within(workspace).getByRole("img", { name: "Site plan" });
    const name = screen.getByRole("textbox", { name: "Option name (optional)" });
    const width = screen.getByRole("textbox", { name: "Width (m)" });
    fireEvent.change(name, { target: { value: "Unsent workspace name" } });
    fireEvent.change(width, { target: { value: "invalid" } });
    const queries = client.getQueriesData({ queryKey: ["massing-preview"] });
    const result = queries.find(([, value]) => value !== undefined)?.[1];
    const metrics = within(workspace).getByRole("region", { name: "Actual massing" }).textContent;

    for (const response of [first, next]) {
      view.select(response);
      compare();
      await screen.findByRole("heading", { name: "Saved option comparison" });
      await show3D(response.options[0].result);
      fireEvent.click(screen.getByRole("radio", { name: "Option 2 plan" }));
      expect(displayedResult()).toEqual(response.options[1].result);
      fireEvent.click(within(results()).getByRole("button", { name: "2D Plan" }));
      await show3D(response.options[1].result);

      expect(width).toHaveValue("invalid");
      expect(name).toHaveValue("Unsent workspace name");
      expect(within(workspace).getByRole("img", { name: "Site plan" })).toBe(plan);
      expect(within(workspace).getByRole("button", { name: "2D Plan" })).toHaveAttribute("aria-pressed", "true");
      expect(within(workspace).getByRole("region", { name: "Actual massing" })).toHaveTextContent(metrics!);
      expect(within(workspace).getByRole("button", { name: "Save Option" })).toBeDisabled();
      expect(screen.queryByRole("region", { name: "Replace workspace" })).not.toBeInTheDocument();
      expect(client.getQueriesData({ queryKey: ["massing-preview"] })).toEqual(queries);
      expect(client.getQueriesData({ queryKey: ["massing-preview"] }).find(([, value]) => value !== undefined)?.[1]).toBe(result);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:8000/api/v1/massing/preview",
      "http://localhost:8000/api/v1/options/compare",
      "http://localhost:8000/api/v1/options/compare",
    ]);
  });
});
