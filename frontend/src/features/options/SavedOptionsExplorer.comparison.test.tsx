import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionResponse, OptionTree } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { optionComparisonResponse } from "../../test/comparisonFixtures";
import { optionResponse } from "../../test/optionFixtures";
import SavedOptionsExplorer from "./SavedOptionsExplorer";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();
const root = optionResponse();
const child = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440001", parent_id: root.id, name: "Child" });
const sibling = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440002", parent_id: root.id, name: "Sibling" });
const nested = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440003", parent_id: child.id, name: "Nested" });
const other = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440004", name: "Other root" });

function tree(option: OptionResponse, children: OptionTree[] = []): OptionTree {
  return { ...option, metrics: option.result.metrics, children };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/tree?")) return Response.json(url.includes(other.id) ? tree(other)
      : tree(root, [tree(child, [tree(nested)]), tree(sibling)]));
    return Response.json([tree(root), tree(other)]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); client.clear(); });

function ExplorerNavigation() {
  const [view, setView] = useState<"saved-options" | "compare">("saved-options");
  return <SavedOptionsExplorer activeView={view} onViewChange={setView} />;
}

function mount() {
  return render(<QueryClientProvider client={client}><ExplorerNavigation /></QueryClientProvider>);
}

function viewComparison() {
  fireEvent.click(screen.getByRole("button", { name: "View comparison" }));
}

function browseOptions() {
  fireEvent.click(screen.getByRole("button", { name: "Browse saved options" }));
}

async function selectRoot(name = "Rectangle study") {
  const roots = within(screen.getByRole("region", { name: "Root options" }));
  fireEvent.click(await roots.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("list", { name: "Saved decision tree" });
}

function choose(name: string) {
  fireEvent.click(within(screen.getByRole("list", { name: "Saved decision tree" }))
    .getByRole("button", { name: new RegExp(`^${name} `) }));
}

function assign(side: "Option 1" | "Option 2") {
  fireEvent.click(screen.getByRole("button", { name: `Assign to ${side}` }));
}

function slot(side: "Option 1" | "Option 2") {
  return screen.getByRole("region", { name: `${side} comparison selection` });
}

describe("comparison selection in saved histories", () => {
  it("requires explicit assignment and rejects the same identity without losing either slot", async () => {
    mount();
    await selectRoot();
    viewComparison();
    expect(slot("Option 1")).toHaveTextContent("No option selected");
    browseOptions();
    assign("Option 1");
    assign("Option 2");
    expect(screen.getByRole("alert")).toHaveTextContent("two distinct saved options");
    viewComparison();
    expect(slot("Option 1")).toHaveTextContent(root.id);
    expect(slot("Option 2")).toHaveTextContent("No option selected");
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    browseOptions();
    choose("Child");
    assign("Option 2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    viewComparison();
    expect(slot("Option 2")).toHaveTextContent(child.id);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it("keeps roots, siblings, and nested choices independent of tree navigation and supports replacing and clearing", async () => {
    mount();
    await selectRoot();
    assign("Option 1");
    choose("Child"); assign("Option 2");
    viewComparison();
    expect(slot("Option 1")).toHaveTextContent(root.id);
    expect(slot("Option 2")).toHaveTextContent(child.id);
    browseOptions();
    choose("Sibling"); assign("Option 1");
    viewComparison();
    expect(slot("Option 1")).toHaveTextContent(sibling.id);
    browseOptions();
    fireEvent.click(screen.getByRole("button", { name: `Expand branches of Child (${child.id})` }));
    choose("Nested"); assign("Option 2");
    viewComparison();
    expect(slot("Option 2")).toHaveTextContent(nested.id);
    browseOptions();
    await selectRoot("Other root");
    viewComparison();
    expect(slot("Option 1")).toHaveTextContent(sibling.id);
    expect(slot("Option 2")).toHaveTextContent(nested.id);
    browseOptions();
    assign("Option 1");
    expect(screen.getByRole("region", { name: "Selected option summary" })).toHaveTextContent(other.id);
    expect(screen.getByRole("status", { name: "Current comparison selections" })).toHaveTextContent("Other root");
    viewComparison();
    expect(slot("Option 1")).toHaveTextContent(other.id);
    fireEvent.click(screen.getByRole("button", { name: "Clear Option 2" }));
    expect(slot("Option 2")).toHaveTextContent("No option selected");
    expect(slot("Option 1")).toHaveTextContent(other.id);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it("submits a cross-root pair in assignment order and removes its result immediately when a slot changes", async () => {
    const comparison = optionComparisonResponse();
    comparison.options = [other, nested];
    const browse = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => String(input).endsWith("/compare")
      ? Response.json(comparison) : browse(input, init));
    mount();
    await selectRoot();
    fireEvent.click(screen.getByRole("button", { name: `Expand branches of Child (${child.id})` }));
    choose("Nested"); assign("Option 2");
    await selectRoot("Other root"); assign("Option 1");
    viewComparison();
    expect(screen.queryByRole("region", { name: "Saved option comparison" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("region", { name: "Saved option comparison" })).toBeInTheDocument();
    const post = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(post).toHaveLength(1);
    expect(JSON.parse(String(post[0][1]?.body))).toEqual({ option_ids: [other.id, nested.id] });
    const result = screen.getByRole("region", { name: "Saved option comparison" });
    browseOptions();
    expect(screen.queryByRole("region", { name: "Saved option comparison" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected option summary" })).toHaveTextContent(other.id);
    viewComparison();
    expect(screen.getByRole("region", { name: "Saved option comparison" })).toBe(result);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear Option 1" }));
    expect(screen.queryByRole("region", { name: "Saved option comparison" })).not.toBeInTheDocument();
    expect(screen.getByText(/No submitted comparison/)).toBeInTheDocument();
    browseOptions();
    assign("Option 1");
    viewComparison();
    expect(screen.queryByRole("region", { name: "Saved option comparison" })).not.toBeInTheDocument();
  });

  it("aborts an old submitted pair and ignores its late response after a newer pair succeeds", async () => {
    const pending = deferred<Response>();
    const browse = fetchMock.getMockImplementation()!;
    const requests: RequestInit[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      if (!String(input).endsWith("/compare")) return browse(input, init);
      requests.push(init!);
      if (requests.length === 1) return pending.promise;
      const next = optionComparisonResponse();
      next.options = [root, sibling];
      return Response.json(next);
    });
    mount(); await selectRoot(); assign("Option 1"); choose("Child"); assign("Option 2");
    viewComparison();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    browseOptions();
    choose("Sibling"); assign("Option 2");
    expect(requests[0].signal?.aborted).toBe(true);
    expect(screen.queryByText("Loading saved option comparison…")).not.toBeInTheDocument();
    viewComparison();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("region", { name: "Option 2 compared option" })).toHaveTextContent(sibling.id);
    await act(async () => pending.resolve(Response.json(optionComparisonResponse())));
    expect(screen.getByRole("region", { name: "Option 2 compared option" })).toHaveTextContent(sibling.id);
    expect(screen.getByRole("region", { name: "Option 2 compared option" })).not.toHaveTextContent(child.id);
  });
});
